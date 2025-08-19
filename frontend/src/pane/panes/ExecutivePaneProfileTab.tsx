// frontend/src/pane/panes/ExecutivePaneProfileTab.tsx

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import api from '../../services/api';
import type { PanePayload } from '../PaneContext';

type CompanyType = 'tv_network' | 'studio' | 'production_company';

interface ExecutiveDetail {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface ExecCompanyLink {
  company_id:   string;
  company_name: string;
  company_type: CompanyType;
  status:       'Active' | 'Archived';
  last_modified:string;                  // ISO
}

interface ExecCompaniesPayload {
  current: ExecCompanyLink[];
  past:    ExecCompanyLink[];
}

interface CompanyRow { id:string; name:string; }

const NONE = <em style={{ color:'#999' }}>None</em>;
const labelCell: React.CSSProperties = { fontWeight:600, padding:6, border:'1px solid #ddd' };
const cell: React.CSSProperties      = { border:'1px solid #ddd', padding:6 };

const companyTypeLabel = (t?: CompanyType) =>
  t === 'tv_network' ? 'TV Network'
: t === 'studio' ? 'Studio'
: t === 'production_company' ? 'Production Company'
: 'N/A';

export default function ExecutivePaneProfileTab({
  executiveId,
  onOpen,
}: {
  executiveId: string;
  onOpen: (payload: PanePayload) => void;
}) {
  const [exec, setExec] = useState<ExecutiveDetail|null>(null);
  const [companies, setCompanies] = useState<ExecCompaniesPayload>({ current:[], past:[] });

  // personal-details inline editing
  const [editingKey, setEditingKey] = useState<keyof ExecutiveDetail | null>(null);
  const [tempValue, setTempValue]   = useState<string>('');
  const [hoverKey, setHoverKey]     = useState<string|null>(null);

  // company lists for picker (fetched from 3 endpoints)
  const [networks, setNetworks] = useState<CompanyRow[]>([]);
  const [studios,  setStudios]  = useState<CompanyRow[]>([]);
  const [prodcos,  setProdcos]  = useState<CompanyRow[]>([]);

  // add-company UI
  const [adding, setAdding] = useState<boolean>(false);
  const [pickerValue, setPickerValue] = useState<string>(''); // company_id
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  // delete/archive confirmation states
  const [confirmArchiveId, setConfirmArchiveId] = useState<string|null>(null);
  const [confirmDeleteId,  setConfirmDeleteId]  = useState<string|null>(null);

  // ---- data loaders
  const loadExecutive = useCallback(async () => {
    const r = await api.get<ExecutiveDetail>(`/executives/${executiveId}`);
    setExec(r.data);
  }, [executiveId]);

  const loadCompanies = useCallback(async () => {
    const r = await api.get<ExecCompaniesPayload>(`/executives/${executiveId}/companies`);
    setCompanies(r.data);
  }, [executiveId]);

  const loadCompanyLists = useCallback(async () => {
    const [nw, st, pc] = await Promise.all([
      api.get('/companies/tv_networks',          { params: { q: '' } }),
      api.get('/companies/studios',              { params: { q: '' } }),
      api.get('/companies/production_companies', { params: { q: '' } }),
    ]);
    const pick = (r: any) => Array.isArray(r.data) ? r.data : (r.data.items ?? []);
    setNetworks(pick(nw)); setStudios(pick(st)); setProdcos(pick(pc));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([loadExecutive(), loadCompanies(), loadCompanyLists()]);
      } catch {/* noop */}
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [loadExecutive, loadCompanies, loadCompanyLists]);

  // ---- personal detail patch
  const patchExecutive = async (payload: Partial<ExecutiveDetail>) => {
    await api.patch(`/executives/${executiveId}`, payload);
    await loadExecutive();
  };

  // ---- company link mutations
  const addOrActivateCompany = async (company_id: string) => {
    await api.post(`/executives/${executiveId}/companies`, { company_id });
    await loadCompanies();
  };

  const archiveCurrentCompany = async (company_id: string) => {
    await api.patch(`/executives/${executiveId}/companies/${company_id}`, { status:'Archived' });
    setConfirmArchiveId(null);
    await loadCompanies();
  };

  const deletePastCompany = async (company_id: string) => {
    await api.delete(`/executives/${executiveId}/companies/${company_id}`);
    setConfirmDeleteId(null);
    await loadCompanies();
  };

  // ---- picker options (grouped)
  const groupedOptions = useMemo(() => {
    const map = (rows:CompanyRow[]) => rows
      .slice()
      .sort((a,b) => a.name.localeCompare(b.name))
      .map(r => ({ id:r.id, label:r.name }));

    return {
      networks: map(networks),
      studios : map(studios),
      prodcos : map(prodcos),
    };
  }, [networks, studios, prodcos]);

  if (!exec) return <>Loading…</>;

  // ───────────────────────────────────────────────────────────
  // Personal Details (hover-to-edit)
  const detailRows: { label:string; key:keyof ExecutiveDetail }[] = [
    { label:'Name',  key:'name'  },
    { label:'Email', key:'email' },
    { label:'Phone', key:'phone' },
  ];

  // picker change handler
  const onPickCompany = async (value: string) => {
    if (value === '__ADD_NEW__') {
      setShowAddModal(true);
      return;
    }
    setPickerValue(value);
  };

  // modal “created new company” callback
  // Expect { id:string, name:string, type: 'tv_network'|'studio'|'production_company' }
  const onCompanyCreated = async (created: { id:string; name:string; type:CompanyType }) => {
    setShowAddModal(false);
    setPickerValue(created.id);
    // refresh lists so the new company appears in picker next time
    await loadCompanyLists();
    // immediately link
    await addOrActivateCompany(created.id);
    setAdding(false);
    setPickerValue('');
  };

  return (
    <>
      {/* ───────── Personal Details ───────── */}
      <h4 style={{ marginTop: 0 }}>Personal Details</h4>
      <table style={{ borderCollapse:'collapse', width:'100%', maxWidth:620 }}>
        <tbody>
          {detailRows.map(({ label, key }) => {
            const val       = exec[key];
            const isEditing = editingKey === key;
            const inputType = key === 'email' ? 'email' : 'text';

            return (
              <tr
                key={key}
                onMouseEnter={() => setHoverKey(key)}
                onMouseLeave={() => setHoverKey(null)}
              >
                <td style={labelCell}>{label}</td>
                <td style={{ ...cell, width:'100%' }}>
                  {isEditing ? (
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <input
                        autoFocus
                        type={inputType}
                        value={tempValue}
                        onChange={e => setTempValue(e.target.value)}
                        style={{ flex:1, minWidth:0 }}
                      />
                      <button
                        className="btn"
                        onClick={() => {
                          const cleaned = (tempValue.trim() || null) as any;
                          patchExecutive({ [key]: cleaned });
                          setEditingKey(null);
                        }}
                      >Save</button>
                      <button className="btn" onClick={() => setEditingKey(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span>{val ?? NONE}</span>
                      <button
                        className="btn"
                        style={{ marginLeft:8, visibility: hoverKey === key ? 'visible' : 'hidden' }}
                        onClick={() => { setTempValue((val ?? '') as string); setEditingKey(key); }}
                      >Edit</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ───────── Current Company ───────── */}
      <h4 style={{ marginTop: 24 }}>Current Company</h4>
      {companies.current.length === 0 ? (
        <p>{NONE}</p>
      ) : (
        <table style={{ borderCollapse:'collapse', width:'100%', maxWidth:720 }}>
          <thead>
            <tr>
              <th style={labelCell}>Company</th>
              <th style={labelCell}>Company Type</th>
              <th style={labelCell}>Updated</th>
              <th style={labelCell}></th>
            </tr>
          </thead>
          <tbody>
            {companies.current.map(link => {
              const confirming = confirmArchiveId === link.company_id;
              return (
                <tr key={link.company_id}>
                  <td style={cell}>
                    <span
                      className="clickable"
                      onClick={() => onOpen({ kind:'company', id: link.company_id })}
                      title="Open company"
                    >
                      {link.company_name}
                    </span>
                  </td>
                  <td style={cell}>{companyTypeLabel(link.company_type)}</td>
                  <td style={cell}>{new Date(link.last_modified).toLocaleString()}</td>
                  <td style={{ ...cell, width:140 }}>
                    {!confirming ? (
                      <button
                        className="btn"
                        onClick={() => setConfirmArchiveId(link.company_id)}
                      >Delete</button>
                    ) : (
                      <div style={{ display:'flex', gap:6 }}>
                        <button
                          className="btn confirm-remove"
                          onClick={() => archiveCurrentCompany(link.company_id)}
                          title="Archive current link"
                        >Confirm</button>
                        <button className="btn" onClick={() => setConfirmArchiveId(null)}>Cancel</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Add Current Company */}
      {!adding ? (
        <div style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => setAdding(true)}>Add Current Company</button>
        </div>
      ) : (
        <div style={{ marginTop: 8, display:'grid', gap:8, maxWidth: 520 }}>
          <select
            value={pickerValue}
            onChange={e => onPickCompany(e.target.value)}
          >
            <option value="">Pick a company…</option>
            <option value="__ADD_NEW__">➕ Add Company to Database…</option>

            {groupedOptions.networks.length > 0 && (
              <optgroup label="TV Networks">
                {groupedOptions.networks.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </optgroup>
            )}
            {groupedOptions.studios.length > 0 && (
              <optgroup label="Studios">
                {groupedOptions.studios.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </optgroup>
            )}
            {groupedOptions.prodcos.length > 0 && (
              <optgroup label="Production Companies">
                {groupedOptions.prodcos.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </optgroup>
            )}
          </select>

          <div style={{ display:'flex', gap:8 }}>
            <button
              className="btn"
              disabled={!pickerValue || pickerValue === '__ADD_NEW__'}
              onClick={async () => {
                if (!pickerValue || pickerValue === '__ADD_NEW__') return;
                await addOrActivateCompany(pickerValue);
                setAdding(false);
                setPickerValue('');
              }}
            >Save</button>
            <button className="btn" onClick={() => { setAdding(false); setPickerValue(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ───────── Past Companies ───────── */}
      <h4 style={{ marginTop: 24 }}>Past Companies</h4>
      {companies.past.length === 0 ? (
        <p>{NONE}</p>
      ) : (
        <table style={{ borderCollapse:'collapse', width:'100%', maxWidth:720 }}>
          <thead>
            <tr>
              <th style={labelCell}>Company</th>
              <th style={labelCell}>Company Type</th>
              <th style={labelCell}>Updated</th>
              <th style={labelCell}></th>
            </tr>
          </thead>
          <tbody>
            {companies.past.map(link => {
              const confirming = confirmDeleteId === link.company_id;
              return (
                <tr key={`past:${link.company_id}`}>
                  <td style={cell}>
                    <span
                      className="clickable"
                      onClick={() => onOpen({ kind:'company', id: link.company_id })}
                      title="Open company"
                    >
                      {link.company_name}
                    </span>
                  </td>
                  <td style={cell}>{companyTypeLabel(link.company_type)}</td>
                  <td style={cell}>{new Date(link.last_modified).toLocaleString()}</td>
                  <td style={{ ...cell, width:140 }}>
                    {!confirming ? (
                      <button
                        className="btn"
                        onClick={() => setConfirmDeleteId(link.company_id)}
                      >Delete</button>
                    ) : (
                      <div style={{ display:'flex', gap:6 }}>
                        <button
                          className="btn confirm-remove"
                          onClick={() => deletePastCompany(link.company_id)}
                          title="Delete archived link"
                        >Confirm</button>
                        <button className="btn" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Minimal inline modal for adding companies */}
      {showAddModal && (
        <AddCompanyToDatabaseModal
          onClose={() => setShowAddModal(false)}
          onCreated={onCompanyCreated}
        />
      )}
    </>
  );
}

/* Minimal, self-contained modal so this file compiles and works.
   If you already have a shared modal component, replace this with yours. */
function AddCompanyToDatabaseModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c:{ id:string; name:string; type:CompanyType }) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CompanyType>('tv_network');

  const create = async () => {
    const endpoint =
      type === 'tv_network' ? '/companies/tv_networks'
    : type === 'studio' ? '/companies/studios'
    : '/companies/production_companies';

    const r = await api.post(endpoint, { name });
    onCreated({ id:r.data.id, name:r.data.name, type });
  };

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
      display:'grid', placeItems:'center', zIndex:1000
    }}>
      <div style={{ background:'#fff', padding:16, borderRadius:8, minWidth:360 }}>
        <h3 style={{ marginTop:0 }}>Add Company</h3>
        <div style={{ display:'grid', gap:8 }}>
          <label>
            <div>Type</div>
            <select value={type} onChange={e => setType(e.target.value as CompanyType)}>
              <option value="tv_network">TV Network</option>
              <option value="studio">Studio</option>
              <option value="production_company">Production Company</option>
            </select>
          </label>
          <label>
            <div>Name</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Company name" />
          </label>
          <div style={{ display:'flex', gap:8, marginTop:8 }}>
            <button className="btn" onClick={create} disabled={!name.trim()}>Save</button>
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
