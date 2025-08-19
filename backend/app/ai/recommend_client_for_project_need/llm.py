# backend/app/ai/recommend_client_for_project_need/llm.py

import os
from openai import OpenAI, APIError, RateLimitError, APITimeoutError

USE_OPENAI = os.getenv("OPENAI_API_KEY") is not None
CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")  # solid, cost-efficient default

def generate_justification(project: dict, client: dict, feedback_events: list[dict]) -> str:
    if not USE_OPENAI:
        return _stub_justification(project, client, feedback_events)

    prompt = build_prompt(project, client, feedback_events)
    try:
        client_ = OpenAI()
        resp = client_.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system",
                 "content": "You are a precise, brief development/staffing analyst. Do not invent facts."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=220,
        )
        return (resp.choices[0].message.content or "").strip()
    except (APIError, RateLimitError, APITimeoutError) as e:
        return f"(justification temporarily unavailable: {e})"

def _stub_justification(project: dict, client: dict, feedback_events: list[dict]) -> str:
    lines = []
    lines.append(
        f"{client.get('name') or client['creative_id']} is a fit for "
        f"{project.get('title') or project['project_id']} ({project.get('media_type')})."
    )
    if client.get("credits_for_llm"):
        top = client["credits_for_llm"][:2]
        cite = "; ".join(
            [
                f"{c.get('title')} [{', '.join(c.get('tags') or [])}]"
                for c in top
            ]
        )
        lines.append(f"Relevant credits include {cite}.")
    pos = [e for e in feedback_events if e.get("sentiment") == "positive"]
    if pos:
        names = ", ".join(sorted({e.get("recipient_name") or e.get("recipient_id") for e in pos}))
        lines.append(f"Previously received positive feedback from {names}.")
    if client.get("interests_and_goals"):
        lines.append("Interests: " + "; ".join(client["interests_and_goals"][:2]))
    return " ".join(lines)[:800]


def build_prompt(project: dict, client: dict, feedback_events: list[dict]) -> str:
    staff = ", ".join([s["name"] or s["recipient_id"] for s in project.get("staffing", [])])
    genres = ", ".join(project.get("genres", []))
    notes  = "\n- ".join(project.get("notes", [])[:8])

    lines = []
    lines.append("PROJECT")
    lines.append(f"Title: {project.get('title') or project['project_id']}")
    lines.append(f"Media: {project.get('media_type')}")
    if genres: lines.append(f"Genres: {genres}")
    if staff:  lines.append(f"Staffing entities: {staff}")
    if project.get("description"): lines.append(f"Description: {project['description']}")
    if notes: lines.append(f"Notes:\n- {notes}")

    lines.append("\nCLIENT")
    lines.append(f"Name: {client.get('name') or client['creative_id']}")
    roles = client.get("roles", {})
    lines.append(f"Roles: writer={roles.get('is_writer')} (level={roles.get('writer_level')}), "
                 f"director={roles.get('is_director')} (has_feature={roles.get('has_directed_feature')})")
    lines.append(f"Availability: {client.get('availability') or 'unknown'}")

    cred_lines = []
    for c in client.get("credits_for_llm", [])[:10]:
        cred_lines.append(f"- {c['title']} ({c['media_type']}); tags=[{', '.join(c['tags'])}]; weight={c['weight']:.2f}")
    if cred_lines:
        lines.append("Credits:")
        lines.extend(cred_lines)

    if client.get("interests_and_goals"):
        ig = "; ".join(client["interests_and_goals"][:6])
        lines.append(f"Interests/Goals: {ig}")

    if feedback_events:
        fb_lines = []
        for e in feedback_events[:6]:
            who = e.get("recipient_name") or e.get("recipient_id")
            fb_lines.append(f"- {e.get('created_at')}: {who}: {e.get('sentiment')} — {e.get('feedback_text')}")
        lines.append("Feedback from staffing entities:")
        lines.extend(fb_lines)

    lines.append(
        "\nTASK: Explain why this client is a fit. "
        "Cite specific credits that match the project's media/genres/themes. "
        "Do not discuss feedback at all if none has been received. "
        "Mention any positive or not-positive feedback (by who, when). "
        "Do not mention any metrics. "
        "No fluff; facts only. Brief. Abbreviated. Robotic. "
        "Do NOT invent facts. Keep under ~80 words."
    )
    return "\n".join(lines)
