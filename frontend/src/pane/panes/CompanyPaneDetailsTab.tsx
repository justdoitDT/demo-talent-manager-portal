// frontend/src/pane/panes/CompanyPaneDetailsTab.tsx

import React, { CSSProperties, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { PanePayload } from '../PaneContext';

const td: CSSProperties = { padding: 8, border: '1px solid #ddd', verticalAlign: 'top' };
const th: CSSProperties = { ...td, fontWeight: 700, background: '#fafafa' };
const NA = <span style={{ color: '#999' }}>—</span>;

type CompanyMini = { id: string; name: string };

type CompanyType = 'tv_network' | 'studio' | 'production_company' | 'external_agency' | 'unknown';
const inferType = (id: string): CompanyType => {
  if (id.startsWith('NW_')) return 'tv_network';
  if (id.startsWith('ST_')) return 'studio';
  if (id.startsWith('PC_')) return 'production_company';
  if (id.startsWith('AG_')) return 'external_agency';
  return 'unknown';
};

export default function CompanyPaneDetailsTab({
  companyId,
  onOpen,
}: {
  companyId: string;
  onOpen: (payload: PanePayload) => void;
}) {
  const [row, setRow] = useState<CompanyMini | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const type = useMemo(() => inferType(companyId), [companyId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data } = await api.get<CompanyMini>(`/companies/${companyId}`);
        if (mounted) {
          setRow(data);
          setDraftName(data?.name ?? '');
        }
      } catch (e) {
        if (mounted) setErr('Failed to load company.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [companyId]);

  const startEdit = () => {
    setDraftName(row?.name ?? '');
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    if (!row) return;
    const name = draftName.trim();
    if (!name || name === row.name) {
      setEditing(false);
      return;
    }
    try {
      setSaving(true);
      const { data } = await api.patch<CompanyMini>(`/companies/${companyId}`, { name });
      setRow(data);
      setEditing(false);
    } catch {
      window.alert('Failed to save name.');
    } finally {
      setSaving(false);
    }
  };

  const deleteCompany = async () => {
    if (!row) return;
    const ok = window.confirm(`Delete “${row.name}”? This cannot be undone.`);
    if (!ok) return;
    try {
      setDeleting(true);
      await api.delete(`/companies/${companyId}`);
      setDeleted(true);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Delete failed (this company may be referenced by other records).';
      window.alert(msg);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="spinner"><div /></div>;
  if (err)     return <div style={{ padding: 12, color: '#b00' }}>{err}</div>;

  if (deleted) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ padding: 12, border: '1px solid #ddd', background: '#fafafa' }}>
          Company deleted.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <style>{`
        .hover-wrap .row-action { visibility: hidden; }
        .hover-wrap:hover .row-action { visibility: visible; }
      `}</style>

      <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
        <tbody>
          <tr>
            <td style={th}>Name</td>
            <td style={td}>
              <div className="hover-wrap" style={{ display:'flex', alignItems:'center', gap:8 }}>
                {!editing ? (
                  <>
                    <div style={{ flex:1 }}>{row?.name ?? NA}</div>
                    <button
                      className="btn row-action"
                      onClick={startEdit}
                      title="Edit name"
                    >
                      Edit
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      style={{ flex:1 }}
                      value={draftName}
                      onChange={e => setDraftName(e.target.value)}
                      placeholder="Company name"
                      disabled={saving}
                    />
                    <button className="btn" onClick={saveEdit} disabled={saving}>
                      Save
                    </button>
                    <button className="btn" onClick={cancelEdit} disabled={saving} style={{ marginLeft: 6 }}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </td>
          </tr>

          <tr>
            <td style={th}>Type</td>
            <td style={td}>
              {type === 'tv_network' ? 'TV Network'
               : type === 'studio' ? 'Studio'
               : type === 'production_company' ? 'Production Company'
               : type === 'external_agency' ? 'External Agency'
               : '—'}
            </td>
          </tr>
        </tbody>
      </table>

      {/* actions */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          className="btn confirm-remove"
          onClick={deleteCompany}
          disabled={deleting}
          title="Remove this company from the database"
        >
          {deleting ? 'Deleting…' : 'Delete Company'}
        </button>
      </div>
    </div>
  );
}
