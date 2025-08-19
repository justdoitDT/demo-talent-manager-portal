// frontend/src/pane/panes/CompanyPaneSubsTab.tsx

import React, {
  CSSProperties, useEffect, useMemo, useRef, useState, useLayoutEffect,
} from 'react';
import api from '../../services/api';
import { PanePayload } from '../PaneContext';


/* ───────────── label helpers ───────────── */
const RESULT_LABEL: Record<string, string> = {
  no_response: 'No Response',
  pass:        'Pass',
  success:     'Success',
};
type ResultCode = keyof typeof RESULT_LABEL;
const RESULT_CODES = Object.keys(RESULT_LABEL) as ResultCode[];

type RecipientType = 'executive' | 'external_rep' | 'creative';

/* ───────────── feedback types ───────────── */
type FeedbackEntry = {
  id: string;
  created_at: string;
  sentiment: 'positive' | 'not positive';
  text: string;
  source_type: RecipientType;
  source_id: string;
  source_name: string;
};

interface SubRow {
  sub_id:            string;
  project_id?:       string | null;
  project_title:     string | null;
  media_type:        string | null;
  intent_primary?:   string | null;
  result:            ResultCode | null;

  // Clients & recipients (from view)
  clients?:          string | null;
  recipients?:       { id: string; type: RecipientType; name: string; company_id?: string|null; company_name?: string|null }[];
  executives?:       string | null;
  recipient_company?:string | null;

  // Feedback summary
  feedback_count:    number;
  has_positive:      boolean;

  // Timestamps
  updated_at:        string;
}

interface PagedSubs { total: number; items: SubRow[]; }

/* ───────────── shared styles ───────────── */
const th: CSSProperties      = { padding: 8, border: '1px solid #ddd', textAlign: 'left', verticalAlign: 'bottom' };
const thClickable: CSSProperties = { ...th, cursor: 'pointer' };
const td: CSSProperties      = { padding: 8, border: '1px solid #ddd' };
const iconCell: CSSProperties = { textAlign: 'center', width: 40, border: '1px solid #ddd' };
const NA = <span style={{ color: '#999' }}>—</span>;

/* ───────────── helpers ───────────── */
function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

/* Resolve a person/source name once and cache it */
const sourceNameCache = new Map<string, string>();
async function resolveSourceName(type: RecipientType, id: string): Promise<string> {
  const key = `${type}:${id}`;
  const cached = sourceNameCache.get(key);
  if (cached) return cached;

  const endpoint =
    type === 'executive'
      ? `/executives/${id}`
      : type === 'creative'
      ? `/creatives/${id}`
      : `/external_reps/${id}`;

  try {
    const { data } = await api.get<any>(endpoint);
    const name = data?.name ?? '(unknown)';
    sourceNameCache.set(key, name);
    return name;
  } catch {
    const name = '(unknown)';
    sourceNameCache.set(key, name);
    return name;
  }
}

/* ───────────────────────────────────────────────────────────────────────────── */

export default function CompanyPaneSubsTab({
  companyId,
  onOpen,
}: {
  companyId: string;
  onOpen: (payload: PanePayload) => void;
}) {
  /* data */
  const [subs, setSubs]       = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);

  /* filters */
  const [projectQ, setProjectQ]   = useState('');
  const [clientsQ, setClientsQ]   = useState('');
  const [recipientQ, setRecipientQ] = useState('');
  const [resultFilter, setResultFilter]     = useState('');        // ''
  const [feedbackFilter, setFeedback]       = useState('');        // '', 'positive', 'not positive', 'none'

  const debouncedProjectQ   = useDebouncedValue(projectQ, 300);
  const debouncedClientsQ   = useDebouncedValue(clientsQ, 300);
  const debouncedRecipientQ = useDebouncedValue(recipientQ, 300);

  /* sort + paging (client-side) */
  // type SortKey = 'updated';
  // const [sortKey] = useState<SortKey>('updated');
  const [asc, setAsc]         = useState<boolean>(false);   // newest first
  const [limit, setLimit]     = useState<number>(50);
  const [offset, setOffset]   = useState<number>(0);
  const page = Math.floor(offset / limit) + 1;

  /* feedback bubble */
  const hostRef   = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<{
    open: boolean;
    entries: FeedbackEntry[];
    x: number;
    y: number;
    mode: 'absolute' | 'fixed';
    anchorTop: number;
    anchorBottom: number;
    placement: 'below' | 'above';
    anchorKey: string | null;
  }>({
    open: false,
    entries: [],
    x: 0,
    y: 0,
    mode: 'absolute',
    anchorTop: 0,
    anchorBottom: 0,
    placement: 'below',
    anchorKey: null,
  });

  useLayoutEffect(() => {
    if (!bubble.open) return;
    const el = bubbleRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const height = rect.height;
    const containerHeight =
      bubble.mode === 'absolute'
        ? (hostRef.current?.getBoundingClientRect().height ?? window.innerHeight)
        : window.innerHeight;

    const MARGIN = 12;
    if (bubble.placement !== 'above' && bubble.y + height > containerHeight - MARGIN) {
      const newY = Math.max(MARGIN, bubble.anchorTop - height - 6);
      setBubble(b => ({ ...b, y: newY, placement: 'above' }));
    }
  }, [bubble.open, bubble.y, bubble.mode, bubble.anchorTop, bubble.placement]);

  useEffect(() => {
    if (!bubble.open) return;
    const onDocClick = () => setBubble(b => ({ ...b, open: false }));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBubble(b => ({ ...b, open: false })); };
    window.addEventListener('click', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [bubble.open]);

  const toggleFeedbackBubble = async (ev: React.MouseEvent, r: SubRow) => {
    ev.preventDefault();
    ev.stopPropagation();
    const anchorKey = `fb:${r.sub_id}`;
    if (bubble.open && bubble.anchorKey === anchorKey) {
      setBubble(b => ({ ...b, open: false }));
      return;
    }

    const cell = ev.currentTarget as HTMLElement;
    const cellRect = cell.getBoundingClientRect();
    const hostRect = hostRef.current?.getBoundingClientRect();
    const useAbsolute =
      !!hostRect &&
      cellRect.top >= (hostRect.top + 40) &&
      cellRect.bottom <= (hostRect.bottom - 40);

    let x: number, y: number, anchorTop: number, anchorBottom: number;
    if (useAbsolute) {
      x = cellRect.left - (hostRect?.left ?? 0);
      y = cellRect.bottom - (hostRect?.top ?? 0) + 6;
      anchorTop = cellRect.top - (hostRect?.top ?? 0);
      anchorBottom = cellRect.bottom - (hostRect?.top ?? 0);
    } else {
      x = cellRect.left;
      y = cellRect.bottom + 6;
      anchorTop = cellRect.top;
      anchorBottom = cellRect.bottom;
    }

    const MAX_WIDTH = 420;
    const MARGIN = 12;
    if (useAbsolute) {
      const containerWidth = hostRect?.width ?? window.innerWidth;
      x = Math.min(x, containerWidth - MAX_WIDTH - MARGIN);
    } else {
      x = Math.min(x, window.innerWidth - MAX_WIDTH - MARGIN);
    }

    // fetch all feedback rows for this sub and resolve source names
    let entries: FeedbackEntry[] = [];
    try {
      const { data } = await api.get<any>(`/subs/${r.sub_id}`); // SubDetail with .feedback[]
      const list: any[] = Array.isArray(data?.feedback) ? data.feedback : [];

      entries = await Promise.all(
        list.map(async (f: any) => {
          const sentiment: 'positive' | 'not positive' =
            f?.sentiment === 'positive' ? 'positive' : 'not positive';
          const st: RecipientType =
            f?.source_type === 'executive' || f?.source_type === 'external_rep'
              ? f.source_type
              : 'creative';

          const source_name = await resolveSourceName(st, String(f?.source_id ?? ''));

          return {
            id: String(f?.id ?? ''),
            created_at: String(f?.created_at ?? ''),
            sentiment,
            text: String(f?.feedback_text ?? '') || '(no feedback text)',
            source_type: st,
            source_id: String(f?.source_id ?? ''),
            source_name,
          } as FeedbackEntry;
        })
      );

      entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } catch {
      entries = [];
    }

    setBubble({
      open: true,
      entries,
      x,
      y,
      mode: useAbsolute ? 'absolute' : 'fixed',
      anchorTop,
      anchorBottom,
      placement: 'below',
      anchorKey,
    });
  };

/* ───────────── fetch data ───────────── */
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        // Try by company ID first (matches recipient_company)
        const byId = await api.get<PagedSubs>('/subs', {
          params: { company: companyId, limit: 500 },
        });
        let items: SubRow[] = byId.data.items || [];

        // If nothing by ID, look up the company name and try again
        if (!items.length) {
          try {
            const { data: comp } = await api.get<{ id: string; name: string }>(
              `/companies/${companyId}`
            );
            const name = comp?.name ?? companyId;
            const byName = await api.get<PagedSubs>('/subs', {
              params: { company: name, limit: 500 },
            });
            items = byName.data.items || [];
          } catch {
            // ignore name lookup failure; we'll just show empty
          }
        }

        if (alive) setSubs(items);
      } catch {
        if (alive) setSubs([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [companyId]);

  /* ───────────── filtering ───────────── */
  const filtered = useMemo(() => {
    const qProj = debouncedProjectQ.trim().toLowerCase();
    const qCli  = debouncedClientsQ.trim().toLowerCase();
    const qRec  = debouncedRecipientQ.trim().toLowerCase();

    return subs.filter(r => {
      if (qProj) {
        const title = (r.project_title ?? '').toLowerCase();
        if (!title.includes(qProj)) return false;
      }

      if (qCli) {
        const s = (r.clients ?? '').toLowerCase();
        if (!s.includes(qCli)) return false;
      }

      if (qRec) {
        // search in recipients (structured if available, otherwise fallback strings)
        const hay: string[] = [];
        if (Array.isArray(r.recipients) && r.recipients.length) {
          r.recipients.forEach(u => {
            if (u?.name) hay.push(u.name);
            if (u?.company_name) hay.push(u.company_name);
          });
        } else {
          if (r.executives) hay.push(r.executives);
          if (r.recipient_company) hay.push(r.recipient_company);
        }
        const has = hay.some(s => (s ?? '').toLowerCase().includes(qRec));
        if (!has) return false;
      }

      if (resultFilter && r.result !== resultFilter) return false;

      if (feedbackFilter) {
        if (feedbackFilter === 'none') {
          if (r.feedback_count > 0) return false;
        } else {
          if (r.feedback_count === 0) return false;
          const label = r.has_positive ? 'positive' : 'not positive';
          if (label !== feedbackFilter) return false;
        }
      }

      return true;
    });
  }, [subs, debouncedProjectQ, debouncedClientsQ, debouncedRecipientQ, resultFilter, feedbackFilter]);

  /* ───────────── sort (Updated only) ───────────── */
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const toTs = (iso?: string | null) => (iso ? new Date(iso).getTime() : -Infinity);
    arr.sort((a, b) => {
      const aT = toTs(a.updated_at);
      const bT = toTs(b.updated_at);
      return asc ? aT - bT : bT - aT;
    });
    return arr;
  }, [filtered, asc]);

  /* ───────────── pagination ───────────── */
  const paged = useMemo(() => sorted.slice(offset, offset + limit), [sorted, offset, limit]);
  const maxPage = Math.max(1, Math.ceil(sorted.length / limit));

  if (loading) return <p style={{ padding: 16 }}>Loading…</p>;

  /* ───────────── render ───────────── */
  return (
    <div ref={hostRef} style={{ padding: 16, position:'relative' }}>
      <style>{`
        .sub-row:hover .open-link,
        .sub-row:hover .row-action { visibility: visible; }
        .open-link, .row-action { visibility: hidden; text-decoration:none; }
        .clickable { cursor: pointer; }
      `}</style>

      <small style={{ display:'block', marginBottom:4 }}>
        Showing {paged.length} of {sorted.length}
      </small>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {/* Open icon */}
            <th style={iconCell}>
              <img src="/doubleLeft.png" alt="Open" style={{ width: 18, height: 18 }} />
            </th>

            {/* Project (search) */}
            <th style={th}>
              <div>Project</div>
              <div style={{ marginTop: 4 }}>
                <input
                  placeholder="Search project…"
                  value={projectQ}
                  onChange={e => { setProjectQ(e.target.value); setOffset(0); }}
                  style={{ width: '95%' }}
                />
              </div>
            </th>

            {/* Clients (search) */}
            <th style={th}>
              <div>Clients</div>
              <div style={{ marginTop: 4 }}>
                <input
                  placeholder="Search clients…"
                  value={clientsQ}
                  onChange={e => { setClientsQ(e.target.value); setOffset(0); }}
                  style={{ width: '95%' }}
                />
              </div>
            </th>

            {/* Recipients (optional free-text search) */}
            <th style={th}>
              <div>Recipients</div>
              <div style={{ marginTop: 4 }}>
                <input
                  placeholder="Search recipients or companies…"
                  value={recipientQ}
                  onChange={e => { setRecipientQ(e.target.value); setOffset(0); }}
                  style={{ width: '95%' }}
                />
              </div>
            </th>

            {/* Result (dropdown filter) */}
            <th style={th}>
              <div>Result</div>
              <div style={{ marginTop: 4 }}>
                <select
                  value={resultFilter}
                  onChange={e => { setResultFilter(e.target.value); setOffset(0); }}
                >
                  <option value="">All</option>
                  {RESULT_CODES.map(c => <option key={c} value={c}>{RESULT_LABEL[c]}</option>)}
                </select>
              </div>
            </th>

            {/* Feedback (dropdown filter) */}
            <th style={th}>
              <div>Feedback</div>
              <div style={{ marginTop: 4 }}>
                <select
                  value={feedbackFilter}
                  onChange={e => { setFeedback(e.target.value); setOffset(0); }}
                >
                  <option value="">All</option>
                  <option value="positive">Positive</option>
                  <option value="not positive">Not Positive</option>
                  <option value="none">None</option>
                </select>
              </div>
            </th>

            {/* Updated (sortable toggle) */}
            <th
              style={thClickable}
              onClick={() => setAsc(v => !v)}
              title="Sort by Updated"
            >
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Updated</span>
                <span style={{ marginLeft:4 }}>{asc ? '▲' : '▼'}</span>
              </div>
              <div style={{ marginTop:4 }}>&nbsp;</div>
            </th>

            {/* Action button column */}
            <th style={{ ...th, width: '1%', whiteSpace: 'nowrap' }} />
          </tr>
        </thead>

        <tbody>
          {paged.map(r => {
            const hasFb = r.feedback_count > 0;
            const fbBadge = hasFb ? (r.has_positive ? 'Positive' : 'Not Positive') : '—';

            return (
              <tr key={r.sub_id} className="sub-row">
                {/* Open sub */}
                <td style={iconCell}>
                  <button
                    type="button"
                    className="open-link"
                    title="Open sub"
                    aria-label={`Open submission ${r.sub_id}`}
                    onClick={(e) => { e.stopPropagation(); onOpen({ kind: 'sub', id: r.sub_id } as PanePayload); }}
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                  >
                    <img src="/doubleLeft.png" alt="" aria-hidden="true" style={{ width:16, height:16 }} />
                  </button>
                </td>

                {/* Project (clickable if id present) */}
                <td style={td}>
                  {r.project_id ? (
                    <span
                      className="clickable"
                      onClick={() => onOpen({ kind: 'project', id: r.project_id! })}
                      title="Open project"
                    >
                      {r.project_title ?? 'Untitled'}
                    </span>
                  ) : (r.project_title ?? NA)}
                </td>

                {/* Clients (string aggregate) */}
                <td style={td}>{r.clients || NA}</td>

                {/* Recipients (structured preferred; fallback to '—') */}
                <td style={td}>
                  {r.recipients?.length ? (
                    <div>
                      {r.recipients.map((rec, idx) => (
                        <div key={`${r.sub_id}:rec:${idx}`} style={{ marginBottom: 6 }}>
                          <span
                            className="clickable"
                            onClick={() => {
                              if (rec.type === 'executive')        onOpen({ kind: 'executive',   id: rec.id });
                              else if (rec.type === 'external_rep') onOpen({ kind: 'externalRep', id: rec.id });
                              else                                   onOpen({ kind: 'creative',    id: rec.id });
                            }}
                            title={`Open ${rec.type}`}
                          >
                            {rec.name}
                          </span>
                          {rec.company_id && rec.company_name ? (
                            <div style={{ paddingLeft: 16, color: '#555' }}>
                              ↳ (
                              <span
                                className="clickable"
                                onClick={() => onOpen({ kind: 'company', id: rec.company_id! })}
                                title="Open company"
                              >
                                {rec.company_name}
                              </span>
                              )
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (r.executives || r.recipient_company || '—')}
                </td>

                {/* Result (read-only here) */}
                <td style={td}>{r.result ? RESULT_LABEL[r.result] : '—'}</td>

                {/* Feedback (bubble on click) */}
                <td style={td}>
                  {hasFb ? (
                    <span
                      className="clickable"
                      onClick={(e) => toggleFeedbackBubble(e, r)}
                      title="Show feedback"
                    >
                      {fbBadge}
                    </span>
                  ) : '—'}
                </td>

                {/* Updated */}
                <td style={td}>{formatDate(r.updated_at)}</td>

                {/* Actions */}
                <td style={{ ...td, width: '1%', whiteSpace: 'nowrap' }}>
                  <button className="btn row-action" onClick={() => onOpen({ kind: 'sub', id: r.sub_id } as PanePayload)}>
                    Open
                  </button>
                </td>
              </tr>
            );
          })}

          {paged.length === 0 && (
            <tr><td colSpan={8} style={{ padding: 16, color:'#666', textAlign:'center' }}>
              No submissions yet.
            </td></tr>
          )}
        </tbody>
      </table>

      {/* pagination */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button className="btn" disabled={page === 1} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</button>
          <span>Page {page} / {maxPage}</span>
          <button className="btn" disabled={page >= maxPage} onClick={() => setOffset(Math.min(sorted.length, offset + limit))}>Next</button>
        </div>
        <div style={{ marginLeft:'auto' }}>
          <label>
            Page size:&nbsp;
            <select
              value={String(limit)}
              onChange={e => { setLimit(Number(e.target.value)); setOffset(0); }}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>
      </div>

      {/* Feedback bubble */}
      {bubble.open && (
        <div
          ref={bubbleRef}
          style={{
            position: bubble.mode === 'absolute' ? 'absolute' : 'fixed',
            left: bubble.x,
            top:  bubble.y,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: 12,
            boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
            maxWidth: 420,
            zIndex: 2000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Feedback</div>

          {bubble.entries.length === 0 ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>(no feedback)</div>
          ) : (
            bubble.entries.map((e, idx) => {
              const dateOnly =
                e.created_at
                  ? new Date(e.created_at).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })
                  : '';

              return (
                <div key={e.id} style={{ marginBottom: idx < bubble.entries.length - 1 ? 12 : 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                    {e.source_name}
                  </div>
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>
                    {e.sentiment === 'positive' ? 'Positive' : 'Not Positive'}
                    {dateOnly ? ` — ${dateOnly}` : ''}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    {e.text || '(no feedback text)'}
                  </div>
                  {idx < bubble.entries.length - 1 && (
                    <hr style={{ border: 0, borderTop: '1px solid #eee', margin: '10px 0 0' }} />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
