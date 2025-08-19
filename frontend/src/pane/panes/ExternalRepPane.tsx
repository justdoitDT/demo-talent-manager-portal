// frontend/src/pane/panes/ExternalRepPane.tsx

import React, { useEffect, useState } from 'react';
import api                    from '../../services/api';
import PaneFrame, { PaneTab } from '../PaneFrame';
import { usePaneTab }         from '../usePaneTab';

interface ExternalRepMini {
  id:   string;
  name: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;   // optional if your API provides it
}

const TABS: PaneTab[] = [
  { key: 'overview', label: 'Overview' },
  // add more tabs later (e.g., 'subs') when you’re ready
];

export default function ExternalRepPane({ id }: { id: string }) {
  const paneKey = `externalRep:${id}`;
  const [active, setActive] = usePaneTab(paneKey, 'overview');

  const [rep, setRep] = useState<ExternalRepMini | null>(null);

  useEffect(() => {
    // Pick the endpoint that exists in your app:
    // If your router is /external_talent_reps/{id}, use that; otherwise /external_reps/{id}.
    api.get<ExternalRepMini>(`/external_talent_reps/${id}`)
       .then(r => setRep(r.data))
       .catch(() => setRep({ id, name: null }));
  }, [id]);

  const cellLabel: React.CSSProperties = { fontWeight: 600, padding: 6 };
  const cell: React.CSSProperties      = { border: '1px solid #ddd', padding: 6 };
  const NA = <span style={{ color: '#999' }}>—</span>;

  const body = (
    <div style={{ padding: 8 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 520 }}>
        <tbody>
          <tr>
            <td style={cellLabel}>Name</td>
            <td style={cell}>{rep?.name ?? NA}</td>
          </tr>
          <tr>
            <td style={cellLabel}>Email</td>
            <td style={cell}>{rep?.email ?? NA}</td>
          </tr>
          <tr>
            <td style={cellLabel}>Phone</td>
            <td style={cell}>{rep?.phone ?? NA}</td>
          </tr>
          <tr>
            <td style={cellLabel}>Company</td>
            <td style={cell}>{rep?.company ?? NA}</td>
          </tr>
          <tr>
            <td style={cellLabel}>ID</td>
            <td style={cell}>{id}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <PaneFrame
      title={rep?.name ?? 'External Rep'}
      tabs={TABS}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={420}
    >
      {active === 'overview' && body}
    </PaneFrame>
  );
}
