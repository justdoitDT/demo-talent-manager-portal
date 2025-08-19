// frontend/src/pane/panes/CreativePaneProfileTab.tsx

import React, { useEffect, useState } from 'react';
import api from '../../services/api';

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

/* helper – display “None” consistently */
const NONE = <em style={{ color: '#999' }}>None</em>;

/* helper – get “Month D[ YYYY]” string per business rule */
const friendlyBirthday = (iso: string | null, year: number | null) => {
  if (!iso && !year) return NONE;
  if (!iso) return NONE; // spec: year alone counts as None

  // Parse keeping local tz harmless – we need only month/day/year
  const d = new Date(iso);
  const monthDay = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const yr = d.getFullYear();

  // if we were passed 9999 (placeholder when only month/day known)
  // show just month & day
  if (yr === 9999) return <>{monthDay}</>;

  // otherwise, include year if it actually exists in record OR matches stored birth_year
  return <>{monthDay}, {yr}</>;
};

/* ───────────────────────── Component ─────────────────────── */
export default function ProfileTab({ creativeId }: { creativeId: string }) {
  const [creative, setCreative] = useState<Creative | null>(null);
  const [survey, setSurvey] = useState<SurveyRow[]>([]);

  // editing state – one field at a time
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [tempValue, setTempValue] = useState<string>('');
  const [hoverKey,   setHoverKey]   = useState<string | null>(null);

  /* ───── fetch data ───── */
  const load = () => {
    api.get<Creative>(`/creatives/${creativeId}`).then(r => setCreative(r.data));
    api.get<SurveyRow[]>(`/creatives/${creativeId}/survey`).then(r => setSurvey(r.data));
  };

  useEffect(load, [creativeId]);

  /* ───── patch helpers ───── */
  const patchCreative = (payload: Partial<Creative>) =>
    api.patch(`/creatives/${creativeId}`, payload).then(load);

  const patchSurvey = (q: string, answer: string | null) =>
    api
      .patch(`/creatives/${creativeId}/survey`, [
        { question: q, answer: (answer ?? '').trim() || null }
      ])
      .then(load);

  /* ───── field‑level UI pieces ───── */
  const cellLabel: React.CSSProperties = { fontWeight: 600, padding: 6 };
  const cell: React.CSSProperties = { border: '1px solid #ddd', padding: 6 };

  /* guards */
  if (!creative) return <>Loading…</>;

  const detailRows: { label: string; key: keyof Creative; render?: () => React.ReactNode }[] = [
    { label: 'Name',       key: 'name' },
    { label: 'Pronouns',   key: 'pronouns' },
    { label: 'IMDb',       key: 'imdb_id', render: () => {
        if (!creative.imdb_id) return NONE;
        const text = creative.imdb_id.split('/').pop() || creative.imdb_id;
        const link = `https://www.imdb.com/name/${creative.imdb_id}`;
        return <a href={link} target="_blank" rel="noreferrer">{text}</a>;
      }} ,
    { label: 'Birthday',   key: 'birthday', render: () => friendlyBirthday(creative.birthday, creative.birth_year) },
    { label: 'Phone',      key: 'phone' },
    { label: 'Email',      key: 'email' },
    { label: 'Location',   key: 'location' },
    { label: 'Address',    key: 'address' },
  ];

  /* ───────────────────────── render ───────────────────────── */
  console.log('creative.email=', creative.email);
  return (
    <>
      {/* ───────── Personal Details ───────── */}
      <h4 style={{ marginTop: 0 }}>Personal Details</h4>
      <table style={{ borderCollapse:'collapse', width:'100%', maxWidth:600 }}>
        <tbody>
          {detailRows.map(({ label, key, render }) => {
            const val       = creative[key];
            const isEditing = editingKey === key;

            /* pick an <input> type for this field */
            const inputType =
              key === 'birthday' ? 'date' :
              key === 'email'    ? 'email' :
              'text';

            return (
              <tr
                key={key as string}
                onMouseEnter={() => setHoverKey(key as string)}
                onMouseLeave={() => setHoverKey(null)}
              >
                <td style={cellLabel}>{label}</td>
                <td style={{ ...cell, width:'100%' }}>
                  {isEditing ? (
                    /* ——— EDIT MODE ——— */
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <input
                        autoFocus
                        type={inputType}
                        value={tempValue}
                        onChange={e => setTempValue(e.target.value)}
                        style={{ flex:1, minWidth:0 }}
                      />

                      <button
                        className="btn"
                        onClick={() => {
                          let payload: Partial<Creative> = {};
                        
                          if (key === 'imdb_id') {
                            // Normalize to nm######## or null
                            let s = (tempValue ?? '').trim();
                        
                            // strip query/hash
                            s = s.split('?')[0].split('#')[0];
                        
                            // if a URL or path, grab the last non-empty segment
                            if (s.includes('/')) {
                              const parts = s.split('/').filter(Boolean);
                              s = parts[parts.length - 1] ?? '';
                            }
                        
                            // try to extract nm id if embedded
                            const match = s.match(/nm\d{3,9}/i);
                            s = match ? match[0].toLowerCase() : '';
                        
                            payload.imdb_id = s || null; // NEVER send ''
                          } else if (key === 'birthday') {
                            // empty -> null, otherwise keep as ISO yyyy-mm-dd
                            const v = (tempValue ?? '').trim();
                            payload.birthday = v || null;
                          } else {
                            // generic text fields: empty -> null
                            const v = (tempValue ?? '').trim();
                            (payload as any)[key] = v || null;
                          }
                        
                          patchCreative(payload);
                          setEditingKey(null);
                        }}

                      >
                        Save
                      </button>
                      <button
                        className="btn"
                        onClick={() => setEditingKey(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    /* ——— READ-ONLY MODE ——— */
                    <div style={{
                      display:'flex',
                      justifyContent:'space-between',
                      alignItems:'center',
                    }}>
                      {/* value renderer */}
                      <span>
                        {render ? render() : (val ?? NONE)}
                      </span>

                      {/* Edit button only visible on hover */}
                      <button
                        className="btn"
                        style={{
                          marginLeft:8,
                          visibility: hoverKey === key ? 'visible' : 'hidden',
                        }}
                        onClick={() => {
                          setTempValue((val ?? '') as string);
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
      <h4 style={{ marginTop: 32 }}>Interests & Feedback</h4>
      {survey.length === 0 ? (
        <p>No survey on file.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {survey.map(({ question, answer }) => {
              const isEditing = editingKey === question;
              return (
                <tr key={question}>
                  <td style={cellLabel}>{question}</td>
                  <td style={{ ...cell, width: '100%' }}>
                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          value={tempValue}
                          onChange={e => setTempValue(e.target.value)}
                          style={{ width: '70%' }}
                        />
                        <button className="btn" style={{ marginLeft: 8 }} onClick={() => {
                          patchSurvey(question, tempValue.trim());
                          setEditingKey(null);
                        }}>Save</button>
                        <button className="btn" onClick={() => setEditingKey(null)} style={{ marginLeft: 4 }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        {answer ? answer : NONE}&nbsp;
                        <button
                          className="btn"
                          style={{ marginLeft: 8 }}
                          onClick={() => {
                            setTempValue(answer ?? '');
                            setEditingKey(question);
                          }}
                        >Edit</button>
                      </>
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
