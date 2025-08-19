// frontend/src/components/MandatesPage.tsx
import React, {
  useEffect, useMemo, useState, CSSProperties, useCallback, useRef,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { usePane } from '../pane/PaneContext';
import CreateMandateModal from '../modals/CreateMandateModal';

/* ───────────── Types ───────────── */
type CompanyType = 'tv_network' | 'studio' | 'production_company' | 'creative';

interface Mandate {
  id:           string;
  company_type: CompanyType;
  company_id:   string;               // e.g. "NW_..." | "ST_..." | "PC_..." | "CR_..."
  name:         string;
  description?: string | null;
  status:       'active' | 'archived' | string;
  updated_at:   string;               // ISO
}

interface PagedMandates {
  total: number;
  items: Mandate[];
}

interface CompanyRow { id: string; name: string; }
type SortKey = 'updated' | 'company';

/* For the single searchable dropdown (combobox) */
type MandatorGroup = 'TV Networks' | 'Studios' | 'Production Companies' | 'Creatives';
type MandatorOpt = { id: string; label: string; group: MandatorGroup };

/* ───────────── Styles ───────────── */
const Spinner: React.FC = () => (
  <div className="spinner" role="status" aria-label="Loading">
    <div />
  </div>
);
const th: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: 8,
  verticalAlign: 'bottom',
  cursor: 'default',
};
const td: CSSProperties = { ...th };
const NA = <span style={{ color: '#999' }}>—</span>;

/* helpers */
const companyTypeLabel = (ct?: CompanyType | null) =>
  ct === 'tv_network'         ? 'TV Network'
: ct === 'studio'             ? 'Studio'
: ct === 'production_company' ? 'Production Company'
: ct === 'creative'           ? 'Creative'
: '—';

/** Decide which catalog to use based on the first two letters of the ID */
const inferBucketById = (companyId: string): CompanyType | null => {
  const p = companyId.slice(0, 2).toUpperCase();
  if (p === 'NW') return 'tv_network';
  if (p === 'ST') return 'studio';
  if (p === 'PC') return 'production_company';
  if (p === 'CR') return 'creative';
  return null;
};

/* ────────────────────────────────── */
export default function MandatesPage() {
  const { open } = usePane();
  const [showCreate, setShowCreate] = useState(false);

  /* URL-backed filters */
  const [sp, setSp] = useSearchParams();

  // Filters
  const companyTypeParam = sp.get('company_type') ?? ''; // '', 'tv_network', 'studio', 'production_company', 'creative'
  const companyParam     = sp.get('company_id')    ?? ''; // e.g. "NW_123..."
  const statusParam      = sp.get('status')        ?? 'active'; // 'active' (default), 'archived', 'all'

  // Paging
  const limit  = +(sp.get('limit')  ?? 50);
  const offset = +(sp.get('offset') ?? 0);
  const page   = Math.floor(offset / limit) + 1;

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    v ? next.set(k, v) : next.delete(k);
    next.set('offset', '0'); // reset to page 1 on any filter change
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

  /* data */
  const [paged, setPaged] = useState<PagedMandates>({ total: 0, items: [] });
  const mandates = paged.items;
  const [loading, setLoading] = useState(true);

  // Company + creative catalogs for mapping + dropdown
  const [networks, setNetworks]   = useState<CompanyRow[]>([]);
  const [studios, setStudios]     = useState<CompanyRow[]>([]);
  const [prodCos, setProdCos]     = useState<CompanyRow[]>([]);
  const [creatives, setCreatives] = useState<CompanyRow[]>([]);

  // Sorting (match WritingSamplesTab style)
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [asc, setAsc]         = useState<boolean>(false); // updated desc by default

  const clickSort = (k: SortKey) => {
    setSortKey(prev => (prev === k ? prev : k));
    setAsc(prev => (sortKey === k ? !prev : (k === 'updated' ? false : true)));
  };

  // Fetch catalogs once (for mapping and dropdown)
  useEffect(() => {
    Promise.all([
      api.get('/companies/tv_networks',          { params: { q: '' } }),
      api.get('/companies/studios',              { params: { q: '' } }),
      api.get('/companies/production_companies', { params: { q: '' } }),
      api.get('/creatives',                      { params: { q: '' } }),
    ])
      .then(([n, s, p, c]) => {
        const pick = (r: any) => Array.isArray(r.data) ? r.data : (r.data.items ?? []);
        setNetworks(pick(n));
        setStudios(pick(s));
        setProdCos(pick(p));
        // Ensure creatives are id+name only
        setCreatives(pick(c).map((row: any) => ({ id: row.id, name: row.name })));
      })
      .catch(() => { setNetworks([]); setStudios([]); setProdCos([]); setCreatives([]); });
  }, []);

  // Build fast lookup maps
  const maps = useMemo(() => ({
    tv_network:         new Map(networks.map(n => [n.id, n.name] as const)),
    studio:             new Map(studios.map(s => [s.id, s.name] as const)),
    production_company: new Map(prodCos.map(p => [p.id, p.name] as const)),
    creative:           new Map(creatives.map(c => [c.id, c.name] as const)),
  }), [networks, studios, prodCos, creatives]);

  const companyNameFor = useCallback((m: Mandate): string => {
    const bucket = inferBucketById(m.company_id) ?? m.company_type;
    const map = bucket ? (maps as any)[bucket] as Map<string, string> : undefined;
    if (!map) return '—';
    return map.get(m.company_id) ?? '—';
  }, [maps]);

  // Fetch mandates whenever filters/paging change
  useEffect(() => {
    setLoading(true);
    const params: Record<string, any> = {
      limit, offset,
      company_type: companyTypeParam || undefined,
      company_id:   companyParam     || undefined,
      status:       statusParam || undefined,
    };

    api.get('/mandates', { params })
      .then(r => {
        const data = r.data;
        const normalized = Array.isArray(data)
          ? { total: data.length, items: data }
          : data;
        setPaged(normalized);        // ← always { total, items }
      })
      .catch(() => setPaged({ total: 0, items: [] }))
      .finally(() => setLoading(false));
  }, [companyTypeParam, companyParam, statusParam, limit, offset]);

  // Derived + client-side filter fallback
  const filtered = useMemo(() => {
    let out = mandates;

    if (companyTypeParam) {
      out = out.filter(m => m.company_type === companyTypeParam);
    }
    if (statusParam !== 'all') {
      out = out.filter(m => (m.status ?? 'active') === statusParam);
    }
    if (companyParam) {
      out = out.filter(m => m.company_id === companyParam);
    }

    return out;
  }, [mandates, companyTypeParam, statusParam, companyParam]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let vA: string | number = '';
      let vB: string | number = '';
      if (sortKey === 'updated') {
        vA = new Date(a.updated_at).getTime();
        vB = new Date(b.updated_at).getTime();
      } else if (sortKey === 'company') {
        vA = companyNameFor(a);
        vB = companyNameFor(b);
      }
      if (typeof vA === 'string' && typeof vB === 'string') {
        return asc ? vA.localeCompare(vB) : vB.localeCompare(vA);
      }
      return asc ? Number(vA) - Number(vB) : Number(vB) - Number(vA);
    });
    return arr;
  }, [filtered, sortKey, asc, companyNameFor]);

  const maxPage = Math.max(1, Math.ceil(paged.total / limit));

  /* ── Single searchable dropdown (combobox) for Mandator filter ───────── */
  const [mandatorQuery, setMandatorQuery] = useState<string>('');
  const [mandatorMenuOpen, setMandatorMenuOpen] = useState<boolean>(false);
  const [mandatorActiveIdx, setMandatorActiveIdx] = useState<number>(-1);
  const mandatorComboRef = useRef<HTMLDivElement | null>(null);

  // Build a flat grouped options list respecting the Mandator Type filter
  const allMandatorOpts = useMemo<MandatorOpt[]>(() => {
    const mk = (rows: CompanyRow[], group: MandatorGroup): MandatorOpt[] =>
      rows.map(r => ({ id: r.id, label: r.name, group }));

    const allow = (ct: string) => !companyTypeParam || companyTypeParam === ct;

    const out: MandatorOpt[] = [];
    if (allow('tv_network'))         out.push(...mk(networks, 'TV Networks'));
    if (allow('studio'))             out.push(...mk(studios, 'Studios'));
    if (allow('production_company')) out.push(...mk(prodCos, 'Production Companies'));
    if (allow('creative'))           out.push(...mk(creatives, 'Creatives'));

    // alpha sort within each group (stable enough for our use)
    out.sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : 0));
    return out;
  }, [companyTypeParam, networks, studios, prodCos, creatives]);

  // Filter by query text
  const filteredMandatorOpts = useMemo(() => {
    const q = mandatorQuery.trim().toLowerCase();
    if (!q) return allMandatorOpts;
    return allMandatorOpts.filter(o => o.label.toLowerCase().includes(q));
  }, [mandatorQuery, allMandatorOpts]);

  // Keep the input showing the currently-selected Mandator name
  useEffect(() => {
    if (!companyParam) { setMandatorQuery(''); return; }
    const bucket = inferBucketById(companyParam) ?? (companyTypeParam as CompanyType | null);
    const name = bucket ? (maps as any)[bucket]?.get(companyParam) : undefined;
    if (name) setMandatorQuery(name);
  }, [companyParam, companyTypeParam, maps]);

  function selectMandator(opt: MandatorOpt) {
    setFilter('company_id', opt.id);
    setMandatorMenuOpen(false);
    setMandatorActiveIdx(-1);
    setMandatorQuery(opt.label);
  }
  function clearMandator() {
    setFilter('company_id', '');
    setMandatorQuery('');
    setMandatorMenuOpen(false);
    setMandatorActiveIdx(-1);
  }
  function onMandatorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!mandatorMenuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setMandatorMenuOpen(true);
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMandatorActiveIdx(i => Math.min(i + 1, filteredMandatorOpts.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMandatorActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (mandatorMenuOpen && mandatorActiveIdx >= 0 && mandatorActiveIdx < filteredMandatorOpts.length) {
        e.preventDefault();
        selectMandator(filteredMandatorOpts[mandatorActiveIdx]);
      }
    } else if (e.key === 'Escape') {
      setMandatorMenuOpen(false);
      setMandatorActiveIdx(-1);
    }
  }
  // Close menu on outside click
  useEffect(() => {
    function handleDocClick(ev: MouseEvent) {
      if (!mandatorComboRef.current) return;
      if (!mandatorComboRef.current.contains(ev.target as Node)) {
        setMandatorMenuOpen(false);
        setMandatorActiveIdx(-1);
      }
    }
    if (mandatorMenuOpen) {
      document.addEventListener('mousedown', handleDocClick);
      return () => document.removeEventListener('mousedown', handleDocClick);
    }
  }, [mandatorMenuOpen]);

  /* ─────────── render ─────────── */
  return (
    <div>
      <h1>Mandates</h1>

      {/* top toolbar */}
      <div style={{ margin: '6px 0 8px' }}>
        <button className="tab" onClick={() => setShowCreate(true)}>
          Add Mandate to database
        </button>
      </div>

      <small style={{ display: 'block', margin: '4px 0' }}>
        Showing {offset + 1}–{offset + sorted.length} of {paged.total}
      </small>

      <div style={{ position:'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {/* Mandator Type */}
              <th style={th}>
                <div>Mandator Type</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={companyTypeParam}
                    onChange={e => setFilter('company_type', e.target.value)}
                  >
                    <option value="">All</option>
                    <option value="tv_network">TV Network</option>
                    <option value="studio">Studio</option>
                    <option value="production_company">Production Company</option>
                    <option value="creative">Creative</option>
                  </select>
                </div>
              </th>

              {/* Mandator — sortable + single searchable dropdown */}
              <th
                style={th}
                className="clickable"
                onClick={() => clickSort('company')}
                title="Sort by Mandator"
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    userSelect: 'none',
                  }}
                >
                  <span>Mandator</span>
                  {sortKey === 'company' ? (
                    <span style={{ marginLeft: 4 }}>{asc ? '▲' : '▼'}</span>
                  ) : (
                    <img
                      src="/sortable.png"
                      alt="sortable"
                      style={{ marginLeft: 4, width: 12, height: 12 }}
                    />
                  )}
                </div>

                {/* Single combobox */}
                <div
                  ref={mandatorComboRef}
                  onClick={(e) => e.stopPropagation()} // don't toggle sort while interacting
                  style={{ position: 'relative', marginTop: 4, width: '95%' }}
                >
                  <input
                    role="combobox"
                    aria-expanded={mandatorMenuOpen}
                    aria-autocomplete="list"
                    aria-controls="mandator-listbox"
                    aria-activedescendant={
                      mandatorMenuOpen && mandatorActiveIdx >= 0
                        ? `mandator-opt-${mandatorActiveIdx}`
                        : undefined
                    }
                    placeholder="Search mandators…"
                    value={mandatorQuery}
                    onChange={(e) => {
                      setMandatorQuery(e.target.value);
                      setMandatorMenuOpen(true);
                      setMandatorActiveIdx(0);
                    }}
                    onKeyDown={onMandatorKeyDown}
                    onFocus={() => setMandatorMenuOpen(true)}
                    style={{ width: '100%' }}
                  />

                  {mandatorMenuOpen && (
                    <ul
                      id="mandator-listbox"
                      role="listbox"
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        maxHeight: 240,
                        overflowY: 'auto',
                        border: '1px solid #ddd',
                        background: '#fff',
                        zIndex: 1000,
                        margin: 0,
                        padding: 0,
                        listStyle: 'none',
                      }}
                    >
                      {/* Clear / Any */}
                      <li
                        id="mandator-opt-any"
                        role="option"
                        aria-selected={false}
                        className="clickable"
                        onMouseDown={(e) => { e.preventDefault(); clearMandator(); }}
                        style={{ padding: '6px 8px', cursor: 'pointer', background: '#fafafa' }}
                        title="Clear mandator filter"
                      >
                        Any mandator
                      </li>

                      {/* Grouped options */}
                      {(() => {
                        const order: MandatorGroup[] = [
                          'TV Networks',
                          'Studios',
                          'Production Companies',
                          'Creatives',
                        ];
                        let idx = -1;
                        return order.flatMap(group => {
                          const rows = filteredMandatorOpts.filter(o => o.group === group);
                          if (rows.length === 0) return [];
                          return [
                            <li
                              key={`hdr-${group}`}
                              role="presentation"
                              style={{ padding: '6px 8px', fontSize: 12, color: '#666', background: '#f6f6f6' }}
                            >
                              {group}
                            </li>,
                            ...rows.map((opt) => {
                              idx += 1;
                              const active = idx === mandatorActiveIdx;
                              return (
                                <li
                                  key={opt.id}
                                  id={`mandator-opt-${idx}`}
                                  role="option"
                                  aria-selected={active}
                                  className="clickable"
                                  onMouseDown={(e) => { e.preventDefault(); selectMandator(opt); }}
                                  onMouseEnter={() => setMandatorActiveIdx(idx)}
                                  style={{
                                    padding: '6px 8px',
                                    background: active ? '#eef5ff' : '#fff',
                                    cursor: 'pointer',
                                  }}
                                  title={opt.label}
                                >
                                  {opt.label}
                                </li>
                              );
                            }),
                          ];
                        });
                      })()}
                    </ul>
                  )}
                </div>
              </th>

              {/* Mandate Name */}
              <th style={th}>
                <div>Mandate Name</div>
                <div style={{ marginTop: 4 }}>&nbsp;</div>
              </th>

              {/* Description */}
              <th style={th}>
                <div>Description</div>
                <div style={{ marginTop: 4 }}>&nbsp;</div>
              </th>

              {/* Status */}
              <th style={th}>
                <div>Status</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={statusParam}
                    onChange={e => setFilter('status', e.target.value)}
                  >
                    <option value="active">active</option>
                    <option value="archived">archived</option>
                    <option value="all">all</option>
                  </select>
                </div>
              </th>

              {/* Updated — sortable, default active */}
              <th
                style={th}
                className="clickable"
                onClick={() => clickSort('updated')}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    userSelect: 'none',
                  }}
                >
                  <span>Updated</span>
                  {sortKey === 'updated' ? (
                    <span style={{ marginLeft: 4 }}>{asc ? '▲' : '▼'}</span>
                  ) : (
                    <img
                      src="/sortable.png"
                      alt="sortable"
                      style={{ marginLeft: 4, width: 12, height: 12 }}
                    />
                  )}
                </div>
                <div style={{ marginTop: 4 }}>&nbsp;</div>
              </th>
            </tr>
          </thead>

          <tbody>
            {sorted.map(m => {
              const companyName = companyNameFor(m);
              return (
                <tr key={m.id}>
                  <td style={td}>{companyTypeLabel(m.company_type)}</td>

                  <td style={td}>{companyName || NA}</td>

                  <td
                    className="clickable"
                    style={{ ...td, cursor: 'pointer' }}
                    onClick={() => open({ kind: 'mandate', id: m.id })}
                    title="Open mandate"
                  >
                    {m.name}
                  </td>

                  <td style={{ ...td, whiteSpace: 'pre-line' }}>
                    {m.description ?? NA}
                  </td>

                  <td style={td}>{m.status ?? NA}</td>

                  <td style={td}>
                    {new Date(m.updated_at).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* create-mandate modal */}
        <CreateMandateModal
          isOpen={showCreate}
          onClose={() => setShowCreate(false)}
        />

        {/* overlay spinner just under header */}
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
