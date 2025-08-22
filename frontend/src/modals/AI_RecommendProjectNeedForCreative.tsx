// frontend/src/pane/modals/AI_RecommendProjectNeedForCreative.tsx

import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import api from '../services/api';
import CreateSubModal from './CreateSubModal';
import { usePane } from '../pane/PaneContext';
import { useZItem } from '../ui/ZStack';
import ScrapeImdbCreditsModal from './ScrapeImdbCreditsModal';


type RankedNeed = {
  need_id: string;
  project_id: string;
  project_title: string;
  media_type: string | null;
  need_qual: string | null;
  qualifications?: string | null;
  sim: number;
  justification?: string;
};

type ReverseResult = {
  creative_id?: string;
  ranked: RankedNeed[];
  model?: string;
  considered_count?: number;
  filters?: {
    media_type_filter: string[];
    qualifications_filter: string[];
    include_archived?: boolean;
  };
  run_started_at?: string | null;
};

const MEDIA_ORDER = ['Feature','TV Series','Play','Other'] as const;
type MediaOpt = typeof MEDIA_ORDER[number];

const WRITER_ENUMS = {
  ANY: 'Writer (Any)',
  UPPER: 'Writer (Upper)',
  MID_UPPER: 'Writer (Mid - Upper)',
  MID: 'Writer (Mid)',
  LOWER_MID: 'Writer (Lower - Mid)',
  LOWER: 'Writer (Lower)',
} as const;

const DIRECTOR_ENUMS = {
  ANY: 'Director (Any)',
  HAS_FEATURE: 'Director (Has Directed Feature)',
} as const;

/* ── helpers ──────────────────────────────────────────────── */
function writerQualsForLevel(level: number | null | undefined): string[] {
  if (level == null) return [WRITER_ENUMS.ANY, WRITER_ENUMS.LOWER];
  if (level > 6) return [WRITER_ENUMS.ANY, WRITER_ENUMS.UPPER, WRITER_ENUMS.MID_UPPER];
  if (level === 6) return [WRITER_ENUMS.ANY, WRITER_ENUMS.UPPER, WRITER_ENUMS.MID_UPPER, WRITER_ENUMS.MID];
  if (level === 5.5 || level === 5 || level === 4.5) return [WRITER_ENUMS.ANY, WRITER_ENUMS.MID_UPPER, WRITER_ENUMS.MID, WRITER_ENUMS.LOWER_MID];
  if (level === 4)   return [WRITER_ENUMS.ANY, WRITER_ENUMS.LOWER, WRITER_ENUMS.LOWER_MID, WRITER_ENUMS.MID];
  if (level < 4)     return [WRITER_ENUMS.ANY, WRITER_ENUMS.LOWER, WRITER_ENUMS.LOWER_MID];
  return [WRITER_ENUMS.ANY];
}
function directorQuals(hasDirectedFeature: boolean | null | undefined): string[] {
  return hasDirectedFeature ? [DIRECTOR_ENUMS.ANY, DIRECTOR_ENUMS.HAS_FEATURE] : [DIRECTOR_ENUMS.ANY];
}
const QUAL_BUCKET_ORDER = ['OWA','Staff Writer','ODA','Director'] as const;
function canonMedia(selected: Record<MediaOpt, boolean>) {
  return MEDIA_ORDER.filter(m => selected[m]);
}
function canonQuals(flags: { owa:boolean; staff:boolean; oda:boolean; dir:boolean }) {
  const m = new Map([
    ['OWA', flags.owa],
    ['Staff Writer', flags.staff],
    ['ODA', flags.oda],
    ['Director', flags.dir],
  ] as const);
  return QUAL_BUCKET_ORDER.filter(k => m.get(k as any));
}
function useDebounced<T>(val:T, ms=250) {
  const [v,setV] = useState(val);
  useEffect(() => { const id = setTimeout(()=>setV(val), ms); return ()=>clearTimeout(id); }, [val, ms]);
  return v;
}
const listsEqual = (a?: readonly string[], b?: readonly string[]) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every((v, i) => v === b[i]);

/* ── component ────────────────────────────────────────────── */
export default function AI_RecommendProjectNeedForCreative({
  creativeId,
  onClose,
}: {
  creativeId: string;
  onClose: (changed: boolean) => void;
}) {
  const { open } = usePane();
  const { zIndex, focus, bring } = useZItem('ai-modal-project-need');
  const pane = usePane(); // you already had { open }, keep a full ref for optional closeAll

  // creative facts
  const [writerLevel, setWriterLevel] = useState<number | null>(null);
  const [hasDirectedFeature, setHasDirectedFeature] = useState<boolean | null>(null);
  const [loadingFacts, setLoadingFacts] = useState(true);
  const [imdbId, setImdbId] = useState<string | null>(null);
  const [creativeName, setCreativeName] = useState<string>('Creative');

  // filters
  const [pickOWA, setPickOWA]       = useState(true);
  const [pickODA, setPickODA]       = useState(true);
  const [pickStaff, setPickStaff]   = useState(true);
  const [pickDirector, setPickDir]  = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [media, setMedia] = useState<Record<MediaOpt, boolean>>({
    Feature: true, 'TV Series': true, Play: true, Other: true,
  });
  const [limit, setLimit] = useState(30);

  // ui/busy/results
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ReverseResult | null>(null);

  // cache probe state for current filters
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeHit, setProbeHit]   = useState(false);
  const [probeRunAt, setProbeRunAt] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<ReverseResult | null>(null);

  // helpers in case creative has no credits
  const [scrapeOpen, setScrapeOpen] = useState(false);

  function parseImdbSlug(input: string): string | null {
    if (!input) return null;
    // Accept either a slug like "nm3964350" or any URL containing it
    const m = input.match(/(nm\d{5,9})/i);
    return m ? m[1] : null;
  }

  async function ensureImdbIdUpserted(): Promise<boolean> {
    // returns true if we successfully have an imdbId after prompting, false if user canceled/invalid
    if (imdbId) return true;
    const entered = window.prompt(
      'This creative has no IMDb ID. Paste their IMDb url (e.g. https://www.imdb.com/name/nm3964350/) or the nm slug:'
    );
    if (!entered) return false;
    const slug = parseImdbSlug(entered);
    if (!slug) { window.alert('Could not find a valid IMDb "nm" id in that input.'); return false; }
    try {
      await api.patch(`/creatives/${creativeId}`, { imdb_id: slug });
      setImdbId(slug);
      return true;
    } catch (e) {
      console.error('Failed to save imdb_id', e);
      window.alert('Failed to save IMDb ID. Check server logs.');
      return false;
    }
  }

  // bring modal to front on mount
  useEffect(() => { focus(); }, [focus]);

  /* load creative facts */
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingFacts(true);
      try {
        const { data } = await api.get<any>(`/creatives/${creativeId}`);
        if (!mounted) return;
        setCreativeName(data?.name || 'Creative');
        const wl =
          typeof data?.writer_level === 'number'
            ? data.writer_level
            : (typeof data?.writer_level === 'string' ? Number(data.writer_level) || null : null);
        setWriterLevel(wl);
        setHasDirectedFeature(
          data?.has_directed_feature === true ? true :
          data?.has_directed_feature === false ? false : null
        );

        setImdbId((data?.imdb_id ?? null) || null);

      } finally {
        if (mounted) setLoadingFacts(false);
      }
    })();
    return () => { mounted = false; };
  }, [creativeId]);

  /* expansions */
  const expandedWriterList = useMemo(
    () => (pickStaff ? writerQualsForLevel(writerLevel) : []),
    [pickStaff, writerLevel]
  );
  const expandedDirectorList = useMemo(
    () => (pickDirector ? directorQuals(hasDirectedFeature) : []),
    [pickDirector, hasDirectedFeature]
  );
  const expansionPreview = useMemo(() => ({
    writer: expandedWriterList.join(', ') || '(none)',
    director: expandedDirectorList.join(', ') || '(none)',
  }), [expandedWriterList, expandedDirectorList]);

  const mt_feature = media['Feature'];
  const mt_tv      = media['TV Series'];
  const mt_play    = media['Play'];
  const mt_other   = media['Other'];

  /* canonical key for current filters (matches backend cache key order) */
  const canon = useMemo(() => ({
    media_type_filter: canonMedia(media),
    qualifications_filter: canonQuals({ owa:pickOWA, staff:pickStaff, oda:pickODA, dir:pickDirector }),
    include_archived: includeArchived, // ← NEW
  }), [media, pickOWA, pickStaff, pickODA, pickDirector, includeArchived]);

  /* debounce the probe to keep UI snappy */
  const debouncedCanon = useDebounced(canon, 250);

  /* probe cache anytime filters change */
  useEffect(() => {
    let mounted = true;
    (async () => {
      setProbeBusy(true);
      setProbeHit(false);
      setProbeRunAt(null);
      setProbeResult(null);

      const body = debouncedCanon;

      try {
        // 1) Direct lookup by filter-combo
        const { data } = await api.post<ReverseResult>(
          `/ai/recommendations/creatives/${creativeId}/needs/lookup`,
          body
        );
        if (!mounted) return;
        setProbeHit(true);
        setProbeRunAt(data?.run_started_at ?? null);
        setProbeResult(data);
        return;
      } catch (_) {
        // fall through to /latest with explicit filters
      }

      try {
        const qs = new URLSearchParams();
        for (const m of body.media_type_filter || []) qs.append('media', m);
        for (const q of body.qualifications_filter || []) qs.append('quals', q);
        qs.set('include_archived', includeArchived ? 'true' : 'false'); // ← NEW
        const { data } = await api.get<ReverseResult>(
          `/ai/recommendations/creatives/${creativeId}/needs/latest?${qs.toString()}`
        );
        if (!mounted) return;

        const f = data?.filters;
        const same =
          listsEqual(f?.media_type_filter, body.media_type_filter) &&
          listsEqual(f?.qualifications_filter, body.qualifications_filter) &&
          (Boolean(f?.include_archived) === Boolean(body.include_archived));

        if (same) {
          setProbeHit(true);
          setProbeRunAt(data?.run_started_at ?? null);
          setProbeResult(data);
        } else {
          setProbeHit(false);
        }
      } catch (err: any) {
        // 404 means “no cached run for this combo”—that’s fine, just show Generate.
        if (err?.response?.status === 404) {
          setProbeHit(false);
          setProbeRunAt(null);
          setProbeResult(null);
        } else {
          // Log other errors but don’t blow up the UI
          console.error('latest probe failed', err);
          setProbeHit(false);
        }
      } finally {
        if (mounted) setProbeBusy(false);
      }
    })();

    return () => { mounted = false; };
  }, [creativeId, debouncedCanon, includeArchived]);

  // Auto-apply cached results when available; clear when no cache for this combo.
  useEffect(() => {
    if (probeBusy) return; // don't flicker while probing
    if (probeHit && probeResult) {
      setResults(probeResult);
    } else if (!busy) {
      // only clear if we're not in the middle of a run
      setResults(null);
    }
  }, [probeBusy, probeHit, probeResult, busy]);

  /* open ProjectPane ABOVE modal, leave modal open behind */
  const openProjectOnTop = (projectId: string) => {
    console.log('[AI modal] open project', projectId);
    open({ kind: 'project', id: projectId });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => bring('pane'));
    });
  };

  /* Generate or Re-Generate */
  async function runNow(force = false) {
    if (!(pickOWA || pickODA || pickStaff || pickDirector)) {
      window.alert('Pick at least one qualification filter (OWA / Staff Writer / ODA / Director).');
      return;
    }
    if (!(mt_feature || mt_tv || mt_play || mt_other)) {
      window.alert('Pick at least one media type.');
      return;
    }

    if (!force && probeHit && probeResult) {
      setResults(probeResult);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        mt_feature, mt_tv, mt_play, mt_other,
        q_owa: pickOWA, q_oda: pickODA, q_staff: pickStaff, q_dir: pickDirector,
        writer_qual_list: expandedWriterList,
        director_qual_list: expandedDirectorList,
        limit,
        include_archived: includeArchived,
        refresh_embedding: true,  // ← let backend generate embeddings
      };
      const { data } = await api.post<ReverseResult>(
        `/ai/recommendations/creatives/${creativeId}/needs/rank`,
        payload
      );
      setResults(data);
      setProbeHit(true);
      setProbeRunAt(data?.run_started_at ?? new Date().toISOString());
      setProbeResult(data);
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail ?? err?.response?.data;

      if (status === 400 && (detail?.code === 'NO_CREDITS' || /no credits/i.test(detail?.message || ''))) {
        // ensure we have imdb_id
        let okImdb = !!imdbId;
        if (!okImdb) okImdb = await ensureImdbIdUpserted();
        if (!okImdb) return;

        // open the scraper modal; when it finishes we'll retry
        setScrapeOpen(true);
        return;
      }

      console.error('generate failed', err);
      window.alert('Failed to generate recommendations. Check server logs.');
    } finally {
      setBusy(false);
    }
  }

  function viewDynamicReport() {
    if (!results?.ranked?.length) {
      window.alert('Generate recommendations first.');
      return;
    }

    const projectIds = results.ranked.map(r => r.project_id);
    const recs = results.ranked.map(r => ({
      project_id: r.project_id,
      need_id: r.need_id,
      justification: r.justification ?? null,
      sim: Number.isFinite(r.sim) ? r.sim : null,
      need_qual: r.need_qual ?? r.qualifications ?? null,
    }));

    // Exact filters used in the modal (canonicalized to match backend cache keys)
    const filters = {
      media_type_filter: canon.media_type_filter,
      qualifications_filter: canon.qualifications_filter,
      include_archived: includeArchived,
    };

    // Close modal
    onClose(true);

    // Best effort: close panes
    try { (pane as any)?.closeAll?.(); } catch {}

    // Hand off payload + filters to the report page
    try {
      sessionStorage.setItem(
        'rde:project-recs',
        JSON.stringify({ creativeId, creativeName, projectIds, recs, includeArchived, filters })
      );
      // Also persist filters separately so a page reload can re-fetch the same cached run
      sessionStorage.setItem(
        'rde:project-recs:filters',
        JSON.stringify({ creativeId, ...filters })
      );
    } catch {}

    // Navigate without relying on React Router context
    window.location.assign(`/reports/creatives/${creativeId}/project-recs`);
  }

  /* PDF report */
  async function exportPdf() {
    if (!results?.ranked?.length) {
      window.alert('No recommendations to export. Generate results first.');
      return;
    }

    const project_ids = results.ranked.map(r => r.project_id);
    const recs = results.ranked.map(r => ({
      project_id: r.project_id,
      need_id: r.need_id,
      justification: r.justification ?? null,
      sim: Number.isFinite(r.sim) ? r.sim : null,
      need_qual: r.need_qual ?? r.qualifications ?? null,
    }));

    try {
      const { data } = await api.post(
        `/ai/recommendations/creatives/${creativeId}/needs/report.pdf`,
        {
          creative_id: creativeId,
          project_ids,
          include_archived: includeArchived,
          recs, // ← send the “Why” rows
        },
        { responseType: 'blob' }
      );

      const blob = new Blob([data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Project Recommendations - ${creativeName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export PDF failed', e);
      window.alert('Failed to generate PDF. Check server logs.');
    }
  }

  const prettyRunAt = useMemo(() => {
    if (!probeRunAt) return '';
    const d = new Date(probeRunAt);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  }, [probeRunAt]);

  const Table = ({ rows }: { rows: RankedNeed[] }) => (
    <>
      {rows.map((r, idx) => (
        <tr key={`${r.project_id}:${r.need_id}:${idx}`}>
          {/* Fit */}
          <td style={{ border:'1px solid #ddd', padding:8, width:90 }}>
            {Number.isFinite(r.sim) ? r.sim.toFixed(3) : '—'}
          </td>

          {/* Project / Need */}
          <td style={{ border:'1px solid #ddd', padding:8 }}>
            <div style={{ fontWeight:600 }}>
              <span
                role="button"
                tabIndex={0}
                aria-label="Open project"
                title="Open project"
                onPointerDown={(e) => {
                  e.preventDefault();     // avoids text selection
                  e.stopPropagation();    // stops the modal container’s pointerdown
                  openProjectOnTop(r.project_id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    openProjectOnTop(r.project_id);
                  }
                }}
                style={{
                  cursor: 'pointer',
                  userSelect: 'none',
                  position: 'relative',
                  zIndex: 1,
                  pointerEvents: 'auto',   // hard-enable pointer events on the title
                }}
                className="clickable"
              >
                {r.project_title || r.project_id}
              </span>
            </div>

            <div style={{ fontSize:12, color:'#555' }}>
              {r.media_type ?? '—'} · {r.need_qual ?? r.qualifications ?? '—'}
            </div>
            <div style={{ marginTop:10 }}>
              <CreateSubButton projectId={r.project_id} needId={r.need_id} creativeId={creativeId} />
            </div>
          </td>

          {/* Why */}
          <td style={{ border:'1px solid #ddd', padding:8, whiteSpace:'pre-wrap' }}>
            {r.justification || '(no justification)'}
          </td>
        </tr>
      ))}
    </>
  );

  /* ── PORTAL: backdrop never closes modal on outside click. Outer wrapper allows click-through. ── */
  return ReactDOM.createPortal(
    <>
      <div
        // wrapper is click-through so you can click pane to bring it on top
        style={{ position: 'fixed', inset: 0, zIndex, pointerEvents: 'none' }}
      >
        <div
          onPointerDown={(e) => {
            // Let child handlers (like the project title onClick) run first,
            // then stop the event from leaving the modal.
            e.stopPropagation();
            // raise the modal layer so it stays on top when you interact with it
            focus(); // or bring('ai-modal-project-need')
          }}
          onMouseDown={(e) => {
            e.stopPropagation(); // belt-and-suspenders for libs that listen on mouse events
          }}
          style={{
            position: 'fixed',
            inset: '80px auto auto 50%',
            transform: 'translateX(-50%)',
            background: '#fff',
            border: '4px solid #046A38',
            borderRadius: 10,
            minWidth: 820,
            maxWidth: 1000,
            maxHeight: 'calc(100vh - 140px)',
            overflow: 'auto',
            padding: 16,
            pointerEvents: 'auto',
            boxShadow: '0 18px 50px rgba(0,0,0,.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, color: '#046A38' }}>AI: Recommend Projects </h3>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => onClose(!!results)}>Close</button>
            </div>
          </div>

          {/* Filters */}
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {/* High-level quals */}
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontWeight: 600 }}>Qualifications</div>
              <label style={{ userSelect: 'none' }}>
                <input type="checkbox" checked={pickOWA} onChange={() => setPickOWA(v => !v)} disabled={busy} /> OWA
              </label>
              <label style={{ userSelect: 'none' }}>
                <input type="checkbox" checked={pickODA} onChange={() => setPickODA(v => !v)} disabled={busy} /> ODA
              </label>
              <label style={{ userSelect: 'none' }}>
                <input type="checkbox" checked={pickStaff} onChange={() => setPickStaff(v => !v)} disabled={busy || loadingFacts} /> Staff Writer
              </label>
              <div style={{ fontSize: 12, color: '#555', marginLeft: 22 }}>
                {loadingFacts ? '(loading creative level…)' : `expands to: ${expansionPreview.writer}`}
              </div>
              <label style={{ userSelect: 'none', marginTop: 2 }}>
                <input type="checkbox" checked={pickDirector} onChange={() => setPickDir(v => !v)} disabled={busy || loadingFacts} /> Director
              </label>
              <div style={{ fontSize: 12, color: '#555', marginLeft: 22 }}>
                {loadingFacts ? '(loading director info…)' : `expands to: ${expansionPreview.director}`}
              </div>
            </div>

            {/* Media */}
            <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
              <div style={{ fontWeight: 600 }}>Media Types</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                {MEDIA_ORDER.map(m => (
                  <label key={m} style={{ userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={media[m]}
                      onChange={() => setMedia(s => ({ ...s, [m]: !s[m] }))}
                      disabled={busy}
                    /> {m}
                  </label>
                ))}
              </div>
            </div>

            {/* Tracking Status */}
            <div style={{ display:'grid', gap:8, marginTop:6 }}>
              <div style={{ fontWeight:600 }}>Tracking Status</div>
              <label style={{ userSelect:'none' }}>
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={() => setIncludeArchived(v => !v)}
                  disabled={busy}
                /> Include Archived
              </label>
            </div>

            {/* Limit + Generate/Re-Generate (cache-aware) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <label>
                Limit:&nbsp;
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={limit}
                  onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                  style={{ width: 80 }}
                  disabled={busy}
                />
              </label>

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                {probeBusy ? (
                  <button className="aiButton" disabled>Checking saved run…</button>
                ) : (
                  <>
                    <button
                      className="aiButton"
                      disabled={busy || loadingFacts}
                      onClick={() => runNow(probeHit)}
                    >
                      {busy ? (probeHit ? 'Refreshing…' : 'Generating…') : (probeHit ? 'Re-Generate' : 'Generate')}
                    </button>

                    {results?.ranked?.length ? (
                      <>
                        <button className="tab" onClick={exportPdf}>Export PDF</button>
                        <button className="tab" onClick={viewDynamicReport}>View Dynamic Report</button>
                      </>
                    ) : null}

                    {probeHit && probeRunAt && (
                      <small style={{ color: '#555' }}>Last run: {prettyRunAt} (cached)</small>
                    )}
                  </>
                )}
              </div>



            </div>
          </div>

          {/* Results */}
          {results && (
            <div style={{ marginTop: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', border: '1px solid #ddd', padding: 8, width: 90 }}>Fit</th>
                    <th style={{ textAlign: 'left', border: '1px solid #ddd', padding: 8, width: '1%' }}>Project</th>
                    <th style={{ textAlign: 'left', border: '1px solid #ddd', padding: 8 }}>Why</th>
                  </tr>
                </thead>
                <tbody>
                  <Table rows={results.ranked || []} />
                </tbody>
              </table>
            </div>
          )}

          {!results && !busy && (
            <div style={{ marginTop: 16, color: '#666' }}>
              No results yet. Choose filters and click <b>Generate</b>.
            </div>
          )}
        </div>
      </div>

      {scrapeOpen && (
        <ScrapeImdbCreditsModal
          isOpen={scrapeOpen}
          creativeId={creativeId}
          onClose={() => setScrapeOpen(false)}
          onFinished={async () => {
            setScrapeOpen(false);
            // refresh facts so credits_count / imdb_id are up to date
            try {
              setLoadingFacts(true);
              const { data } = await api.get<any>(`/creatives/${creativeId}`);
              setImdbId((data?.imdb_id ?? null) || null);
            } finally {
              setLoadingFacts(false);
            }
          }}
        />
      )}
    </>,
    document.body
  );
}

/* inline launcher */
function CreateSubButton({
  projectId, needId, creativeId,
}: { projectId:string; needId:string; creativeId:string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn"                         // ← not "tab"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        Sub to this Need
      </button>

      {open && (
        <CreateSubModal
          isOpen={open}
          onClose={() => setOpen(false)}
          initial={{
            projectId,
            creativeIds: [creativeId],
            intentPrimary: 'staffing',
            projectNeedId: needId,
          }}
        />
      )}
    </>
  );
}