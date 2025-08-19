// frontend/src/components/ExecutivesPage.tsx

import React, {
  useEffect, useMemo, useState, CSSProperties,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { usePane } from '../pane/PaneContext';

/* ───────────── Types ───────────── */
type CompanyType = 'tv_network' | 'studio' | 'production_company';

interface ExecutiveRow {
  executive_id:   string;
  executive_name: string;
  company_ids:    string[];
  company_names:  string[];
  company_types:  CompanyType[];
}
interface PagedExecutives { total: number; items: ExecutiveRow[]; }

interface CompanyRow { id: string; name: string; }

type SortKey = 'name' | 'company' | 'company_type';

/* ───────────── Styles ───────────── */
const th: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: 8,
  verticalAlign: 'bottom',
  // cursor: 'default',
};
const td: CSSProperties = { ...th };
const NA = <span style={{ color: '#999' }}>—</span>;
const Spinner: React.FC = () => (
    <div className="spinner" role="status" aria-label="Loading">
      <div />
    </div>
  );

/* helpers */
const typeLabelFor = (types: CompanyType[]) =>
  types.length === 0 ? 'N/A'
  : types.length === 1
    ? (types[0] === 'tv_network' ? 'TV Network'
       : types[0] === 'studio' ? 'Studio'
       : 'Production Company')
    : 'Mixed';

const displayCompanyList = (names: string[]) =>
  names.length ? names.join(', ') : 'None';
const safeStr = (v: string | null | undefined) => (v ?? '');   // ← for sorting & filtering

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/* ────────────────────────────────── */
export default function ExecutivesPage() {
  const { open } = usePane();

  /* URL-backed filters */
  const [sp, setSp] = useSearchParams();

  // filters
  const typeParam     = sp.get('company_type') ?? '';   // '', 'tv_network'|'studio'|'production_company'
  const companyParam  = sp.get('company_id')   ?? '';   // 'NW_…' | 'ST_…' | 'PC_…'
  const nameParam     = sp.get('name')         ?? '';   // optional exact name filter (dropdown)
  const nameSearch    = sp.get('name_q')       ?? '';   // free-text name search
  const companySearch = sp.get('company_q')    ?? '';   // free-text company search

  // paging
  const limit  = +(sp.get('limit')  ?? 50);
  const offset = +(sp.get('offset') ?? 0);
  const page   = Math.floor(offset / limit) + 1;

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    v ? next.set(k, v) : next.delete(k);
    next.set('offset', '0');
    next.delete('page');
    setSp(next);
  };
  const goPage = (n: number) => {
    const newOffset = (n - 1) * limit;
    if (newOffset < 0) return;
    const next = new URLSearchParams(sp);
    next.set('offset', String(newOffset));
    next.set('limit', String(limit));
    setSp(next);
  };

  // sorting
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [asc, setAsc]         = useState<boolean>(true);
  const clickSort = (k: SortKey) => {
    setSortKey(prev => (prev === k ? prev : k));
    setAsc(prev => (sortKey === k ? !prev : true));
  };

  /* catalogs (for Company dropdown) */
  const [networks, setNetworks] = useState<CompanyRow[]>([]);
  const [studios,  setStudios]  = useState<CompanyRow[]>([]);
  const [prodcos,  setProdcos]  = useState<CompanyRow[]>([]);

  useEffect(() => {
    Promise.all([
      api.get('/companies/tv_networks',          { params: { q: '' } }),
      api.get('/companies/studios',              { params: { q: '' } }),
      api.get('/companies/production_companies', { params: { q: '' } }),
    ])
      .then(([n, s, p]) => {
        const pick = (r: any) => Array.isArray(r.data) ? r.data : (r.data.items ?? []);
        setNetworks(pick(n));
        setStudios(pick(s));
        setProdcos(pick(p));
      })
      .catch(() => { setNetworks([]); setStudios([]); setProdcos([]); });
  }, []);


  /* debounce for search */
  // read current URL params
  const nameQFromUrl    = sp.get('name_q')    ?? '';
  const companyQFromUrl = sp.get('company_q') ?? '';

  // local input state mirrors URL
  const [nameSearchLocal, setNameSearchLocal]         = useState(nameQFromUrl);
  const [companySearchLocal, setCompanySearchLocal]   = useState(companyQFromUrl);

  // keep local state in sync if user navigates back/forward or link changes URL
  useEffect(() => setNameSearchLocal(nameQFromUrl), [nameQFromUrl]);
  useEffect(() => setCompanySearchLocal(companyQFromUrl), [companyQFromUrl]);

  // debounce the inputs
  const debouncedNameQ    = useDebouncedValue(nameSearchLocal, 300);
  const debouncedCompanyQ = useDebouncedValue(companySearchLocal, 300);

  // push debounced values to URL only when they differ
  useEffect(() => {
    const current = sp.get('name_q') ?? '';
    if (current !== debouncedNameQ) setFilter('name_q', debouncedNameQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedNameQ]);

  useEffect(() => {
    const current = sp.get('company_q') ?? '';
    if (current !== debouncedCompanyQ) setFilter('company_q', debouncedCompanyQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedCompanyQ]);


  /* main data */
  const [paged, setPaged] = useState<PagedExecutives>({ total: 0, items: [] });
  const rows = paged.items;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, any> = {
      limit, offset,
      company_type: typeParam    || undefined,
      company_id:   companyParam || undefined,
      q:            (nameSearch || companySearch) || undefined, // server searches both fields
    };

    // ⬇️ use the new flat endpoint
    api.get('/executives/agg', { params })
      .then(r => {
        const data = r.data;
        const normalized = Array.isArray(data)
          ? { total: data.length, items: data }
          : data;
        setPaged(normalized);
      })
      .catch(() => setPaged({ total: 0, items: [] }))
      .finally(() => setLoading(false));
  }, [typeParam, companyParam, nameSearch, companySearch, limit, offset]);

  /* derived sets for dropdown options */
  const nameOptions = useMemo(() => {
    const s = nameSearch.trim().toLowerCase();
    const unique = new Set<string>();
    rows.forEach(r => {
      if (!s || r.executive_name.toLowerCase().includes(s)) {
        unique.add(r.executive_name);
      }
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows, nameSearch]);

  const companyOptions = useMemo(() => {
    const match = (name: string) => {
      const q = companySearch.trim().toLowerCase();
      return !q || name.toLowerCase().includes(q);
    };

    const useNetworks = !typeParam || typeParam === 'tv_network';
    const useStudios  = !typeParam || typeParam === 'studio';
    const useProdcos  = !typeParam || typeParam === 'production_company';

    const mapRows = (list: CompanyRow[]) =>
      list.filter(r => match(r.name)).map(r => ({ id: r.id, label: r.name }));

    return {
      networks: useNetworks ? mapRows(networks) : [],
      studios:  useStudios  ? mapRows(studios)  : [],
      prodcos:  useProdcos  ? mapRows(prodcos)  : [],
    };
  }, [networks, studios, prodcos, typeParam, companySearch]);

  /* client-side filtering (extra safety & for name dropdown) */
  const filtered = useMemo(() => {
    let out = rows;
  
    if (typeParam) {
      out = out.filter(r => r.company_types.includes(typeParam as CompanyType));
    }
    if (companyParam) {
      out = out.filter(r => r.company_ids.includes(companyParam));
    }
    if (nameParam) {
      out = out.filter(r => r.executive_name === nameParam);
    }
    if (nameSearch.trim()) {
      const q = nameSearch.trim().toLowerCase();
      out = out.filter(r => r.executive_name.toLowerCase().includes(q));
    }
    if (companySearch.trim()) {
      const q = companySearch.trim().toLowerCase();
      out = out.filter(r => r.company_names.some(n => n.toLowerCase().includes(q)));
    }
  
    return out;
  }, [rows, typeParam, companyParam, nameParam, nameSearch, companySearch]);

  /* sorting (guard all values) */
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let vA = '';
      let vB = '';
      if (sortKey === 'name') {
        vA = safeStr(a.executive_name);
        vB = safeStr(b.executive_name);
      } else if (sortKey === 'company') {
        vA = displayCompanyList(a.company_names);
        vB = displayCompanyList(b.company_names);
      } else {
        vA = typeLabelFor(a.company_types);
        vB = typeLabelFor(b.company_types);
      }
      return asc ? vA.localeCompare(vB) : vB.localeCompare(vA);
    });
    return arr;
  }, [filtered, sortKey, asc]);

  const maxPage = Math.max(1, Math.ceil(paged.total / limit));

  /* render */
  return (
    <div>
      <h1>Executives</h1>
      <small style={{ display: 'block', margin: '4px 0' }}>
        Showing {offset + 1}–{offset + sorted.length} of {paged.total}
      </small>

      <div style={{ position:'relative' /* for spinner overlay */ }}>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {/* Name — sortable + search + dropdown */}
              <th
                style={th}
                className="clickable"
                onClick={() => clickSort('name')}
                title="Sort by name"
              >
                <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                  <span>Name</span>
                  {sortKey === 'name' ? (
                    <span style={{ marginLeft:4 }}>{asc ? '▲' : '▼'}</span>
                  ) : (
                    <img src="/sortable.png" alt="sortable" style={{ marginLeft:4, width:12, height:12 }} />
                  )}
                </div>

                <div style={{ marginTop:4, display:'grid', gap:4 }}>
                  <input
                    placeholder="Search names…"
                    value={nameSearchLocal}
                    onChange={e => setNameSearchLocal(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    style={{ width:'95%' }}
                  />
                  <select
                    value={nameParam}
                    onChange={e => setFilter('name', e.target.value)}
                    onClick={e => e.stopPropagation()}
                    style={{ width:'100%' }}
                  >
                    <option value="">All Names</option>
                    {nameOptions.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </th>

              {/* Company — sortable + search + grouped dropdown */}
              <th
                style={th}
                className="clickable"
                onClick={() => clickSort('company')}
                title="Sort by company"
              >
                <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                  <span>Company</span>
                  {sortKey === 'company' ? (
                    <span style={{ marginLeft:4 }}>{asc ? '▲' : '▼'}</span>
                  ) : (
                    <img src="/sortable.png" alt="sortable" style={{ marginLeft:4, width:12, height:12 }} />
                  )}
                </div>

                <div style={{ marginTop:4, display:'grid', gap:4 }}>
                  <input
                    placeholder="Search companies…"
                    value={companySearchLocal}
                    onChange={e => setCompanySearchLocal(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    style={{ width:'95%' }}
                  />
                  <select
                    value={companyParam}
                    onChange={e => setFilter('company_id', e.target.value)}
                    onClick={e => e.stopPropagation()}
                    style={{ width:'100%' }}
                  >
                    <option value="">Any</option>

                    {companyOptions.networks.length > 0 && (
                      <optgroup label="TV Networks">
                        {companyOptions.networks.map(opt => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </optgroup>
                    )}

                    {companyOptions.studios.length > 0 && (
                      <optgroup label="Studios">
                        {companyOptions.studios.map(opt => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </optgroup>
                    )}

                    {companyOptions.prodcos.length > 0 && (
                      <optgroup label="Production Companies">
                        {companyOptions.prodcos.map(opt => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </th>

              {/* Company Type — sortable + filter */}
              <th
                style={th}
                className="clickable"
                onClick={() => clickSort('company_type')}
                title="Sort by company type"
              >
                <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                  <span>Company Type</span>
                  {sortKey === 'company_type' ? (
                    <span style={{ marginLeft:4 }}>{asc ? '▲' : '▼'}</span>
                  ) : (
                    <img src="/sortable.png" alt="sortable" style={{ marginLeft:4, width:12, height:12 }} />
                  )}
                </div>

                <div style={{ marginTop:4 }}>
                  <select
                    value={typeParam}
                    onChange={e => setFilter('company_type', e.target.value)}
                    onClick={e => e.stopPropagation()}
                  >
                    <option value="">All</option>
                    <option value="tv_network">TV Network</option>
                    <option value="studio">Studio</option>
                    <option value="production_company">Production Company</option>
                  </select>
                </div>
              </th>
            </tr>
          </thead>

          <tbody>
            {sorted.map(r => (
              // BEFORE key used exec+company; AFTER just exec
              <tr key={r.executive_id}>
                <td
                  style={td}
                  className="clickable"
                  onClick={() => open({ kind: 'executive', id: r.executive_id })}
                  title="Open executive"
                >
                  {r.executive_name || NA}
                </td>

                <td style={td} title={r.company_ids.length ? 'Open company' : 'No active company'}>
                  {r.company_ids.length === 0
                    ? 'None'
                    : r.company_ids.map((id, i) => (
                        <React.Fragment key={id}>
                          <span
                            className="clickable"
                            onClick={() => open({ kind: 'company', id })}
                            // optional: accessible hint
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open({ kind: 'company', id })}
                          >
                            {r.company_names[i]}
                          </span>
                          {i < r.company_ids.length - 1 ? ', ' : null}
                        </React.Fragment>
                      ))
                  }
                </td>

                <td style={td}>{typeLabelFor(r.company_types)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* spinner overlay (below header row) */}
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

        {/* pagination */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" disabled={page === 1} onClick={() => goPage(page - 1)}>Prev</button>
          <span>Page {page} / {maxPage}</span>
          <button className="btn" disabled={page >= maxPage} onClick={() => goPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
