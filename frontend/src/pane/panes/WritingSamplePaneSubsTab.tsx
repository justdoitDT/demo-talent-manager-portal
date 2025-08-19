// frontend/src/pane/panes/WritingSamplePaneSubsTab.tsx

import React from 'react';

type WritingSamplePaneSubsTabProps = {
  writingSampleId: string;
  onOpen: (...args: any[]) => void;
};

export default function WritingSamplePaneSubsTab({ writingSampleId, onOpen }: WritingSamplePaneSubsTabProps) {
  return (
    <div>
      {/* Placeholder: subs content coming soon */}
      <p>Loading subs for sample ID {writingSampleId}</p>
    </div>
  );
}
