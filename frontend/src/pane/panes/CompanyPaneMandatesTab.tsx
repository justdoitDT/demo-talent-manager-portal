// frontend/src/pane/panes/CompanyPaneMandatesTab.tsx
import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import CreateMandateModal from '../../modals/CreateMandateModal';

type CompanyType = 'tv_network' | 'studio' | 'production_company' | 'creative';

interface Mandate {
  id: string;
  company_type: CompanyType | null;
  company_id: string;
  name: string;
  description?: string | null;
  status: 'active' | 'archived' | string;
  updated_at: string; // ISO
}

interface PagedMandates {
  total: number;
  items: Mandate[];
}

interface Props {
  companyId: string;
  companyType: CompanyType;
  companyName: string;
  onOpen: (p: { kind: 'mandate'; id: string }) => void;
}

const TYPE_LABEL: Record<CompanyType, string> = {
  tv_network: 'TV Network',
  studio: 'Studio',
  production_company: 'Production Company',
  creative: 'Creative',
};

export default function CompanyPaneMandatesTab({
  companyId,
  companyType,
  companyName,
  onOpen,
}: Props) {
  const [paged, setPaged] = useState<PagedMandates>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get<PagedMandates>('/mandates', {
        params: { company_id: companyId, status: 'active', limit: 100, offset: 0 },
      });
      const data = Array.isArray(r.data) ? { total: r.data.length, items: r.data } : r.data;
      setPaged(data);
    } catch (e) {
      console.error(e);
      setErr('Failed to load mandates.');
      setPaged({ total: 0, items: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [showCreate, setShowCreate] = useState(false);

  return (
    <div style={{ padding: 8 }}>
      {/* Top toolbar */}
      <div style={{ margin: '0 0 12px' }}>
        <button className="tab" onClick={() => setShowCreate(true)}>Add mandate</button>
      </div>

      {err && <div style={{ marginBottom: 12, color: '#b00' }}>{err}</div>}

      <div style={{ marginBottom: 6, color: '#666' }}>
        {loading ? 'Loading…' : `Showing ${paged.items.length} of ${paged.total} mandates`}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', border: '1px solid #ddd', padding: 8 }}>Mandator Type</th>
            <th style={{ textAlign: 'left', border: '1px solid #ddd', padding: 8 }}>Mandator</th>
            <th style={{ textAlign: 'left', border: '1px solid #ddd', padding: 8 }}>Mandate Name</th>
            <th style={{ textAlign: 'left', border: '1px solid #ddd', padding: 8 }}>Description</th>
            <th style={{ textAlign: 'left', border: '1px solid #ddd', padding: 8 }}>Status</th>
            <th style={{ textAlign: 'left', border: '1px solid #ddd', padding: 8 }}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {paged.items.map((m) => (
            <tr key={m.id}>
              <td style={{ border: '1px solid #ddd', padding: 8 }}>
                {TYPE_LABEL[m.company_type ?? companyType] ?? '—'}
              </td>
              <td style={{ border: '1px solid #ddd', padding: 8 }}>
                {companyName || <span style={{ color: '#999' }}>—</span>}
              </td>
              <td
                className="clickable"
                style={{ border: '1px solid #ddd', padding: 8, cursor: 'pointer' }}
                title="Open mandate"
                onClick={() => onOpen({ kind: 'mandate', id: m.id })}
              >
                {m.name}
              </td>
              <td style={{ border: '1px solid #ddd', padding: 8, whiteSpace: 'pre-line' }}>
                {m.description ?? <span style={{ color: '#999' }}>—</span>}
              </td>
              <td style={{ border: '1px solid #ddd', padding: 8 }}>
                {m.status ?? <span style={{ color: '#999' }}>—</span>}
              </td>
              <td style={{ border: '1px solid #ddd', padding: 8 }}>
                {m.updated_at ? new Date(m.updated_at).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
          {!loading && paged.items.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 12, textAlign: 'center', color: '#666' }}>
                No mandates yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pre-populated create modal */}
      <CreateMandateModal
        isOpen={showCreate}
        onClose={() => { setShowCreate(false); load(); }}
        initialMandatorType={companyType}
        initialMandatorId={companyId}
        initialMandatorName={companyName}
      />
    </div>
  );
}
