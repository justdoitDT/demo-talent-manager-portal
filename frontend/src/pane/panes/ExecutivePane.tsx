// frontend/src/pane/panes/ExecutivePane.tsx

import React, { useEffect, useState } from 'react';
import PaneFrame, { PaneTab } from '../PaneFrame';
import { usePaneTab } from '../usePaneTab';
import { usePane } from '../PaneContext';
import api from '../../services/api';

import ExecutivePaneProfileTab from './ExecutivePaneProfileTab';
import ExecutivePaneSubsFeedbackTab from './ExecutivePaneSubsFeedbackTab';

interface ExecutiveMini { id:string; name:string; }

const TABS: PaneTab[] = [
  { key: 'profile',      label: 'Profile' },
  { key: 'subsFeedback', label: 'Subs & Feedback' },
];

export default function ExecutivePane({ id }: { id:string }) {
  const paneKey = `executive:${id}`;
  const [active, setActive] = usePaneTab(paneKey, 'profile');
  const { open, close } = usePane();

  const [execMini, setExecMini] = useState<ExecutiveMini|null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<ExecutiveMini>(`/executives/${id}`)
      .then(r => { if (!cancelled) setExecMini({ id:r.data.id, name:r.data.name }); })
      .catch(() => close());
    return () => { cancelled = true; };
  }, [id, close]);

  return (
    <PaneFrame
      title={execMini?.name ?? id}
      tabs={TABS}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={600}
    >
      {active === 'profile' ? (
        <ExecutivePaneProfileTab
          executiveId={id}
          onOpen={open}
        />
      ) : (
        <ExecutivePaneSubsFeedbackTab
          executiveId={id}
          onOpen={open}
        />
      )}
    </PaneFrame>
  );
}
