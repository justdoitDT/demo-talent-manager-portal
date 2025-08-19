// frontend/src/pane/panes/ProjectPaneCommunicationsTab.tsx

import React from 'react';
import { PanePayload } from '../PaneContext';

interface ProjectPaneCommunicationsTabProps {
  projectId: string;
  onOpen: (payload: PanePayload) => void;
}

export default function ProjectPaneCommunicationsTab({
  projectId,
  onOpen,
}: ProjectPaneCommunicationsTabProps) {
  return (
    <div style={{ padding: 16 }}>
      <h4>Communications for Project {projectId}</h4>
      {/* TODO: Add messaging or communication-log UI and onOpen hooks */}
      <p>Placeholder content for the Communications tab.</p>
    </div>
  );
}
