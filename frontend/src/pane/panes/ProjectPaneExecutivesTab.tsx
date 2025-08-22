// frontend/src/pane/panes/ProjectPaneExecutivesTab.tsx

import React, { useEffect, useMemo, useRef, useState, CSSProperties } from 'react';
import api from '../../services/api';
import { usePane, PanePayload } from '../PaneContext';

/* ─────────── Types ─────────── */
type CompanyType = 'tv_network' | 'studio' | 'production_company';

interface CompanyMini { id: string; name: string; status?: 'Active' | 'Archived' | string }
interface ExecutiveRead {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  tv_networks: CompanyMini[];
  studios: CompanyMini[];
  production_companies: CompanyMini[];
}

/* Aggregated row for the grid */
interface ExecutiveRow {
  executive_id:   string;
  executive_name: string;
  company_ids:    string[];
  company_names:  string[];
  company_types:  CompanyType[];
}

type SortKey = 'name' | 'company' | 'company_type';

/* For typeahead search (from /executives/flat) */
type ExecListItem = {
  executive_id: string;
  executive_name: string;
  company_id?: string | null;
  company_name?: string | null;
  company_type?: CompanyType | null;
};

/* ───────────── Styles ───────────── */
const th: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: 8,
  verticalAlign: 'bottom',
};
const td: CSSProperties = { ...th };
const NA = <span style={{ color: '#999' }}>—</span>;
const Spinner: React.FC = () => (
  <div className="spinner" role="status" aria-label="Loading"><div /></div>
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

const safeStr = (v?: string | null) => v ?? '';

function byAlpha<T>(get: (x: T) => string) {
  return (a: T, b: T) => get(a).localeCompare(get(b));
}

const singleTypeLabel = (t: CompanyType) =>
  t === 'tv_network' ? 'TV Network' :
  t === 'studio' ? 'Studio' : 'Production Company';

const companyTypeFromId = (id: string): CompanyType | null =>
  id.startsWith('NW_') ? 'tv_network'
  : id.startsWith('ST_') ? 'studio'
  : id.startsWith('PC_') ? 'production_company'
  : null;

/* ───────────── Reusable SearchSelect (combobox) ───────────── */
type Option = { value: string; label: string; group?: string | null };
type SearchSelectProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options: Option[];         // provide in desired order; groups rendered in order encountered
  query: string;
  onQueryChange: (q: string) => void;
  emptyText?: string;
  width?: number;
};

const SearchSelect: React.FC<SearchSelectProps> = ({
  value,
  onChange,
  placeholder = 'Select…',
  options,
  query,
  onQueryChange,
  emptyText = 'No results',
  width = 300,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Filter options client-side too (in addition to any server filtering you do)
  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(opt => !q || opt.label.toLowerCase().includes(q));
  }, [options, query]);

  // Groups in encounter order
  const groups = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    visibleOptions.forEach(o => {
      const g = o.group ?? '';
      if (!seen.has(g)) { seen.add(g); order.push(g); }
    });
    return order;
  }, [visibleOptions]);

  // Key handling
  const focusNext = (dir: 1 | -1) => {
    if (!visibleOptions.length) return;
    setActiveIndex(prev => {
      const next = prev === -1 ? (dir === 1 ? 0 : visibleOptions.length - 1)
                               : (prev + dir + visibleOptions.length) % visibleOptions.length;
      scrollIntoView(next);
      return next;
    });
  };
  const scrollIntoView = (idx: number) => {
    const listEl = listRef.current;
    if (!listEl) return;
    const optEl = listEl.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    if (optEl) {
      const { top, bottom } = optEl.getBoundingClientRect();
      const { top: lTop, bottom: lBot } = listEl.getBoundingClientRect();
      if (top < lTop) listEl.scrollTop -= (lTop - top);
      if (bottom > lBot) listEl.scrollTop += (bottom - lBot);
    }
  };

  const currentLabel = useMemo(() => {
    const m = options.find(o => o.value === value);
    return m?.label ?? '';
  }, [options, value]);

  return (
    <div ref={rootRef} style={{ position: 'relative', width }}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open) setTimeout(() => setActiveIndex(-1), 0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); focusNext(1); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); setOpen(true); focusNext(-1); }
          if (e.key === 'Enter' && open && activeIndex >= 0) {
            e.preventDefault();
            const chosen = visibleOptions[activeIndex];
            if (chosen) { onChange(chosen.value); setOpen(false); }
          }
        }}
        style={{
          width: '100%',
          textAlign: 'left',
          border: '1px solid #ccc',
          padding: '6px 10px',
          borderRadius: 4,
          background: '#fff',
          cursor: 'pointer',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ opacity: value ? 1 : 0.6 }}>
          {value ? currentLabel : placeholder}
        </span>
        <span style={{ float: 'right', opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-activedescendant={activeIndex >= 0 ? `opt-${activeIndex}` : undefined}
          tabIndex={0}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 1000,
            border: '1px solid #ccc',
            borderRadius: 6,
            background: '#fff',
            boxShadow: '0 8px 24px rgba(0,0,0,.12)',
            padding: 6,
          }}
        >
          {/* Inline search field inside dropdown */}
          <input
            autoFocus
            placeholder="Type to search…"
            value={query}
            onChange={e => { onQueryChange(e.target.value); setActiveIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); focusNext(1); }
              if (e.key === 'ArrowUp')   { e.preventDefault(); focusNext(-1); }
              if (e.key === 'Enter') {
                if (activeIndex >= 0) {
                  const chosen = visibleOptions[activeIndex];
                  if (chosen) { onChange(chosen.value); setOpen(false); }
                }
              }
              if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
            }}
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '1px solid #ddd',
              borderRadius: 4,
              marginBottom: 6,
            }}
          />

          <div
            ref={listRef}
            style={{
              maxHeight: 280,
              overflowY: 'auto',
              padding: '2px 0',
            }}
          >
            {/* Render groups in order; group==='' → unlabeled (attached section) */}
            {visibleOptions.length === 0 && (
              <div style={{ padding: '8px 10px', color: '#666' }}>{emptyText}</div>
            )}
            {groups.map((g, gi) => {
              const groupOpts = visibleOptions.filter(o => (o.group ?? '') === g);
              if (!groupOpts.length) return null;
              return (
                <div key={`g-${gi}`}>
                  {g && (
                    <div style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#666',
                      padding: '6px 8px 4px',
                      textTransform: 'uppercase',
                      letterSpacing: .3,
                    }}>
                      {g}
                    </div>
                  )}
                  {groupOpts.map((o, idxWithin) => {
                    // Map to global option index among visibleOptions for keyboard highlight
                    const globalIdx = visibleOptions.indexOf(o);
                    const active = globalIdx === activeIndex;
                    return (
                      <div
                        id={`opt-${globalIdx}`}
                        key={o.value}
                        role="option"
                        aria-selected={active}
                        data-idx={globalIdx}
                        onMouseEnter={() => setActiveIndex(globalIdx)}
                        onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); }}
                        style={{
                          padding: '6px 10px',
                          background: active ? '#f2f6ff' : 'transparent',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                        title={o.label}
                      >
                        {o.label}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────── */
export default function ProjectPaneExecutivesTab({
  projectId,
  onOpen,
}: { projectId: string; onOpen: (payload: PanePayload) => void }) {

  const { open } = usePane();

  /* filters (local state; no URL sync inside a pane) */
  const [typeFilter, setTypeFilter] = useState<'' | CompanyType>('');
  const [companyFilter, setCompanyFilter] = useState<string>('');
  const [nameFilterExact, setNameFilterExact] = useState<string>('');
  const [nameSearch, setNameSearch] = useState('');
  const [companySearch, setCompanySearch] = useState('');

  /* sorting */
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [asc, setAsc] = useState(true);
  const clickSort = (k: SortKey) => {
    setAsc(prev => (k === sortKey ? !prev : true));
    setSortKey(k);
  };

  /* data */
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExecutiveRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  /* For "Add executive" controls */
  const [addBusy, setAddBusy] = useState(false);
  const [rmBusyId, setRmBusyId] = useState<string | null>(null);

  // Company + exec state for combined dropdowns
  const [projectCompanies, setProjectCompanies] = useState<CompanyMini[]>([]);

  // Executive picker
  const [addExecutiveId, setAddExecutiveId] = useState<string>('');
  const [execQuery, setExecQuery] = useState('');
  const [execOptions, setExecOptions] = useState<ExecListItem[]>([]);

  // Company picker (optional filter for exec search)
  const [companyChoice, setCompanyChoice] = useState<string>(''); // '' = Any
  const [companyQuery, setCompanyQuery] = useState('');
  const [companyOptions, setCompanyOptions] = useState<CompanyMini[]>([]);

  // Load grid + project-attached companies
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const [execResp, projCoResp] = await Promise.all([
          api.get<ExecutiveRead[]>(`/projects/${projectId}/executives`),
          api.get<{ networks: CompanyMini[]; studios: CompanyMini[]; prodcos: CompanyMini[] }>(`/projects/${projectId}/companies`)
        ]);
        if (!mounted) return;

        const mapped: ExecutiveRow[] = execResp.data.map(e => {
          const ids: string[]   = [];
          const names: string[] = [];
          const typesSet = new Set<CompanyType>();
          const isActive = (c: CompanyMini) => !c.status || c.status === 'Active';

          const tv  = (e.tv_networks || []).filter(isActive);
          const st  = (e.studios || []).filter(isActive);
          const pc  = (e.production_companies || []).filter(isActive);

          tv.forEach(c => { ids.push(c.id); names.push(c.name); });
          st.forEach(c => { ids.push(c.id); names.push(c.name); });
          pc.forEach(c => { ids.push(c.id); names.push(c.name); });

          if (tv.length) typesSet.add('tv_network');
          if (st.length) typesSet.add('studio');
          if (pc.length) typesSet.add('production_company');

          // de-dup companies by id while keeping order
          const seen = new Set<string>();
          const dedupIds: string[] = [];
          const dedupNames: string[] = [];
          ids.forEach((id, i) => {
            if (!seen.has(id)) { seen.add(id); dedupIds.push(id); dedupNames.push(names[i]); }
          });

          return {
            executive_id: e.id,
            executive_name: e.name,
            company_ids: dedupIds,
            company_names: dedupNames,
            company_types: Array.from(typesSet),
          };
        });

        setRows(mapped);

        // Only keep companies attached to this project that are Active
        const isActive = (c: CompanyMini) => !c.status || c.status === 'Active';
        const pc = [
          ...(projCoResp.data.networks || []).filter(isActive),
          ...(projCoResp.data.studios  || []).filter(isActive),
          ...(projCoResp.data.prodcos  || []).filter(isActive),
        ].sort((a,b)=>a.name.localeCompare(b.name));
        setProjectCompanies(pc);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [projectId, refreshKey]);

  /* Build options for the company SearchSelect
     - Unlabeled top section: already-attached companies, with type in parentheses
     - Then grouped sections: TV Networks / Studios / Production Companies (excluding attached)
     - Remote search via ?q=companyQuery
  */
  useEffect(() => {
    (async () => {
      const params = companyQuery ? { q: companyQuery } : {};
      const [nw, st, pc] = await Promise.all([
        api.get<CompanyMini[]>('/companies/tv_networks', { params }),
        api.get<CompanyMini[]>('/companies/studios', { params }),
        api.get<CompanyMini[]>('/companies/production_companies', { params }),
      ]);
      const all = [...nw.data, ...st.data, ...pc.data].sort(byAlpha(c => c.name));
      // Attacheds first (not duplicated below)
      const attachedIds = new Set(projectCompanies.map(c => c.id));
      const top = projectCompanies
        .slice()
        .sort(byAlpha(c => c.name)); // keep alphabetic among attached
      const rest = all.filter(c => !attachedIds.has(c.id));
      setCompanyOptions([...top, ...rest]);
    })();
  }, [companyQuery, projectCompanies]);

  /* Exec typeahead options (filtered by companyChoice server-side) */
  useEffect(() => {
    (async () => {
      const params: any = {
        q: execQuery || undefined,
        company_id: companyChoice || undefined,
        limit: 50,
      };
      const { data } = await api.get<{ total: number; items: ExecListItem[] }>('/executives/flat', { params });
      // Deduplicate by executive_id and sort by name
      const map = new Map<string, ExecListItem>();
      (data.items || []).forEach(item => {
        if (!map.has(item.executive_id)) map.set(item.executive_id, item);
      });
      setExecOptions(Array.from(map.values()).sort(byAlpha(x => x.executive_name || '')));
    })();
  }, [execQuery, companyChoice]);

  /* filtering for grid */
  const filtered = useMemo(() => {
    let out = rows;
    if (typeFilter)    out = out.filter(r => r.company_types.includes(typeFilter));
    if (companyFilter) out = out.filter(r => r.company_ids.includes(companyFilter));
    if (nameFilterExact) out = out.filter(r => r.executive_name === nameFilterExact);

    const nq = nameSearch.trim().toLowerCase();
    if (nq) out = out.filter(r => r.executive_name.toLowerCase().includes(nq));
    const cq = companySearch.trim().toLowerCase();
    if (cq) out = out.filter(r => r.company_names.some(n => n.toLowerCase().includes(cq)));

    return out;
  }, [rows, typeFilter, companyFilter, nameFilterExact, nameSearch, companySearch]);

  /* sorting */
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a,b) => {
      let vA = '', vB = '';
      if (sortKey === 'name') {
        vA = safeStr(a.executive_name); vB = safeStr(b.executive_name);
      } else if (sortKey === 'company') {
        vA = displayCompanyList(a.company_names); vB = displayCompanyList(b.company_names);
      } else {
        vA = typeLabelFor(a.company_types); vB = typeLabelFor(b.company_types);
      }
      return asc ? vA.localeCompare(vB) : vB.localeCompare(vA);
    });
    return arr;
  }, [filtered, sortKey, asc]);

  /* Actions */
  async function handleAddExecutive() {
    if (!addExecutiveId) return;
    try {
      setAddBusy(true);
      await api.post(`/projects/${projectId}/executives/${addExecutiveId}`);
      setExecQuery('');
      setAddExecutiveId('');
      refresh();
    } finally {
      setAddBusy(false);
    }
  }

  async function handleRemoveExecutive(executiveId: string) {
    try {
      setRmBusyId(executiveId);
      await api.delete(`/projects/${projectId}/executives/${executiveId}`);
      refresh();
    } finally {
      setRmBusyId(null);
    }
  }

  /* Map to SearchSelect option shapes */

  const companySearchOptions: Option[] = useMemo(() => {
    const attachedIds = new Set(projectCompanies.map(c => c.id));
    const top: Option[] = projectCompanies
      .slice()
      .sort(byAlpha(c => c.name))
      .map(c => {
        const t = companyTypeFromId(c.id);
        const label = t ? `${c.name} (${singleTypeLabel(t)})` : c.name;
        return { value: c.id, label, group: '' }; // unlabeled section
      });

    const nets: Option[] = companyOptions
      .filter(c => c.id.startsWith('NW_') && !attachedIds.has(c.id))
      .map(c => ({ value: c.id, label: c.name, group: 'TV Networks' }));

    const studs: Option[] = companyOptions
      .filter(c => c.id.startsWith('ST_') && !attachedIds.has(c.id))
      .map(c => ({ value: c.id, label: c.name, group: 'Studios' }));

    const prods: Option[] = companyOptions
      .filter(c => c.id.startsWith('PC_') && !attachedIds.has(c.id))
      .map(c => ({ value: c.id, label: c.name, group: 'Production Companies' }));

    return [
      { value: '', label: 'Any company', group: '' },
      ...top,
      ...nets, ...studs, ...prods,
    ];
  }, [companyOptions, projectCompanies]);

  const execSearchOptions: Option[] = useMemo(() => {
    return execOptions.map(e => ({
      value: e.executive_id,
      label: e.company_name ? `${e.executive_name} — ${e.company_name}` : e.executive_name,
      group: undefined,
    }));
  }, [execOptions]);

  return (
    <div style={{ padding: 16, position: 'relative' }}>
      <h4 style={{ marginTop: 0 }}>Executives attached to this project</h4>
      <small style={{ display: 'block', margin: '6px 0' }}>
        Showing {sorted.length} {sorted.length === 1 ? 'executive' : 'executives'}
      </small>

      {/* Add executive controls (combined dropdowns with inline search) */}
      <div style={{ margin: '8px 0 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Add executive:</strong>

        {/* Company filter (optional) — combined dropdown with search; attached section at top */}
        <SearchSelect
          value={companyChoice}
          onChange={(v) => { setCompanyChoice(v); }}
          placeholder="Filter by company (optional)"
          options={companySearchOptions}
          query={companyQuery}
          onQueryChange={setCompanyQuery}
          width={320}
        />

        {/* Executive picker — combined dropdown with search; server filtered by selected company */}
        <SearchSelect
          value={addExecutiveId}
          onChange={setAddExecutiveId}
          placeholder="Select an executive…"
          options={execSearchOptions}
          query={execQuery}
          onQueryChange={setExecQuery}
          width={360}
        />

        <button onClick={handleAddExecutive} disabled={!addExecutiveId || addBusy}>
          {addBusy ? 'Adding…' : 'Add'}
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {/* Name — sortable + search + dropdown */}
            <th style={th} className="clickable" onClick={() => clickSort('name')} title="Sort by name">
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Name</span>
                <span style={{ marginLeft:4 }}>{sortKey === 'name' ? (asc ? '▲' : '▼') : ''}</span>
              </div>
              <div style={{ marginTop:4, display:'grid', gap:4 }}>
                <input
                  placeholder="Search names…"
                  value={nameSearch}
                  onChange={e => setNameSearch(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  style={{ width:'95%' }}
                />
                <select
                  value={nameFilterExact}
                  onChange={e => setNameFilterExact(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  style={{ width:'100%' }}
                >
                  <option value="">All Names</option>
                  {Array.from(new Set(rows.map(r => r.executive_name)))
                    .sort((a,b)=>a.localeCompare(b))
                    .map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </th>

            {/* Company — sortable + search + grouped dropdown */}
            <th style={th} className="clickable" onClick={() => clickSort('company')} title="Sort by company">
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Company</span>
                <span style={{ marginLeft:4 }}>{sortKey === 'company' ? (asc ? '▲' : '▼') : ''}</span>
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
                  value={companyFilter}
                  onChange={e => setCompanyFilter(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  style={{ width:'100%' }}
                >
                  <option value="">Any</option>
                  {/* Build company filter options from visible rows */}
                  {(() => {
                    const seen = new Map<string,string>();
                    rows.forEach(r => r.company_ids.forEach((id, i) => {
                      if (!seen.has(id)) seen.set(id, r.company_names[i]);
                    }));
                    return Array.from(seen.entries())
                      .sort((a,b)=>a[1].localeCompare(b[1]))
                      .map(([id,label]) => <option key={id} value={id}>{label}</option>);
                  })()}
                </select>
              </div>
            </th>

            {/* Company Type — sortable + filter */}
            <th style={th} className="clickable" onClick={() => clickSort('company_type')} title="Sort by company type">
              <div style={{ display:'flex', alignItems:'center', userSelect:'none' }}>
                <span>Company Type</span>
                <span style={{ marginLeft:4 }}>{sortKey === 'company_type' ? (asc ? '▲' : '▼') : ''}</span>
              </div>
              <div style={{ marginTop:4 }}>
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)} onClick={e => e.stopPropagation()}>
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

              <td style={td}>
                <button
                  onClick={() => handleRemoveExecutive(r.executive_id)}
                  disabled={rmBusyId === r.executive_id}
                  title="Detach this executive from the project"
                >
                  {rmBusyId === r.executive_id ? 'Removing…' : 'Remove'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* spinner overlay */}
      {loading && (
        <div style={{
          position:'absolute', inset:0,
          background:'rgba(255,255,255,.6)',
          display:'flex', justifyContent:'center',
          alignItems:'flex-start', paddingTop:24,
          zIndex:1000,
        }}>
          <Spinner/>
        </div>
      )}
    </div>
  );
}
