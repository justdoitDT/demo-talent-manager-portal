// frontend/src/modals/AI_RecommendClientForProjectNeedModal.tsx

import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import CreateSubModal from './CreateSubModal';
import AttachNeedsModal from './AttachNeedsModal';


const ADD_NEW_NEED = '__add_new_need__';

// Types expected from backend
type Availability = 'available' | 'unavailable' | null;
type Sentiment = 'positive' | 'not positive';

type RecEvent = {
  sub_id?: string;
  recipient_id?: string;
  recipient_name?: string | null;
  sentiment?: Sentiment;
  created_at?: string;
  feedback_text?: string | null;
};

type FeedbackSummary = {
  any_positive: boolean;
  any_non_positive: boolean;
  has_subs_to_staffing: boolean;
  has_subs_no_feedback: boolean;
  events: RecEvent[];
};

type RankedRow = {
  creative_id: string;
  score: number;           // already computed ordering score
  sim: number;             // similarity (same as score in your pipeline)
  availability: Availability;
  justification?: string;
  feedback_summary?: FeedbackSummary;
  name?: string;           // enriched client name
};

type ResultPayload = {
  need_id: string;
  model?: string;
  filters?: any;
  ranked: RankedRow[];
  honorable_mentions: RankedRow[];
};

type NeedMini = {
  id: string;
  project_id: string;
  qualifications: string;
  title?: string | null;
};

export default function AI_RecommendClientForProjectNeedModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: (changed: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [needs, setNeeds] = useState<NeedMini[]>([]);
  const [selectedNeedId, setSelectedNeedId] = useState<string>('');
  const [results, setResults] = useState<ResultPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [subInit, setSubInit] = useState<any | null>(null);
  const [needsModalOpen, setNeedsModalOpen] = useState(false);

  // Load needs for this project
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        // you likely have this endpoint; if not, add GET /projects/{id}/needs
        const { data } = await api.get<NeedMini[]>(`/projects/${projectId}/needs`);
        if (mounted) {
          setNeeds(data || []);
          // try to auto-select the first one
          if (!selectedNeedId && data?.length) {
            setSelectedNeedId(data[0].id);
          }
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [projectId, selectedNeedId]);

  // Fetch latest stored recommendations when need changes
  useEffect(() => {
    if (!selectedNeedId) {
      setResults(null);
      return;
    }
    let mounted = true;
    (async () => {
      setBusy(true);
      try {
        const { data } = await api.get<ResultPayload>(`/ai/recommendations/needs/${selectedNeedId}/latest`);
        // enrich names + availability (might have changed since generation)
        const enriched = await enrichWithClientInfo(data);
        if (mounted) setResults(enriched);
      } catch (e: any) {
        // 404 means none stored yet; show null results so we display "Generate" button
        setResults(null);
      } finally {
        if (mounted) setBusy(false);
      }
    })();
    return () => { mounted = false; };
  }, [selectedNeedId]);

  async function enrichWithClientInfo(payload: ResultPayload): Promise<ResultPayload> {
    if (!payload) return payload;
    const ids = Array.from(new Set([
      ...payload.ranked.map(r => r.creative_id),
      ...payload.honorable_mentions.map(r => r.creative_id),
    ]));

    const infos = await Promise.all(ids.map(async (id) => {
      try {
        const { data } = await api.get<any>(`/creatives/${id}`);
        return [id, { name: data?.name ?? id, availability: data?.availability ?? null }] as const;
      } catch {
        return [id, { name: id, availability: null }] as const;
      }
    }));

    const map = Object.fromEntries(infos);
    const mapRow = (r: RankedRow): RankedRow => ({
      ...r,
      name: map[r.creative_id]?.name || r.creative_id,
      availability: map[r.creative_id]?.availability ?? r.availability ?? null,
    });

    return {
      ...payload,
      ranked: payload.ranked.map(mapRow),
      honorable_mentions: payload.honorable_mentions.map(mapRow),
    };
  }

  async function loadOrRun(refresh = false) {
    if (!selectedNeedId) return;
    setBusy(true);
    try {
      let data: ResultPayload;
      if (refresh || !results) {
        // (re)run
        const { data: fresh } = await api.post<ResultPayload>(
          `/ai/recommendations/needs/${selectedNeedId}/rank`
        );
        data = fresh;
      } else {
        const { data: latest } = await api.get<ResultPayload>(
          `/ai/recommendations/needs/${selectedNeedId}/latest`
        );
        data = latest;
      }
      const enriched = await enrichWithClientInfo(data);
      setResults(enriched);
    } finally {
      setBusy(false);
    }
  }

  const handleSubClient = (creative_id: string) => {
    setSubInit({
      projectId,
      creativeIds: [creative_id],
      intent_primary: 'staffing',
      needId: selectedNeedId,
    });
    setShowCreateSub(true);
  };

  const closeCreateSub = async () => {
    setShowCreateSub(false);
    setSubInit(null);
  };

  const selectedNeedTitle = useMemo(() => {
    const n = needs.find(x => x.id === selectedNeedId);
    const base = n?.title || n?.qualifications || n?.id || '';
    return base;
  }, [needs, selectedNeedId]);

  // Build tooltip strings for 👍 based on feedback_summary.events
  // We resolve exec names via recipient_name if present; otherwise leave the ID.
  // We also resolve project titles by fetching /subs/{sub_id} once per distinct sub_id.
  const [subTitleCache, setSubTitleCache] = useState<Record<string, string>>({});
  async function hydrateProjectTitles(events: RecEvent[]) {
    const needSubs = Array.from(new Set(events.map(e => e.sub_id).filter(Boolean) as string[]));
    const newEntries: Record<string, string> = {};
    await Promise.all(needSubs.map(async (sid) => {
      if (subTitleCache[sid]) return;
      try {
        const { data } = await api.get<any>(`/subs/${sid}`);
        newEntries[sid] = data?.project?.title || data?.project_title || '';
      } catch {
        newEntries[sid] = '';
      }
    }));
    if (Object.keys(newEntries).length) {
      setSubTitleCache(prev => ({ ...prev, ...newEntries }));
    }
  }

  function makeThumbTooltip(summary?: FeedbackSummary): string | undefined {
    if (!summary || !summary.events?.length) return undefined;
    const groups = new Map<string, { recipient: string; project: string; latest: string }>();

    summary.events.forEach((e) => {
      if (e.sentiment !== 'positive') return;
      const recip = e.recipient_name || e.recipient_id || '(recipient)';
      const proj = (e.sub_id && subTitleCache[e.sub_id]) ? subTitleCache[e.sub_id] : '';
      const key = `${recip}||${proj || '(project)'}`;
      const date = e.created_at ? new Date(e.created_at).toISOString() : '';
      const prev = groups.get(key);
      if (!prev || (date && date > prev.latest)) {
        groups.set(key, { recipient: recip, project: proj, latest: date });
      }
    });

    if (groups.size === 0) return undefined;

    const lines: string[] = [];
    groups.forEach(({ recipient, project, latest }) => {
      const pretty = latest ? new Date(latest).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }) : '';
      const projPart = project ? ` for ${project}` : '';
      const datePart = pretty ? ` on ${pretty}` : '';
      lines.push(`• ${recipient}${projPart}${datePart}`);
    });

    return lines.join('\n');
  }

  // Hydrate project titles for tooltips when results change
  useEffect(() => {
    const allEvents: RecEvent[] = [
      ...(results?.ranked?.flatMap(r => r.feedback_summary?.events || []) || []),
      ...(results?.honorable_mentions?.flatMap(r => r.feedback_summary?.events || []) || []),
    ];
    if (allEvents.length) {
      hydrateProjectTitles(allEvents);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results?.need_id]);

  const Table = ({ rows, header }: { rows: RankedRow[]; header?: string }) => (
    <>
      {header && (
        <tr>
          <th colSpan={3} style={{ textAlign:'left', paddingTop:14 }}>
            <div style={{ fontWeight:700 }}>{header}</div>
          </th>
        </tr>
      )}
      {rows.map((r, idx) => {
        const unavailable = r.availability === 'unavailable';
        const posTooltip  = makeThumbTooltip(r.feedback_summary);
  
        return (
          <tr key={`${r.creative_id}:${idx}`} className="ai-rec-row">
            {/* Fit score */}
            <td style={{ padding:8, border:'1px solid #ddd', width:90 }}>
              {Number.isFinite(r.score) ? r.score.toFixed(3) : '—'}
            </td>
  
            {/* Client + Sub button */}
            <td style={{ padding:8, border:'1px solid #ddd', whiteSpace:'nowrap' }}>
              {/* line 1 — name + icons */}
              <span>
                {r.name || r.creative_id}
                {unavailable && <span title="Client currently unavailable" style={{ marginLeft:6 }}>❗</span>}
                {!!posTooltip && <span title={posTooltip} style={{ marginLeft:6 }}>👍</span>}
              </span>
  
              {/* line 2 — button (hidden until row-hover) */}
              <div>
                <button
                  className="tab sub-btn"
                  style={{ marginTop: 14 }}          //  🔥 drop `visibility`
                  onClick={() => handleSubClient(r.creative_id)}
                  title="Create a new sub for this client"
                >
                  Sub Client
                </button>
              </div>
            </td>
  
            {/* Justification */}
            <td style={{ padding:8, border:'1px solid #ddd', whiteSpace:'pre-wrap' }}>
              {r.justification || '(no justification)'}
            </td>
          </tr>
        );
      })}
    </>
  );

  return (
    /* ── backdrop ───────────────────────────────────────────── */
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
               display:'grid', placeItems:'center', zIndex:3000 }}
      /* click anywhere on this backdrop → close modal */
      onClick={() => onClose(false)}
    >
      <style>{`
        .ai-rec-row .sub-btn       { visibility:hidden; opacity:0; transition:none; }
        .ai-rec-row:hover .sub-btn { visibility:visible; opacity:1; }
        .ai-rec-row .sub-btn.tab   { transition:none !important; }
      `}</style>
  
      {/* ── modal box ─────────────────────────────────────────── */}
      <div
        style={{
          background:'#fff',
          border:'4px solid #046A38',
          borderRadius:10,
          minWidth:820,
          maxWidth:1000,
          maxHeight:'calc(100vh - 140px)',
          overflow:'auto',
          padding:16,
          position:'relative',
        }}
        /* prevent clicks inside the box from closing it */
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <h3 style={{ margin:0, color: '#046A38' }}>AI: Recommend Subs</h3>
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            <button className="btn" onClick={() => onClose(false)}>Close</button>
          </div>
        </div>

        {/* Need picker */}
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:12 }}>
          <label style={{ whiteSpace:'nowrap' }}>Select need:</label>
          <select
            value={selectedNeedId}
            onChange={(e) => {
              const val = e.target.value;
              if (val === ADD_NEW_NEED) {
                setNeedsModalOpen(true);           // show AttachNeedsModal
              } else {
                setSelectedNeedId(val);
              }
            }}
            
            disabled={loading || busy}
          >
            {needs.length === 0 && <option value="">(no needs attached)</option>}
            {needs.map(n => (
              <option key={n.id} value={n.id}>
                {n.title || n.qualifications || n.id}
              </option>
            ))}
            <option value={ADD_NEW_NEED}>➕ Add new need…</option>
          </select>

          {/* Generate or Refresh */}
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            {selectedNeedId && !results && (
              <button className="aiButton" disabled={busy} onClick={() => loadOrRun(true)}>
                {busy ? 'Generating…' : 'Generate Recommendations'}
              </button>
            )}
            {selectedNeedId && results && (
              <button className="aiButton" disabled={busy} onClick={() => loadOrRun(true)}>
                {busy ? 'Refreshing…' : 'Refresh Recommendations'}
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        {selectedNeedId && results && (
          <div style={{ marginTop:12 }}>
            <div style={{ marginBottom:6, color:'#555' }}>
              Showing recommendations for need: <b>{selectedNeedTitle}</b>
            </div>

            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign:'left', border:'1px solid #ddd', padding:8, width:"1%", whiteSpace:"nowrap" }}>Fit Score</th>
                  <th style={{ textAlign:'left', border:'1px solid #ddd', padding:8, width:"1%", whiteSpace:"nowrap" }}>Client</th>
                  <th style={{ textAlign:'left', border:'1px solid #ddd', padding:8 }}>Justification</th>
                </tr>
              </thead>
              <tbody>
                {/* Top 10 */}
                <Table rows={results.ranked.slice(0, 10)} />

                {/* Honorable Mention header + rows if any */}
                {results.honorable_mentions?.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={3} style={{ paddingTop:12, background:'#fafafa', borderTop:'2px solid #ddd' }}>
                        <b>Honorable Mention</b>
                      </td>
                    </tr>
                    <Table rows={results.honorable_mentions} />
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* If no stored results yet */}
        {selectedNeedId && !results && !busy && (
          <div style={{ marginTop:16, color:'#666' }}>
            No stored recommendations for this need yet. Click <b>Generate Recommendations</b>.
          </div>
        )}

        {/* CreateSubModal for “Sub Client” action */}
        {showCreateSub && subInit && (
          <CreateSubModal
            isOpen={showCreateSub}
            onClose={() => {
              closeCreateSub();
            }}
            initial={{
              projectId: subInit.projectId,
              creativeIds: subInit.creativeIds,
              intentPrimary: 'staffing',
              projectNeedId: subInit.needId,
            }}
          />
        )}

        {/* ─── AttachNeedsModal (➕ Add new need…) ─── */}
        {needsModalOpen && (
          <AttachNeedsModal
            isOpen={true}
            projectId={projectId}
            initiallySelectedIds={[]}
            onClose={() => setNeedsModalOpen(false)}
            onSaved={(selected, all) => {
              // merge new needs into dropdown list
              if (all?.length) {
                setNeeds(prev => {
                  const seen   = new Set(prev.map(n => n.id));

                  /*  Option → NeedMini  */
                  const converted = all.map(o => ({
                    id:             o.id,
                    project_id:     projectId,
                    qualifications: o.label,     // best available field
                    title:          o.label,
                  })) as NeedMini[];

                  return [
                    ...prev,
                    ...converted.filter(n => !seen.has(n.id)),
                  ];
                });
              }
              if (selected) {
                setSelectedNeedId(selected.id);   // auto-select
              }
              setNeedsModalOpen(false);
            }}
          />
        )}

      </div>
    </div>
  );
}
