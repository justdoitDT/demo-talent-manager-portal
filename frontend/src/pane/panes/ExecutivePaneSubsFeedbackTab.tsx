import React, { CSSProperties, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import api from '../../services/api';
import type { PanePayload } from '../PaneContext';

type ResultCode = 'success' | 'no_response' | 'pass';
const RESULT_LABEL: Record<ResultCode, string> = {
  success: 'Success',
  no_response: 'No Response',
  pass: 'Pass',
};

const INTENT_LABEL: Record<string, string> = {
  staffing:        'Staffing',
  sell_project:    'Sell Project',
  recruit_talent:  'Recruit External Talent',
  general_intro:   'General Intro',
  other:           'Other',
};

interface Row {
  sub_id: string;
  project_id: string | null;
  project_title: string | null;
  media_type: string | null;
  intent_primary: string | null;
  result: ResultCode | null;
  clients: { id: string; name: string }[];
  feedback_id: string | null;
  feedback_sentiment: 'positive' | 'not positive' | null;
  feedback_text: string | null;
  feedback_created_at: string | null;
  sub_created_at: string;
}

interface Paged {
  total: number;
  items: Row[];
}

interface Props {
  executiveId: string;
  onOpen: (payload: PanePayload) => void;
}

const th: CSSProperties = { padding: 8, border: '1px solid #ddd', textAlign: 'left', verticalAlign:'bottom' };
const td: CSSProperties = { padding: 8, border: '1px solid #ddd' };
const iconCell: CSSProperties = { textAlign: 'center', width: 40, border: '1px solid #ddd' };
const NA = <span style={{ color: '#999' }}>—</span>;

function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function ExecutivePaneSubsFeedbackTab({ executiveId, onOpen }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  // raw rows (from server), we’ll filter/sort/page locally
  const [rows, setRows] = useState<Row[]>([]);

  // client-side paging
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const page = Math.floor(offset / limit) + 1;

  // sort (client-side)
  type SortKey = 'sub_date' | 'feedback_date';
  const [sortKey, setSortKey] = useState<SortKey>('sub_date');
  const [asc, setAsc] = useState<boolean>(false); // newest subs first by default

  const clickSort = (k: SortKey) => {
    setSortKey(prev => (prev === k ? prev : k));
    setAsc(prev => (sortKey === k ? !prev : (k === 'sub_date' ? false : true)));
    setOffset(0);
  };

  // filters in header
  const [clientNameFilter, setClientNameFilter] = useState<string>(''); // client-side by name
  const [intentFilter, setIntentFilter]         = useState<string>('');
  const [projectQ, setProjectQ]                 = useState<string>('');
  const [mediaTypeFilter, setMediaType]         = useState<string>('');
  const [resultFilter, setResultFilter]         = useState<string>(''); // success|no_response|pass
  const [feedbackFilter, setFeedback]           = useState<string>(''); // positive|not positive|none|''

  const debouncedProjectQ = useDebouncedValue(projectQ, 300);

  // editing state
  const [editingId, setEdit] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<ResultCode>('no_response');

  // feedback modal state
  const [modal, setModal] = useState<{
    open: boolean;
    subId: string | null;
    feedbackId: string | null;
    initialText: string;
    initialSentiment: 'positive' | 'not positive';
  }>({ open:false, subId:null, feedbackId:null, initialText:'', initialSentiment:'positive' });

  // feedback "bubble" (popover) state — LIVES IN PARENT
  const [bubble, setBubble] = useState<{
    open: boolean;
    text: string;
    x: number;
    y: number;
    anchorId: string | null;
    mode: 'absolute' | 'fixed';       // coordinates are relative to host (absolute) or viewport (fixed)
    anchorTop: number;                 // top of anchor in the same coordinate system as bubble.x/y
    anchorBottom: number;              // bottom of anchor in the same coordinate system
    placement: 'below' | 'above';      // where we *intend* to place it
  }>({
    open: false, text: '', x: 0, y: 0, anchorId: null,
    mode: 'absolute',
    anchorTop: 0, anchorBottom: 0,
    placement: 'below',
  });

  const bubbleRef = useRef<HTMLDivElement>(null);

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
  
    // If bottom would overflow and we haven't flipped yet, flip above
    if (bubble.placement !== 'above' && bubble.y + height > containerHeight - MARGIN) {
      const newY = Math.max(MARGIN, bubble.anchorTop - height - 6);
      setBubble(b => ({ ...b, y: newY, placement: 'above' }));
    }
  }, [bubble.open, bubble.y, bubble.mode, bubble.anchorTop, bubble.placement]);
  

  const toggleBubble = (
    ev: React.MouseEvent,
    text: string | null,
    anchorId: string
  ) => {
    ev.preventDefault();
    ev.stopPropagation();
  
    // Toggle off if clicking the same anchor again
    if (bubble.open && bubble.anchorId === anchorId) {
      setBubble(b => ({ ...b, open: false }));
      return;
    }
  
    const anchorRect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const hostRect   = hostRef.current?.getBoundingClientRect();
  
    const MAX_WIDTH = 420;
    const MARGIN    = 12;
  
    if (hostRect) {
      // Host-relative coordinates
      let x = anchorRect.left   - hostRect.left;
      const anchorTop    = anchorRect.top    - hostRect.top;
      const anchorBottom = anchorRect.bottom - hostRect.top;
  
      // Horizontal clamp inside host
      x = Math.min(x, hostRect.width - MAX_WIDTH - MARGIN);
  
      setBubble({
        open: true,
        text: (text && text.trim()) ? text : '(no feedback text)',
        x,
        y: anchorBottom + 6,           // start below; may flip in layout effect
        anchorId,
        mode: 'absolute',
        anchorTop,
        anchorBottom,
        placement: 'below',
      });
    } else {
      // Fallback: viewport-relative (fixed)
      let x = anchorRect.left;
      const anchorTop    = anchorRect.top;
      const anchorBottom = anchorRect.bottom;
  
      x = Math.min(x, window.innerWidth - MAX_WIDTH - MARGIN);
  
      setBubble({
        open: true,
        text: (text && text.trim()) ? text : '(no feedback text)',
        x,
        y: anchorBottom + 6,
        anchorId,
        mode: 'fixed',
        anchorTop,
        anchorBottom,
        placement: 'below',
      });
    }
  };
  
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

  // ────────────────────────── LOAD ONCE (fetch all) ──────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      // Grab them all so filters/sorts are instant and reliable
      const params = { limit: 1000, offset: 0, order_by: 'sub_date', asc: false };
      const { data } = await api.get<Paged>(`/executives/${executiveId}/subs_feedback`, { params });
      if (!mounted) return;
      setRows(data.items || []);
      setOffset(0);
    })().catch(console.error);
    return () => { mounted = false; };
  }, [executiveId]);

  // options for header dropdowns (from entire dataset)
  const clientOptions = useMemo(() => {
    const names = new Set<string>();
    rows.forEach(r => (r.clients || []).forEach(c => { if (c?.name) names.add(c.name); }));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const intentOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => r.intent_primary && s.add(r.intent_primary));
    return Array.from(s).sort();
  }, [rows]);

  const mediaTypeOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => r.media_type && s.add(r.media_type));
    return Array.from(s).sort();
  }, [rows]);

  // ─────────────────────── CLIENT-SIDE FILTERING ───────────────────────
  const filtered = useMemo(() => {
    const q = debouncedProjectQ.trim().toLowerCase();
    return rows.filter(r => {
      // Client name (substring match on any client name)
      if (clientNameFilter.trim()) {
        const needle = clientNameFilter.trim().toLowerCase();
        const hasClient = (r.clients || []).some(c => (c?.name ?? '').toLowerCase().includes(needle));
        if (!hasClient) return false;
      }

      if (intentFilter && r.intent_primary !== intentFilter) return false;

      if (q) {
        const title = (r.project_title ?? '').toLowerCase();
        if (!title.includes(q)) return false;
      }

      if (mediaTypeFilter && r.media_type !== mediaTypeFilter) return false;

      if (resultFilter && r.result !== resultFilter) return false;

      if (feedbackFilter) {
        if (feedbackFilter === 'none') {
          if (r.feedback_id) return false;
        } else {
          if (!r.feedback_id) return false;
          if (r.feedback_sentiment !== feedbackFilter) return false;
        }
      }

      return true;
    });
  }, [rows, clientNameFilter, intentFilter, debouncedProjectQ, mediaTypeFilter, resultFilter, feedbackFilter]);

  // ─────────────────────── CLIENT-SIDE SORTING ───────────────────────
  const sorted = useMemo(() => {
    const copy = [...filtered];
    const getTime = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : -Infinity);
    copy.sort((a, b) => {
      let aT: number, bT: number;
      if (sortKey === 'sub_date') {
        aT = new Date(a.sub_created_at).getTime();
        bT = new Date(b.sub_created_at).getTime();
      } else {
        aT = getTime(a.feedback_created_at);
        bT = getTime(b.feedback_created_at);
      }
      return asc ? aT - bT : bT - aT;
    });
    return copy;
  }, [filtered, sortKey, asc]);

  // ─────────────────────── CLIENT-SIDE PAGINATION ───────────────────────
  const paged = useMemo(() => {
    return sorted.slice(offset, offset + limit);
  }, [sorted, offset, limit]);

  const maxPage = Math.max(1, Math.ceil(sorted.length / limit));

  // edit helpers
  const startEdit  = (r: Row) => { setDraftResult((r.result ?? 'no_response') as ResultCode); setEdit(r.sub_id); };
  const cancelEdit = () => setEdit(null);

  const saveIfChanged = async (r: Row) => {
    if (draftResult !== (r.result ?? 'no_response')) {
      await api.patch(`/subs/${r.sub_id}`, { result: draftResult });
      setRows(s => s.map(x => (x.sub_id === r.sub_id ? { ...x, result: draftResult } : x)));
    }
    cancelEdit();
  };

  const uiSentimentFromDb = (db: string | null): 'positive' | 'not positive' => {
    if (!db) return 'not positive';
    return db === 'positive' ? 'positive' : 'not positive';
  };

  return (
    <div ref={hostRef} style={{ padding: 12, position: 'relative' }}>
      <style>{`
        .row:hover .open-link,
        .row:hover .row-action { visibility: visible; }
        .open-link, .row-action { visibility: hidden; text-decoration:none; }
      `}</style>

      <small style={{ display:'block', marginBottom:4 }}>
        Showing {paged.length} of {sorted.length}
      </small>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={iconCell}>
              <img src="/doubleLeft.png" alt="Open" style={{ width: 18, height: 18 }} />
            </th>

            {/* Clients (dropdown filter; client-side) */}
            <th style={th}>
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Client(s)</span>
              </div>
              <div style={{ marginTop: 4 }}>
                <select
                  value={clientNameFilter}
                  onChange={e => { setOffset(0); setClientNameFilter(e.target.value); }}
                >
                  <option value="">All</option>
                  {clientOptions.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </th>

            {/* Intent */}
            <th style={th}>
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Intent</span>
              </div>
              <div style={{ marginTop: 4 }}>
                <select value={intentFilter} onChange={e => { setOffset(0); setIntentFilter(e.target.value); }}>
                  <option value="">All</option>
                  {intentOptions.map(k => (
                    <option key={k} value={k}>{INTENT_LABEL[k] || k}</option>
                  ))}
                </select>
              </div>
            </th>

            {/* Project (search; debounced) */}
            <th style={th}>
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Project</span>
              </div>
              <div style={{ marginTop: 4 }}>
                <input
                  placeholder="Search title…"
                  value={projectQ}
                  onChange={e => { setOffset(0); setProjectQ(e.target.value); }}
                  style={{ width: '95%' }}
                />
              </div>
            </th>

            {/* Media Type */}
            <th style={th}>
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Media Type</span>
              </div>
              <div style={{ marginTop: 4 }}>
                <select value={mediaTypeFilter} onChange={e => { setOffset(0); setMediaType(e.target.value); }}>
                  <option value="">All</option>
                  {mediaTypeOptions.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </th>

            {/* Result */}
            <th style={th}>
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Result</span>
              </div>
              <div style={{ marginTop: 4 }}>
                <select value={resultFilter} onChange={e => { setOffset(0); setResultFilter(e.target.value); }}>
                  <option value="">All</option>
                  <option value="success">{RESULT_LABEL.success}</option>
                  <option value="no_response">{RESULT_LABEL.no_response}</option>
                  <option value="pass">{RESULT_LABEL.pass}</option>
                </select>
              </div>
            </th>

            {/* Feedback */}
            <th style={th}>
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Feedback</span>
              </div>
              <div style={{ marginTop: 4 }}>
                <select value={feedbackFilter} onChange={e => { setOffset(0); setFeedback(e.target.value); }}>
                  <option value="">All</option>
                  <option value="positive">Positive</option>
                  <option value="not positive">Not Positive</option>
                  <option value="none">None</option>
                </select>
              </div>
            </th>

            {/* Feedback Date (sortable) */}
            <th
              style={{ ...th, cursor:'pointer' }}
              onClick={() => clickSort('feedback_date')}
              title="Sort by feedback date"
            >
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Feedback Date</span>
                {sortKey === 'feedback_date' ? (
                  <span style={{ marginLeft:4 }}>{asc ? '▲' : '▼'}</span>
                ) : (
                  <img src="/sortable.png" alt="sortable" style={{ marginLeft:4, width:12, height:12 }} />
                )}
              </div>
              <div style={{ marginTop:4 }}>&nbsp;</div>
            </th>

            {/* Sub Date (sortable, default) */}
            <th
              style={{ ...th, cursor:'pointer' }}
              onClick={() => clickSort('sub_date')}
              title="Sort by sub date"
            >
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Sub Date</span>
                {sortKey === 'sub_date' ? (
                  <span style={{ marginLeft:4 }}>{asc ? '▲' : '▼'}</span>
                ) : (
                  <img src="/sortable.png" alt="sortable" style={{ marginLeft:4, width:12, height:12 }} />
                )}
              </div>
              <div style={{ marginTop:4 }}>&nbsp;</div>
            </th>

            <th style={{ ...th, width: 120 }} />
          </tr>
        </thead>

        <tbody>
          {paged.map(r => {
            const isEd = editingId === r.sub_id;
            // const feedbackBadge =
            //   r.feedback_id
            //     ? (r.feedback_sentiment === 'positive' ? 'Positive' : 'Not Positive')
            //     : '–';

            const clientNames = (r.clients || []).map(c => c?.name).filter(Boolean) as string[];

            return (
              <tr key={`${r.sub_id}:${r.feedback_id || 'none'}`} className="row">
                {/* Open sub */}
                <td style={iconCell}>
                  <button
                    type="button"
                    className="open-link"
                    title="Open sub"
                    aria-label={`Open submission ${r.sub_id}`}
                    onClick={() => onOpen({ kind:'sub', id: r.sub_id })}
                    style={{ background:'none', border:0, padding:0, cursor:'pointer' }}
                  >
                    <img src="/doubleLeft.png" alt="" aria-hidden="true" style={{ width:16, height:16 }} />
                  </button>
                </td>

                {/* Clients */}
                <td style={td}>
                  {clientNames.length
                    ? clientNames.map((name, idx) => (
                        <span
                          key={`${r.sub_id}:client:${idx}`}
                          className="clickable"
                          style={{ marginRight: 6 }}
                          onClick={() => {
                            const c = (r.clients || []).find(x => x.name === name);
                            if (c) onOpen({ kind: 'creative', id: c.id });
                          }}
                          title="Open client"
                        >
                          {name}{idx < clientNames.length - 1 ? ',' : ''}
                        </span>
                      ))
                    : NA}
                </td>

                {/* Intent */}
                <td style={td}>{r.intent_primary ? (INTENT_LABEL[r.intent_primary] || r.intent_primary) : NA}</td>

                {/* Project (clickable if id) */}
                <td style={td}>
                  {r.project_id ? (
                    <span
                      className="clickable"
                      onClick={() => r.project_id && onOpen({ kind: 'project', id: r.project_id })}
                      title="Open project"
                    >
                      {r.project_title ?? 'Untitled'}
                    </span>
                  ) : (r.project_title ?? NA)}
                </td>

                {/* Media Type */}
                <td style={td}>{r.media_type ?? NA}</td>

                {/* Result */}
                <td style={td}>
                  {isEd ? (
                    <select value={draftResult} onChange={e => setDraftResult(e.target.value as ResultCode)}>
                      <option value="success">{RESULT_LABEL.success}</option>
                      <option value="no_response">{RESULT_LABEL.no_response}</option>
                      <option value="pass">{RESULT_LABEL.pass}</option>
                    </select>
                  ) : (
                    r.result ? RESULT_LABEL[r.result] : NA
                  )}
                </td>

                {/* Feedback */}
                <td style={td}>
                  {isEd ? (
                    <button
                      className="btn"
                      onClick={() => setModal({
                        open:true,
                        subId:r.sub_id,
                        feedbackId:r.feedback_id || null,
                        initialText: r.feedback_text ?? '',
                        initialSentiment: uiSentimentFromDb(r.feedback_sentiment),
                      })}
                    >
                      {r.feedback_id ? 'Edit Feedback' : 'Add Feedback'}
                    </button>
                  ) : (
                    r.feedback_id ? (
                      <span
                        className="clickable"
                        onClick={(e) => toggleBubble(e, r.feedback_text, `fb:${r.sub_id}:${r.feedback_id || 'none'}`)}
                        title="Show feedback text"
                      >
                        {r.feedback_sentiment === 'positive' ? 'Positive' : 'Not Positive'}
                      </span>
                    ) : '–'
                  )}
                </td>

                {/* Feedback Date */}
                <td style={td}>
                  {r.feedback_created_at
                    ? new Date(r.feedback_created_at).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })
                    : NA}
                </td>

                {/* Sub Date (clickable to open SubPane) */}
                <td style={td}>
                  <span
                    className="clickable"
                    onClick={() => onOpen({ kind:'sub', id:r.sub_id })}
                    title="Open sub"
                  >
                    {new Date(r.sub_created_at).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })}
                  </span>
                </td>

                {/* Edit / Save / Cancel */}
                <td style={td}>
                  {!isEd ? (
                    <button className="btn row-action" onClick={() => startEdit(r)}>Edit</button>
                  ) : (
                    <>
                      <button className="btn" onClick={() => saveIfChanged(r)}>Save</button>
                      <button className="btn" style={{ marginLeft:4 }} onClick={cancelEdit}>Cancel</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
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

      {/* Feedback bubble (parent owns this state) */}
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
            padding: 10,
            boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
            maxWidth: 420,
            zIndex: 2000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Feedback</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{bubble.text}</div>
        </div>
      )}

      {/* Feedback modal */}
      {modal.open && (
        <SubFeedbackModal
          executiveId={executiveId}
          subId={modal.subId!}
          feedbackId={modal.feedbackId}
          initialText={modal.initialText}
          initialSentiment={modal.initialSentiment}
          onClose={async (changed) => {
            setModal({ open:false, subId:null, feedbackId:null, initialText:'', initialSentiment:'positive' });
            if (changed) {
              // cheap refresh of just that sub row
              const params = { limit: 1000, offset: 0, order_by: 'sub_date', asc: false };
              const { data } = await api.get<Paged>(`/executives/${executiveId}/subs_feedback`, { params });
              setRows(data.items || []);
            }
          }}
        />
      )}
    </div>
  );
}

/* Minimal modal; wire into your design system later */
function SubFeedbackModal({
  executiveId,
  subId,
  feedbackId,
  initialText,
  initialSentiment,
  onClose,
}: {
  executiveId: string;
  subId: string;
  feedbackId: string | null;
  initialText: string;
  initialSentiment: 'positive' | 'not positive';
  onClose: (changed: boolean) => void;
}) {
  const [sentiment, setSentiment] = useState<'positive' | 'not positive'>(initialSentiment);
  const [text, setText] = useState<string>(initialText);

  const save = async () => {
    if (feedbackId) {
      await api.patch(`/subs/feedback/${feedbackId}`, {
        sentiment, feedback_text: text || null,
      });
    } else {
      await api.post(`/subs/${subId}/feedback`, {
        id: null,
        sub_id: subId,
        source_type: 'executive',
        source_id: executiveId,
        sentiment,
        feedback_text: text || null,
        actionable_next: null,
      });
    }
    onClose(true);
  };

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
      display:'grid', placeItems:'center', zIndex:3000
    }}>
      <div style={{ background:'#fff', padding:16, borderRadius:8, minWidth:360 }}>
        <h3 style={{ marginTop:0 }}>{feedbackId ? 'Edit Feedback' : 'Add Feedback'}</h3>
        <div style={{ display:'grid', gap:8 }}>
          <label>
            <div>Sentiment</div>
            <select value={sentiment} onChange={e => setSentiment(e.target.value as 'positive'|'not positive')}>
              <option value="positive">Positive</option>
              <option value="not positive">Not Positive</option>
            </select>
          </label>
          <label>
            <div>Feedback</div>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={5} />
          </label>
          <div style={{ display:'flex', gap:8, marginTop:8 }}>
            <button className="btn" onClick={save}>Save</button>
            <button className="btn" onClick={() => onClose(false)}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
