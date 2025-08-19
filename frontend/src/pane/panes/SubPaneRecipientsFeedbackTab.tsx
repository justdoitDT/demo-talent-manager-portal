/* src/pane/panes/SubPaneRecipientsFeedbackTab.tsx */

import React, { useState } from 'react';
import useSWRMutation from 'swr/mutation';
import api from '../../services/api';
import {
  SubDetail,
  SubFeedbackMini,
  RecipientMini,
} from '../../types/subs';

/* ------------------------------------------------------------------ */
/* constants / helpers                                                */
/* ------------------------------------------------------------------ */

type Sentiment = 'positive' | 'not positive';
const SENTIMENT_OPTS: Sentiment[] = ['positive', 'not positive'];

const ROLE_LABEL = (t: string) =>
  t === 'executive' ? 'Executive' :
  t === 'external_rep' ? 'External Rep' :
  t;

/* keys */
const rKey = (r: RecipientMini) => `${r.type}:${r.id}`;

/* ------------------------------------------------------------------ */
/* API helpers                                                        */
/* ------------------------------------------------------------------ */

const removeFB = (_key: string, { arg: { id } }: { arg: { id: string } }) =>
  api.delete(`/subs/feedback/${id}`);

const addFB = (
  _key: string,
  {
    arg: { sub, recip, sentiment, text },
  }: {
    arg: {
      sub: SubDetail;
      recip: RecipientMini;
      sentiment: Sentiment;
      text: string;
    };
  }
) =>
  api.post(`/subs/${sub.id}/feedback`, {
    sub_id: sub.id,
    source_type: recip.type,
    source_id: recip.id,
    sentiment,
    feedback_text: text.trim(),
    actionable_next: null, // no UI for this anymore
  });

const updateFB = (
  _key: string,
  {
    arg: { id, sentiment, text },
  }: {
    arg: {
      id: string;
      sentiment: Sentiment;
      text: string;
    };
  }
) =>
  api.patch(`/subs/feedback/${id}`, {
    sentiment,
    feedback_text: text.trim(),
    actionable_next: null, // keep null
  });

/* ------------------------------------------------------------------ */
/* styles                                                             */
/* ------------------------------------------------------------------ */

const section: React.CSSProperties = { marginBottom: 24 };
const card: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 4, padding: 12, marginBottom: 12 };
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 };
const textarea: React.CSSProperties = { width: '100%', minHeight: 60, resize: 'vertical', padding: 6, fontFamily: 'inherit' };

/* ------------------------------------------------------------------ */
/* component                                                          */
/* ------------------------------------------------------------------ */

interface Props {
  sub: SubDetail;
  onChange: () => void; // parent pane reload
}

export default function RecipientsFeedbackTab({ sub, onChange }: Props) {
  /* SWR mutation hooks */
  const { trigger: deleteFB } = useSWRMutation('delFB', removeFB, { onSuccess: onChange });
  const { trigger: createFB } = useSWRMutation('addFB', addFB, { onSuccess: onChange });
  const { trigger: saveFB   } = useSWRMutation('updFB', updateFB, { onSuccess: onChange });

  /* Map recipient → their feedback list */
  const fbMap: Record<string, SubFeedbackMini[]> = {};
  sub.feedback.forEach((fb) => {
    const k = `${fb.source_type}:${fb.source_id}`;
    (fbMap[k] ??= []).push(fb);
  });

  /* orphaned (no matching recipient on sub) */
  const orphaned = sub.feedback.filter(
    (f) => !sub.recipients.find((r) => rKey(r) === `${f.source_type}:${f.source_id}`)
  );

  /* UI state */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // which feedback row is currently being edited (null = none)
  const [editingId, setEditingId] = useState<string | null>(null);

  // single global “Add new feedback” drawer at the bottom
  const [showAdd, setShowAdd] = useState(false);
  const [newForKey, setNewForKey] = useState<string | null>(
    sub.recipients.length === 1 ? rKey(sub.recipients[0]) : null
  );
  const [newSentiment, setNewSentiment] = useState<Sentiment>('positive');
  const [newText, setNewText] = useState('');

  /* one card (view vs edit) */
  const FeedbackCard = ({
    fb,
    recip,
  }: {
    fb: SubFeedbackMini;
    recip: RecipientMini;
  }) => {
    const isEditing = editingId === fb.id;

    const [sentiment, setSentiment] = useState<Sentiment>(fb.sentiment as Sentiment);
    const [text, setText]           = useState(fb.feedback_text ?? '');

    const dirty =
      sentiment !== (fb.sentiment as Sentiment) ||
      text !== (fb.feedback_text ?? '');

    return (
      <div style={card}>
        {/* Source (prominent) */}
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
          {recip.name}
          {recip.company_name ? ` — ${recip.company_name}` : ''}
          <span style={{ marginLeft: 8, color: '#666', fontWeight: 600 }}>
            ({ROLE_LABEL(recip.type)})
          </span>
        </div>

        {/* Secondary: sentiment + date */}
        {!isEditing && (
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
            {(fb.sentiment === 'positive' ? 'Positive' : 'Not Positive')}
            {fb.created_at
              ? ` · ${new Date(fb.created_at).toLocaleString()}`
              : ''}
          </div>
        )}

        {/* VIEW MODE */}
        {!isEditing && (
          <>
            <div style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>
              {fb.feedback_text ?? <em style={{ color: '#999' }}>No feedback text</em>}
            </div>

            <button className="tab" onClick={() => {
              setEditingId(fb.id);
              // seed edit fields
              setSentiment(fb.sentiment as Sentiment);
              setText(fb.feedback_text ?? '');
            }}>
              Edit
            </button>

            <button
              className={`tab${confirmDeleteId === fb.id ? ' confirm-remove' : ''}`}
              style={{ marginLeft: 6 }}
              onClick={() => {
                if (confirmDeleteId === fb.id) {
                  deleteFB({ id: fb.id });
                  setConfirmDeleteId(null);
                } else {
                  setConfirmDeleteId(fb.id);
                }
              }}
            >
              {confirmDeleteId === fb.id ? 'Confirm Delete' : 'Delete'}
            </button>
          </>
        )}

        {/* EDIT MODE */}
        {isEditing && (
          <>
            <div style={{ marginBottom: 8 }}>
              <label style={label}>Sentiment</label>
              <select value={sentiment} onChange={(e) => setSentiment(e.target.value as Sentiment)}>
                {SENTIMENT_OPTS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={label}>Feedback</label>
              <textarea style={textarea} value={text} onChange={(e) => setText(e.target.value)} />
            </div>

            <button
              className="tab"
              disabled={!dirty}
              onClick={async () => {
                await saveFB({ id: fb.id, sentiment, text });
                setEditingId(null);
              }}
            >
              Save
            </button>
            <button className="tab" style={{ marginLeft: 6 }} onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </>
        )}
      </div>
    );
  };

  /* ----------------------------------------------------------------
     render
     ---------------------------------------------------------------- */
  return (
    <div>
      {/* ───────────── Recipients & their feedback ─────────────── */}
      <h3 style={{ marginTop: 0 }}>Recipients</h3>

      {sub.recipients.map((rec) => {
        const rows = (fbMap[rKey(rec)] ?? []).slice().sort(
          (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
        );

        return (
          <section key={rKey(rec)} style={section}>
            {/* Recipient header */}
            <h4 style={{ margin: '8px 0 12px' }}>
              {rec.name}
              {rec.company_name ? ` — ${rec.company_name}` : ''}
              <small style={{ marginLeft: 8, color: '#666' }}>({ROLE_LABEL(rec.type)})</small>
            </h4>

            {rows.length === 0 && (
              <p style={{ color: '#999' }}>None</p>
            )}

            {rows.map((fb) => (
              <FeedbackCard key={fb.id} fb={fb} recip={rec} />
            ))}
          </section>
        );
      })}

      {/* ───────────── Orphaned feedback (no recipient on Sub) ─────────────── */}
      {orphaned.length > 0 && (
        <section style={section}>
          <h3>Non-Recipients</h3>
          {orphaned.map((fb) => (
            <div key={fb.id} style={card}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                {fb.source_type}:{fb.source_id}
              </p>
              <p style={{ margin: '4px 0', color:'#666' }}>
                {(fb.sentiment === 'positive' ? 'Positive' : 'Not Positive')}
                {fb.created_at ? ` · ${new Date(fb.created_at).toLocaleString()}` : ''}
              </p>
              <div style={{ whiteSpace:'pre-wrap', marginBottom: 8 }}>
                {fb.feedback_text ?? <em style={{ color:'#999' }}>No feedback text</em>}
              </div>

              <button
                className={`tab${confirmDeleteId === fb.id ? ' confirm-remove' : ''}`}
                onClick={() => {
                  if (confirmDeleteId === fb.id) {
                    deleteFB({ id: fb.id });
                    setConfirmDeleteId(null);
                  } else {
                    setConfirmDeleteId(fb.id);
                  }
                }}
              >
                {confirmDeleteId === fb.id ? 'Confirm Delete' : 'Delete'}
              </button>
            </div>
          ))}
        </section>
      )}

      {/* ───────────── Global "Add new feedback" drawer ─────────────── */}
      <section style={section}>
        <button className="tab" onClick={() => setShowAdd(v => !v)} style={{ marginBottom: showAdd ? 8 : 0 }}>
          {showAdd ? 'Hide new feedback' : 'Add new feedback'}
        </button>

        {showAdd && (
          <div style={card}>
            <h4 style={{ margin: '0 0 8px' }}>Add new feedback</h4>

            <div style={{ marginBottom: 8 }}>
              <label style={label}>Feedback source</label>
              {sub.recipients.length <= 1 ? (
                <div style={{ padding: '6px 0' }}>
                  {sub.recipients[0]?.name ?? '(no recipients)'}
                </div>
              ) : (
                <select
                  value={newForKey ?? ''}
                  onChange={(e) => setNewForKey(e.target.value || null)}
                >
                  <option value="">Choose recipient…</option>
                  {sub.recipients.map((r) => (
                    <option key={rKey(r)} value={rKey(r)}>
                      {r.name} ({ROLE_LABEL(r.type)})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={label}>Sentiment</label>
              <select
                value={newSentiment}
                onChange={(e) => setNewSentiment(e.target.value as Sentiment)}
              >
                {SENTIMENT_OPTS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={label}>Feedback</label>
              <textarea
                style={textarea}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Add a new feedback note…"
              />
            </div>

            <button
              className="tab"
              onClick={() => {
                if (sub.recipients.length === 0) {
                  window.alert('This submission has no recipients yet. Add a recipient first.');
                  return;
                }
                if (sub.recipients.length > 1 && !newForKey) {
                  window.alert('Please choose who is providing this feedback.');
                  return;
                }
                const recip =
                  sub.recipients.length === 1
                    ? sub.recipients[0]
                    : sub.recipients.find((r) => rKey(r) === newForKey)!;

                if (!newText.trim()) return;

                createFB({
                  sub,
                  recip,
                  sentiment: newSentiment,
                  text: newText,
                });

                // reset
                setNewText('');
                setNewSentiment('positive');
                setNewForKey(sub.recipients.length === 1 ? rKey(sub.recipients[0]) : null);
                setShowAdd(false);
              }}
              disabled={!newText.trim()}
            >
              Add
            </button>
            <button className="tab" style={{ marginLeft: 8 }} onClick={() => setShowAdd(false)}>
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
