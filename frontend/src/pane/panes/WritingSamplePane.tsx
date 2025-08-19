// frontend/src/pane/panes/WritingSamplePane.tsx

import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import PaneFrame, { PaneTab } from '../PaneFrame';
import { usePane } from '../PaneContext';
import { usePaneTab } from '../usePaneTab';

/* ───────── sub-tab components ─────────────────────────────────── */
import WritingSamplePaneDetailsTab from './WritingSamplePaneDetailsTab';
import WritingSamplePaneSubsTab from './WritingSamplePaneSubsTab';

/* ───────── constants / helpers ────────────────────────────────── */
interface WritingSampleMini { id: string; filename: string; }

const TABS: PaneTab[] = [
  { key: 'details', label: 'Details' },
  { key: 'subs',    label: 'Subs'    },
];

/* ───────── component ──────────────────────────────────────────── */
export default function WritingSamplePane({ id }: { id: string }) {
  const { open } = usePane();
  const paneKey = `writingSample:${id}`;
  const [active, setActive] = usePaneTab(paneKey, 'details');

  const [writingSample, setWritingSample] = useState<WritingSampleMini | null>(null);

  /* fetch once for the header title */
  useEffect(() => {
    api.get<WritingSampleMini>(`/writing_samples/${id}`)
      .then(response => setWritingSample(response.data));
  }, [id]);

  /* choose tab body */
  let body = null;
  switch (active) {
    case 'details':
      body = <WritingSamplePaneDetailsTab writingSampleId={id} />;
      break;
    case 'subs':
      body = <WritingSamplePaneSubsTab writingSampleId={id} onOpen={open} />;
      break;
  }

  /* render inside the shared frame */
  return (
    <PaneFrame
      title={writingSample?.filename ?? 'Loading…'}
      tabs={TABS}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={420}
    >
      {body}
    </PaneFrame>
  );
}
