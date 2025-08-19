// frontend/src/pane/panes/CompanyPaneProjectsTab.tsx

import React, { CSSProperties, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { PanePayload } from '../PaneContext';

const th: CSSProperties = { padding: 8, border: '1px solid #ddd', textAlign: 'left', verticalAlign: 'bottom' };
const td: CSSProperties = { padding: 8, border: '1px solid #ddd', verticalAlign: 'top' };
const NA = <span style={{ color: '#999' }}>—</span>;

type Row = {
  id: string;
  title: string;
  year?: number | string | null;
  tracking_status?: string | null;
  engagement?: string | null;
  project_types?: string[];
  sub_count: number;
};

const chipStyle: CSSProperties = {
  display: 'inline-block',
  padding: '2px 6px',
  margin: '0 4px 4px 0',
  borderRadius: 12,
  fontSize: 12,
  background: '#eee',
};

const TRACKING_OPTS = [
  'Hot List', 'Active', 'Priority Tracking', 'Tracking', 'Development',
  'Engaged', 'Deep Tracking', 'Archived', 'Completed',
];

const TYPE_OPTS = [
  'OWA/ODA', 'OWA', 'ODA', 'Staffing', 'Episodic Directing', 'Re-write', '1st in', 'Pitch',
];

const ENGAGEMENT_OPTS = ['Meeting', 'Incoming', 'Sub', 'Pitching'];

export default function CompanyPaneProjectsTab({
  companyId,
  onOpen,
}: {
  companyId: string;
  onOpen: (payload: PanePayload) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // filters
  const [fTitle, setFTitle] = useState('');
  const [fYear, setFYear] = useState('');               // '' | concrete year string
  const [fTracking, setFTracking] = useState('');       // '' | one of TRACKING_OPTS
  const [fType, setFType] = useState('');               // '' | one of TYPE_OPTS
  const [fEngagement, setFEngagement] = useState('');   // '' | one of ENGAGEMENT_OPTS
  const [fSubs, setFSubs] = useState('');               // '' | '1+' | '0'

  // sorting
  const [titleAsc, setTitleAsc] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data } = await api.get<Row[]>(`/companies/${companyId}/projects`);
        if (mounted) setRows(data ?? []);
      } catch (e) {
        if (mounted) setErr('Failed to load projects.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [companyId]);

  const yearOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => {
      const y = r.year == null ? '' : String(r.year);
      if (y) s.add(y);
    });
    return Array.from(s).sort((a,b) => Number(b) - Number(a));
  }, [rows]);

  const filteredSorted = useMemo(() => {
    const needle = fTitle.trim().toLowerCase();
    const passType = (types: string[] = []) => {
      if (!fType) return true;
      if (fType === 'OWA/ODA') return types.includes('OWA') || types.includes('ODA');
      return types.includes(fType);
    };
    const passSubs = (n: number) => {
      if (!fSubs) return true;
      if (fSubs === '1+') return n > 0;
      if (fSubs === '0')  return n === 0;
      return true;
    };

    const pass = (r: Row) => {
      if (needle && !(r.title || '').toLowerCase().includes(needle)) return false;
      if (fYear && String(r.year ?? '') !== fYear) return false;
      if (fTracking && (r.tracking_status || '') !== fTracking) return false;
      if (!passType(r.project_types)) return false;
      if (fEngagement && (r.engagement || '') !== fEngagement) return false;
      if (!passSubs(r.sub_count)) return false;
      return true;
    };

    const out = rows.filter(pass);
    out.sort((a, b) => {
      const A = (a.title || '').toLowerCase();
      const B = (b.title || '').toLowerCase();
      const cmp = A.localeCompare(B);
      return titleAsc ? cmp : -cmp;
    });
    return out;
  }, [rows, fTitle, fYear, fTracking, fType, fEngagement, fSubs, titleAsc]);

  const SortTitle = () => (
    <span
      className="clickable"
      onClick={() => setTitleAsc(v => !v)}
      title={`Sort by title (${titleAsc ? 'A→Z' : 'Z→A'})`}
    >
      Title {titleAsc ? '▲' : '▼'}
    </span>
  );

  return (
    <div style={{ padding: 16 }}>
      <div style={{ position:'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}><SortTitle/></th>
              <th style={th}>Year</th>
              <th style={th}>Tracking</th>
              <th style={th}>OWA / ODA</th>
              <th style={th}>Engagement</th>
              <th style={th}>Sub Count</th>
            </tr>
            {/* filter row */}
            <tr>
              {/* Title search */}
              <th style={th}>
                <input
                  placeholder="Search title…"
                  value={fTitle}
                  onChange={e => setFTitle(e.target.value)}
                  style={{ width:'95%' }}
                />
              </th>

              {/* Year */}
              <th style={th}>
                <select value={fYear} onChange={e => setFYear(e.target.value)}>
                  <option value="">Any</option>
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </th>

              {/* Tracking */}
              <th style={th}>
                <select value={fTracking} onChange={e => setFTracking(e.target.value)}>
                  <option value="">Any</option>
                  {TRACKING_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </th>

              {/* OWA / ODA */}
              <th style={th}>
                <select value={fType} onChange={e => setFType(e.target.value)}>
                  <option value="">Any</option>
                  {TYPE_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </th>

              {/* Engagement */}
              <th style={th}>
                <select value={fEngagement} onChange={e => setFEngagement(e.target.value)}>
                  <option value="">Any</option>
                  {ENGAGEMENT_OPTS.map(e2 => <option key={e2} value={e2}>{e2}</option>)}
                </select>
              </th>

              {/* Sub Count */}
              <th style={th}>
                <select value={fSubs} onChange={e => setFSubs(e.target.value)}>
                  <option value="">Any</option>
                  <option value="1+">1+</option>
                  <option value="0">0</option>
                </select>
              </th>
            </tr>
          </thead>

          <tbody>
            {filteredSorted.map(r => (
              <tr key={r.id}>
                <td style={td}>
                  <span
                    className="clickable"
                    onClick={() => onOpen({ kind: 'project', id: r.id } as PanePayload)}
                  >
                    {r.title || NA}
                  </span>
                </td>
                <td style={td}>{r.year ?? NA}</td>
                <td style={td}>{r.tracking_status || NA}</td>
                <td style={td}>
                  {(r.project_types?.length ?? 0) > 0
                    ? r.project_types!.map(t => <span key={t} style={chipStyle}>{t}</span>)
                    : NA}
                </td>
                <td style={td}>{r.engagement || NA}</td>
                <td style={td}>{r.sub_count}</td>
              </tr>
            ))}
            {filteredSorted.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ padding: 16, color:'#666', textAlign:'center' }}>
                No projects found.
              </td></tr>
            )}
          </tbody>
        </table>

        {loading && (
          <div style={{
            position:'absolute', inset:0,
            background:'rgba(255,255,255,.6)',
            display:'flex', justifyContent:'center', alignItems:'flex-start', paddingTop: 32
          }}>
            <div className="spinner"><div /></div>
          </div>
        )}
        {err && !loading && (
          <div style={{ marginTop: 8, color:'#b00' }}>{err}</div>
        )}
      </div>
    </div>
  );
}
