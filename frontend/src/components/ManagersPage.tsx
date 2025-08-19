// frontend/src/components/ManagersPage.tsx
import React, { useEffect, useState, CSSProperties } from 'react';
import { AxiosResponse } from 'axios';
import api from '../services/api';
import { usePane } from '../pane/PaneContext';

interface Manager {
  id: string;
  name: string;
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: '8px',
  verticalAlign: 'bottom',
};

const tdStyle: CSSProperties = {
  textAlign: 'left',
  border: '1px solid #ddd',
  padding: '8px',
};

const Spinner: React.FC = () => (
    <div className="spinner" role="status" aria-label="Loading">
      <div />
    </div>
  );

export default function ManagersPage() {
  const { open } = usePane();
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<Manager[]>('/managers', { params: { role: 'manager' } })
      .then((res: AxiosResponse<Manager[]>) => setManagers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1>Managers</h1>
      <small style={{ display: 'block', margin: '4px 0' }}>
        {managers.length} row{managers.length === 1 ? '' : 's'}
      </small>

      <div style={{ position:'relative' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
            </tr>
          </thead>
          <tbody>
            {managers.map(m => (
              <tr key={m.id}>
                <td
                  className="clickable"
                  style={tdStyle}
                  onClick={() => open({ kind: 'manager', id: m.id })}
                >
                  {m.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {/* overlay spinner (just below header row) */}
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
    </div>
  );
}
