// frontend/src/pane/panes/WritingSamplePaneDetailsTab.tsx

import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';
import { usePane } from '../PaneContext';
import { useBusy } from '../BusyContext';

/* ───────────────────────── Types ─────────────────────────── */
interface CreativeMini { id:string; name:string; }
interface ProjectMini  { id:string; title:string; }

export interface WritingSampleDetail {
  id:              string;
  filename:        string;
  file_type:       string;
  size_bytes:      number;
  file_description:string | null;
  synopsis:        string | null;
  uploaded_by:     string | null;
  uploaded_by_name: string | null;
  uploaded_at:     string;              // ISO string
  creatives: CreativeMini[];
  projects:  ProjectMini[];
}

/* ───────── helpers ───────────────────────────────────────── */
const NONE = <em style={{ color:'#999' }}>None</em>;
const th: React.CSSProperties = { textAlign:'left', padding:'6px 8px', background:'#f6f6f6', border:'1px solid #ddd' };
const td: React.CSSProperties = { padding:'6px 8px', border:'1px solid #ddd' };

/* ───────────────────────── Component ─────────────────────── */
export default function WritingSamplePaneDetailsTab({ writingSampleId }: { writingSampleId:string }) {
  const { open } = usePane();
  const [, setBusy] = useBusy();

  const [data, setData] = useState<WritingSampleDetail | null>(null);

  /* editing state for sample fields */
  const [editingKey, setEditingKey] = useState<keyof WritingSampleDetail | null>(null);
  const [tempValue, setTempValue]   = useState<string>('');
  const [hoverKey,  setHoverKey]    = useState<keyof WritingSampleDetail | null>(null);

  /* creatives link‑management state */
  const [hoverCid,   setHoverCid]    = useState<string|null>(null);
  const [confirmCid, setConfirmCid]  = useState<string|null>(null);
  const [addingCr,   setAddingCr]    = useState(false);
  const [searchCr,   setSearchCr]    = useState('');
  const [allCreatives, setAllCreatives] = useState<CreativeMini[]>([]);

  /* projects link‑management state */
  const [hoverPid,   setHoverPid]    = useState<string|null>(null);
  const [confirmPid, setConfirmPid]  = useState<string|null>(null);
  const [addingPr,   setAddingPr]    = useState(false);
  const [searchPr,   setSearchPr]    = useState('');
  const [allProjects, setAllProjects] = useState<ProjectMini[]>([]);

  /* ───── fetch detail ───── */
  const load = useCallback(() => {
    api
      .get<WritingSampleDetail>(`/writing_samples/${writingSampleId}`)
      .then(r => setData(r.data));
  }, [writingSampleId]);

  useEffect(() => { load(); }, [load]);

  // fetch dropdown lists — CREATIVES
  useEffect(() => {
      if (!addingCr) return;
    
      const t = setTimeout(() => {
        api
          .get<CreativeMini[]>('/creatives', {
            params: { q: searchCr || undefined, limit: 20 },
          })
          .then(r => setAllCreatives(r.data));
      }, 250);               // ¼‑second debounce
    
      return () => clearTimeout(t);
    }, [addingCr, searchCr]);

  // fetch dropdown lists — PROJECTS
  useEffect(() => {
    if (!addingPr) return;
  
    const t = setTimeout(() => {
      api
        // note the response is { total, items }
        .get<{ total: number; items: ProjectMini[] }>('/projects', {
          params: { q: searchPr || undefined, limit: 20, offset: 0 },
        })
        .then(r => setAllProjects(r.data.items));   // ← grab .items
    }, 250);      // debounce
  
    return () => clearTimeout(t);
  }, [addingPr, searchPr]);

  /* ───── mutators ───── */
  const patchSample = (payload: Partial<WritingSampleDetail>) =>
    api.patch(`/writing_samples/${writingSampleId}`, payload).then(load);

  const linkCreative = (cid: string) => {
    setBusy(true);
    api
      .post(`/writing_samples/${writingSampleId}/creatives/${cid}`)
      .then(load)
      .finally(() => setBusy(false));
  };

  const unlinkCreative = (cid: string) => {
    setBusy(true);
    api
      .delete(`/writing_samples/${writingSampleId}/creatives/${cid}`)
      .then(load)
      .finally(() => setBusy(false));
  };

  const linkProject = (pid: string) => {
    setBusy(true);
    api
      .post(`/writing_samples/${writingSampleId}/projects/${pid}`)
      .then(load)
      .finally(() => setBusy(false));
  };

  const unlinkProject = (pid: string) => {
    setBusy(true);
    api
      .delete(`/writing_samples/${writingSampleId}/projects/${pid}`)
      .then(load)
      .finally(() => setBusy(false));
  };

  /* Download writing sample */
  const handleDownload = async () => {
    try {
      const { data: { url } } =
        await api.get<{ url: string }>(`/writing_samples/${writingSampleId}/download`);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      alert('Could not get download link');
      console.error(err);
    }
  };

  /* guards */
  if (!data) return <>Loading…</>;

  /* ─────────── helpers for rendering tables ─────────── */
  const EditableRow = (
    label:string,
    key: keyof WritingSampleDetail,
    render?: () => React.ReactNode,
  ) => {
    const val:any = data[key];
    const isEditing = editingKey === key;
    const inputType = key === 'uploaded_at' ? 'date' : 'text';

    return (
      <tr
        onMouseEnter={()=>setHoverKey(key)}
        onMouseLeave={()=>setHoverKey(null)}
      >
        <td style={{ fontWeight:600, padding:6 }}>{label}</td>
        <td style={{ ...td, width:'100%' }}>
          {isEditing ? (
            <div style={{ display:'flex', gap:8 }}>
              {key === 'file_description' || key === 'synopsis' ? (
                <textarea
                  style={{ flex:1, minHeight:80 }}
                  value={tempValue}
                  onChange={e=>setTempValue(e.target.value)}
                />
              ) : (
                <input
                  autoFocus
                  type={inputType}
                  value={tempValue}
                  onChange={e=>setTempValue(e.target.value)}
                  style={{ flex:1 }}
                />
              )}
              <button className="btn" onClick={()=>{
                patchSample({ [key]: tempValue.trim() || null });
                setEditingKey(null);
              }}>Save</button>
              <button className="btn" onClick={()=>setEditingKey(null)}>Cancel</button>
            </div>
          ) : (
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>{render ? render() : (val ?? NONE)}</span>
              {(key === 'file_description' || key === 'synopsis') && (
                <button
                  className="btn"
                  style={{ visibility: hoverKey === key ? 'visible' : 'hidden' }}
                  onClick={()=>{ setTempValue(val ?? ''); setEditingKey(key); }}
                >Edit</button>
              )}
            </div>
          )}
        </td>
      </tr>
    );
  };

  const menuBox: React.CSSProperties = {
    maxHeight: 300,
    overflowY: 'auto',
    border: '1px solid #ddd',
    padding: 6,
    background: '#fff',
    boxShadow: '0 2px 6px rgba(0,0,0,.15)',
  };
  const pickStyle = { padding: 4,  };   // for each clickable item
  

  /* ─────────── render ─────────── */
  return (
    <>
      {/* ───────── Download button ───────── */}
      <div style={{ marginBottom: 16 }}>
        <button className="tab" onClick={handleDownload}>
          Download Writing Sample
        </button>
      </div>
      
      {/* ───────── Linked Creatives ───────── */}
      <table style={{ borderCollapse:'collapse', minWidth:'40ch', width:'fit-content', marginTop:0 }}>
        <thead>
          <tr>
            <th style={th}>
              Linked Creative{data.creatives.length !== 1 ? 's' : ''}
              <button
                className="btn"
                style={{ float:'right', fontSize:'0.8rem', padding:'4px 8px' }}
                onClick={() => setAddingCr(a => !a)}
              >
                {addingCr ? 'Cancel' : 'Add Creative'}
              </button>
            </th>
          </tr>

          {addingCr && (
            <>
              {/* search box */}
              <tr>
                <td style={{ padding:8 }}>
                  <input
                    type="search"
                    placeholder="Search creatives…"
                    value={searchCr}
                    onChange={e => setSearchCr(e.target.value)}
                    style={{ width:'100%' }}
                  />
                </td>
              </tr>

              {/* results box */}
              <tr>
                <td>
                  <div style={menuBox}>
                    {allCreatives.length === 0 ? (
                      <div style={{ color:'#999' }}>No matches</div>
                    ) : (
                      allCreatives.map(c => (
                        <div
                          key={`pick-${c.id}`}
                          className="clickable"
                          style={pickStyle}
                          onClick={() => { linkCreative(c.id); setAddingCr(false); }}
                        >
                          {c.name}
                        </div>
                      ))
                    )}
                  </div>
                </td>
              </tr>
            </>
          )}
        </thead>

        <tbody>
          {data.creatives.length === 0 ? (
            <tr><td style={{ ...td, color:'#aaa' }}>None</td></tr>
          ) : data.creatives.map(c => (
            <tr
              key={c.id}
              onMouseEnter={() => setHoverCid(c.id)}
              onMouseLeave={() => { setHoverCid(null); setConfirmCid(null); }}
            >
              <td style={{ ...td, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span className="clickable" onClick={() => open({ kind:'creative', id:c.id })}>{c.name}</span>
                {hoverCid === c.id && (
                  <button
                    className={`btn ${confirmCid === c.id ? 'confirm-remove' : ''}`}
                    onClick={() => {
                      if (confirmCid === c.id) { unlinkCreative(c.id); setConfirmCid(null); }
                      else setConfirmCid(c.id);
                    }}
                  >
                    {confirmCid === c.id ? 'Confirm Remove' : 'Remove'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>


      {/* ───────── Linked Projects ───────── */}
      <table style={{ borderCollapse:'collapse', minWidth:'40ch', width:'fit-content', marginTop:32 }}>
        <thead>
          <tr>
            <th style={th}>
              Linked Project Title{data.projects.length !== 1 ? 's' : ''}
              <button
                className="btn"
                style={{ float:'right', fontSize:'0.8rem', padding:'4px 8px' }}
                onClick={() => setAddingPr(a => !a)}
              >
                {addingPr ? 'Cancel' : 'Add Project'}
              </button>
            </th>
          </tr>

          {addingPr && (
            <>
              {/* search box */}
              <tr>
                <td style={{ padding:8 }}>
                  <input
                    type="search"
                    placeholder="Search projects…"
                    value={searchPr}
                    onChange={e => setSearchPr(e.target.value)}
                    style={{ width:'100%' }}
                  />
                </td>
              </tr>

              {/* results box */}
              <tr>
                <td>
                  <div style={menuBox}>
                    {allProjects.length === 0 ? (
                      <div style={{ color:'#999' }}>No matches</div>
                    ) : (
                      allProjects.map(p => (
                        <div
                          key={`pick-${p.id}`}
                          className="clickable"
                          style={pickStyle}
                          onClick={() => { linkProject(p.id); setAddingPr(false); }}
                        >
                          {p.title}
                        </div>
                      ))
                    )}
                  </div>
                </td>
              </tr>
            </>
          )}
        </thead>

        <tbody>
          {data.projects.length === 0 ? (
            <tr><td style={{ ...td, color:'#aaa' }}>None</td></tr>
          ) : data.projects.map(p => (
            <tr
              key={p.id}
              onMouseEnter={() => setHoverPid(p.id)}
              onMouseLeave={() => { setHoverPid(null); setConfirmPid(null); }}
            >
              <td style={{ ...td, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span className="clickable" onClick={() => open({ kind:'project', id:p.id })}>{p.title}</span>
                {hoverPid === p.id && (
                  <button
                    className={`btn ${confirmPid === p.id ? 'confirm-remove' : ''}`}
                    onClick={() => {
                      if (confirmPid === p.id) { unlinkProject(p.id); setConfirmPid(null); }
                      else setConfirmPid(p.id);
                    }}
                  >
                    {confirmPid === p.id ? 'Confirm Remove' : 'Remove'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>



      {/* ───────── Writing Sample Details ───────── */}
      <h4 style={{ marginTop:32 }}>Writing Sample Details</h4>
      <table style={{ borderCollapse:'collapse', width:'100%' }}>
        <tbody>
          {EditableRow('File Description', 'file_description')}
          {EditableRow('Summary',          'synopsis')}
          {EditableRow('File Name',        'filename')}
          {EditableRow('File Type',        'file_type')}
          {EditableRow('File Size',        'size_bytes', ()=> `${(data.size_bytes/1024).toFixed(1)} KB`)}
          {EditableRow('Uploaded By',      'uploaded_by', () => data.uploaded_by_name ?? '–')}
          {EditableRow('Upload Date',      'uploaded_at', ()=> new Date(data.uploaded_at).toLocaleDateString())}
        </tbody>
      </table>
    </>
  );
}
