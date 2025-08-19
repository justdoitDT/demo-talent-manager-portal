// frontend/src/pane/panes/CreativePanePersonalProjectsTab.tsx

import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';
import { useBusy } from '../BusyContext';
import CreateProjectModal from '../../modals/CreateProjectModal';

interface ProjectMini {
  id: string;
  title: string;
  year:        number | null;
  media_type:  string | null;
  status:      string | null;          // ← “Production Phase”
  tracking_status: string | null;      // ← “Tracking”
}

/* ────────── Option sets ────────── */
const PRODUCTION_PHASE_OPTIONS = [
  'Idea / Concept',
  'In Development',
  'Pitch-Ready',
  'Sold',
  'Archived',
] as const;

const TRACKING_OPTIONS = [
  'Internal / Not Tracking',
  'Hot List',
  'Active',
  'Priority Tracking',
  'Tracking',
  'Development',
  'Engaged',
  'Deep Tracking',
  'Archived',
  'Completed',
] as const;

export default function PersonalProjectsTab({
  creativeId,
  onOpen,
}: {
  creativeId: string;
  onOpen: (p: { kind: 'project'; id: string }) => void;
}) {
  const [, setBusy] = useBusy();
  const [rows, setRows] = useState<ProjectMini[] | null>(null);

  // row edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [tempPhase, setTempPhase] = useState<string>('');
  const [tempTracking, setTempTracking] = useState<string>('');

  // create modal
  const [showCreate, setShowCreate] = useState(false);

  // load the list
  const load = useCallback(() => {
    return api
      .get<ProjectMini[]>(`/creatives/${creativeId}/personal-projects`)
      .then(r => setRows(r.data));
  }, [creativeId]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (p: ProjectMini) => {
    setEditId(p.id);
    setTempPhase(p.status ?? '');
    setTempTracking(p.tracking_status ?? '');
  };

  const cancelEdit = () => {
    setEditId(null);
    setTempPhase('');
    setTempTracking('');
  };

  const saveEdit = async (projectId: string) => {
    setBusy(true);
    try {
      await api.patch(`/projects/${projectId}`, {
        status: tempPhase || null,
        tracking_status: tempTracking || null,
      });
      await load();
      cancelEdit();
    } finally {
      setBusy(false);
    }
  };

  if (rows === null) return <>Loading…</>;

  return (
    <>
      {/* Top bar: Add button + row count */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 14 }}>
        <button className="tab" onClick={() => setShowCreate(true)}>
          Add Personal Project
        </button>
        <small>{rows.length} row{rows.length === 1 ? '' : 's'}</small>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
        <thead>
          <tr>
            <th style={th}>Title</th>
            <th style={th}>Year</th>
            <th style={th}>Media Type</th>
            <th style={th}>Production Phase</th>
            <th style={th}>Tracking</th>
            <th style={th}>&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const isEditing = editId === p.id;

            // If the DB has a value not in our option list, include it as the first option so it renders
            const phaseOptions = [
              ...(p.status && !PRODUCTION_PHASE_OPTIONS.includes(p.status as any) ? [p.status] : []),
              ...PRODUCTION_PHASE_OPTIONS,
            ];
            const trackingOptions = [
              ...(p.tracking_status && !TRACKING_OPTIONS.includes(p.tracking_status as any) ? [p.tracking_status] : []),
              ...TRACKING_OPTIONS,
            ];

            return (
              <tr key={p.id}>
                <td
                  style={td}
                  className="clickable"
                  onClick={() => onOpen({ kind: 'project', id: p.id })}
                  title="Open project"
                >
                  {p.title}
                </td>
                <td style={td}>{p.year ?? '—'}</td>
                <td style={td}>{p.media_type ?? '—'}</td>

                {/* Production Phase */}
                <td style={td}>
                  {isEditing ? (
                    <select value={tempPhase} onChange={e => setTempPhase(e.target.value)}>
                      <option value="">—</option>
                      {phaseOptions.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    p.status ?? '—'
                  )}
                </td>

                {/* Tracking */}
                <td style={td}>
                  {isEditing ? (
                    <select value={tempTracking} onChange={e => setTempTracking(e.target.value)}>
                      <option value="">—</option>
                      {trackingOptions.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    p.tracking_status ?? '—'
                  )}
                </td>

                {/* Actions */}
                <td style={td}>
                  {isEditing ? (
                    <>
                      <button className="btn" onClick={() => saveEdit(p.id)}>Save</button>
                      <button className="btn" style={{ marginLeft: 6 }} onClick={cancelEdit}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn" onClick={() => startEdit(p)}>Edit</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Modal: prefill with this creative + force personal=Yes */}
      <CreateProjectModal
        isOpen={showCreate}
        onClose={() => { setShowCreate(false); load(); }}
        initialCreativeId={creativeId}
        initialIsPersonal="yes"
      />
    </>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: 6,
  border: '1px solid #ddd',
};
const td: React.CSSProperties = { ...th };
