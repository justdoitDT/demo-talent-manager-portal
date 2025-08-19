// frontend/src/pane/panes/ManagerPane.tsx

import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';
import { usePane } from '../PaneContext';
import { useBusy } from '../BusyContext';
// import PaneFrame, { PaneTab } from '../PaneFrame';
import PaneFrame from '../PaneFrame';
import { usePaneTab } from '../usePaneTab';

interface CreativeMini {
  id:   string;
  name: string;
}

interface Manager {
  id: string;
  name: string;
  email: string | null;
  clients: CreativeMini[];
}

export default function ManagerPane({ id }: { id: string }) {
  const { open } = usePane();
  const paneKey = `creative:${id}`;
  const [active,setActive] = usePaneTab(paneKey,'clients');

  const [mgr, setMgr] = useState<Manager | null>(null);
  const [editing, setEditing] = useState(false);
  const [email,   setEmail]   = useState('');
  const [adding,  setAdding]  = useState(false);   // show dropdown
  const [allCreatives, setAllCreatives] = useState<CreativeMini[]>([]);
  const [, setBusy] = useBusy();
  const [search, setSearch] = useState('');
  // const TABS: PaneTab[] = [
  //   { key: 'clients', label: 'Clients' },
  // ];

  // /* ───────── style ───────── */
  // const menuBox: React.CSSProperties = {
  //   maxHeight: 300,
  //   overflowY: 'auto',
  //   border: '1px solid #ddd',
  //   padding: 6,
  //   background: '#fff',
  //   boxShadow: '0 2px 6px rgba(0,0,0,.15)',
  // };
  // const pickStyle = { padding: 4 };
  
  /* which row is hovered / awaiting confirm */
  const [hoverId,   setHoverId]   = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  /* ───────── fetch manager + client list ───────── */
  const load = useCallback(() => {
    return api.get<Manager>(`/managers/${id}`).then(r => {
      setMgr(r.data);
      setEmail(r.data.email ?? '');
    });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /* ───────── edit email ───────── */
  const saveEmail = async () => {
      setBusy(true);
      try {
        await api.patch(`/managers/${id}`, { email });
        setEditing(false);
        load();
      } finally {
        setBusy(false);
      }
    };

  /* ───────── remove client ───────── */
  const removeClient = async (cid: string) => {
    setBusy(true);
    try {
      await api.delete('/client-team-assignments', {
          params: { team_id: id, creative_id: cid }
        }).catch(err => {
          console.error('remove failed', err);
          alert('Could not remove client – see console for details.');
        });
      load();
    } finally {
      setBusy(false);
    }
  };

  /* ───────── open “add client” list once ───────── */
  useEffect(() => {
    if (!adding) return;
    api.get<CreativeMini[]>('/creatives', {
        params: {
          unmanaged_by:    id,       // your own filter (optional on backend)
        }
      })
       .then(r => setAllCreatives(r.data));
  }, [adding, id]);

  const addClient = async (cid: string) => {
    setBusy(true);
    try {
      await api.post(
          '/client-team-assignments',
          /* no JSON body */ undefined,
          { params: { team_id: id, creative_id: cid } }
        )
      setAdding(false);
      load();
    } finally {
      setBusy(false);
    }
  };

  if (!mgr) return <div className="manager-pane" style={{ padding: 16 }}>Loading…</div>;

  return (
    <PaneFrame
      /* ─── header bar ───────────────────────────── */
      title={mgr?.name ?? 'Loading…'}
      tabs={[{ key: 'clients', label: 'Clients' }]}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={420}
    >
      {/* ─── editable-email row ───────────────────── */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        {editing ? (
          <>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ fontSize: '1rem', width: '70%' }}
            />
            <button
              onClick={saveEmail}
              style={{ marginLeft: 8, cursor: 'pointer' }}
            >
              ✔
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: '1rem' }}>
              {mgr.email ?? <em style={{ color: '#999' }}>No email</em>}
            </span>
            <button
              onClick={() => setEditing(true)}
              style={{
                marginLeft: 8,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                opacity: 0.6,
              }}
              title="Edit email"
            >
              ✎
            </button>
          </>
        )}
      </div>
  
      {/* ─── client count ─────────────────────────── */}
      <small style={{ display: 'block', margin: '4px 0' }}>
        {mgr.clients.length} row{mgr.clients.length === 1 ? '' : 's'}
      </small>
  
      {/* ─── clients table ────────────────────────── */}
      <table
        style={{
          borderCollapse: 'collapse',
          minWidth: '40ch',
          width: 'fit-content',
        }}
      >
        <thead>
          <tr>
            <th style={th}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Clients</span>
                <button
                  onClick={() => setAdding(a => !a)}
                  className="btn"
                  style={{ fontSize: '0.85rem' }}
                >
                  {adding ? 'Cancel' : 'Add Client'}
                </button>
              </div>
            </th>
          </tr>
  
          {adding && (
            <tr>
              <td style={{ padding: 8 }}>
                <input
                  type="text"
                  placeholder="Search…"
                  style={{ width: '100%', marginBottom: 6, padding: 4 }}
                  onChange={e => setSearch(e.target.value.toLowerCase())}
                />
                <div
                  style={{
                    maxHeight: 300,
                    overflowY: 'auto',
                    border: '1px solid #ddd',
                    padding: 6,
                    background: '#fff',
                    boxShadow: '0 2px 6px rgba(0,0,0,.15)',
                  }}
                >
                  <div
                    className="clickable"
                    style={{ padding: 4 }}
                    onClick={() => alert('TODO: open New-Creative form')}
                  >
                    ➕ Add New Client to Database
                  </div>
                  {allCreatives
                    .filter(c => c.name.toLowerCase().includes(search))
                    .map(c => (
                      <div
                        key={c.id}
                        className="clickable"
                        style={{ padding: 4 }}
                        onClick={() => addClient(c.id)}
                      >
                        {c.name}
                      </div>
                    ))}
                </div>
              </td>
            </tr>
          )}
        </thead>
  
        <tbody>
          {mgr.clients.map(c => (
            <tr
              key={c.id}
              onMouseEnter={() => setHoverId(c.id)}
              onMouseLeave={() => {
                setHoverId(null);
                setConfirmId(null);
              }}
            >
              <td style={td}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  {/* left-aligned name */}
                  <span
                    className="clickable"
                    onClick={() => open({ kind: 'creative', id: c.id })}
                  >
                    {c.name}
                  </span>
  
                  {/* right-aligned remove button */}
                  <button
                    className={`btn${
                      confirmId === c.id ? ' confirm-remove' : ''
                    }`}
                    style={{
                      visibility: hoverId === c.id ? 'visible' : 'hidden',
                    }}
                    onClick={() => {
                      if (confirmId === c.id) removeClient(c.id);
                      else setConfirmId(c.id);
                    }}
                  >
                    {confirmId === c.id ? 'Confirm Remove' : 'Remove Client'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PaneFrame>
  );  
}

// /* ───────── single row component ───────── */
// function Row({
//   creative,
//   onOpen,
//   onRemove,
// }: {
//   creative: CreativeMini;
//   onOpen: () => void;
//   onRemove: () => void;
// }) {
//   const [confirm, setConfirm] = useState(false);

//   return (
//     <tr
//       onMouseLeave={() => setConfirm(false)}
//       style={{ transition: 'background 0.2s' }}
//     >
//       <td
//         className="clickable"
//         style={td}
//         onClick={onOpen}
//       >
//         {creative.name}
//       </td>
//       <td style={td}>
//         {confirm ? (
//           <button
//             className="remove-btn confirm"
//             style={btnDanger}
//             onClick={onRemove}
//           >
//             Are you sure?
//           </button>
//         ) : (
//           <button
//             className="remove-btn"
//             style={btn}
//             onMouseEnter={() => setConfirm(false)}
//             onClick={() => setConfirm(true)}
//           >
//             Remove Client
//           </button>
//         )}
//       </td>
//     </tr>
//   );
// }

/* ────────── styles ────────── */
const th: React.CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: '8px',
};

const td: React.CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: '8px',
};

// const btn: React.CSSProperties = {
//   padding: '4px 8px',
//   background: '#fff',
//   color: '#000',
//   border: '1px solid #000',
//   cursor: 'pointer',
//   transition: 'transform 0.2s ease, box-shadow 0.2s ease',
// };

// const btnDanger: React.CSSProperties = {
//   ...btn,
//   background: '#c33',
//   color: '#000',
// };

// const dropdown: React.CSSProperties = {
//   maxHeight: 300,
//   overflowY: 'auto',
//   border: '1px solid #ddd',
//   padding: 6,
//   background: '#fff',
//   boxShadow: '0 2px 6px rgba(0,0,0,.15)',
// };

// const spinnerOverlay: React.CSSProperties = {
//   position: 'absolute',
//   inset: 0,
//   background: 'rgba(255,255,255,.4)',
//   display: 'flex',
//   alignItems: 'center',
//   justifyContent: 'center',
//   pointerEvents: 'none',
// };
