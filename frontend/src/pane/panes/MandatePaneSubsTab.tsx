// frontend/src/pane/panes/MandatePaneSubsTab.tsx

import React, {
  CSSProperties, useEffect, useMemo, useRef, useState, useLayoutEffect,
} from 'react';
import api from '../../services/api';
import { usePane } from '../PaneContext';
import { ProjectSubFeedbackModal } from './ProjectPaneSubsTab';

/* ───────────── labels ───────────── */
const RESULT_LABEL: Record<string, string> = {
  no_response: 'No Response',
  pass:        'Pass',
  success:     'Success',
};
type ResultCode = keyof typeof RESULT_LABEL;
const RESULT_CODES = Object.keys(RESULT_LABEL) as ResultCode[];

/* ───────────── types ───────────── */
type RecipientType = 'executive' | 'external_rep' | 'creative';

type FeedbackEntry = {
  id: string;
  created_at: string;
  sentiment: 'positive' | 'not positive';
  text: string;
  source_type: RecipientType;
  source_id: string;
  source_name: string;
};

type APIRow = {
  id:               string;
  project_id:       string | null;
  project_title:    string | null;
  clients?:         { id?: string; name: string }[] | string | null;
  recipients?:      { id: string; kind?: RecipientType; type?: RecipientType; name: string; company_id?: string|null; company_name?: string|null }[];
  executives?:      string | null;
  recipient_company?: string | null;
  feedback?:        'positive' | 'not_positive' | 'none';
  feedback_count?:  number | null;
  has_positive?:    boolean | null;
  result?:          ResultCode | null;
  created_at:       string;
  updated_at:       string;
};

type NormalizedRecipient = {
  id: string;
  type: RecipientType;
  name: string;
  company_id?: string | null;
  company_name?: string | null;
};

type NormalizedClient = { id?: string; name: string };

type Row = {
  sub_id: string;
  project_id: string | null;
  project_title: string | null;

  clients: NormalizedClient[];
  recipients: NormalizedRecipient[];

  result: ResultCode | null;

  feedback_count: number;
  has_positive: boolean;

  created_at: string;
  updated_at: string;
};

/* ───────────── styles ───────────── */
const th: CSSProperties          = { padding: 8, border: '1px solid #ddd', textAlign: 'left', verticalAlign: 'bottom' };
const thClickable: CSSProperties = { ...th, cursor: 'pointer' };
const td: CSSProperties          = { padding: 8, border: '1px solid #ddd', verticalAlign: 'top' };
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

function normalizeRecipients(row: APIRow): NormalizedRecipient[] {
  const raw = Array.isArray(row.recipients) ? row.recipients : [];
  return raw
    .map((u) => ({
      id: String(u.id ?? ''),
      type: (u.kind ?? u.type ?? 'creative') as RecipientType,
      name: String(u.name ?? ''),
      company_id: u.company_id ?? null,
      company_name: u.company_name ?? null,
    }))
    .filter((u) => Boolean(u.id && u.name && u.type));
}

function normalizeClients(row: APIRow): NormalizedClient[] {
  if (Array.isArray(row.clients) && row.clients.length) {
    return row.clients
      .map((c: any) => ({ id: c.id, name: c.name }))
      .filter((c: NormalizedClient) => Boolean(c.name));
  }
  if (typeof row.clients === 'string' && row.clients.trim()) {
    return row.clients
      .split(',')
      .map((s: string) => ({ name: s.trim() }))
      .filter((c: NormalizedClient) => Boolean(c.name));
  }
  return [];
}

const mapAPIRowToRow = (r: APIRow): Row => {
  // derive feedback badge state, with fallback to the older `feedback` summary
  let feedback_count = typeof r.feedback_count === 'number' ? r.feedback_count : 0;
  let has_positive = typeof r.has_positive === 'boolean' ? r.has_positive : false;

  if ((!r.feedback_count && !r.has_positive) && r.feedback) {
    if (r.feedback === 'none') {
      feedback_count = 0; has_positive = false;
    } else if (r.feedback === 'positive') {
      feedback_count = 1; has_positive = true;
    } else {
      feedback_count = 1; has_positive = false; // 'not_positive'
    }
  }
  return {
    sub_id: r.id,
    project_id: r.project_id ?? null,
    project_title: r.project_title ?? null,
    clients: normalizeClients(r),
    recipients: normalizeRecipients(r),
    result: r.result ?? null,
    feedback_count,
    has_positive,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
};

// tiny cache so we don't refetch names repeatedly
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

/* ══════════════════════════════════════════════════════════════ */

export default function MandatePaneSubsTab({ mandateId }: { mandateId: string }) {
  const { open } = usePane();

  /* data */
  const [subs, setSubs]       = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  /* edit state (Result) */
  const [editingId, setEdit]  = useState<string | null>(null);
  const [draft, setDraft]     = useState<ResultCode>('no_response');

  /* feedback modal state (same UX as ProjectPaneSubsTab) */
  type ModalState = {
    open: boolean;
    subId: string | null;
    availableSources: { id: string; type: RecipientType; name: string }[];
    defaultSource?: { id: string; type: RecipientType; name: string };
  };
  const [modal, setModal] = useState<ModalState>({
    open: false,
    subId: null,
    availableSources: [],
    defaultSource: undefined,
  });

  /* filters */
  const [clientQ, setClientQ]       = useState('');
  const [projectQ, setProjectQ]     = useState('');
  const [recipientQ, setRecipientQ] = useState('');
  const [resultFilter, setResultF]  = useState('');
  const [feedbackFilter, setFbF]    = useState(''); // '', 'positive', 'not positive', 'none'
  const debouncedClientQ    = useDebouncedValue(clientQ, 300);
  const debouncedProjectQ   = useDebouncedValue(projectQ, 300);
  const debouncedRecipientQ = useDebouncedValue(recipientQ, 300);

  /* sort + paging */
  type SortKey = 'created' | 'updated';
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [asc, setAsc]         = useState<boolean>(false);
  const [limit, setLimit]     = useState<number>(50);
  const [offset, setOffset]   = useState<number>(0);
  const page = Math.floor(offset / limit) + 1;

  const clickSort = (k: SortKey) => {
    setSortKey(prev => (prev === k ? prev : k));
    setAsc(prev => (sortKey === k ? !prev : (k === 'created' ? false : true)));
    setOffset(0);
  };

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
    x: 0, y: 0,
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

  const toggleFeedbackBubble = async (ev: React.MouseEvent, r: Row) => {
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

    let entries: FeedbackEntry[] = [];
    try {
      const { data } = await api.get<any>(`/subs/${r.sub_id}`);
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

  /* ───────────── fetch ───────────── */
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    (async () => {
      try {
        const { data } = await api.get<APIRow[]>(`/mandates/${mandateId}/subs`);
        const items: Row[] = (data || []).map(mapAPIRowToRow);
        if (mounted) setSubs(items);
      } catch (e) {
        console.error('fetch mandate subs failed', e);
        if (mounted) setSubs([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [mandateId]);

  /* ───────────── actions ───────────── */
  const startEdit  = (r: Row) => { setDraft(r.result ?? 'no_response'); setEdit(r.sub_id); };
  const cancelEdit = () => setEdit(null);

  const saveIfChanged = async (r: Row) => {
    if (draft !== (r.result ?? 'no_response')) {
      await api.patch(`/subs/${r.sub_id}`, { result: draft });
      setSubs(s => s.map(x => (x.sub_id === r.sub_id ? { ...x, result: draft } : x)));
    }
    cancelEdit();
  };

  /* ───────────── filtering ───────────── */
  const filtered = useMemo(() => {
    const qClients = debouncedClientQ.trim().toLowerCase();
    const qProj    = debouncedProjectQ.trim().toLowerCase();
    const qRec     = debouncedRecipientQ.trim().toLowerCase();

    return subs.filter(r => {
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

      if (qClients) {
        const hay: string[] = [];
        r.clients.forEach(c => c?.name && hay.push(c.name));
        if (!hay.some(s => (s ?? '').toLowerCase().includes(qClients))) return false;
      }

      if (qProj) {
        const title = (r.project_title ?? '').toLowerCase();
        if (!title.includes(qProj)) return false;
      }

      if (qRec) {
        const hay: string[] = [];
        r.recipients.forEach(u => {
          if (u?.name) hay.push(u.name);
          if (u?.company_name) hay.push(u.company_name);
        });
        if (!hay.some(s => (s ?? '').toLowerCase().includes(qRec))) return false;
      }

      return true;
    });
  }, [subs, debouncedClientQ, debouncedProjectQ, debouncedRecipientQ, resultFilter, feedbackFilter]);

  /* ───────────── sort ───────────── */
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const toTs = (iso?: string | null) => (iso ? new Date(iso).getTime() : -Infinity);

    arr.sort((a, b) => {
      let aT: number, bT: number;
      if (sortKey === 'created') {
        aT = toTs(a.created_at ?? null);
        bT = toTs(b.created_at ?? null);
      } else {
        aT = toTs(a.updated_at);
        bT = toTs(b.updated_at);
      }
      return asc ? aT - bT : bT - aT;
    });
    return arr;
  }, [filtered, sortKey, asc]);

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
            {/* Clients (search) */}
            <th style={th}>
              <div>Clients</div>
              <div style={{ marginTop: 4 }}>
                <input
                  placeholder="Search clients…"
                  value={clientQ}
                  onChange={e => { setClientQ(e.target.value); setOffset(0); }}
                  style={{ width: '95%' }}
                />
              </div>
            </th>

            {/* Projects (search + created sort) */}
            <th style={thClickable} onClick={() => clickSort('created')} title="Sort by Created">
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Projects</span>
              </div>
              <div style={{ marginTop: 4 }}>
                <input
                  placeholder="Search title…"
                  value={projectQ}
                  onChange={e => { setProjectQ(e.target.value); setOffset(0); }}
                  style={{ width: '95%' }}
                />
              </div>
            </th>

            {/* Recipients (search) */}
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

            {/* Result (filter) */}
            <th style={th}>
              <div>Result</div>
              <div style={{ marginTop: 4 }}>
                <select
                  value={resultFilter}
                  onChange={e => { setResultF(e.target.value); setOffset(0); }}
                >
                  <option value="">All</option>
                  {RESULT_CODES.map(c => <option key={c} value={c}>{RESULT_LABEL[c]}</option>)}
                </select>
              </div>
            </th>

            {/* Feedback (filter) */}
            <th style={th}>
              <div>Feedback</div>
              <div style={{ marginTop: 4 }}>
                <select
                  value={feedbackFilter}
                  onChange={e => { setFbF(e.target.value); setOffset(0); }}
                >
                  <option value="">All</option>
                  <option value="positive">Positive</option>
                  <option value="not positive">Not Positive</option>
                  <option value="none">None</option>
                </select>
              </div>
            </th>

            {/* Created (sortable) */}
            <th
              style={thClickable}
              onClick={() => clickSort('created')}
              title="Sort by Created"
            >
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Created</span>
                {sortKey === 'created'
                  ? <span style={{ marginLeft:4 }}>{asc ? '▲' : '▼'}</span>
                  : <img src="/sortable.png" alt="sortable" style={{ marginLeft:4, width:12, height:12 }} />}
              </div>
              <div style={{ marginTop:4 }}>&nbsp;</div>
            </th>

            {/* Updated (sortable default) */}
            <th
              style={thClickable}
              onClick={() => clickSort('updated')}
              title="Sort by Updated"
            >
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Updated</span>
                {sortKey === 'updated'
                  ? <span style={{ marginLeft:4 }}>{asc ? '▲' : '▼'}</span>
                  : <img src="/sortable.png" alt="sortable" style={{ marginLeft:4, width:12, height:12 }} />}
              </div>
              <div style={{ marginTop:4 }}>&nbsp;</div>
            </th>

            {/* Action button column */}
            <th style={{ ...th, width: '1%', whiteSpace: 'nowrap' }} />
          </tr>
        </thead>

        <tbody>
          {paged.map(r => {
            const isEd = editingId === r.sub_id;
            const hasFb = r.feedback_count > 0;
            const fbBadge = hasFb ? (r.has_positive ? 'Positive' : 'Not Positive') : '—';

            return (
              <tr key={r.sub_id} className="sub-row">
                {/* Clients */}
                <td style={td}>
                  {r.clients.length ? (
                    <div>
                      {r.clients.map((c, idx) => (
                        <div key={`${r.sub_id}:client:${idx}`} style={{ marginBottom: 6 }}>
                          <span
                            className="clickable"
                            role="button"
                            tabIndex={0}
                            title={c.id ? 'Open client' : undefined}
                            onClick={() => { if (c.id) open({ kind: 'creative', id: c.id }); }}
                            onKeyDown={(e) => {
                              if ((e.key === 'Enter' || e.key === ' ') && c.id) {
                                e.preventDefault();
                                open({ kind: 'creative', id: c.id });
                              }
                            }}
                          >
                            {c.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : NA}
                </td>

                {/* Projects */}
                <td style={td}>
                  {r.project_id ? (
                    <span
                      className="clickable"
                      onClick={() => open({ kind: 'project', id: r.project_id! })}
                      title="Open project"
                    >
                      {r.project_title ?? 'Untitled'}
                    </span>
                  ) : (r.project_title ?? NA)}
                </td>

                {/* Recipients */}
                <td style={td}>
                  {r.recipients?.length ? (
                    <div>
                      {r.recipients.map((rec, idx) => (
                        <div key={`${r.sub_id}:rec:${idx}`} style={{ marginBottom: 6 }}>
                          <span
                            className="clickable"
                            role="button"
                            tabIndex={0}
                            title={`Open ${rec.type}`}
                            onClick={() => {
                              if (rec.type === 'executive')        open({ kind: 'executive',   id: rec.id });
                              else if (rec.type === 'external_rep') open({ kind: 'externalRep', id: rec.id });
                              else                                   open({ kind: 'creative',    id: rec.id });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (rec.type === 'executive')        open({ kind: 'executive',   id: rec.id });
                                else if (rec.type === 'external_rep') open({ kind: 'externalRep', id: rec.id });
                                else                                   open({ kind: 'creative',    id: rec.id });
                              }
                            }}
                          >
                            {rec.name}
                          </span>

                          {rec.company_id && rec.company_name ? (
                            <div style={{ paddingLeft: 16, color: '#555' }}>
                              ↳ (
                              <span
                                className="clickable"
                                role="button"
                                tabIndex={0}
                                title="Open company"
                                onClick={() => open({ kind: 'company', id: rec.company_id! })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    open({ kind: 'company', id: rec.company_id! });
                                  }
                                }}
                              >
                                {rec.company_name}
                              </span>
                              )
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    NA
                  )}
                </td>

                {/* Result (editable) */}
                <td style={td}>
                  {isEd ? (
                    <select value={draft} onChange={e => setDraft(e.target.value as ResultCode)}>
                      {RESULT_CODES.map(c => (
                        <option key={c} value={c}>{RESULT_LABEL[c]}</option>
                      ))}
                    </select>
                  ) : (
                    r.result ? RESULT_LABEL[r.result] : '—'
                  )}
                </td>

                {/* Feedback (badge → bubble OR Edit Feedback modal in edit mode) */}
                <td style={td}>
                  {isEd ? (
                    <button
                      className="btn"
                      onClick={async () => {
                        // fetch fresh recipients for the Sub (same as ProjectPaneSubsTab behavior)
                        let availableSources: { id: string; type: RecipientType; name: string }[] = [];
                        try {
                          const { data } = await api.get<any>(`/subs/${r.sub_id}`);
                          const recs: any[] = Array.isArray(data?.recipients) ? data.recipients : [];

                          const seen = new Set<string>();
                          availableSources = recs
                            .map(u => ({
                              id: String(u.id ?? u.recipient_id ?? ''),
                              type: (u.type ?? u.recipient_type) as RecipientType,
                              name: String(u.name ?? ''),
                            }))
                            .filter(s =>
                              Boolean(
                                s.id &&
                                s.name &&
                                (s.type === 'executive' || s.type === 'external_rep' || s.type === 'creative')
                              )
                            )
                            .filter(s => {
                              if (seen.has(s.id)) return false;
                              seen.add(s.id);
                              return true;
                            });
                        } catch {
                          const srcs = Array.isArray(r.recipients) ? r.recipients : [];
                          const seen = new Set<string>();
                          availableSources = srcs
                            .map(u => ({ id: u.id, type: u.type as RecipientType, name: u.name }))
                            .filter(s => {
                              if (!s.id || !s.name || !s.type) return false;
                              if (seen.has(s.id)) return false;
                              seen.add(s.id);
                              return true;
                            });
                        }

                        setModal({
                          open: true,
                          subId: r.sub_id,
                          availableSources,
                          defaultSource: availableSources.length === 1 ? availableSources[0] : undefined,
                        });
                      }}
                    >
                      {r.feedback_count > 0 ? 'Edit Feedback' : 'Add Feedback'}
                    </button>
                  ) : (
                    hasFb ? (
                      <span
                        className="clickable"
                        onClick={(e) => toggleFeedbackBubble(e, r)}
                        title="Show feedback"
                      >
                        {fbBadge}
                      </span>
                    ) : '—'
                  )}
                </td>

                {/* Created */}
                <td style={td}>
                  {formatDate(r.created_at)}
                </td>

                {/* Updated */}
                <td style={td}>{formatDate(r.updated_at)}</td>

                {/* Edit / Save / Cancel */}
                <td style={{ ...td, width: '1%', whiteSpace: 'nowrap' }}>
                  {isEd ? (
                    <>
                      <button className="btn" onClick={() => saveIfChanged(r)}>Save</button>
                      <button className="btn" style={{ marginLeft:4 }} onClick={cancelEdit}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn row-action" onClick={() => startEdit(r)}>Edit</button>
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

      {/* Feedback modal (reused from ProjectPaneSubsTab) */}
      {modal.open && modal.subId && (
        <ProjectSubFeedbackModal
          subId={modal.subId}
          availableSources={modal.availableSources}
          defaultSource={modal.defaultSource}
          onClose={async (changed) => {
            setModal({ open:false, subId:null, availableSources:[], defaultSource:undefined });
            if (changed) {
              try {
                const { data } = await api.get<APIRow[]>(`/mandates/${mandateId}/subs`);
                const items: Row[] = (data || []).map(mapAPIRowToRow);
                setSubs(items);
              } catch (e) {
                console.error('re-fetch mandate subs failed', e);
              }
            }
          }}
        />
      )}
    </div>
  );
}
