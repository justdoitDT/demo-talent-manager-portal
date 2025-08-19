// frontend/src/pane/panes/CreativePaneManagementTab.tsx
import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';
import { useBusy } from '../BusyContext';

interface ManagerMini { id: string; name: string }
interface Creative {
  id: string;
  availability:        'available' | 'unavailable' | null;
  unavailable_until:   string | null;      // ISO date
  tv_acceptable:       boolean | null;
  is_writer:           boolean | null;
  is_director:         boolean | null;
  writer_level:        number | null;
  has_directed_feature:boolean | null;
  industry_notes:      string | null;
  managers:            ManagerMini[];
}

/* ────────────────────────────────────────────────────────────────── */
const LIGHT_GREY = '#999';

const WRITER_LEVELS: { value:number; label:string }[] = [
  { value:0   , label:`Writer’s Assistant` },
  { value:0.5 , label:`Writer's Asst / Staff Writer` },
  { value:1   , label:`Staff Writer` },
  { value:1.5 , label:`Staff Writer / Story Editor` },
  { value:2   , label:`Story Editor` },
  { value:2.5 , label:`Story Editor / Exec Story Editor` },
  { value:3   , label:`Exec Story Editor` },
  { value:3.5 , label:`Exec Story Editor / Co-Producer` },
  { value:4   , label:`Co-Producer` },
  { value:4.5 , label:`Co-Producer / Producer` },
  { value:5   , label:`Producer` },
  { value:5.5 , label:`Producer / Supervising Producer` },
  { value:6   , label:`Supervising Producer` },
  { value:6.5 , label:`Supervising Producer / Co-EP` },
  { value:7   , label:`Co-EP` },
  { value:7.5 , label:`Co-EP / EP` },
  { value:8   , label:`EP` },
  { value:8.5 , label:`EP / Showrunner` },
  { value:9   , label:`Showrunner` },
];

/* ────────────────────────────────────────────────────────────────── */
export default function ManagementTab({
  creativeId,
  onOpen,
}: {
  creativeId: string;
  onOpen: (p: { kind: 'manager'; id: string }) => void;
}) {
  const [data,  setData]       = useState<Creative | null>(null);
  const [notes, setNotes]      = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [, setBusy]            = useBusy();
  const [hoverId,   setHoverId]   = useState<string|null>(null);
  const [confirmId, setConfirmId] = useState<string|null>(null);
  const [addingMgr,   setAddingMgr]   = useState(false);      // “Add Manager” dropdown
  const [allManagers, setAllManagers] = useState<ManagerMini[]>([]);
  const isoDate = (s: string | null) => (s ? s.slice(0, 10) : '');

  /* fetch --------------------------------------------------------- */
  const load = useCallback(() => {
    return api.get<Creative>(`/creatives/${creativeId}`).then(r => {
      setData(r.data);
      setNotes(r.data.industry_notes ?? '');
    });
  }, [creativeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!addingMgr) return;
    api.get<ManagerMini[]>('/managers', {
      params:{ role:'manager', unassigned_to: creativeId }
    }).then(r => setAllManagers(r.data));
  }, [addingMgr, creativeId]);

  /* helpers ------------------------------------------------------- */
  const patch = async (payload: Partial<Creative>) => {
    setBusy(true);
    try   { await api.patch(`/creatives/${creativeId}`, payload); }
    finally { setBusy(false); load(); }
  };

  /* save notes inline -------------------------------------------- */
  const saveNotes = () => patch({ industry_notes: notes }).then(()=>setEditingNotes(false));

  if (!data) return <>Loading…</>;

  /* ─────────────────────────────────────────────────────────────── */
  return (
    <div style={{ position:'relative' }}>

      {/* ───────── Availability ──────────────────────────────── */}
      <h4 style={{ margin:'20px 0 8px' }}>Availability</h4>

      <div style={{ display:'flex', alignItems:'center', gap:24 }}>
        <div style={{ width:140 }}>Currently&nbsp;Available</div>

        <div>
          <label className="switch">
            <input
              type="checkbox"
              checked={data.availability !== 'unavailable'}
              onChange={e =>
                patch({
                  availability:      e.target.checked ? 'available' : 'unavailable',
                  unavailable_until: e.target.checked ? null        : data.unavailable_until
                })
              }
            />
            <span className="slider" />
          </label>

          {/* Show only active label */}
          <div className="switch-labels">
            <span style={{ visibility: data.availability==='unavailable' ? 'visible':'hidden' }}>No</span>
            <span style={{ visibility: data.availability!=='unavailable'? 'visible':'hidden' }}>Yes</span>
          </div>
        </div>
      </div>

      {/* date picker */}
      {data.availability === 'unavailable' && (
        <div style={{ marginTop:0 }}>
          <label style={{ marginRight:8 }}>Unavailable Until&nbsp;(approx.)</label>
          <input
            type="date"
            value={isoDate(data.unavailable_until)}
            onChange={e => patch({ unavailable_until: e.target.value || null })}
            style={{ padding:4 }}
          />
        </div>
      )}

      {/* ───────────── Medium ───────────────────────────────────── */}
      <h4 style={{ marginTop: 48 }}>Media Type</h4>
      <select
        value={data.tv_acceptable ? 'tv' : 'features'}
        onChange={e => patch({ tv_acceptable: e.target.value==='tv' })}
      >
        <option value="tv">TV / Features</option>
        <option value="features">Features Only</option>
      </select>

      {/* ───────────── Role & levels ────────────────────────────── */}
      <h4 style={{ marginTop:48 }}>Role</h4>
      <select
        value={
          data.is_writer && data.is_director ? 'writer_dir'
          : data.is_writer ? 'writer'
          : data.is_director ? 'director'
          : ''
        }
        onChange={e => {
          const v = e.target.value;
          patch({
            is_writer   : v==='writer' || v==='writer_dir',
            is_director : v==='director'|| v==='writer_dir'
          });
        }}
      >
        <option value="writer">Writer</option>
        <option value="director">Director</option>
        <option value="writer_dir">Writer & Director</option>
      </select>

      {/* writer level */}
      {data.is_writer && data.tv_acceptable && (
        <div style={{ marginTop:8 }}>
          <label style={{ marginRight:8 }}>Writer Level (TV):</label>
          <select
            value={data.writer_level ?? ''}
            onChange={e => patch({ writer_level: Number(e.target.value) })}
          >
            {WRITER_LEVELS.map(o=>(
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* director level */}
      {data.is_director && (
        <div style={{ marginTop:8 }}>
          <label style={{ marginRight:8 }}>Director Level:</label>
          <select
            value={data.has_directed_feature==null?'':
                   data.has_directed_feature?'yes':'no'}
            onChange={e => patch({
              has_directed_feature:
                e.target.value==='' ? null : e.target.value==='yes'
            })}
          >
            <option value="yes">Directed Feature</option>
            <option value="no">Not Directed Feature</option>
          </select>
        </div>
      )}

      {/* ───────────── Strengths / Tags ─────────────────────────── */}
      <h4 style={{ marginTop:48 }}>Strengths / Industry Tags</h4>
      {editingNotes ? (
        <>
          <textarea
            value={notes}
            rows={4}
            style={{ width:'100%' }}
            onChange={e => setNotes(e.target.value)}
          />
          <button className="btn" onClick={saveNotes}>Save</button>
          <button className="btn" onClick={()=>setEditingNotes(false)}>Cancel</button>
        </>
      ) : (
        <div style={{ whiteSpace:'pre-wrap', marginBottom:0 }}>
          {data.industry_notes
            ? data.industry_notes
            : <em style={{ color:LIGHT_GREY }}>None</em>}
          <button
            className="btn"
            style={{ marginLeft: 8 }}
            onClick={() => { setNotes(data.industry_notes ?? ''); setEditingNotes(true); }}
          >
            Edit
          </button>
        </div>
      )}

      {/* ───────── Manager table ─────────────────────────────── */}
      <table style={{ borderCollapse: 'collapse', minWidth: '40ch', width: 'fit-content', marginTop: 48 }}>
        <thead>
          <tr>
            <th style={th}>
              {`Manager${data.managers.length > 1 ? 's' : ''}`}
              <button
                className="btn"
                style={{ float:'right', fontSize:'0.8rem', padding:'4px 8px' }}
                onClick={() => setAddingMgr(a => !a)}
              >
                {addingMgr ? 'Close' : 'Add Manager'}
              </button>
            </th>
          </tr>

          {addingMgr && (
            <tr>
              <td style={{ padding:8 }}>
                <select
                  style={{ width:'100%' }}
                  onChange={e => {
                    const mid = e.target.value;
                    if (!mid) return;
                    setBusy(true);
                    api.post('/client-team-assignments', undefined,
                      { params:{ team_id: mid, creative_id: creativeId } })
                      .then(()=>{ setAddingMgr(false); load(); })
                      .finally(()=> setBusy(false));
                  }}
                >
                  <option value="">— select manager to add —</option>
                  {allManagers.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </td>
            </tr>
          )}
        </thead>

        <tbody>
          {data.managers.length === 0
            ? (
              <tr>
                <td style={{ ...td, color: LIGHT_GREY }}>
                  None
                </td>
              </tr>
            )
            : data.managers.map(m => (
              <tr
                key={m.id}
                onMouseEnter={() => setHoverId(m.id)}
                onMouseLeave={() => { setHoverId(null); setConfirmId(null); }}
              >
                <td
                  style={{
                    ...td,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span
                    className="clickable"
                    onClick={() => onOpen({ kind:'manager', id:m.id })}
                  >
                    {m.name}
                  </span>
                  {hoverId === m.id && (
                    <button
                      className={`btn ${confirmId === m.id ? 'confirm-remove' : ''}`}
                      onClick={() => {
                        if (confirmId === m.id) {
                          setBusy(true);
                          api.delete(
                            '/client-team-assignments',
                            { params:{ team_id: m.id, creative_id: creativeId } }
                          )
                          .then(load)
                          .finally(() => {
                            setBusy(false);
                            setConfirmId(null);
                          });
                        } else {
                          setConfirmId(m.id);
                        }
                      }}
                    >
                      {confirmId === m.id ? 'Confirm Remove' : 'Remove'}
                    </button>
                  )}
                </td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  );
}

// /* busy-overlay */
// const overlayCSS: React.CSSProperties = {
//   position:'absolute',
//   inset:0,
//   background:'rgba(255,255,255,.4)',
//   display:'flex',
//   alignItems:'center',
//   justifyContent:'center'
// };
const th: React.CSSProperties = { textAlign:'left', padding:8, border:'1px solid #ddd' };
const td: React.CSSProperties = { textAlign:'left', padding:8, border:'1px solid #ddd' };
