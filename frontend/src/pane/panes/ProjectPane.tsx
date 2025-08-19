// frontend/src/pane/panes/ProjectPane.tsx

import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import PaneFrame, { PaneTab } from '../PaneFrame';
import { usePane } from '../PaneContext';
import { usePaneTab } from '../usePaneTab';

// ───────── sub-tab components ─────────────────────────────────
import DetailsTab        from './ProjectPaneDetailsTab';
import SubsTab           from './ProjectPaneSubsTab';
import CompaniesTab      from './ProjectPaneCompaniesTab';
import ExecutivesTab from './ProjectPaneExecutivesTab';
import CommunicationsTab from './ProjectPaneCommunicationsTab';

// ───────── constants ─────────────────────────────────────────
const TABS: PaneTab[] = [
  { key: 'details',        label: 'Details'       },
  { key: 'subs',           label: 'Subs'          },
  { key: 'companies',      label: 'Companies'     },
  { key: 'executives',     label: 'Executives'    },
  { key: 'communications', label: 'Communications' },
];

/* Use the same Project interface fields as ProjectsPage */
interface Project {
  id:    string;
  title: string;
}

export default function ProjectPane({ id }: { id: string }) {
  const { open } = usePane();
  const paneKey = `project:${id}`;
  const [active, setActive] = usePaneTab(paneKey, 'details');
  const [project, setProject] = useState<Project | null>(null);

  /* fetch project for pane header */
  useEffect(() => {
    api.get<Project>(`/projects/${id}`).then(r => setProject(r.data));
  }, [id]);

  /* select tab content */
  let body: React.ReactNode;
  switch (active) {
    case 'details':
      body = <DetailsTab projectId={id} />;
      break;
    case 'subs':
      body = <SubsTab projectId={id} onOpen={open} />;
      break;
    case 'companies':
      body = <CompaniesTab projectId={id} />;
      break;
    case 'executives':
      body = <ExecutivesTab projectId={id} onOpen={open} />;
      break;
    case 'communications':
      body = <CommunicationsTab projectId={id} onOpen={open} />;
      break;
    default:
      body = null;
  }

  return (
    <PaneFrame
      title={project?.title ?? 'Loading…'}
      tabs={TABS}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={420}
    >
      {body}
    </PaneFrame>
  );
}
