// frontend/src/components/SubsPage.tsx

import React, {
  CSSProperties,
  useEffect,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { usePane, PanePayload } from '../pane/PaneContext';
import CreateSubModal from '../modals/CreateSubModal';

/* -------------------------------------------------- */
/*  Re‑used feedback modal lifted from Project tab     */
/* -------------------------------------------------- */
// 🔹 KEEP the import path in sync with where this lives in your tree.
//    If you extracted the modal to its own file, update accordingly.
import { ProjectSubFeedbackModal } from '../pane/panes/ProjectPaneSubsTab';

/* ===================== Label maps ===================== */
const INTENT_LABEL: Record<string, string> = {
  staffing:        'Staffing',
  sell_project:    'Sell Project',
  recruit_talent:  'Recruit External Talent',
  general_intro:   'General Intro',
  other:           'Other',
};
const RESULT_LABEL: Record<string, string> = {
  no_response: 'No Response',
  pass: 'Pass',
  success: 'Success',
};
const RESULT_CODES = Object.keys(RESULT_LABEL) as Array<keyof typeof RESULT_LABEL>;

/* ====================== Row shape ====================== */
interface SubRow {
  sub_id: string;
  updated_at: string;
  created_at: string;
  clients: string | null;
  project_id: string | null;
  project_title: string | null;
  media_type: string;
  intent_primary: string | null;
  executives: string | null;
  recipient_company: string | null;
  result: keyof typeof RESULT_LABEL | null;
  feedback_count: number;
  has_positive: boolean;
  recipients?: NormalizedRecipient[];
  clients_list?: { id: string; name: string }[];
}
interface PagedSubs {
  total: number;
  items: SubRow[];
}

/* ===================== Styling helpers ================= */
const th: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: 8,
  verticalAlign: 'bottom',
};
const td: CSSProperties = { ...th, verticalAlign: 'top' };
const iconCell: CSSProperties    = { textAlign: 'center', width: 40, border: '1px solid #ddd' };
const NA = <span style={{ color: '#999' }}>—</span>;
const thClickable: CSSProperties = { ...th, cursor: 'pointer' };

const Spinner: React.FC = () => (
    <div className="spinner" role="status" aria-label="Loading">
      <div />
    </div>
  );

/* ======================== Utils ======================== */
const flatSplit = (list: (string | null)[]) =>
  list.flatMap((s) => (s ?? '').split(',').map((t) => t.trim()).filter(Boolean));
const uniq = <T,>(arr: T[]): T[] => Array.from(new Set(arr));

/* Turn comma‑sep string → individual, trimmed names */
const splitNames = (s: string | null) =>
  (s ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

/* ---------- structured helper copies ---------- */
type RecipientType = 'executive' | 'external_rep' | 'creative';

export type NormalizedRecipient = {
  id: string;
  type: RecipientType;
  name: string;
  company_id?: string|null;
  company_name?: string|null;
};
export type NormalizedClient = { id?: string; name: string };

export const normalizeRecipients = (row: any): NormalizedRecipient[] => {
  const raw = Array.isArray(row.recipients) ? row.recipients : [];
  return raw
    .map((u: any) => ({
      id: u.id ?? u.recipient_id ?? '',
      type: (u.type ?? u.recipient_type) as RecipientType,
      name: u.name ?? '',
      company_id: u.company_id ?? null,
      company_name: u.company_name ?? null,
    }))
    .filter((u: NormalizedRecipient) => u.id && u.name);
};

export const normalizeClients = (row: any): NormalizedClient[] => {
  const list = Array.isArray(row.clients_list) ? row.clients_list : [];
  if (list.length) return list;
  if (row.clients)
    return splitNames(row.clients).map((n: string) => ({ name: n }));
  return [];
};


/* ---------- feedback bubble helpers ---------- */
type FeedbackEntry = {
  id: string;
  created_at: string;
  sentiment: 'positive' | 'not positive';
  text: string;
  source_type: RecipientType;
  source_id: string;
  source_name: string;
};

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


/* ======================================================= */
export default function SubsPage() {
  const { open } = usePane();
  const [sp, setSp] = useSearchParams();
  const [sortKey, setSortKey] = useState<'created' | 'updated'>('created');
  const [asc, setAsc]         = useState(false);
  const clickSort = (k: 'created' | 'updated') => {
      setSortKey(k);
      setAsc(prev => (k === sortKey ? !prev : false));
    };
  
  /* URL‑backed paging params */
  const limit = +(sp.get('limit') ?? 50);
  const offset = +(sp.get('offset') ?? 0);
  const since = +(sp.get('since') ?? 999999);
  const page = Math.floor(offset / limit) + 1;

  /* Filters */
  const clientF = sp.get('client') ?? '';
  const execF = sp.get('exec') ?? '';
  const projF = sp.get('proj') ?? '';
  const mtF = sp.get('media') ?? '';
  const intentF = sp.get('intent') ?? '';
  const compF = sp.get('company') ?? '';
  const resultF = sp.get('result') ?? '';
  const fbF = sp.get('fb') ?? '';

  /* Editing + Modals */
  const [editingId, setEdit] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<keyof typeof RESULT_LABEL>('no_response');
  const [showCreate, setShowCreate] = useState(false);
  const [fbModal, setFbModal] = useState<{
    open: boolean;
    sub?: SubRow;
    sources?: { id: string; type: RecipientType; name: string }[];
  }>({ open: false });

  /* Data */
  const [paged, setPaged] = useState<PagedSubs>({ total: 0, items: [] });
  const subs = useMemo(() => {
    const sorted = [...paged.items];
    const ts = (iso?: string) => new Date(iso ?? '').getTime();
    sorted.sort((a, b) => {
      const aT = sortKey === 'created' ? ts(a.created_at) : ts(a.updated_at);
      const bT = sortKey === 'created' ? ts(b.created_at) : ts(b.updated_at);
      return asc ? aT - bT : bT - aT;
    });
    return sorted;
  }, [paged.items, sortKey, asc]);
  
  /* loading flag for the spinner */
  const [loading, setLoading] = useState(true);
  
  /* ===================================================== */
  /*  Fetch whenever filters / paging change               */
  /* ===================================================== */
  useEffect(() => {
    setLoading(true);
    const params: Record<string, any> = {
      limit,
      offset,
      since_days: since,
      project: projF || undefined,
      media_type: mtF || undefined,
      intent: intentF || undefined,
      company: compF || undefined,
      result: resultF || undefined,
    };
    if (clientF) params.clients = clientF.split('|');
    if (execF) params.executives = execF.split('|');
    switch (fbF) {
      case 'positive':
        params.feedback = 'positive';
        break;
      case 'not_positive':
        params.feedback = 'not_positive';
        break;
      case 'none':
        params.feedback = '0';
        break;
    }

    (async () => {
      const { data } = await api.get<PagedSubs>('/subs', { params });
      const rows = [...data.items];

      /* for any row that’s missing structured bits, call /subs/{id} */
      await Promise.all(
        rows.map(async (row, idx) => {
          if (row.recipients?.length || row.clients_list?.length) return;
          try {
            const { data: full } = await api.get<any>(`/subs/${row.sub_id}`);
            rows[idx] = { ...row, ...full };
          } catch {/* swallow */}
        })
      );

      setPaged({ ...data, items: rows });
    })().finally(() => setLoading(false));

  }, [limit, offset, since, clientF, execF, projF, mtF, intentF, compF, resultF, fbF]);

  /* ===================================================== */
  /*  Column dropdown options generated from current page  */
  /* ===================================================== */
  const clientOpts = useMemo(() => uniq(flatSplit(subs.map((s) => s.clients))), [subs]);
  const execOpts = useMemo(() => uniq(flatSplit(subs.map((s) => s.executives))), [subs]);
  const projOpts = useMemo(() => uniq(subs.map((s) => s.project_title!).filter(Boolean)), [subs]);
  const companyOpts = useMemo(() => uniq(subs.map((s) => s.recipient_company!).filter(Boolean)), [subs]);
  const mediaTypes = ['Feature', 'TV Series', 'Other'];

  /* ===================================================== */
  /*  Helpers to mutate URL search‑params                   */
  /* ===================================================== */
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    v ? next.set(k, v) : next.delete(k);
    next.set('offset', '0');
    setSp(next);
  };
  const goPage = (n: number) => {
    const next = new URLSearchParams(sp);
    next.set('offset', String((n - 1) * limit));
    next.set('limit', String(limit));
    setSp(next);
  };

  /* ===================================================== */
  /*  Edit / Save / Cancel logic for Result column         */
  /* ===================================================== */
  const startEdit = (row: SubRow) => {
    setDraftResult(row.result ?? 'no_response');
    setEdit(row.sub_id);
  };
  const cancelEdit = () => setEdit(null);
  const saveEdit = async (row: SubRow) => {
    if (draftResult === (row.result ?? 'no_response')) {
      cancelEdit();
      return;
    }
    try {
      await api.patch(`/subs/${row.sub_id}`, { result: draftResult });
      setPaged((p) => ({
        ...p,
        items: p.items.map((it) =>
          it.sub_id === row.sub_id ? { ...it, result: draftResult } : it
        ),
      }));
    } finally {
      cancelEdit();
    }
  };

  /* ===================================================== */
  /*  Feedback badge → open feedback modal                 */
  /* ===================================================== */
  const openFeedbackEditor = async (row: SubRow) => {
    // 1) collect from the row if already structured
    let out: { id: string; type: RecipientType; name: string }[] = [];
    const push = (u: any) => {
      if (u?.id && u?.name) {
        out.push({
          id: String(u.id),
          type: u.type as RecipientType,
          name: String(u.name),
        });
      }
    };
    (Array.isArray(row.recipients) ? row.recipients : []).forEach(push);
  
    // 2) fallback: hit the detail endpoint if nothing
    if (!out.length) {
      try {
        const { data } = await api.get<any>(`/subs/${row.sub_id}`);
        (Array.isArray(data.recipients) ? data.recipients : []).forEach(push);
      } catch {
        /* silently ignore */
      }
    }
  
    // 3) dedupe by id
    const seen = new Set<string>();
    out = out.filter(s => !seen.has(s.id) && Boolean(seen.add(s.id)));
  
    // 4) stash into modal state
    setFbModal({ open: true, sub: row, sources: out });
  };
  
  /* ===================================================== */
  /*  Render helpers                                       */
  /* ===================================================== */
  const toDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  /* ===================================================== */
  /*  Feedback bubble                                      */
  /* ===================================================== */
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

    // fetch all feedback rows & resolve source names
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

      entries.sort(
        (a: FeedbackEntry, b: FeedbackEntry) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
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

  /* ----------------------------------------------------- */
  /*  Component                                            */
  /* ----------------------------------------------------- */
  return (
    <div style={{ padding: 16 }}>
      <style>{`
        .clickable{cursor:pointer;color:#046A38}
        .clickable:hover{font-weight:600;color:#046A38}
        .sub-row:hover .hover-btn{visibility:visible}
        .hover-btn{visibility:hidden}
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <button className="tab" onClick={() => setShowCreate(true)}>
          Create New Sub
        </button>
      </div>
      <small style={{ display: 'block', margin: '4px 0' }}>
        Showing {offset + 1}–{Math.min(offset + subs.length, paged.total)} of {paged.total}
      </small>

      {/* Filters */}
      {/* (only the ones that changed behaviour have inputs; rest in table header) */}

      {/* Scroll wrapper so wide table won’t squish */}
      <div style={{ position:'relative', overflowX: 'auto' }}>
        <table style={{ width: '1400px', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={iconCell}>
                <img src="/doubleLeft.png" alt="Open" style={{ width: 18, height: 18 }} />
              </th>

              {/* Clients */}
              <th style={th}>
                <div>Clients</div>
                <div style={{ marginTop: 4 }}>
                  <input
                    placeholder="Filter…"
                    value={clientF}
                    onChange={(e) => setFilter('client', e.target.value)}
                    list="client-list"
                  />
                  <datalist id="client-list">
                    {clientOpts.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </datalist>
                </div>
              </th>

              {/* Project */}
              <th style={th}>
                <div>Project</div>
                <div style={{ marginTop: 4 }}>
                  <input
                    placeholder="Filter…"
                    value={projF}
                    onChange={(e) => setFilter('proj', e.target.value)}
                    list="proj-list"
                  />
                  <datalist id="proj-list">
                    {projOpts.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </datalist>
                </div>
              </th>

              {/* Medium */}
              <th style={th}>
                <div>Media Type</div>
                <div style={{ marginTop: 4 }}>
                  <select value={mtF} onChange={(e) => setFilter('media', e.target.value)}>
                    <option value="">Any</option>
                    {mediaTypes.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </th>

              {/* Intent */}
              <th style={{...th, whiteSpace:'nowrap', width:'1%'}}>
                <div>Intent</div>
                <div style={{ marginTop: 4 }}>
                  <select value={intentF} onChange={(e) => setFilter('intent', e.target.value)}>
                    <option value="">Any</option>
                    <option value="staffing">Staffing</option>
                    <option value="sell_project">Sell Project</option>
                    <option value="recruit_talent">Recruit External Talent</option>
                    <option value="general_intro">General Intro</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </th>

              {/* Executives */}
              <th style={th}>
                <div>Executive(s)</div>
                <div style={{ marginTop: 4 }}>
                  <input
                    placeholder="Filter…"
                    value={execF}
                    onChange={(e) => setFilter('exec', e.target.value)}
                    list="exec-list"
                  />
                  <datalist id="exec-list">
                    {execOpts.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </datalist>
                </div>
              </th>

              {/* Company */}
              <th style={th}>
                <div>Company</div>
                <div style={{ marginTop: 4 }}>
                  <input
                    placeholder="Filter…"
                    value={compF}
                    onChange={(e) => setFilter('company', e.target.value)}
                    list="comp-list"
                  />
                  <datalist id="comp-list">
                    {companyOpts.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </datalist>
                </div>
              </th>

              {/* Result */}
              <th style={th}>
                <div>Result</div>
                <div style={{ marginTop: 4 }}>
                  <select value={resultF} onChange={(e) => setFilter('result', e.target.value)}>
                    <option value="">Any</option>
                    {RESULT_CODES.map((c) => (
                      <option key={c} value={c}>
                        {RESULT_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
              </th>

              {/* Feedback */}
              <th style={th}>
                <div>Feedback</div>
                <div style={{ marginTop: 4 }}>
                  <select value={fbF} onChange={(e) => setFilter('fb', e.target.value)}>
                    <option value="">Any</option>
                    <option value="positive">Positive</option>
                    <option value="not_positive">Not Positive</option>
                    <option value="none">None Received</option>
                  </select>
                </div>
              </th>

              {/* Created */}
              <th
                style={thClickable}
                onClick={() => clickSort('created')}
                title="Sort by Created (default)"
              >
                <div style={{display:'flex',alignItems:'center'}}>
                  <span>Created</span>
                  {sortKey === 'created'
                    ? <span style={{marginLeft:4}}>{asc ? '▲' : '▼'}</span>
                    : <img src="/sortable.png" alt="sortable" style={{marginLeft:4,width:12,height:12}}/>
                  }
                </div>
              </th>

              {/* Updated */}
              <th
                style={thClickable}
                onClick={() => clickSort('updated')}
                title="Sort by Updated"
              >
                <div style={{display:'flex',alignItems:'center'}}>
                  <span>Updated</span>
                  {sortKey === 'updated'
                    ? <span style={{marginLeft:4}}>{asc ? '▲' : '▼'}</span>
                    : <img src="/sortable.png" alt="sortable" style={{marginLeft:4,width:12,height:12}}/>
                  }
                </div>
              </th>

              {/* Edit Button */}
              <th style={{ ...th, width: '1%' }}></th>
            </tr>
          </thead>

          <tbody>
            {subs.map((r) => {
              const inEdit = editingId === r.sub_id;
              const feedbackLabel =
                r.feedback_count === 0
                  ? '—'
                  : r.has_positive
                  ? 'Positive'
                  : 'Not Positive';

              return (
                <tr key={r.sub_id} className="sub-row">
                  {/* open‑pane icon */}
                  <td style={iconCell}>
                    <button
                      type="button"
                      className="open-link hover-btn"
                      title="Open submission"
                      onClick={(e) => {
                        e.stopPropagation();
                        open({ kind: 'sub', id: r.sub_id } as PanePayload);
                      }}
                      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                    >
                      <img src="/doubleLeft.png" alt="" style={{ width: 16, height: 16 }} />
                    </button>
                  </td>

                  {/* Clients */}
                  <td style={td}>
                    {normalizeClients(r).map((c, i) => (
                      <div key={i}>
                        <span
                          className="clickable"
                          onClick={() =>
                            c.id ? open({ kind: 'creative', id: c.id }) : undefined
                          }
                        >
                          {c.name}
                        </span>
                      </div>
                    )) || NA}
                  </td>

                  {/* Project (plain text; click opens project pane if id exists) */}
                  <td
                    style={td}
                    className={r.project_id ? 'clickable' : undefined}
                    onClick={() => r.project_id && open({ kind: 'project', id: r.project_id } as PanePayload)}
                  >
                    {r.project_title ?? NA}
                  </td>

                  {/* Medium */}
                  <td style={td}>{r.media_type}</td>

                  {/* Intent */}
                  <td style={td}>{r.intent_primary ? INTENT_LABEL[r.intent_primary] : '—'}</td>

                  {/* Executives */}
                  <td style={td}>
                    {normalizeRecipients(r)
                      .filter(u => u.type === 'executive' || u.type === 'external_rep')
                      .map(u => (
                        <div key={u.id}>
                          <span
                            className="clickable"
                            onClick={() =>
                              open(u.type === 'executive'
                                ? { kind: 'executive',   id: u.id }
                                : { kind: 'externalRep', id: u.id }
                              )
                            }
                          >
                            {u.name}
                          </span>
                        </div>
                      )) || NA}
                  </td>

                  {/* Company */}
                  <td style={td}>
                    {(() => {
                      // Prefer a structured company (exec / rep row) if we have one
                      const comp = normalizeRecipients(r).find(
                        u => u.company_id && u.company_name
                      );
                      if (comp) {
                        return (
                          <span
                            className="clickable"
                            onClick={() => open({ kind: 'company', id: comp.company_id! })}
                          >
                            {comp.company_name}
                          </span>
                        );
                      }
                      // fallback to legacy string
                      return r.recipient_company ? r.recipient_company : NA;
                    })()}
                  </td>

                  {/* Result with inline edit */}
                  <td style={td}>
                    {inEdit ? (
                      <select
                        value={draftResult}
                        onChange={(e) => setDraftResult(e.target.value as keyof typeof RESULT_LABEL)}
                      >
                        {RESULT_CODES.map((c) => (
                          <option key={c} value={c}>
                            {RESULT_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      r.result ? RESULT_LABEL[r.result] : NA
                    )}
                  </td>

                  {/* Feedback */}
                  <td style={td}>
                    {inEdit ? (
                      /* ── Edit/Add button opens full modal ─────────────── */
                      <button
                        className="btn"
                        onClick={() => openFeedbackEditor(r)}
                      >
                        {r.feedback_count > 0 ? 'Edit Feedback' : 'Add Feedback'}
                      </button>
                    ) : (
                      /* ── View-only mode: badge pops the quick bubble ──── */
                      r.feedback_count > 0 ? (
                        <span
                          className="clickable"
                          onClick={(e) => toggleFeedbackBubble(e, r)}
                          title="Show feedback"
                        >
                          {feedbackLabel}
                        </span>
                      ) : (
                        NA
                      )
                    )}
                  </td>


                  {/* Created */}
                  <td style={td}>
                    <span
                      className="clickable"
                      onClick={() => open({ kind: 'sub', id: r.sub_id } as PanePayload)}
                    >
                      {toDate(r.created_at)}
                    </span>
                  </td>

                  {/* Updated */}
                  <td style={td}>{toDate(r.updated_at)}</td>

                  {/* Row action */}
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {inEdit ? (
                      <>
                        <button className="btn" onClick={() => saveEdit(r)}>
                          Save
                        </button>
                        <button className="btn" style={{ marginLeft: 4 }} onClick={cancelEdit}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button className="btn hover-btn" onClick={() => startEdit(r)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* loading overlay (pinned just below header) */}
        {loading && (
          <div style={{
            position:'absolute', inset:0,
            background:'rgba(255,255,255,.6)',
            display:'flex', justifyContent:'center',
            alignItems:'flex-start', paddingTop:48,   /* ≈ header height */
            zIndex:1000,
          }}>
            <Spinner/>
          </div>
        )}

      </div>

      {/* Pagination */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn" disabled={page === 1} onClick={() => goPage(page - 1)}>
          Prev
        </button>
        <span>
          Page {page}/{Math.max(1, Math.ceil(paged.total / limit))}
        </span>
        <button
          className="btn"
          disabled={offset + limit >= paged.total}
          onClick={() => goPage(page + 1)}
        >
          Next
        </button>
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
                  {/* prominent source name */}
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                    {e.source_name}
                  </div>

                  {/* secondary: sentiment + date */}
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

      {/* Create‑Sub */}
      <CreateSubModal
        isOpen={showCreate}
        onClose={() => {
          setShowCreate(false);
          /* quick refetch */
          setSp((p) => new URLSearchParams(p));
        }}
      />

      {/* Feedback modal */}
      {fbModal.open && fbModal.sub && (
        <ProjectSubFeedbackModal
          subId={fbModal.sub.sub_id}
          availableSources={fbModal.sources ?? []}
          /* pick default when there’s exactly one */
          defaultSource={
            fbModal.sources && fbModal.sources.length === 1
              ? fbModal.sources[0]
              : undefined
          }
          onClose={(changed: boolean) => {
            setFbModal({ open:false });
            if (changed) setSp(p => new URLSearchParams(p));   // quick refresh
          }}
        />
      )}
    </div>
  );
}
