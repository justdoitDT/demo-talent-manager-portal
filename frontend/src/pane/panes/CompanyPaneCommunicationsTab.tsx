// frontend/src/pane/panes/CompanyPaneCommunicationsTab.tsx

import React from 'react';
import { PanePayload } from '../PaneContext';


export default function CompanyPaneCommunicationsTab({
  companyId,
  onOpen: _onOpen, // underscore avoids “unused” lint noise
}: {
  companyId: string;
  onOpen?: (payload: PanePayload) => void;
}) {
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Communications</h3>
      <p style={{ color: '#555' }}>
        This area will aggregate emails, calls, and notes associated with this company.
      </p>
      <div style={{
        padding: 16, border: '1px dashed #ccc', borderRadius: 8, background: '#fafafa'
      }}>
        <p style={{ margin: 0, color: '#777' }}>
          Stub placeholder — wire to your messaging/notes endpoints when ready.
        </p>
      </div>
    </div>
  );
}
