// frontend/src/components/CompanyPage.tsx

import React, { CSSProperties, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { usePane } from '../pane/PaneContext';
import AddCompanyToDatabaseModal from '../modals/AddCompanyToDatabaseModal';

/* ───────── Types ───────── */
type CompanyType = 'tv_network' | 'studio' | 'production_company' | 'external_agency';
type CompanyMini = { id: string; name: string };
type Row = { id: string; name: string; type: CompanyType };
type SortKey = 'company' | 'type';

/* ───────── Styles ───────── */
const th: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: 8,
  verticalAlign: 'bottom',
};
const td: CSSProperties = { ...th };
const NA = <span style={{ color: '#999' }}>—</span>;

/* helpers */
const typeLabel = (t: CompanyType) =>
  t === 'tv_network' ? 'TV Network' :
  t === 'studio' ? 'Studio' :
  t === 'production_company' ? 'Production Company' :
  'External Agency';

const safe = (s?: string | null) => s ?? '';

const Spinner: React.FC = () => (
  <div className="spinner" role="status" aria-label="Loading">
    <div />
  </div>
);

export default function CompanyPage() {
  const { open } = usePane();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<CompanyType | ''>('');
  const [sortKey, setSortKey] = useState<SortKey>('company');
  const [asc, setAsc] = useState(true);

  // pagination (fixed to 25/page as requested)
  const PAGE_SIZE = 25;
  const [offset, setOffset] = useState(0);
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  const [showAdd, setShowAdd] = useState(false);

  const clickSort = (k: SortKey) => {
    setSortKey(prev => (prev === k ? prev : k));
    setAsc(prev => (sortKey === k ? !prev : true));
    setOffset(0); // reset to first page on sort change
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      api.get<CompanyMini[]>('/companies/tv_networks',          { params: { q: '' } }),
      api.get<CompanyMini[]>('/companies/studios',              { params: { q: '' } }),
      api.get<CompanyMini[]>('/companies/production_companies', { params: { q: '' } }),
      api.get<CompanyMini[]>('/companies/external_agencies',    { params: { q: '' } }),
    ])
      .then(([nw, st, pc, ag]) => {
        if (!mounted) return;
        const pick = (r: any) => Array.isArray(r.data) ? r.data : (r.data.items ?? []);
        const flat: Row[] = [
          ...pick(nw).map((r: CompanyMini) => ({ id: r.id, name: r.name, type: 'tv_network' as const })),
          ...pick(st).map((r: CompanyMini) => ({ id: r.id, name: r.name, type: 'studio' as const })),
          ...pick(pc).map((r: CompanyMini) => ({ id: r.id, name: r.name, type: 'production_company' as const })),
          ...pick(ag).map((r: CompanyMini) => ({ id: r.id, name: r.name, type: 'external_agency' as const })),
        ];
        // stable sort by name initially
        flat.sort((a,b) => a.name.localeCompare(b.name));
        setRows(flat);
      })
      .catch(() => setRows([]))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  // reset to first page when filters/search change
  useEffect(() => { setOffset(0); }, [q, typeFilter]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return rows.filter(r => {
      if (typeFilter && r.type !== typeFilter) return false;
      if (qLower && !r.name.toLowerCase().includes(qLower)) return false;
      return true;
    });
  }, [rows, q, typeFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a,b) => {
      let vA = '', vB = '';
      if (sortKey === 'company') {
        vA = safe(a.name); vB = safe(b.name);
      } else {
        vA = typeLabel(a.type); vB = typeLabel(b.type);
      }
      return asc ? vA.localeCompare(vB) : vB.localeCompare(vA);
    });
    return arr;
  }, [filtered, sortKey, asc]);

  const maxPage = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = useMemo(() => sorted.slice(offset, offset + PAGE_SIZE), [sorted, offset]);

  const gotoPrev = () => setOffset(prev => Math.max(0, prev - PAGE_SIZE));
  const gotoNext = () => setOffset(prev => Math.min((maxPage - 1) * PAGE_SIZE, prev + PAGE_SIZE));

  const showingFrom = sorted.length === 0 ? 0 : offset + 1;
  const showingTo = Math.min(sorted.length, offset + PAGE_SIZE);

  return (
    <div style={{ padding: 16, position:'relative' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 14 }}>
        <button className="tab" onClick={() => setShowAdd(true)}>Add Company to Database</button>
      </div>
      <small style={{ display:'block', margin:'4px 0' }}>
        Showing {showingFrom}-{showingTo} of {sorted.length} {sorted.length === 1 ? 'company' : 'companies'}
      </small>

      <div style={{ position:'relative' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              {/* Company (sortable + search) */}
              <th
                style={th}
                className="clickable"
                onClick={() => clickSort('company')}
                title="Sort by company"
              >
                <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                  <span>Company</span>
                  <span style={{ marginLeft:4 }}>{sortKey === 'company' ? (asc ? '▲' : '▼') : ''}</span>
                </div>
                <div style={{ marginTop:4 }}>
                  <input
                    placeholder="Search companies…"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    style={{ width:'95%' }}
                  />
                </div>
              </th>

              {/* Type (sortable + filter) */}
              <th
                style={th}
                className="clickable"
                onClick={() => clickSort('type')}
                title="Sort by type"
              >
                <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                  <span>Type</span>
                  <span style={{ marginLeft:4 }}>{sortKey === 'type' ? (asc ? '▲' : '▼') : ''}</span>
                </div>
                <div style={{ marginTop:4 }}>
                  <select
                    value={typeFilter}
                    onChange={e => setTypeFilter(e.target.value as CompanyType | '')}
                    onClick={e => e.stopPropagation()}
                  >
                    <option value="">All</option>
                    <option value="tv_network">TV Network</option>
                    <option value="studio">Studio</option>
                    <option value="production_company">Production Company</option>
                    <option value="external_agency">External Agency</option>
                  </select>
                </div>
              </th>
            </tr>
          </thead>

          <tbody>
            {paged.map(r => (
              <tr key={r.id}>
                <td
                  style={td}
                  className="clickable"
                  onClick={() => open({ kind: 'company', id: r.id })}
                  title="Open company"
                >
                  {r.name || NA}
                </td>
                <td style={td}>{typeLabel(r.type)}</td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={2} style={{ padding:16, textAlign:'center', color:'#666' }}>
                  No companies found.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {loading && (
          <div style={{
            position:'absolute', inset:0,
            background:'rgba(255,255,255,.6)',
            display:'flex', justifyContent:'center',
            alignItems:'flex-start', paddingTop:48,
            zIndex:1000,
          }}>
            <Spinner/>
          </div>
        )}
      </div>

      {/* Pager */}
      <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:12 }}>
        <button className="btn" disabled={page <= 1} onClick={gotoPrev}>Prev</button>
        <span>Page {page} / {maxPage}</span>
        <button className="btn" disabled={page >= maxPage} onClick={gotoNext}>Next</button>
      </div>

      {/* Modal */}
      <AddCompanyToDatabaseModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
      />
    </div>
  );
}
