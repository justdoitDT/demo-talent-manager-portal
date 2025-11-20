// frontend/src/pane/panes/CreativePaneProfileTab.tsx
import React, { useEffect, useState } from "react";
import api from "../../services/api";

/* ───────────────────────── Types ─────────────────────────── */
interface Creative {
  id: string;
  name: string | null;
  pronouns: string | null;
  imdb_id: string | null;              // final segment (e.g. "nm1234567")
  birthday: string | null;             // full ISO date or null
  birth_year: number | null;           // separate stored year (may be null)
  phone: string | null;
  email: string | null;
  location: string | null;
  address: string | null;
}

interface SurveyRow { question: string; answer: string | null; }

/* helpers */
const NONE = <em className="text-gray-400">None</em>;

const friendlyBirthday = (iso: string | null, year: number | null) => {
  if (!iso && !year) return NONE;
  if (!iso) return NONE; // spec: year alone counts as None
  const d = new Date(iso);
  const monthDay = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const yr = d.getFullYear();
  if (yr === 9999) return <>{monthDay}</>;
  return <>{monthDay},&nbsp;{yr}</>;
};

/* ───────────────────────── Component ─────────────────────── */
export default function ProfileTab({ creativeId }: { creativeId: string }) {
  const [creative, setCreative] = useState<Creative | null>(null);
  const [survey, setSurvey] = useState<SurveyRow[]>([]);

  // editing state – one field at a time
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [tempValue, setTempValue] = useState<string>("");

  /* ───── fetch data ───── */
  const load = () => {
    api.get<Creative>(`/creatives/${creativeId}`).then((r) => setCreative(r.data));
    api.get<SurveyRow[]>(`/creatives/${creativeId}/survey`).then((r) => setSurvey(r.data));
  };
  useEffect(load, [creativeId]);

  /* ───── patch helpers ───── */
  const patchCreative = (payload: Partial<Creative>) =>
    api.patch(`/creatives/${creativeId}`, payload).then(load);

  const patchSurvey = (q: string, answer: string | null) =>
    api
      .patch(`/creatives/${creativeId}/survey`, [
        { question: q, answer: (answer ?? "").trim() || null },
      ])
      .then(load);

  if (!creative) return <>Loading…</>;

  const detailRows: {
    label: string;
    key: keyof Creative;
    render?: () => React.ReactNode;
  }[] = [
    { label: "Name", key: "name" },
    { label: "Pronouns", key: "pronouns" },
    {
      label: "IMDb",
      key: "imdb_id",
      render: () => {
        if (!creative.imdb_id) return NONE;
        const text = creative.imdb_id.split("/").pop() || creative.imdb_id;
        const link = `https://www.imdb.com/name/${creative.imdb_id}`;
        return (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline-offset-2 hover:underline"
          >
            {text}
          </a>
        );
      },
    },
    { label: "Birthday", key: "birthday", render: () => friendlyBirthday(creative.birthday, creative.birth_year) },
    { label: "Phone", key: "phone" },
    { label: "Email", key: "email" },
    { label: "Location", key: "location" },
    { label: "Address", key: "address" },
  ];

  return (
    <>
      {/* ───────── Personal Details ───────── */}
      <h4 className="mt-0 text-lg font-semibold">Personal Details</h4>
      <table className="w-full max-w-[600px] border-collapse">
        <tbody>
          {detailRows.map(({ label, key, render }) => {
            const val = creative[key];
            const isEditing = editingKey === (key as string);
            const inputType =
              key === "birthday" ? "date" : key === "email" ? "email" : "text";

            return (
              <tr key={key as string} className="group">
                <td className="px-1.5 py-1.5 font-semibold align-top">{label}</td>
                <td className="w-full border border-gray-200 px-1.5 py-1.5">
                  {isEditing ? (
                    /* ——— EDIT MODE ——— */
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        type={inputType}
                        value={tempValue}
                        onChange={(e) => setTempValue(e.target.value)}
                        className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                      />

                      <button
                        className="rounded bg-black px-3 py-1.5 text-white transition hover:opacity-90 active:scale-[0.98]"
                        onClick={() => {
                          let payload: Partial<Creative> = {};

                          if (key === "imdb_id") {
                            // Normalize to nm######## or null
                            let s = (tempValue ?? "").trim();
                            s = s.split("?")[0].split("#")[0]; // strip query/hash
                            if (s.includes("/")) {
                              const parts = s.split("/").filter(Boolean);
                              s = parts[parts.length - 1] ?? "";
                            }
                            const match = s.match(/nm\d{3,9}/i);
                            s = match ? match[0].toLowerCase() : "";
                            (payload as any).imdb_id = s || null;
                          } else if (key === "birthday") {
                            const v = (tempValue ?? "").trim();
                            (payload as any).birthday = v || null;
                          } else {
                            const v = (tempValue ?? "").trim();
                            (payload as any)[key] = v || null;
                          }

                          patchCreative(payload);
                          setEditingKey(null);
                        }}
                      >
                        Save
                      </button>
                      <button
                        className="rounded bg-white px-3 py-1.5 text-black ring-1 ring-gray-300 transition hover:bg-gray-100 active:scale-[0.98]"
                        onClick={() => setEditingKey(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    /* ——— READ-ONLY MODE ——— */
                    <div className="flex items-center justify-between">
                      <span className="transition group-hover:opacity-90">
                        {render ? render() : (val ?? NONE)}
                      </span>
                      <button
                        className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto
                                   rounded bg-white px-3 py-1.5 text-black ring-1 ring-gray-300 transition
                                   hover:bg-gray-100 active:scale-[0.98]"
                        onClick={() => {
                          setTempValue((val ?? "") as string);
                          setEditingKey(key as string);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ───────── Interests & Feedback ───────── */}
      <h4 className="mt-8 text-lg font-semibold">Interests&nbsp;&amp;&nbsp;Feedback</h4>
      {survey.length === 0 ? (
        <p className="text-gray-700">No survey on file.</p>
      ) : (
        <table className="w-full border-collapse">
          <tbody>
            {survey.map(({ question, answer }) => {
              const isEditing = editingKey === question;
              return (
                <tr key={question} className="group">
                  <td className="px-1.5 py-1.5 font-semibold align-top">{question}</td>
                  <td className="w-full border border-gray-200 px-1.5 py-1.5">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={tempValue}
                          onChange={(e) => setTempValue(e.target.value)}
                          className="w-8/12 rounded border border-gray-300 px-3 py-2 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                        />
                        <button
                          className="rounded bg-black px-3 py-1.5 text-white transition hover:opacity-90 active:scale-[0.98]"
                          onClick={() => {
                            patchSurvey(question, tempValue.trim());
                            setEditingKey(null);
                          }}
                        >
                          Save
                        </button>
                        <button
                          className="rounded bg-white px-3 py-1.5 text-black ring-1 ring-gray-300 transition hover:bg-gray-100 active:scale-[0.98]"
                          onClick={() => setEditingKey(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="transition group-hover:opacity-90">
                          {answer ? answer : NONE}
                        </span>
                        <button
                          className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto
                                     ml-2 rounded bg-white px-3 py-1.5 text-black ring-1 ring-gray-300 transition
                                     hover:bg-gray-100 active:scale-[0.98]"
                          onClick={() => {
                            setTempValue(answer ?? "");
                            setEditingKey(question);
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
