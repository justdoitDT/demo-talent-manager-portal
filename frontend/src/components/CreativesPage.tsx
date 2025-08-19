// frontend/src/components/CreativesPage.tsx

import React, { useEffect, useState, CSSProperties } from 'react';
import { AxiosResponse } from 'axios';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { usePane } from '../pane/PaneContext';
import AddPersonToDatabaseModal from '../modals/AddPersonToDatabaseModal';

interface ManagerMini { id: string; name: string; }
interface Creative {
  id: string;
  name: string;
  client_status: string;
  availability?: string | null;
  unavailable_until?: string | null;
  tv_acceptable?: boolean | null;
  is_writer?: boolean | null;
  is_director?: boolean | null;
  writer_level?: number | null;
  has_directed_feature?: boolean | null;
  managers?: ManagerMini[];
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: '8px',
  verticalAlign: 'bottom'
};

const tdStyle: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: '8px'
};

const Spinner: React.FC = () => (
    <div className="spinner" role="status" aria-label="Loading">
      <div />
    </div>
  );

const NA = <span style={{ color: '#999' }}>N/A</span>;

const toInitials = (full: string) =>
  full.split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase();

const writerLabel = (lvl?: number | null) => {
  if (lvl == null) return NA;
  const map: Record<number, string> = {
    0: `Writer’s Assistant`, 0.5: `Writer's Asst / Staff Writer`, 1: `Staff Writer`,
    1.5: `Staff Writer / Story Editor`, 2: `Story Editor`, 2.5: `Story Editor / Exec Story Editor`,
    3: `Exec Story Editor`, 3.5: `Exec Story Editor / Co-Producer`, 4: `Co-Producer`,
    4.5: `Co-Producer / Producer`, 5: `Producer`, 5.5: `Producer / Supervising Producer`,
    6: `Supervising Producer`, 6.5: `Supervising Producer / Co-EP`, 7: `Co-EP`,
    7.5: `Co-EP / EP`, 8: `EP`, 8.5: `EP / Showrunner`, 9: `Showrunner`,
  };
  return map[lvl] ?? lvl.toString();
};

export default function CreativesPage() {
  const { open } = usePane();

  const [searchParams, setSearchParams] = useSearchParams();
  const [creatives, setCreatives]     = useState<Creative[]>([]);
  const [managers,   setManagers]     = useState<ManagerMini[]>([]);
  const [loading,    setLoading]      = useState(true);
  const [showAddCreative, setShowAddCreative] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters backed in URL:
  const clientStatus = searchParams.get('client_status') || 'client';
  const managerId    = searchParams.get('manager_id')    || '';
  const availability = searchParams.get('availability')  || '';
  // no “Any” option for medium; default to TV
  const medium       = searchParams.get('medium')        || '';
  const roleFilter   = searchParams.get('role')          || '';
  const writerBucket = searchParams.get('writer_bucket') || '';

  const showWriter = !(medium === 'features' || roleFilter === 'director');
  const dirLevel = searchParams.get('dir_level') || '';  // '' | 'yes' | 'no'
  const showDirLevel = roleFilter !== 'writer';
  const nameSearch   = searchParams.get('q_name')             || '';

  const setParam = (k: string, v: string, base = searchParams) => {
    const p = Object.fromEntries(base);
    if (v) p[k] = v;
    else delete p[k];
    setSearchParams(p);
  };

  // load managers for dropdown
  useEffect(() => {
    api.get<ManagerMini[]>('/managers', { params: { role: 'manager' } })
       .then((r: AxiosResponse<ManagerMini[]>) => setManagers(r.data));
  }, []);

  // fetch /creatives when any filter changes
  useEffect(() => {
    setLoading(true);
    api.get<Creative[]>('/creatives', {
      params: {
        client_status: clientStatus,
        manager_id:    managerId    || undefined,
        availability:  availability || undefined,
    
        // only include tv_acceptable when a real choice is selected
        ...(medium === 'tv_features'
            ? { tv_acceptable: true }
            : medium === 'features'
              ? { tv_acceptable: false }
              : {}),
    
        is_writer:   roleFilter === 'writer' ? true : undefined,
        is_director: roleFilter === 'director' ? true : undefined,
    
        writer_level_bucket: showWriter
          ? (writerBucket || undefined)
          : undefined,
    
        has_directed_feature:
          dirLevel === 'yes' ? true
          : dirLevel === 'no'  ? false
          : undefined,
        
        q: nameSearch || undefined,
      },
    })
      .then((r: AxiosResponse<Creative[]>) => setCreatives(r.data))
      .finally(() => setLoading(false));
  }, [clientStatus, managerId, availability, medium, roleFilter, writerBucket, showWriter, dirLevel, nameSearch, refreshKey]);

  return (
    <div>
      <div style={{ margin: '6px 0 14px' }}>
        <button className="tab" onClick={() => setShowAddCreative(true)}>
          Add creative to database
        </button>
      </div>

      <small style={{ display: 'block', margin: '4px 0' }}>
        {creatives.length} row{creatives.length === 1 ? '' : 's'}
      </small>

      <div style={{ position:'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>

              {/* Name */}
              <th style={thStyle}>
                <div>Name</div>
                <div style={{ marginTop: 4 }}>
                  <input
                    placeholder="Search…"
                    style={{ width: '90%' }}
                    value={nameSearch}
                    onChange={e => setParam('q_name', e.target.value)}
                  />
                </div>
              </th>

              {/* Client Status */}
              <th style={thStyle}>
                <div>Client Status</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={clientStatus}
                    onChange={e => setParam('client_status', e.target.value)}
                  >
                    <option value="client">Client</option>
                    <option value="prospective client">Prospective Client</option>
                    <option value="non-client">Non-Client</option>
                    <option value="ex-client">Ex-Client</option>
                  </select>
                </div>
              </th>

              {/* Managers */}
              <th style={thStyle}>
                <div>Manager(s)</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={managerId}
                    onChange={e => setParam('manager_id', e.target.value)}
                  >
                    <option value="">Any</option>
                    {managers.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </th>

              {/* Availability */}
              <th style={thStyle}>
                <div>Availability</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={availability}
                    onChange={e => setParam('availability', e.target.value)}
                  >
                    <option value="">Any</option>
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </div>
              </th>

              {/* Unavailable Until */}
              <th style={thStyle}>
                <div>Unavailable Until</div>
              </th>

              {/* Medium */}
              <th style={thStyle}>
                <div>Media Type</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={medium}
                    onChange={e => {
                      const next = new URLSearchParams(searchParams);
                      next.set('medium', e.target.value);
                      if (e.target.value === 'features') next.delete('writer_bucket');
                      setSearchParams(next);
                    }}
                  >
                    <option value="">Any</option>
                    <option value="tv_features">TV / Features</option>
                    <option value="features">Features Only</option>
                  </select>
                </div>
              </th>

              {/* Role */}
              <th style={thStyle}>
                <div>Role</div>
                <div style={{ marginTop: 4 }}>
                  <select
                    value={roleFilter}
                    onChange={e => {
                      const next = new URLSearchParams(searchParams);
                      next.set('role', e.target.value);
                      if (e.target.value === 'director') next.delete('writer_bucket');
                      setSearchParams(next);
                    }}
                  >
                    <option value="">Any</option>
                    <option value="writer">Writer</option>
                    <option value="director">Director</option>
                    <option value="writer_dir">Writer & Director</option>
                  </select>
                </div>
              </th>

              {/* Writer Level (TV) */}
              {showWriter && (
                <th style={thStyle}>
                  <div>Writer Level (TV)</div>
                  <div style={{ marginTop: 4 }}>
                    <select
                      value={writerBucket}
                      onChange={e => setParam('writer_bucket', e.target.value)}
                    >
                      <option value="">Any</option>
                      <option value="upper">Upper</option>
                      <option value="mid_upper">Mid–Upper</option>
                      <option value="mid">Mid</option>
                      <option value="low_mid">Low–Mid</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </th>
              )}

              {/* Director Level */}
              {showDirLevel && (
                <th style={thStyle}>
                  <div>Director Level</div>
                  <div style={{ marginTop: 4 }}>
                    <select
                      value={dirLevel}
                      onChange={e => setParam('dir_level', e.target.value)}
                    >
                      <option value="">Any</option>
                      <option value="yes">Directed Feature</option>
                      <option value="no">Not Directed Feature</option>
                    </select>
                  </div>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {creatives.map(c => (
              <tr key={c.id}>
                <td
                  className="clickable"
                  style={tdStyle}
                  onClick={() => open({ kind: 'creative', id: c.id })}
                >
                  {c.name}
                </td>
                <td style={tdStyle}>
                  {{
                    'client': 'Client',
                    'prospective client': 'Prospective Client',
                    'non-client': 'Non-Client',
                    'ex-client': 'Ex-Client',
                  }[c.client_status] ?? c.client_status}
                </td>
                <td style={tdStyle}>
                  {c.managers?.length
                    ? c.managers.map(m => toInitials(m.name)).join(', ')
                    : NA}
                </td>
                <td style={tdStyle}>
                  {c.availability != null
                    ? {
                        'available': 'Available',
                        'unavailable': 'Unavailable',
                      }[c.availability] ?? c.availability
                    : NA}
                </td>
                <td style={tdStyle}>
                  {c.unavailable_until
                    ? new Date(c.unavailable_until).toLocaleDateString()
                    : NA}
                </td>
                <td style={tdStyle}>
                  {c.tv_acceptable ? 'TV / Features' : 'Features Only'}
                </td>
                <td style={tdStyle}>
                  {c.is_writer && c.is_director
                    ? 'Writer & Director'
                    : c.is_writer
                      ? 'Writer'
                      : c.is_director
                        ? 'Director'
                        : NA}
                </td>
                {showWriter && (
                  <td style={tdStyle}>
                    {writerLabel(c.writer_level)}
                  </td>
                )}
                {showDirLevel && (
                  <td style={tdStyle}>
                    {c.has_directed_feature == null
                      ? NA
                      : c.has_directed_feature
                        ? 'Directed Feature'
                        : 'Not Directed Feature'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <AddPersonToDatabaseModal
          isOpen={showAddCreative}
          onClose={() => {
            setShowAddCreative(false);
            setRefreshKey(k => k + 1);  // re-fetch list after closing/saving
          }}
          initialRole="creative"
        />

        {/* overlay spinner just below header row */}
        {loading && (
          <div style={{
            position:'absolute', inset:0,
            background:'rgba(255,255,255,.6)',
            display:'flex', justifyContent:'center',
            alignItems:'flex-start', paddingTop:48,    /* ~ header height */
            zIndex:1000,
          }}>
            <Spinner/>
          </div>
        )}
      
      </div>
    </div>
  );
}
