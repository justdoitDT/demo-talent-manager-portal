// frontend/src/components/ProjectsPage.tsx

import React, {
  useEffect, useMemo, useState, CSSProperties,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { usePane } from '../pane/PaneContext';
import CreateProjectModal from '../modals/CreateProjectModal';

/* ───────────── Types ───────────── */
interface Project {
  id: string;
  title: string;
  year?: number | null;
  media_type?: string | null;
  status?: string | null;
  tracking_status?: string | null;
  engagement?: string | null;
  project_types?: string[];
  network?: string | null;
  studio?: string | null;
}
interface PagedProjects {
  total: number;
  items: Project[];
}

/* ───────────── Styles ───────────── */
const th: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: 8,
  verticalAlign: 'bottom',
};
const td: CSSProperties = { ...th };
const NA = <span style={{ color: '#999' }}>—</span>;

const chipStyle: CSSProperties = {
  display:'inline-block', padding:'2px 6px', margin:'0 4px 4px 0',
  borderRadius:12, fontSize:12, background:'#eee'
};

const Spinner: React.FC = () => (
  <div className="spinner" role="status" aria-label="Loading">
    <div />
  </div>
);

/* ────────────────────────────────── */
export default function ProjectsPage() {
  const { open } = usePane();
  const [showCreateProject, setShowCreateProject] = useState(false);

  /* URL-backed filters */
  const [sp, setSp] = useSearchParams();
  const mediaType  = sp.get('media_type')  ?? '';
  const year       = sp.get('year')        ?? '';
  const tracking   = sp.get('tracking')    ?? '';
  const engagement = sp.get('engagement')  ?? '';
  const ptype      = sp.get('ptype')       ?? '';
  const search     = sp.get('q')           ?? '';
  const studio = sp.get('studio')          ?? '';
  const network    = sp.get('network')    ?? '';

  const limit   = +(sp.get('limit')  ?? 25);
  const offset  = +(sp.get('offset') ?? 0);
  const page    = Math.floor(offset / limit) + 1;

  const [loading, setLoading]   = useState(true);

  /* helper: set any param **and** jump back to page 1 */
  const setFilter = React.useCallback((k: string, v: string) => {
    setLoading(true);
    const next = new URLSearchParams(sp);
    v ? next.set(k, v) : next.delete(k);
    next.set('offset', '0'); // ← ALWAYS jump back to first page
    next.delete('page');     // ← (page param is unused)
    setSp(next);
  }, [sp, setSp, setLoading]);

  const goPage = (n: number) => {
    setLoading(true);
    const newOffset = (n - 1) * limit;
    if (newOffset < 0) return;
    const next = new URLSearchParams(sp);
    next.set('offset', String(newOffset));
    next.set('limit', String(limit));
    setSp(next);
  };

  // Debounced search (local draft mirrors `q` from URL)
  const [searchDraft, setSearchDraft] = useState(search);

  // keep local draft in sync if URL param changes externally
  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  // debounce applying the filter to URL
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchDraft !== search) {
        setFilter('q', searchDraft);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [searchDraft, search, setFilter]); // depends on both



  const [studioDraft, setStudioDraft] = useState(studio);
  useEffect(() => { setStudioDraft(studio); }, [studio]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (studioDraft !== studio) setFilter('studio', studioDraft);
    }, 300);
    return () => clearTimeout(id);
  }, [studioDraft, studio, setFilter]);

  const [networkDraft, setNetworkDraft] = useState(network);
  useEffect(() => { setNetworkDraft(network); }, [network]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (networkDraft !== network) setFilter('network', networkDraft);
    }, 300);
    return () => clearTimeout(id);
  }, [networkDraft, network, setFilter]);



  /* project type helpers */
  const TYPE_OPTIONS = [
    "Staffing","OWA","ODA","Episodic Directing","Re-write","1st in","Pitch"
  ] as const;

  const [editRowId, setEditRowId] = useState<string|null>(null);
  const [draftTypes, setDraftTypes] = useState<string[]>([]);

  const addType = (t:string) => setDraftTypes(prev => [...prev, t]);
  const removeType = (t:string) => setDraftTypes(prev => prev.filter(x=>x!==t));

  const saveTypes = async (pid:string) => {
    const before = projects.find(p => p.id===pid)?.project_types ?? [];
    const toAdd    = draftTypes.filter(t => !before.includes(t));
    const toRemove = before.filter(t => !draftTypes.includes(t));

    await Promise.all([
      ...toAdd.map(t => api.post(`/projects/${pid}/types/${t}`)),
      ...toRemove.map(t => api.delete(`/projects/${pid}/types/${t}`)),
    ]);

    // force-refetch (same params → add a throw-away “ts” param)
    setSp(p => {
      const next = new URLSearchParams(p);
      next.set('ts', Date.now().toString());
      return next;
    });
    setEditRowId(null);
  };


  /* data */
  const [paged, setPaged] = useState<PagedProjects>({ total: 0, items: [] });
  const projects = paged.items;

  useEffect(() => {
    setLoading(true);                      // show spinner immediately

    const params: Record<string, any> = {
      limit, offset,
      year:                year       || undefined,
      tracking_status:     tracking   || undefined,
      engagement:          engagement || undefined,
      q:                   search     || undefined,
      ptype:               ptype      || undefined,
      studio:              studio     || undefined,
      network:             network    || undefined,
    };
    if (mediaType === 'Feature' || mediaType === 'TV Series') {
      params.media_type = mediaType;
    }

    api.get<PagedProjects>('/projects', { params })
       .then(r => {
         let { items } = r.data;
         if (mediaType === 'Other') {
           items = items.filter(
             p => p.media_type !== 'Feature' && p.media_type !== 'TV Series'
           );
         }
         setPaged({ total: r.data.total, items });
       })
       .finally(() => setLoading(false));   // hide spinner no-matter-what
  }, [mediaType, year, tracking, ptype, engagement, studio, network, search, limit, offset]);

  /* ─── dynamic year list for dropdown ─── */
  const yearOptions = useMemo(() => {
    const yrs = new Set<number>();
    projects.forEach(p => p.year && yrs.add(p.year));
    return Array.from(yrs).sort((a, b) => b - a);
  }, [projects]);

  const maxPage = Math.max(1, Math.ceil(paged.total / limit));

  /* ─────────── render ─────────── */
  return (
    <div>
      <style>{`
        tr:hover .hover-btn{visibility:visible}
        .hover-btn{visibility:hidden}
      `}</style>

      <h1>Projects</h1>

      <div style={{ margin: '6px 0 8px 0' }}>
        <button
          className="tab"
          onClick={() => setShowCreateProject(true)}
          title="Create a new project"
        >
          Create Project
        </button>
      </div>

      <small style={{ display: 'block', margin: '4px 0' }}>
        Showing {offset + 1}–{offset + projects.length} of {paged.total}
      </small>

      <div style={{position:'relative'}}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {/* Media Type */}
              <th style={th}>
                <div>Media Type</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={mediaType}
                    onChange={e => setFilter('media_type', e.target.value)}
                  >
                    <option>TV Series</option>
                    <option>Feature</option>
                    <option>Other</option>
                    <option value="">Any</option>
                  </select>
                </div>
              </th>

              {/* Title */}
              <th style={th}>
                <div>Title</div>
                <div style={{ marginTop: 4 }}>
                  <input
                    placeholder="Search…"
                    value={searchDraft}
                    onChange={e => setSearchDraft(e.target.value)}
                    style={{ width: '90%' }}
                  />
                </div>
              </th>

              {/* Year */}
              <th style={th}>
                <div>Year</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={year}
                    onChange={e => setFilter('year', e.target.value)}
                  >
                    <option value="">Any</option>
                    {yearOptions.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </th>

              {/* Conditional company column */}
              {mediaType === 'TV Series' && (
                <th style={th}>
                  <div>Network</div>
                  <div style={{ marginTop: 4 }}>
                    <input
                      placeholder="Search…"
                      value={networkDraft}
                      onChange={e => setNetworkDraft(e.target.value)}
                      style={{ width: '90%' }}
                    />
                  </div>
                </th>
              )}
              {mediaType === 'Feature' && (
                <th style={th}>
                  <div>Studio</div>
                  <div style={{ marginTop: 4 }}>
                    <input
                      placeholder="Search…"
                      value={studioDraft}
                      onChange={e => setStudioDraft(e.target.value)}
                      style={{ width: '90%' }}
                    />
                  </div>
                </th>
              )}

              {/* Tracking */}
              <th style={th}>
                <div>Tracking</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={tracking}
                    onChange={e => setFilter('tracking', e.target.value)}
                  >
                    <option value="">Any</option>
                    <option>Internal / Not Tracking</option>
                    <option>Hot List</option>
                    <option>Active</option>
                    <option>Priority Tracking</option>
                    <option>Tracking</option>
                    <option>Development</option>
                    <option>Engaged</option>
                    <option>Deep Tracking</option>
                    <option>Archived</option>
                    <option>Completed</option>
                  </select>
                </div>
              </th>

              {/* OWA / ODA */}
              <th style={th}>
                <div>OWA / ODA</div>
                <div style={{marginTop:4}}>
                  <select
                    value={ptype}
                    onChange={e => setFilter('ptype', e.target.value)}
                  >
                    <option value="">Any</option>
                    <option value="OWA/ODA">OWA / ODA</option>
                    <option value="OWA">OWA</option>
                    <option value="ODA">ODA</option>
                    <option value="Staffing">Staffing</option>
                    <option value="Episodic Directing">Episodic Directing</option>
                    <option value="Re-write">Re-write</option>
                    <option value="1st in">1st in</option>
                    <option value="Pitch">Pitch</option>
                  </select>
                </div>
              </th>

              {/* Engagement */}
              <th style={th}>
                <div>Engagement</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={engagement}
                    onChange={e => setFilter('engagement', e.target.value)}
                  >
                    <option value="">Any</option>
                    <option>Meeting</option>
                    <option>Incoming</option>
                    <option>Sub</option>
                    <option>Pitching</option>
                  </select>
                </div>
              </th>

              {/* Edit Button */}
              <th style={{ ...th, width: '1%' }}></th>
            </tr>
          </thead>

          <tbody>
            {projects.map(p => (
              <tr key={p.id}>
                <td style={td}>{p.media_type ?? NA}</td>

                <td
                  className="clickable"
                  style={td}
                  onClick={() => open({ kind: 'project', id: p.id })}
                >
                  {p.title}
                </td>

                {/* Year */}
                <td style={td}>{p.year ?? NA}</td>

                {/* Conditional company cell */}
                {mediaType === 'TV Series' && <td style={td}>{p.network || NA}</td>}
                {mediaType === 'Feature'   && <td style={td}>{p.studio  || NA}</td>}

                {/* Tracking */}
                <td style={td}>{p.tracking_status ?? NA}</td>

                {/* OWA / ODA chips */}
                <td style={td}>
                  {(editRowId === p.id ? draftTypes : (p.project_types ?? [])).length
                    ? (editRowId === p.id ? draftTypes : (p.project_types ?? [])).map(t => (
                        <span key={t} style={chipStyle}>
                          {t}
                          {editRowId === p.id && (
                            <span
                              onClick={() => removeType(t)}
                              style={{ marginLeft: 4, cursor: 'pointer' }}
                            >
                              ✕
                            </span>
                          )}
                        </span>
                      ))
                    : NA}

                  {editRowId === p.id && (
                    <select
                      value=""
                      onChange={e => {
                        const t = e.target.value;
                        e.target.value = "";
                        if (t && !draftTypes.includes(t)) addType(t);
                      }}
                    >
                      <option value="">＋ Add…</option>
                      {TYPE_OPTIONS.filter(o => !draftTypes.includes(o)).map(o => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  )}
                </td>

                <td style={td}>{p.engagement ?? NA}</td>

                {/* Edit button */}
                <td style={{...td, width:1, whiteSpace:'nowrap'}}>
                  {editRowId === p.id ? (
                    <>
                      <button className="btn" onClick={() => saveTypes(p.id)}>Save</button>
                      <button className="btn" onClick={() => setEditRowId(null)} style={{marginLeft:4}}>Cancel</button>
                    </>
                  ) : (
                    <button
                      className="btn hover-btn"
                      onClick={() => { setEditRowId(p.id); setDraftTypes(p.project_types ?? []); }}
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* loading spinner */}
        {loading && (
          <div style={{
            position:'absolute', inset:0,
            background:'rgba(255,255,255,.6)',
            display:'flex', justifyContent:'center', alignItems:'flex-start', paddingTop: 48,
            zIndex:1000
          }}>
            <Spinner/>
          </div>
        )}
      </div>

      <CreateProjectModal
        isOpen={showCreateProject}
        onClose={() => setShowCreateProject(false)}
      />

      {/* pagination */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn" disabled={page === 1}       onClick={() => goPage(page - 1)}>Prev</button>
        <span>Page {page} / {maxPage}</span>
        <button className="btn" disabled={page >= maxPage} onClick={() => goPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
