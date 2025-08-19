// frontend/src/pane/panes/CompanyPaneExecutivesTab.tsx

import React, { CSSProperties, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { PanePayload } from '../PaneContext';

type Status = 'Active' | 'Archived';

interface Exec {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;       // per-link title from link tables
  status: Status;              // per-link status
}

interface Props {
  companyId: string;
  onOpen: (payload: PanePayload) => void;
}

const th: CSSProperties        = { padding: 8, border: '1px solid #ddd', textAlign: 'left', verticalAlign: 'bottom' };
const td: CSSProperties        = { padding: 8, border: '1px solid #ddd', verticalAlign: 'top' };
const narrowEnd: CSSProperties = { ...th, width: '1%', whiteSpace: 'nowrap' };
const NA = <span style={{ color: '#999' }}>—</span>;

function useDebounced<T>(value: T, delay = 300) {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return deb;
}

export default function CompanyPaneExecutivesTab({ companyId, onOpen }: Props) {
  const [rows, setRows] = useState<Exec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // header filters (name + status only; email/phone are NOT filterable)
  const [nameQ, setNameQ] = useState('');
  const debNameQ = useDebounced(nameQ, 250);
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');

  // per-row edit state
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<Status>('Active');
  const [draftEmail, setDraftEmail]   = useState<string>('');
  const [draftPhone, setDraftPhone]   = useState<string>('');
  const [draftTitle, setDraftTitle]   = useState<string>('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // New endpoint: includes Active + Archived and per-link title
        type LinkRow = {
          executive_id: string;
          executive_name: string;
          email?: string | null;
          phone?: string | null;
          status: Status;
          title?: string | null;
        };
        const { data } = await api.get<LinkRow[]>(`/companies/${companyId}/links`);
        const list: Exec[] = (data || []).map(r => ({
          id: r.executive_id,
          name: r.executive_name,
          email: r.email ?? null,
          phone: r.phone ?? null,
          title: r.title ?? null,
          status: r.status,
        }));
        if (mounted) setRows(list);
      } catch {
        if (mounted) setError('Failed to load executives.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [companyId]);

  const startEdit = (r: Exec) => {
    setEditingId(r.id);
    setDraftStatus(r.status);
    setDraftEmail(r.email ?? '');
    setDraftPhone(r.phone ?? '');
    setDraftTitle(r.title ?? '');
  };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (r: Exec) => {
    try {
      const ops: Promise<unknown>[] = [];

      // Exec core fields (email/phone)
      const nextEmail = draftEmail.trim();
      const nextPhone = draftPhone.trim();
      if (nextEmail !== (r.email ?? '') || nextPhone !== (r.phone ?? '')) {
        ops.push(api.patch(`/executives/${r.id}`, {
          email: nextEmail || null,
          phone: nextPhone || null,
        }));
      }

      // Link fields (status + title) — patch both together if needed
      const nextTitle = draftTitle.trim();
      const linkPatch: Record<string, any> = {};
      if (draftStatus !== r.status) linkPatch.status = draftStatus;
      if (nextTitle !== (r.title ?? '')) linkPatch.title = nextTitle || null;

      if (Object.keys(linkPatch).length > 0) {
        ops.push(api.patch(`/executives/${r.id}/companies/${companyId}`, linkPatch));
      }

      if (ops.length) await Promise.all(ops);

      // Optimistic local update
      setRows(prev => prev.map(x =>
        x.id === r.id
          ? {
              ...x,
              email: nextEmail || null,
              phone: nextPhone || null,
              status: draftStatus,
              title: nextTitle || null,
            }
          : x
      ));
    } catch {
      window.alert('Update failed. Please try again.');
    } finally {
      cancelEdit();
    }
  };

  // filter (name + status)
  const filtered = useMemo(() => {
    const q = debNameQ.toLowerCase();
    return rows.filter(r => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, debNameQ, statusFilter]);

  // sort: Active first, then Archived; alpha by name within each bucket
  const sorted = useMemo(() => {
    const prio = (s: Status) => (s === 'Active' ? 0 : 1);
    const arr = [...filtered];
    arr.sort((a, b) => {
      const p = prio(a.status) - prio(b.status);
      if (p !== 0) return p;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }, [filtered]);

  if (loading) return <div className="spinner"><div /></div>;
  if (error)   return <div style={{ padding: 12, color: '#b00' }}>{error}</div>;

  return (
    <div style={{ padding: 16 }}>
      <style>{`
        .row:hover .row-action { visibility: visible; }
        .row-action { visibility: hidden; }
        .clickable { cursor: pointer; }
      `}</style>

      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr>
            <th style={th}>
              Executive
              <div style={{ marginTop: 4 }}>
                <input
                  placeholder="Search executives…"
                  value={nameQ}
                  onChange={e => setNameQ(e.target.value)}
                  style={{ width: '95%' }}
                />
              </div>
            </th>
            <th style={th}>
              Title
              <div style={{ marginTop: 4 }}>&nbsp;</div>
            </th>
            <th style={th}>
              Email
              <div style={{ marginTop: 4 }}>&nbsp;</div>
            </th>
            <th style={th}>
              Phone
              <div style={{ marginTop: 4 }}>&nbsp;</div>
            </th>
            <th style={th}>
              Status
              <div style={{ marginTop: 4 }}>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as '' | Status)}
                >
                  <option value="">All</option>
                  <option value="Active">Active</option>
                  <option value="Archived">Archived</option>
                </select>
              </div>
            </th>
            <th style={narrowEnd} />
          </tr>
        </thead>

        <tbody>
          {sorted.map(r => {
            const isEd = editingId === r.id;
            return (
              <tr key={r.id} className="row">
                {/* Executive (opens ExecutivePane) */}
                <td style={td}>
                  <span
                    className="clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen({ kind: 'executive', id: r.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen({ kind: 'executive', id: r.id });
                      }
                    }}
                    title="Open Executive"
                  >
                    {r.name || NA}
                  </span>
                </td>

                {/* Title (editable) */}
                <td style={td}>
                  {isEd ? (
                    <input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      style={{ width:'100%' }}
                      placeholder="e.g., EVP, Drama"
                    />
                  ) : (
                    r.title || NA
                  )}
                </td>

                {/* Email (editable) */}
                <td style={td}>
                  {isEd ? (
                    <input
                      value={draftEmail}
                      onChange={(e) => setDraftEmail(e.target.value)}
                      style={{ width:'100%' }}
                      placeholder="email@example.com"
                    />
                  ) : r.email ? (
                    <a href={`mailto:${r.email}`} style={{ color: 'inherit' }}>{r.email}</a>
                  ) : NA}
                </td>

                {/* Phone (editable) */}
                <td style={td}>
                  {isEd ? (
                    <input
                      value={draftPhone}
                      onChange={(e) => setDraftPhone(e.target.value)}
                      style={{ width:'100%' }}
                      placeholder="(###) ###-####"
                    />
                  ) : r.phone ? (
                    <a href={`tel:${r.phone}`} style={{ color: 'inherit' }}>{r.phone}</a>
                  ) : NA}
                </td>

                {/* Status (editable) */}
                <td style={td}>
                  {isEd ? (
                    <select
                      value={draftStatus}
                      onChange={e => setDraftStatus(e.target.value as Status)}
                    >
                      <option value="Active">Active</option>
                      <option value="Archived">Archived</option>
                    </select>
                  ) : (
                    r.status
                  )}
                </td>

                {/* Edit / Save / Cancel */}
                <td style={{ ...td, width:'1%', whiteSpace:'nowrap' }}>
                  {!isEd ? (
                    <button className="btn row-action" onClick={() => startEdit(r)}>Edit</button>
                  ) : (
                    <>
                      <button className="btn" onClick={() => saveEdit(r)}>Save</button>
                      <button className="btn" style={{ marginLeft: 6 }} onClick={cancelEdit}>Cancel</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}

          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 16, textAlign:'center', color:'#666' }}>
                No executives found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
