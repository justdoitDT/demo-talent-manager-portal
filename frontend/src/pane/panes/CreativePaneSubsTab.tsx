// frontend/src/pane/panes/CreativePaneSubsTab.tsx

import React, {
  CSSProperties, useEffect, useMemo, useRef, useState, useLayoutEffect,
} from 'react';
import api from '../../services/api';
import { PanePayload } from '../PaneContext';
import CreateSubModal from '../../modals/CreateSubModal';

/* ───────────── label helpers ───────────── */
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
type ResultCode = keyof typeof RESULT_LABEL;
const RESULT_CODES = Object.keys(RESULT_LABEL) as ResultCode[];

type RecipientType = 'executive' | 'external_rep' | 'creative';

/* ───────────── feedback ───────────── */
type FeedbackItem = {
  id: string;
  sentiment: 'positive' | 'not positive' | string;
  feedback_text: string | null;
  created_at: string;
  source_type?: string;
  source_id?: string;
};

type FeedbackEntry = {
  id: string;
  created_at: string;
  sentiment: 'positive' | 'not positive';
  text: string;
  source_type: RecipientType;
  source_id: string;
  source_name: string;     // ← resolved name (new)
};

// tiny cache so we don't refetch names repeatedly
const sourceNameCache = new Map<string, string>();

async function resolveSourceName(type: RecipientType, id: string): Promise<string> {
  const key = `${type}:${id}`;
  const cached = sourceNameCache.get(key);
  if (cached) return cached;

  // Adjust these endpoints if your API differs
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

// interface RecipientRow {
//   recipient_type: RecipientType;
//   recipient_id:   string;
//   name:           string | null;
//   company_id:     string | null;
//   company_name:   string | null;
// }

interface SubRow {
  sub_id:            string;
  project_id?:       string | null;
  project_title:     string | null;
  media_type:        string | null;
  intent_primary:    keyof typeof INTENT_LABEL | null;
  result:            ResultCode | null;

  // Feedback summary (counts + quick sentiment)
  feedback_count:    number;
  has_positive:      boolean;

  // Timestamps
  created_at:        string;
  updated_at:        string;

  // Recipients & Feedback
  recipients:      { id: string; type: 'executive'|'external_rep'|'creative'; name: string; company_id?: string|null; company_name?: string|null }[];
  executives:      string | null;
  recipient_company: string | null;
  feedback_id?:         string | null;
  feedback_sentiment?:  'positive' | 'not positive' | null;
  feedback_text?:       string | null;
  feedback_created_at?: string | null;
}

interface PagedSubs { total: number; items: SubRow[]; }

/* ───────────── component props ───────────── */
interface Props {
  creativeId: string;
  onOpen: (payload: PanePayload) => void;
}

/* ───────────── shared styles ───────────── */
const th: CSSProperties      = { padding: 8, border: '1px solid #ddd', textAlign: 'left', verticalAlign: 'bottom' };
const thClickable: CSSProperties = { ...th, cursor: 'pointer' };
const td: CSSProperties      = { padding: 8, border: '1px solid #ddd' };
const iconCell: CSSProperties = { textAlign: 'center', width: 40, border: '1px solid #ddd' };
const NA = <span style={{ color: '#999' }}>—</span>;

/* ───────────── small helpers ───────────── */
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

/* ───────────────────────────────────────────────────────────────────────────── */

export default function CreativePaneSubsTab({ creativeId, onOpen }: Props) {
  /* data */
  const [subs, setSubs]       = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);

  /* edit state */
  const [editingId, setEdit]  = useState<string | null>(null);
  const [draft, setDraft]     = useState<ResultCode>('no_response');

  /* create-sub modal */
  const [showCreate, setShowCreate] = useState(false);

  /* filters */
  const [projectQ, setProjectQ]           = useState('');
  const [mediaTypeFilter, setMediaType]   = useState('');        // ''
  const [recipientQ, setRecipientQ]       = useState('');        // search within names or companies
  const [intentFilter, setIntentFilter]   = useState('');        // ''
  const [resultFilter, setResultFilter]   = useState('');        // ''
  const [feedbackFilter, setFeedback]     = useState('');        // '', 'positive', 'not positive', 'none'
  const debouncedProjectQ   = useDebouncedValue(projectQ, 300);
  const debouncedRecipientQ = useDebouncedValue(recipientQ, 300);

  /* sort + paging (client-side) */
  type SortKey = 'created' | 'updated';
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [asc, setAsc]         = useState<boolean>(false);   // newest first by default
  const [limit, setLimit]     = useState<number>(50);
  const [offset, setOffset]   = useState<number>(0);
  const page = Math.floor(offset / limit) + 1;

  const clickSort = (k: SortKey) => {
    setSortKey(prev => (prev === k ? prev : k));
    setAsc(prev => (sortKey === k ? !prev : (k === 'created' ? false : true)));
    setOffset(0);
  };

  // /* feedback helpers */
  // const normalizeSentiment = (s: string | null | undefined): 'positive' | 'not positive' =>
  //   s === 'positive' ? 'positive' : 'not positive';

  // async function fetchLatestFeedback(subId: string) {
  //   // expects /subs/{id} to include an array "feedback" with { id, feedback_text, sentiment, created_at }
  //   try {
  //     const { data } = await api.get<any>(`/subs/${subId}`);
  //     const list = Array.isArray(data?.feedback) ? data.feedback : [];
  //     if (!list.length) return { id: null, text: '', sentiment: 'not positive' as const };
  //     const latest = list
  //       .slice()
  //       .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  //     return {
  //       id: latest?.id ?? null,
  //       text: latest?.feedback_text ?? '',
  //       sentiment: normalizeSentiment(latest?.sentiment),
  //     };
  //   } catch {
  //     return { id: null, text: '', sentiment: 'not positive' as const };
  //   }
  // }

  // const openFeedbackModal = async (subId: string, hasExisting: boolean) => {
  //   // fetch recipients so we can pre-fill availableSources/defaultSource
  //   let availableSources: { id: string; type: RecipientType; name: string }[] = [];
  //   try {
  //     const { data } = await api.get<any>(`/subs/${subId}`);
  //     const recs: any[] = Array.isArray(data?.recipients) ? data.recipients : [];
  //     availableSources = recs.map((r) => ({
  //       id: r.id,
  //       type: r.type as RecipientType,
  //       name: r.name,
  //     }));
  //   } catch {
  //     availableSources = [];
  //   }
  //   const defaultSource =
  //     availableSources.length === 1 ? availableSources[0] : undefined;
  
  //   if (hasExisting) {
  //     const latest = await fetchLatestFeedback(subId);
  //     setModal({
  //       open: true,
  //       subId,
  //       feedbackId: latest.id,
  //       initialText: latest.text,
  //       initialSentiment: latest.sentiment,
  //       availableSources,
  //       defaultSource,
  //     });
  //   } else {
  //     setModal({
  //       open: true,
  //       subId,
  //       feedbackId: null,
  //       initialText: '',
  //       initialSentiment: 'positive',
  //       availableSources,
  //       defaultSource,
  //     });
  //   }
  // };

  /* feedback bubble (parent-owned) */
  const hostRef   = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<{
    open: boolean;
    entries: FeedbackEntry[];      // ← list of feedback items
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

  // flip up if overflowing bottom of the pane
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
  
    // toggle off if same anchor clicked
    if (bubble.open && bubble.anchorKey === anchorKey) {
      setBubble(b => ({ ...b, open: false }));
      return;
    }
  
    // anchor rect (pane-relative if visible, else viewport-fixed)
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
  
    // clamp X so the bubble stays within the pane/viewport
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
  
      // map to entries, resolve names in parallel
      entries = await Promise.all(
        list.map(async (f: any) => {
          const sentiment: 'positive' | 'not positive' =
            f?.sentiment === 'positive' ? 'positive' : 'not positive';
          const st: RecipientType =
            f?.source_type === 'executive' || f?.source_type === 'external_rep'
              ? f.source_type
              : 'creative'; // fallback to 'creative' if unknown
  
          const source_name = await resolveSourceName(st, f?.source_id);
  
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
  
      // newest first (typed comparator to satisfy noImplicitAny)
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


  // const pickFeedbackText = (subDetail: any): string | null => {
  //   // Expect subDetail.feedback to be an array with objects including feedback_text and created_at
  //   const list = Array.isArray(subDetail?.feedback) ? subDetail.feedback : [];
  //   if (!list.length) return null;
  //   const latest = list
  //     .slice()
  //     .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  //   return latest?.feedback_text ?? null;
  // };

  /* ───────────── fetch data ───────────── */
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get<PagedSubs>(`/creatives/${creativeId}/subs`);
        if (mounted) setSubs(data.items || []);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [creativeId]);

  /* ───────────── helpers ───────────── */
  // const RECIPIENTS_TAB = 'recipients';   // if needed elsewhere

  const openSubPane = (id: string, tab = 'overview') =>
    onOpen({ kind: 'sub', id, initialTab: tab } as unknown as PanePayload);

  const startEdit  = (r: SubRow) => { setDraft(r.result ?? 'no_response'); setEdit(r.sub_id); };
  const cancelEdit = () => setEdit(null);

  const saveIfChanged = async (r: SubRow) => {
    if (draft !== (r.result ?? 'no_response')) {
      await api.patch(`/subs/${r.sub_id}`, { result: draft });
      setSubs(s => s.map(x => (x.sub_id === r.sub_id ? { ...x, result: draft } : x)));
    }
    cancelEdit();
  };

  /* “Add Feedback” modal (for this Creative). Creates feedback from the Creative perspective. */
  type ModalState = {
    open: boolean;
    subId: string | null;
    feedbackId: string | null;
    initialText: string;
    initialSentiment: 'positive' | 'not positive';
  
    // NEW — recipients available for this Sub
    availableSources: { id: string; type: RecipientType; name: string }[];
  
    // NEW — when exactly one recipient, preselect it
    defaultSource?: { id: string; type: RecipientType; name: string };
  };
  
  const [modal, setModal] = useState<ModalState>({
    open:false,
    subId:null,
    feedbackId:null,
    initialText:'',
    initialSentiment:'positive',
    availableSources: [],
    defaultSource: undefined,
  });

  /* ───────────── derived options for header dropdowns ───────────── */
  const mediaTypeOptions = useMemo(() => {
    const s = new Set<string>();
    subs.forEach(r => r.media_type && s.add(r.media_type));
    return Array.from(s).sort();
  }, [subs]);

  const intentOptions = useMemo(() => {
    const s = new Set<string>();
    subs.forEach(r => r.intent_primary && s.add(r.intent_primary));
    return Array.from(s).sort();
  }, [subs]);

  /* ───────────── client-side filtering ───────────── */
  const filtered = useMemo(() => {
    const qProj = debouncedProjectQ.trim().toLowerCase();
    const qRec  = debouncedRecipientQ.trim().toLowerCase();

    return subs.filter(r => {
      if (qProj) {
        const title = (r.project_title ?? '').toLowerCase();
        if (!title.includes(qProj)) return false;
      }
      if (mediaTypeFilter && r.media_type !== mediaTypeFilter) return false;
      if (intentFilter && r.intent_primary !== intentFilter) return false;
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

      if (qRec) {
        // search in recipients (structured if available, otherwise fallbacks)
        const haystacks: string[] = [];

        if (Array.isArray(r.recipients) && r.recipients.length) {
          r.recipients.forEach(u => {
            if (u?.name) haystacks.push(u.name);
            if (u?.company_name) haystacks.push(u.company_name);
          });
        } else {
          if (r.executives) haystacks.push(r.executives);
          if (r.recipient_company) haystacks.push(r.recipient_company);
        }

        const has = haystacks.some(s => (s ?? '').toLowerCase().includes(qRec));
        if (!has) return false;
      }

      return true;
    });
  }, [subs, debouncedProjectQ, debouncedRecipientQ, mediaTypeFilter, intentFilter, resultFilter, feedbackFilter]);

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


      {/* “Create New Sub” */}
      <button
        className="tab"
        style={{ margin: '0 0 14px 0' }}
        onClick={() => setShowCreate(true)}
      >
        Create New Sub
      </button>

      <small style={{ display:'block', marginBottom:4 }}>
        Showing {paged.length} of {sorted.length}
      </small>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={iconCell}>
              <img src="/doubleLeft.png" alt="Open" style={{ width: 18, height: 18 }} />
            </th>

            {/* Project (search) */}
            <th style={thClickable} onClick={() => clickSort('created')} title="Sort by Created (default)">
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Project</span>
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

            {/* Media Type (dropdown) */}
            <th style={th}>
              <div>Media Type</div>
              <div style={{ marginTop: 4 }}>
                <select
                  value={mediaTypeFilter}
                  onChange={e => { setMediaType(e.target.value); setOffset(0); }}
                >
                  <option value="">All</option>
                  {mediaTypeOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
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

            {/* Intent (dropdown) */}
            <th style={th}>
              <div>Intent</div>
              <div style={{ marginTop: 4 }}>
                <select
                  value={intentFilter}
                  onChange={e => { setIntentFilter(e.target.value); setOffset(0); }}
                >
                  <option value="">All</option>
                  {intentOptions.map(k => (
                    <option key={k} value={k}>{INTENT_LABEL[k] || k}</option>
                  ))}
                </select>
              </div>
            </th>

            {/* Result (dropdown) */}
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

            {/* Feedback (dropdown + bubble) */}
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

            {/* Created (sortable default) */}
            <th
              style={thClickable}
              onClick={() => clickSort('created')}
              title="Sort by Created (default)"
            >
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Created</span>
                {sortKey === 'created' ? <span style={{ marginLeft:4 }}>{asc ? '▲' : '▼'}</span> :
                  <img src="/sortable.png" alt="sortable" style={{ marginLeft:4, width:12, height:12 }} />}
              </div>
              <div style={{ marginTop:4 }}>&nbsp;</div>
            </th>

            {/* Updated (sortable) */}
            <th
              style={thClickable}
              onClick={() => clickSort('updated')}
              title="Sort by Updated"
            >
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Updated</span>
                {sortKey === 'updated' ? <span style={{ marginLeft:4 }}>{asc ? '▲' : '▼'}</span> :
                  <img src="/sortable.png" alt="sortable" style={{ marginLeft:4, width:12, height:12 }} />}
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

            // // recipients render (structured preferred; fallback to old strings)
            // const recipients = Array.isArray(r.recipients) && r.recipients.length
            //   ? r.recipients
            //   : [];

            return (
              <tr key={r.sub_id} className="sub-row">
                {/* Open sub */}
                <td style={iconCell}>
                  <button
                    type="button"
                    className="open-link"
                    title="Open sub"
                    aria-label={`Open submission ${r.sub_id}`}
                    onClick={(e) => { e.stopPropagation(); openSubPane(r.sub_id); }}
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                  >
                    <img src="/doubleLeft.png" alt="" aria-hidden="true" style={{ width:16, height:16 }} />
                  </button>
                </td>

                {/* Project (clickable if we have project_id) */}
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

                {/* Media Type */}
                <td style={td}>{r.media_type ?? NA}</td>

                {/* Recipients (each name + optional (Company)) */}
                <td style={td}>
                  {r.recipients?.length ? (
                    <div>
                      {r.recipients.map((rec, idx) => (
                        <div key={`${r.sub_id}:rec:${idx}`} style={{ marginBottom: 6 }}>
                          {/* Name (clickable) */}
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

                          {/* Company on the next line with ↳ and indent */}
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
                  ) : (
                    '—'
                  )}
                </td>

                {/* Intent */}
                <td style={td}>{r.intent_primary ? (INTENT_LABEL[r.intent_primary] || r.intent_primary) : '—'}</td>

                {/* Result */}
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

                {/* Feedback (click to show bubble if present) */}
                <td style={td}>
                  {isEd ? (
                    <button
                      className="btn"
                      onClick={() => {
                        const sources = Array.isArray(r.recipients) ? r.recipients : [];
                        const availableSources = sources.map(u => ({
                          id: u.id,
                          type: u.type as RecipientType,
                          name: u.name,
                        }));
                        setModal({
                          open: true,
                          subId: r.sub_id,
                          feedbackId: null,
                          initialText: '',
                          initialSentiment: 'positive',
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
                        onClick={(e) => toggleFeedbackBubble(e, r)}  // ← uses the new function
                        title="Show feedback"
                      >
                        {fbBadge}
                      </span>
                    ) : '—'
                  )}
                </td>

                {/* Created (clickable to open SubPane) */}
                <td style={td}>
                  <span
                    className="clickable"
                    onClick={() => openSubPane(r.sub_id)}
                    title="Open sub"
                  >
                    {new Date(r.created_at).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'short', day: 'numeric'
                    })}
                  </span>
                </td>

                {/* Updated */}
                <td style={td}>{formatDate(r.updated_at)}</td>

                {/* Edit / Save / Cancel */}
                <td style={{ ...td, width: '1%', whiteSpace: 'nowrap' }}>
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

                  {/* secondary line: sentiment + date */}
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>
                    {e.sentiment === 'positive' ? 'Positive' : 'Not Positive'}
                    {dateOnly ? ` — ${dateOnly}` : ''}
                  </div>

                  {/* body */}
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

      {/* Create-Sub modal */}
      <CreateSubModal
        isOpen={showCreate}
        onClose={async () => {
          setShowCreate(false);
          try {
            const { data } = await api.get<PagedSubs>(`/creatives/${creativeId}/subs`);
            setSubs(data.items || []);
          } catch (err) {
            console.error('re-fetch subs failed', err);
          }
        }}
        initial={{ creativeIds: [creativeId] }}
      />

      {/* Add-Feedback modal (for this Creative) */}
      {modal.open && (
        <SubFeedbackManagerModal
          subId={modal.subId!}
          availableSources={modal.availableSources}
          defaultSource={modal.defaultSource}
          fallbackCreativeId={creativeId}     // only used if no recipients exist
          onClose={async (changed) => {
            setModal({
              open:false,
              subId:null,
              feedbackId:null,
              initialText:'',
              initialSentiment:'positive',
              availableSources: [],
              defaultSource: undefined,
            });
            if (changed) {
              const { data } = await api.get<PagedSubs>(`/creatives/${creativeId}/subs`);
              setSubs(data.items || []);
            }
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Minimal feedback modal for Creative — creates a feedback row attributed
   to this Creative (source_type: 'creative', source_id: creativeId).
   Adjust if you want to attribute to executives instead.
   ───────────────────────────────────────────────────────────────────────────── */
function SubFeedbackManagerModal({
  subId,
  availableSources,
  defaultSource,
  fallbackCreativeId,
  onClose,
}: {
  subId: string;
  availableSources: { id: string; type: RecipientType; name: string }[];
  defaultSource?: { id: string; type: RecipientType; name: string };
  fallbackCreativeId: string;
  onClose: (changed: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FeedbackItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { sentiment: 'positive' | 'not positive'; text: string }>>({});
  const [newSentiment, setNewSentiment] = useState<'positive' | 'not positive'>('positive');
  const [newText, setNewText] = useState('');

  const [dirty, setDirty] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newSourceId, setNewSourceId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // resolve source names for existing feedback rows
  const [sourceNames, setSourceNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get<any>(`/subs/${subId}`);
        const list = Array.isArray(data?.feedback) ? data.feedback : [];
        const items: FeedbackItem[] = list
          .map((f: any) => ({
            id: f.id,
            sentiment: f.sentiment === 'positive' ? 'positive' : 'not positive',
            feedback_text: f.feedback_text ?? null,
            created_at: f.created_at,
            source_type: f.source_type,
            source_id: f.source_id,
          }))
          .sort(
            (a: { created_at: string }, b: { created_at: string }) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
  
        if (mounted) {
          setRows(items);
          // seed drafts with current values
          const seed: Record<string, { sentiment: 'positive' | 'not positive'; text: string }> = {};
          items.forEach(it => {
            seed[it.id] = {
              sentiment: (it.sentiment === 'positive' ? 'positive' : 'not positive'),
              text: it.feedback_text ?? ''
            };
          });
          setDrafts(seed);
  
          // Initialize the "new feedback" source from props
          setNewSourceId(
            defaultSource?.id ?? (availableSources.length === 1 ? availableSources[0].id : null)
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [subId, availableSources, defaultSource]);

  const changeRow = (id: string, patch: Partial<{ sentiment:'positive'|'not positive'; text:string }>) => {
    setDrafts(d => ({ ...d, [id]: { ...(d[id] || { sentiment: 'positive', text:'' }), ...patch } }));
  };

  const saveAll = async () => {
    const ops: Promise<unknown>[] = [];
  
    // 1) PATCH edited feedback rows
    for (const r of rows) {
      const d = drafts[r.id];
      if (!d) continue;
  
      const origSent: 'positive' | 'not positive' =
        r.sentiment === 'positive' ? 'positive' : 'not positive';
      const origText = r.feedback_text ?? '';
  
      if (d.sentiment !== origSent || d.text !== origText) {
        ops.push(
          api.patch(`/subs/feedback/${r.id}`, {
            sentiment: d.sentiment,
            feedback_text: d.text || null,
          })
        );
      }
    }
  
    // 2) POST new feedback if provided
    const textTrimmed = newText.trim();
    if (textTrimmed.length > 0) {
      // If multiple possible sources, require an explicit choice
      if (availableSources.length > 1 && !newSourceId) {
        window.alert('Please choose who is providing this feedback.');
        return;
      }
  
      // Resolve source to use
      let src: { id: string; type: RecipientType };
      if (availableSources.length > 1) {
        const found = availableSources.find(s => s.id === newSourceId!);
        src = found
          ? { id: found.id, type: found.type }
          : { id: fallbackCreativeId, type: 'creative' as RecipientType };
      } else if (availableSources.length === 1) {
        src = { id: availableSources[0].id, type: availableSources[0].type };
      } else {
        // No recipients on the Sub — attribute to the creative as a fallback
        src = { id: fallbackCreativeId, type: 'creative' as RecipientType };
      }
  
      ops.push(
        api.post(`/subs/${subId}/feedback`, {
          id: null,
          sub_id: subId,
          source_type: src.type,   // 'executive' | 'external_rep' | 'creative'
          source_id: src.id,
          sentiment: newSentiment,
          feedback_text: textTrimmed,
          actionable_next: null,
        })
      );
    }
  
    // 3) Nothing to do?
    if (ops.length === 0) {
      onClose(false);
      return;
    }
  
    // 4) Execute
    try {
      await Promise.all(ops);
      onClose(true);
    } catch (e) {
      console.error('save feedback failed', e);
      onClose(true); // still refresh
    }
  };
  
  
  useEffect(() => {
    if (!rows.length) return;
    let mounted = true;
    (async () => {
      const pairs = await Promise.all(
        rows.map(async (r) => {
          const nm = await resolveSourceName(
            (r.source_type as RecipientType) ?? 'creative',
            String(r.source_id ?? '')
          );
          return [r.id, nm] as const;
        })
      );
      if (mounted) {
        setSourceNames((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
      }
    })();
    return () => { mounted = false; };
  }, [rows]);

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
      display:'grid', placeItems:'center', zIndex:3000
    }}>
      <div style={{ background:'#fff', padding:16, borderRadius:8, minWidth:520, maxWidth:720 }}>
        <h3 style={{ marginTop:0 }}>Feedback</h3>

        {loading ? (
          <div>Loading…</div>
        ) : (
          <div style={{ display:'grid', gap:16 }}>
            {/* Existing rows */}
            {rows.length === 0 ? (
              <div style={{ color:'#666' }}>(no feedback yet)</div>
            ) : (
              rows.map(r => {
                const d = drafts[r.id] || { sentiment: 'positive' as const, text: '' };
                return (
                  <div key={r.id} style={{ border:'1px solid #eee', borderRadius:8, padding:10, position:'relative' }}>
                    {/* source (prominent) */}
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                      {sourceNames[r.id] ?? '(unknown source)'}
                    </div>

                    {/* sentiment + date (secondary) */}
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
                      {r.sentiment === 'positive' ? 'Positive' : 'Not Positive'} · {new Date(r.created_at).toLocaleString()}
                    </div>

                    {/* DELETE: two-step inline confirmation (no window.confirm) */}
                    {confirmDeleteId !== r.id ? (
                      <button
                        className="btn"
                        style={{ position:'absolute', top:8, right:8 }}
                        onClick={() => setConfirmDeleteId(r.id)}
                        title="Delete feedback"
                      >
                        Delete
                      </button>
                    ) : (
                      <div style={{ position:'absolute', top:6, right:8, display:'flex', gap:6 }}>
                        <button
                          className="btn"
                          onClick={async () => {
                            try {
                              await api.delete(`/subs/feedback/${r.id}`);
                              setRows(prev => prev.filter(x => x.id !== r.id));
                              setDrafts(prev => {
                                const { [r.id]: _, ...rest } = prev;
                                return rest;
                              });
                              setDirty(true);
                            } catch (e) {
                              console.error('delete feedback failed', e);
                              // optional: toast here
                            } finally {
                              setConfirmDeleteId(null);
                            }
                          }}
                          title="Confirm delete"
                        >
                          Confirm
                        </button>
                        <button
                          className="btn"
                          onClick={() => setConfirmDeleteId(null)}
                          title="Cancel delete"
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    {/* editors */}
                    <div style={{ display:'grid', gap:8, marginTop: 8 }}>
                      <label>
                        <div>Sentiment</div>
                        <select
                          value={d.sentiment}
                          onChange={e => {
                            changeRow(r.id, { sentiment: e.target.value as 'positive' | 'not positive' });
                            setDirty(true);
                          }}
                        >
                          <option value="positive">Positive</option>
                          <option value="not positive">Not Positive</option>
                        </select>
                      </label>
                      <label>
                        <div>Feedback</div>
                        <textarea
                          rows={4}
                          value={d.text}
                          style={{ width: '100%' }}
                          onChange={e => {
                            changeRow(r.id, { text: e.target.value });
                            setDirty(true);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })
            )}

            {/* Add new row (collapsible) */}
            <div style={{ borderTop:'1px solid #eee', paddingTop:10 }}>
              <button
                className="btn"
                onClick={() => setShowAdd(v => !v)}
                style={{ marginBottom: showAdd ? 8 : 0 }}
              >
                {showAdd ? 'Hide new feedback' : 'Add new feedback'}
              </button>

              {showAdd && (
                <>
                  <h4 style={{ margin:'8px 0 8px 0' }}>Add new feedback</h4>
                  <div style={{ display:'grid', gap:8 }}>
                    {/* Feedback source (only shown in this section) */}
                    <label>
                      <div>Feedback source</div>
                      {availableSources.length <= 1 ? (
                        <div style={{ padding:'6px 0' }}>
                          Will attribute to:&nbsp;
                          <b>{availableSources[0]?.name ?? '(no recipients)'}</b>
                          {availableSources[0] ? ` (${availableSources[0].type})` : ''}
                        </div>
                      ) : (
                        <select
                          value={newSourceId ?? ''}
                          onChange={e => { setNewSourceId(e.target.value || null); setDirty(true); }}
                        >
                          <option value="">Choose source…</option>
                          {availableSources.map(s => (
                            <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
                          ))}
                        </select>
                      )}
                    </label>

                    {/* Sentiment */}
                    <label>
                      <div>Sentiment</div>
                      <select
                        value={newSentiment}
                        onChange={e => { setNewSentiment(e.target.value as 'positive'|'not positive'); setDirty(true); }}
                      >
                        <option value="positive">Positive</option>
                        <option value="not positive">Not Positive</option>
                      </select>
                    </label>

                    {/* Feedback text (full width) */}
                    <label>
                      <div>Feedback</div>
                      <textarea
                        rows={4}
                        value={newText}
                        onChange={e => { setNewText(e.target.value); setDirty(true); }}
                        style={{ width:'100%' }}
                        placeholder="Add a new feedback note…"
                      />
                    </label>
                  </div>
                </>
              )}
            </div>

            {/* Actions */}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button className="btn" onClick={() => onClose(dirty)}>Cancel</button>
              <button className="btn" onClick={saveAll}>Save Changes</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
