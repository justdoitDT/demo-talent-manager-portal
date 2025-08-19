// frontend/src/pane/panes/ProjectPaneCompaniesTab.tsx

import React, { CSSProperties, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { usePane } from '../PaneContext';

/* ─────────── Types ─────────── */
type CompanyType = 'tv_network' | 'studio' | 'production_company';

type CompanyMini = { id: string; name: string };

type ProjectCompanies = {
  networks: CompanyMini[];
  studios:  CompanyMini[];
  prodcos:  CompanyMini[];
};

type ExecutiveRead = {
  id: string;
  name: string;
  tv_networks: CompanyMini[];
  studios: CompanyMini[];
  production_companies: CompanyMini[];
};

type SortKey = 'name' | 'executives' | 'company_type';

type Row = {
  company_id:      string;
  company_name:    string;
  company_type:    CompanyType;
  executive_ids:   string[];
  executive_names: string[];
};

/* ─────────── UI helpers ─────────── */
const th: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: 8,
  verticalAlign: 'bottom',
};
const td: CSSProperties = { ...th };
const NA = <span style={{ color: '#999' }}>—</span>;
const typeLabel = (t: CompanyType) =>
  t === 'tv_network' ? 'TV Network' :
  t === 'studio' ? 'Studio' : 'Production Company';

const safe = (s?: string | null) => s ?? '';
const joinNames = (arr: string[]) => (arr.length ? arr.join(', ') : 'None');

/* Debounce hook */
function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const id = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(id); }, [value, delay]);
  return debounced;
}

/* ─────────── Component ─────────── */
export default function ProjectPaneCompaniesTab({ projectId }: { projectId: string }) {
  const { open } = usePane();

  // table state
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  // filters/sorts (local to pane)
  const [typeFilter, setTypeFilter] = useState<'' | CompanyType>('');
  const [companySearch, setCompanySearch] = useState('');
  const [executiveSearch, setExecutiveSearch] = useState('');
  const [companyExact, setCompanyExact] = useState('');
  const [executiveExact, setExecutiveExact] = useState('');
  const debCompanyQ = useDebouncedValue(companySearch, 300);
  const debExecQ    = useDebouncedValue(executiveSearch, 300);

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [asc, setAsc] = useState(true);
  const clickSort = (k: SortKey) => {
    setAsc(prev => (k === sortKey ? !prev : true));
    setSortKey(k);
  };

  // Add-company controls
  type AddKind = '' | 'tv_network' | 'studio' | 'production_company';
  const [addKind, setAddKind] = useState<AddKind>('');
  const [addQuery, setAddQuery] = useState('');
  const debAddQ = useDebouncedValue(addQuery, 300);
  const [addOptions, setAddOptions] = useState<CompanyMini[]>([]);
  const [addCompanyId, setAddCompanyId] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [rmBusyId, setRmBusyId] = useState<string | null>(null);

  // fetch companies + executives, then aggregate execs per company
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const [cResp, eResp] = await Promise.all([
          api.get<ProjectCompanies>(`/projects/${projectId}/companies`),
          api.get<ExecutiveRead[]>(`/projects/${projectId}/executives`),
        ]);
        if (!mounted) return;

        const companies: Row[] = [
          ...(cResp.data.networks || []).map(c => ({ company_id: c.id, company_name: c.name, company_type: 'tv_network' as const, executive_ids: [], executive_names: [] })),
          ...(cResp.data.studios  || []).map(c => ({ company_id: c.id, company_name: c.name, company_type: 'studio'     as const, executive_ids: [], executive_names: [] })),
          ...(cResp.data.prodcos  || []).map(c => ({ company_id: c.id, company_name: c.name, company_type: 'production_company' as const, executive_ids: [], executive_names: [] })),
        ];

        if (companies.length === 0) { setRows([]); return; }

        // build map company_id -> execs (from project execs’ company memberships)
        const byCompany: Record<string, { ids: string[]; names: string[] }> = {};
        const push = (cid: string, eid: string, ename: string) => {
          if (!byCompany[cid]) byCompany[cid] = { ids: [], names: [] };
          if (!byCompany[cid].ids.includes(eid)) {
            byCompany[cid].ids.push(eid);
            byCompany[cid].names.push(ename);
          }
        };

        eResp.data.forEach(ex => {
          [...(ex.tv_networks || []), ...(ex.studios || []), ...(ex.production_companies || [])].forEach(co => {
            push(co.id, ex.id, ex.name);
          });
        });

        const mapped = companies.map(r => ({
          ...r,
          executive_ids:   byCompany[r.company_id]?.ids   || [],
          executive_names: byCompany[r.company_id]?.names || [],
        }));

        setRows(mapped);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [projectId, refreshKey]);

  // dropdown options
  const companyOptions = useMemo(() => {
    const s = debCompanyQ.trim().toLowerCase();
    const set = new Set<string>();
    rows.forEach(r => { if (!s || r.company_name.toLowerCase().includes(s)) set.add(r.company_name); });
    return Array.from(set).sort((a,b)=>a.localeCompare(b));
  }, [rows, debCompanyQ]);

  const executiveOptions = useMemo(() => {
    const s = debExecQ.trim().toLowerCase();
    const set = new Set<string>();
    rows.forEach(r => {
      r.executive_names.forEach(n => {
        if (!s || n.toLowerCase().includes(s)) set.add(n);
      });
    });
    return Array.from(set).sort((a,b)=>a.localeCompare(b));
  }, [rows, debExecQ]);

  // filtering
  const filtered = useMemo(() => {
    let out = rows;
    if (typeFilter) out = out.filter(r => r.company_type === typeFilter);
    if (companyExact) out = out.filter(r => r.company_name === companyExact);
    if (executiveExact) out = out.filter(r => r.executive_names.includes(executiveExact));

    if (debCompanyQ.trim()) {
      const q = debCompanyQ.trim().toLowerCase();
      out = out.filter(r => r.company_name.toLowerCase().includes(q));
    }
    if (debExecQ.trim()) {
      const q = debExecQ.trim().toLowerCase();
      out = out.filter(r => r.executive_names.some(n => n.toLowerCase().includes(q)));
    }
    return out;
  }, [rows, typeFilter, companyExact, executiveExact, debCompanyQ, debExecQ]);

  // sorting
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a,b) => {
      let vA = '', vB = '';
      if (sortKey === 'name') {
        vA = safe(a.company_name); vB = safe(b.company_name);
      } else if (sortKey === 'executives') {
        vA = joinNames(a.executive_names); vB = joinNames(b.executive_names);
      } else {
        vA = typeLabel(a.company_type); vB = typeLabel(b.company_type);
      }
      return asc ? vA.localeCompare(vB) : vB.localeCompare(vA);
    });
    return arr;
  }, [filtered, sortKey, asc]);

  // fetch options for Add controls
  useEffect(() => {
    if (!addKind) { setAddOptions([]); return; }
    const endpoint =
      addKind === 'tv_network' ? '/companies/tv_networks' :
      addKind === 'studio'     ? '/companies/studios' :
                                 '/companies/production_companies';
    (async () => {
      const resp = await api.get<CompanyMini[]>(endpoint, { params: debAddQ ? { q: debAddQ } : {} });
      setAddOptions(resp.data);
    })();
  }, [addKind, debAddQ]);

  async function handleAddCompany() {
    if (!addCompanyId) return;
    try {
      setAddBusy(true);
      await api.post(`/projects/${projectId}/companies/${addCompanyId}`);
      setAddQuery('');
      setAddCompanyId('');
      setAddKind('');
      refresh();
    } finally {
      setAddBusy(false);
    }
  }

  async function handleRemoveCompany(companyId: string) {
    try {
      setRmBusyId(companyId);
      await api.delete(`/projects/${projectId}/companies/${companyId}`);
      refresh();
    } finally {
      setRmBusyId(null);
    }
  }

  return (
    <div style={{ padding: 16, position:'relative' }}>
      <h4 style={{ marginTop: 0 }}>Companies attached to this project</h4>
      <small style={{ display:'block', margin:'6px 0' }}>
        Showing {sorted.length} {sorted.length === 1 ? 'company' : 'companies'}
      </small>

      {/* Add company controls */}
      <div style={{ margin: '8px 0 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Add company:</strong>
        <select value={addKind} onChange={e => setAddKind(e.target.value as AddKind)}>
          <option value="">Select type…</option>
          <option value="tv_network">TV Network</option>
          <option value="studio">Studio</option>
          <option value="production_company">Production Company</option>
        </select>
        <input
          placeholder="Search companies…"
          value={addQuery}
          onChange={e => setAddQuery(e.target.value)}
          disabled={!addKind}
          style={{ minWidth: 220 }}
        />
        <select
          value={addCompanyId}
          onChange={e => setAddCompanyId(e.target.value)}
          disabled={!addKind || !addOptions.length}
        >
          <option value="">Select a company…</option>
          {addOptions.map(opt => (
            <option key={opt.id} value={opt.id}>{opt.name}</option>
          ))}
        </select>
        <button onClick={handleAddCompany} disabled={!addCompanyId || addBusy}>
          {addBusy ? 'Adding…' : 'Add'}
        </button>
      </div>

      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr>
            {/* Company name */}
            <th style={th} className="clickable" onClick={() => clickSort('name')} title="Sort by company">
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Company</span>
                <span style={{ marginLeft:4 }}>{sortKey === 'name' ? (asc ? '▲' : '▼') : ''}</span>
              </div>
              <div style={{ marginTop:4, display:'grid', gap:4 }}>
                <input
                  placeholder="Search companies…"
                  value={companySearch}
                  onChange={e => setCompanySearch(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  style={{ width:'95%' }}
                />
                <select
                  value={companyExact}
                  onChange={e => setCompanyExact(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  style={{ width:'100%' }}
                >
                  <option value="">All Companies</option>
                  {companyOptions.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </th>

            {/* Executives (comma-separated) */}
            <th style={th} className="clickable" onClick={() => clickSort('executives')} title="Sort by executives">
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Executives</span>
                <span style={{ marginLeft:4 }}>{sortKey === 'executives' ? (asc ? '▲' : '▼') : ''}</span>
              </div>
              <div style={{ marginTop:4, display:'grid', gap:4 }}>
                <input
                  placeholder="Search executives…"
                  value={executiveSearch}
                  onChange={e => setExecutiveSearch(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  style={{ width:'95%' }}
                />
                <select
                  value={executiveExact}
                  onChange={e => setExecutiveExact(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  style={{ width:'100%' }}
                >
                  <option value="">Any</option>
                  {executiveOptions.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </th>

            {/* Type */}
            <th style={th} className="clickable" onClick={() => clickSort('company_type')} title="Sort by company type">
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Company Type</span>
                <span style={{ marginLeft:4 }}>{sortKey === 'company_type' ? (asc ? '▲' : '▼') : ''}</span>
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
                </select>
              </div>
            </th>

            {/* Actions */}
            <th style={th}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {sorted.map(r => (
            <tr key={r.company_id}>
              <td
                style={td}
                className="clickable"
                onClick={() => open({ kind: 'company', id: r.company_id })}
                title="Open company"
              >
                {r.company_name || NA}
              </td>

              <td style={td}>
                {r.executive_ids.length === 0
                  ? 'None'
                  : r.executive_ids.map((eid, i) => (
                      <React.Fragment key={eid}>
                        <span
                          className="clickable"
                          onClick={() => open({ kind: 'executive', id: eid })}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open({ kind: 'executive', id: eid })}
                        >
                          {r.executive_names[i]}
                        </span>
                        {i < r.executive_ids.length - 1 ? ', ' : null}
                      </React.Fragment>
                    ))
                }
              </td>

              <td style={td}>{typeLabel(r.company_type)}</td>

              <td style={td}>
                <button
                  onClick={() => handleRemoveCompany(r.company_id)}
                  disabled={rmBusyId === r.company_id}
                  title="Detach this company from the project"
                >
                  {rmBusyId === r.company_id ? 'Removing…' : 'Remove'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {loading && (
        <div style={{
          position:'absolute', inset:0,
          background:'rgba(255,255,255,.6)',
          display:'flex', justifyContent:'center',
          alignItems:'flex-start', paddingTop:24,
          zIndex:1000,
        }}>
          <div className="spinner" role="status" aria-label="Loading"><div /></div>
        </div>
      )}
    </div>
  );
}
