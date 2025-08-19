// frontend/src/pane/panes/MandatePaneDetailsTab.tsx

import React, { useState } from 'react';
import api from '../../services/api';
import { MandateDetail, MandateUpdate } from '../../types/mandates';

/* ───────────── helpers ───────────── */
const NONE = <em style={{ color: '#999' }}>—</em>;

const cellLabel: React.CSSProperties = { fontWeight: 600, padding: 6, whiteSpace: 'nowrap' };
const cell: React.CSSProperties      = { border: '1px solid #ddd', padding: 6 };

/* ───────────── component ───────────── */
export default function MandatePaneDetailsTab({
  mandate,
  mandatorName,
  mandatorTypeLabel,
  onRefresh,
}: {
  mandate: MandateDetail & { company_type?: 'tv_network' | 'studio' | 'production_company' | 'creative' | string };
  mandatorName: string | null;
  mandatorTypeLabel: string; // already mapped (e.g. "Creative")
  onRefresh: () => void;
}) {
  /* row-level state */
  const [editingKey, setEditingKey] = useState<null | 'name' | 'description' | 'status'>(null);
  const [tempValue,  setTempValue ] = useState<string>('');
  const [hoverKey,   setHoverKey  ] = useState<string | null>(null);

  /* PATCH helper */
  const patchMandate = (payload: MandateUpdate) =>
    api.patch(`/mandates/${mandate.id}`, payload).then(onRefresh);

  /* render */
  return (
    <div style={{ padding: 8 }}>
      {/* Optional: AI button row */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
        <button className="aiButton">AI: Recommend Sub</button>
      </div>

      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 700 }}>
        <tbody>
          {/* Mandator Type */}
          <tr>
            <td style={cellLabel}>Mandator Type</td>
            <td style={cell}>{mandatorTypeLabel || NONE}</td>
          </tr>

          {/* Mandator (name) */}
          <tr>
            <td style={cellLabel}>Mandator</td>
            <td style={cell}>{mandatorName || NONE}</td>
          </tr>

          {/* Name (editable) */}
          <tr
            onMouseEnter={() => setHoverKey('name')}
            onMouseLeave={() => setHoverKey(null)}
          >
            <td style={cellLabel}>Name</td>
            <td style={cell}>
              {editingKey === 'name' ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    autoFocus
                    type="text"
                    value={tempValue}
                    onChange={e => setTempValue(e.target.value)}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    className="btn"
                    onClick={() => {
                      const payload: MandateUpdate = { name: tempValue.trim() || null };
                      patchMandate(payload);
                      setEditingKey(null);
                    }}
                  >
                    Save
                  </button>
                  <button className="btn" onClick={() => setEditingKey(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{mandate.name || NONE}</span>
                  <button
                    className="btn"
                    style={{ visibility: hoverKey === 'name' ? 'visible' : 'hidden' }}
                    onClick={() => { setTempValue(mandate.name ?? ''); setEditingKey('name'); }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </td>
          </tr>

          {/* Description (editable) */}
          <tr
            onMouseEnter={() => setHoverKey('description')}
            onMouseLeave={() => setHoverKey(null)}
          >
            <td style={cellLabel}>Description</td>
            <td style={cell}>
              {editingKey === 'description' ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <textarea
                    autoFocus
                    rows={4}
                    value={tempValue}
                    onChange={e => setTempValue(e.target.value)}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button
                      className="btn"
                      onClick={() => {
                        const payload: MandateUpdate = { description: tempValue.trim() || null };
                        patchMandate(payload);
                        setEditingKey(null);
                      }}
                    >
                      Save
                    </button>
                    <button className="btn" onClick={() => setEditingKey(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ whiteSpace: 'pre-line' }}>
                    {mandate.description ?? NONE}
                  </span>
                  <button
                    className="btn"
                    style={{ visibility: hoverKey === 'description' ? 'visible' : 'hidden', marginLeft: 8 }}
                    onClick={() => { setTempValue(mandate.description ?? ''); setEditingKey('description'); }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </td>
          </tr>

          {/* Status (editable) */}
          <tr
            onMouseEnter={() => setHoverKey('status')}
            onMouseLeave={() => setHoverKey(null)}
          >
            <td style={cellLabel}>Status</td>
            <td style={cell}>
              {editingKey === 'status' ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    autoFocus
                    value={tempValue}
                    onChange={e => setTempValue(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="active">active</option>
                    <option value="archived">archived</option>
                  </select>
                  <button
                    className="btn"
                    onClick={() => {
                      const payload: MandateUpdate = { status: tempValue as 'active' | 'archived' };
                      patchMandate(payload);
                      setEditingKey(null);
                    }}
                  >
                    Save
                  </button>
                  <button className="btn" onClick={() => setEditingKey(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{mandate.status ?? 'active'}</span>
                  <button
                    className="btn"
                    style={{ visibility: hoverKey === 'status' ? 'visible' : 'hidden' }}
                    onClick={() => { setTempValue(mandate.status ?? 'active'); setEditingKey('status'); }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </td>
          </tr>

          {/* Timestamps */}
          <tr>
            <td style={cellLabel}>Created At</td>
            <td style={cell}>
              {mandate.created_at ? new Date(mandate.created_at).toLocaleString() : NONE}
            </td>
          </tr>
          <tr>
            <td style={cellLabel}>Updated At</td>
            <td style={cell}>
              {mandate.updated_at ? new Date(mandate.updated_at).toLocaleString() : NONE}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
