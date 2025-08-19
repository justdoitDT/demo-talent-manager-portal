// src/pane/panes/SubPaneOverviewTab.tsx

import React, { useState }           from 'react';
import { SubDetail }                 from '../../types/subs';

interface Props {
  sub:    SubDetail;
  onSave: (patch: Partial<SubDetail>) => Promise<void>;
}

/* ---------------------------------- */
/* intent / result pretty‑print maps  */
/* ---------------------------------- */
const INTENT_LABEL: Record<string, string> = {
  staffing:        'Staffing',
  sell_project:    'Sell Project',
  recruit_talent:  'Recruit External Talent',
  general_intro:   'General Intro',
  other:           'Other',
};

const RESULT_LABEL: Record<string, string> = {
  no_response: 'No Response',
  pass:        'Pass',
  success:     'Success',
};

/* ---------------------------------- */
/* helper formatters                  */
/* ---------------------------------- */
const fmtDate = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleString() : '—';

const bytesFmt = (n: number) =>
  `${(n / 1024 / 1024).toFixed(1)} MB`;

/* ---------------------------------- */
/* component                          */
/* ---------------------------------- */
export default function OverviewTab({ sub, onSave }: Props) {
  /* editable “result” field */
  const [result, setResult] = useState(sub.result ?? '');
  const dirty = result !== (sub.result ?? '');

  const saveResult = async () => {
    await onSave({ result: result || null });
  };

  /* ——— render ——— */
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        rowGap: 6,
        columnGap: 12,
      }}
    >
      {/* clients ---------------------------------------------- */}
      <label>Client(s)</label>
      <span>
        {sub.clients.length
          ? sub.clients.map(c => c.name).join(', ')
          : '—'}
      </span>

      {/* project basics --------------------------------------- */}
      <label>Project</label>      <span>{sub.project?.title      ?? '—'}</span>
      <label>Media Type</label>   <span>{sub.project?.media_type ?? '—'}</span>

      {/* intent / result -------------------------------------- */}
      <label>Primary Intent</label>
      <span>{INTENT_LABEL[sub.intent_primary ?? ''] ?? '—'}</span>

      <label>Result</label>
      <span>
        <select
          value={result}
          onChange={e => setResult(e.target.value)}
        >
          <option value="">—</option>
          {Object.entries(RESULT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {dirty && (
          <button
            className="btn"
            style={{ marginLeft: 8 }}
            onClick={saveResult}
          >
            Save
          </button>
        )}
      </span>

      {/* writing samples -------------------------------------- */}
      <label>Writing Samples</label>
      <span>
        {sub.writing_samples.length ? (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {sub.writing_samples.map(ws => (
              <li key={ws.id}>
                {ws.filename} &nbsp;
                <small style={{ color: '#666' }}>
                  ({bytesFmt(ws.size_bytes)})
                </small>
              </li>
            ))}
          </ul>
        ) : (
          '—'
        )}
      </span>

      {/* meta ------------------------------------------------- */}
      <label>Created By</label>  <span>{sub.created_by?.name ?? '—'}</span>
      <label>Created At</label> <span>{fmtDate(sub.created_at)}</span>
      <label>Updated At</label> <span>{fmtDate(sub.updated_at)}</span>
    </div>
  );
}
