// frontend/src/components/AI_RecommendProjectNeedForCreativeReportPage.tsx

import React, { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import api from '../services/api';
import { usePane } from '../pane/PaneContext';

type RecRow = {
  project_id: string;
  need_id?: string | null;
  justification?: string | null;
  sim?: number | null;
  need_qual?: string | null;
};

type CompanyItem = { id: string; name: string };
type NeedItem = { id: string; qualifications?: string | null; description?: string | null; status?: string | null };

type ProjectBundle = {
  id: string;
  title: string;
  media_type: string | null;
  tracking_status: string | null;
  description: string | null;
  updates: string | null;
  engagement: string | null;
  creatives_attached_note?: string | null;

  // names (for simple display)
  tv_networks: string[];
  studios: string[];
  prodcos: string[];
  executives: string[];
  genres: string[];
  needs: Array<{ qualifications?: string | null; description?: string | null; status?: string | null }>;
  notes: Array<{ note: string; created_at?: string }>;

  // structured (clickable)
  tv_networks_struct: CompanyItem[];
  studios_struct: CompanyItem[];
  prodcos_struct: CompanyItem[];
  executives_struct: CompanyItem[];
  genres_struct: Array<{ id: string; name: string }>;
  needs_struct: NeedItem[];

  // attached AI row
  ai_rec?: RecRow | null;
};

type JsonReport = {
  creative: { id: string; name: string };
  include_archived: boolean;
  projects: ProjectBundle[];
};

export default function CreativeProjectRecsReport() {
  const { creativeId } = useParams();
  const location = useLocation();
  const { open } = usePane() as any;

  // incoming state from the modal (preferred)
  const state = (location.state || {}) as {
    projectIds?: string[];
    recs?: RecRow[];
    includeArchived?: boolean;
    creativeId?: string;
    creativeName?: string;
  };

  const [data, setData] = useState<JsonReport | null>(null);
  const [busy, setBusy] = useState(false);
  
  // If we didn’t get state (deep link), try session handoff; else fall back to latest.
  useEffect(() => {
    if (!creativeId) return;

    let mounted = true;
    (async () => {
      setBusy(true);
      try {
        type Payload = { creative_id: string; project_ids: string[]; include_archived: boolean; recs: RecRow[] };
        let payload: Payload | null = null;

        // 1) Router state (from modal)
        if (state?.projectIds?.length && state?.recs?.length) {
          payload = {
            creative_id: creativeId,
            project_ids: state.projectIds,
            include_archived: !!state.includeArchived,
            recs: state.recs,
          };
        }

        // 2) sessionStorage handoff (if no state)
        if (!payload) {
          try {
            const raw = sessionStorage.getItem('rde:project-recs');
            if (raw) {
              const handoff = JSON.parse(raw) as {
                creativeId?: string;
                projectIds?: string[];
                includeArchived?: boolean;
                recs?: RecRow[];
              };
              if (
                handoff?.creativeId === creativeId &&
                handoff?.projectIds?.length &&
                handoff?.recs?.length
              ) {
                payload = {
                  creative_id: creativeId,
                  project_ids: handoff.projectIds,
                  include_archived: !!handoff.includeArchived,
                  recs: handoff.recs,
                };
                sessionStorage.removeItem('rde:project-recs');
              }
            }
          } catch {
            /* noop */
          }
        }

        // 3) Latest-cached fallback
        if (!payload) {
          const savedFiltersRaw = sessionStorage.getItem('rde:project-recs:filters');
          let saved: { creativeId?: string; media_type_filter?: string[]; qualifications_filter?: string[]; include_archived?: boolean } | null = null;
          try { saved = savedFiltersRaw ? JSON.parse(savedFiltersRaw) : null; } catch {}

          const qs = new URLSearchParams();

          const media = (saved?.creativeId === creativeId && Array.isArray(saved?.media_type_filter) && saved!.media_type_filter!.length)
            ? saved!.media_type_filter!
            : ['Feature', 'TV Series', 'Play', 'Other'];

          const quals = (saved?.creativeId === creativeId && Array.isArray(saved?.qualifications_filter) && saved!.qualifications_filter!.length)
            ? saved!.qualifications_filter!
            : ['OWA', 'Staff Writer', 'ODA', 'Director'];

          for (const m of media) qs.append('media', m);
          for (const q of quals) qs.append('quals', q);

          const inc = (saved?.creativeId === creativeId && typeof saved?.include_archived === 'boolean')
            ? !!saved!.include_archived
            : false;
          qs.set('include_archived', inc ? 'true' : 'false');

          const { data: latest } = await api.get<any>(
            `/ai/recommendations/creatives/${creativeId}/needs/latest?${qs.toString()}`
          );

          const ranked = (latest?.ranked || []) as Array<{
            project_id: string;
            need_id?: string | null;
            justification?: string | null;
            sim?: number | null;
            need_qual?: string | null;
            qualifications?: string | null;
          }>;

          payload = {
            creative_id: creativeId,
            project_ids: ranked.map((r) => r.project_id),
            include_archived: inc,
            recs: ranked.map((r) => ({
              project_id: r.project_id,
              need_id: r.need_id ?? null,
              justification: r.justification ?? null,
              sim: typeof r.sim === 'number' ? r.sim : null,
              need_qual: r.need_qual ?? r.qualifications ?? null,
            })),
          };
        }

        if (!payload) return;
        const { data } = await api.post<JsonReport>(
          `/ai/recommendations/creatives/${creativeId}/needs/report.json`,
          payload
        );
        if (!mounted) return;
        setData(data);
      } catch (e) {
        console.error('Load dynamic report failed', e);
      } finally {
        if (mounted) setBusy(false);
      }
    })();

    return () => {
      mounted = false;
    };
    // include state props so ESLint is happy; they only change on navigation
  }, [creativeId, state.projectIds, state.recs, state.includeArchived]);


  const creativeName = data?.creative?.name ?? state?.creativeName ?? '—';

  const exportPdf = async () => {
    if (!data || !creativeId) return;
    const project_ids = data.projects.map((p) => p.id);
    const recs: RecRow[] = data.projects.map((p) => p.ai_rec || { project_id: p.id });
    try {
      const { data: blobBytes } = await api.post(
        `/ai/recommendations/creatives/${creativeId}/needs/report.pdf`,
        {
          creative_id: creativeId,
          project_ids,
          include_archived: data.include_archived,
          recs,
        },
        { responseType: 'blob' }
      );
      const blob = new Blob([blobBytes], { type: 'application/pdf' });
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
      alert('Failed to export PDF.');
    }
  };

  const HRule = () => <div style={{ height: 1, background: '#ddd', margin: '6px 0' }} />;

  const linkButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    padding: 0,
    color: '#046A38',
    cursor: 'pointer',
    font: 'inherit',
  };

  const onOpenProject = (id: string) => open?.({ kind: 'project', id });
  const onOpenExecutive = (id: string) => open?.({ kind: 'executive', id });
  const onOpenCompany = (
    type: 'tv_network' | 'studio' | 'production_company',
    id: string
  ) => open?.({ kind: 'company', companyType: type, id });
  const onOpenCreative = () => data?.creative?.id && open?.({ kind: 'creative', id: data.creative.id });

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>
          Project Recommendations for{' '}
          <button type="button" style={linkButtonStyle} onClick={onOpenCreative} title="Open Creative Pane">
            {creativeName}
          </button>
        </h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {/* <button className="btn" onClick={() => navigate(-1)}>
            Back
          </button> */}
          <button className="tab" onClick={exportPdf} disabled={!data || busy}>
            Export PDF
          </button>
        </div>
      </div>


      {busy && <div style={{ marginTop: 16 }}>Loading…</div>}

      {!busy && data?.projects?.length === 0 && (
        <div style={{ marginTop: 16, color: '#666' }}>No projects to show.</div>
      )}

      {!busy &&
        data?.projects?.map((p) => (
          <section key={p.id} style={{ marginTop: 18 }}>
            <HRule />
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              <button
                type="button"
                style={linkButtonStyle}
                onClick={() => onOpenProject(p.id)}
                title="Open Project Pane"
              >
                {p.title || p.id}
              </button>
            </div>
            <div style={{ fontSize: 16, color: '#555' }}>
              {p.media_type ?? '—'} &nbsp;•&nbsp; Tracking: {p.tracking_status ?? '—'}
            </div>
            <HRule />

            {/* Companies */}
            {(p.tv_networks_struct?.length || p.studios_struct?.length || p.prodcos_struct?.length) ? (
              <div style={{ marginBottom: 6 }}>
                {p.tv_networks_struct?.length ? (
                  <>
                    <b>Networks:</b>{' '}
                    {p.tv_networks_struct.map((n, i) => (
                      <React.Fragment key={n.id}>
                        {i > 0 && ', '}
                        <button
                          type="button"
                          style={linkButtonStyle}
                          onClick={() => onOpenCompany('tv_network', n.id)}
                        >
                          {n.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </>
                ) : null}
                {p.studios_struct?.length ? (
                  <>
                    {' '}
                    &nbsp;/&nbsp; <b>Studios:</b>{' '}
                    {p.studios_struct.map((n, i) => (
                      <React.Fragment key={n.id}>
                        {i > 0 && ', '}
                        <button
                          type="button"
                          style={linkButtonStyle}
                          onClick={() => onOpenCompany('studio', n.id)}
                        >
                          {n.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </>
                ) : null}
                {p.prodcos_struct?.length ? (
                  <>
                    {' '}
                    &nbsp;/&nbsp; <b>Production Companies:</b>{' '}
                    {p.prodcos_struct.map((n, i) => (
                      <React.Fragment key={n.id}>
                        {i > 0 && ', '}
                        <button
                          type="button"
                          style={linkButtonStyle}
                          onClick={() => onOpenCompany('production_company', n.id)}
                        >
                          {n.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}

            {/* Executives */}
            {p.executives_struct?.length ? (
              <div style={{ marginBottom: 6 }}>
                <b>Executives:</b>{' '}
                {p.executives_struct.map((x, i) => (
                  <React.Fragment key={x.id}>
                    {i > 0 && ', '}
                    <button
                      type="button"
                      style={linkButtonStyle}
                      onClick={() => onOpenExecutive(x.id)}
                      title="Open Executive Pane"
                    >
                      {x.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            ) : null}

            {/* Genres */}
            {p.genres?.length ? (
              <div style={{ marginBottom: 10 }}>
                <b>Genres:</b> {p.genres.join(', ')}
              </div>
            ) : null}

            {/* Description */}
            {p.description ? (
              <>
                <div style={{ fontWeight: 600, marginTop: 6 }}>Description</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{p.description}</div>
              </>
            ) : null}

            {/* Needs */}
            <div style={{ fontWeight: 600, marginTop: 10 }}>Project Needs</div>
            {p.needs?.length ? (
              <ul style={{ marginTop: 4 }}>
                {p.needs.map((n, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    <span style={{ fontWeight: 600 }}>{n.qualifications ?? '—'}</span>
                    <span style={{ color: '#666' }}> (Status: {n.status ?? '—'})</span>
                    {n.description ? <div style={{ whiteSpace: 'pre-wrap' }}>{n.description}</div> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ fontStyle: 'italic' }}>No needs listed.</div>
            )}

            {/* Creatives Attached */}
            {p.creatives_attached_note ? (
              <>
                <div style={{ fontWeight: 600, marginTop: 10 }}>Creatives Attached</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  {p.creatives_attached_note}
                </div>
              </>
            ) : null}

            {/* Updates / Engagement */}
            {p.updates || p.engagement ? (
              <div style={{ display: 'grid', gap: 4, marginTop: 10 }}>
                {p.updates ? (
                  <div>
                    <div style={{ fontWeight: 600 }}>Updates</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{p.updates}</div>
                  </div>
                ) : null}
                {p.engagement ? (
                  <div>
                    <div style={{ fontWeight: 600 }}>Engagement</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{p.engagement}</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Notes */}
            <div style={{ fontWeight: 600, marginTop: 10 }}>Notes</div>
            {p.notes?.length ? (
              <ul style={{ marginTop: 4 }}>
                {p.notes.map((n, i) => (
                  <li key={i}>
                    <span style={{ color: '#666' }}>{(n.created_at || '').slice(0, 10) || '—'}</span>
                    {' — '}
                    <span style={{ whiteSpace: 'pre-wrap' }}>{n.note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ fontStyle: 'italic' }}>No notes linked.</div>
            )}

            {/* AI Recommendation (Why) */}
            {p.ai_rec ? (
              <>
                <div style={{ fontWeight: 600, marginTop: 10 }}>AI Recommendation</div>
                <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                  {p.ai_rec.need_qual ? (
                    <>
                      <b>Need:</b> {p.ai_rec.need_qual} &nbsp;&nbsp;
                    </>
                  ) : null}
                  {typeof p.ai_rec.sim === 'number' ? (
                    <>
                      <b>Fit:</b> {p.ai_rec.sim.toFixed(3)}
                    </>
                  ) : null}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', marginBottom: 100 }}>
                  {p.ai_rec.justification || <em>(no AI justification text)</em>}
                </div>
              </>
            ) : null}

          </section>
        ))}
    </div>
  );
}
