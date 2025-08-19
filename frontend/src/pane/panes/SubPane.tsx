// frontend/src/pane/panes/SubPane.tsx

import React, { useEffect, useState, useCallback } from 'react';
import { usePaneTab } from '../usePaneTab';
import PaneFrame, { PaneTab } from '../PaneFrame';
import { usePane } from '../PaneContext';
import api from '../../services/api';
import { SubDetail } from '../../types/subs';
import OverviewTab from './SubPaneOverviewTab';
import RecipientsFeedbackTab from './SubPaneRecipientsFeedbackTab';

/* ------------------------------------------------------------------ */

const TABS: PaneTab[] = [
  { key: 'overview',       label: 'Overview' },
  { key: 'recipsFeedback', label: 'Recipients & Feedback' },
];

interface Props {
  id: string;
}

/* -------- pretty title helper -------- */
const makeTitle = (s: SubDetail): string => {
  const clientNames =
    (s.clients ?? [])
      .map((c: any) => c.name)
      .slice(0, 2)
      .join(', ') || 'Unknown Client';

  const projTitle = s.project?.title ?? 'Untitled';

  const execCompanies = Array.from(
    new Set(
      (s.recipients ?? [])
        .filter((r: any) => r.type === 'executive' && r.company_name)
        .map((r: any) => r.company_name)
    )
  );

  const repCreativeNames = (s.recipients ?? [])
    .filter((r: any) => r.type === 'external_rep' || r.type === 'creative')
    .map((r: any) => r.name)
    .join(', ');

  const companyOrRep = execCompanies.join(', ') || repCreativeNames || 'Unknown';

  switch (s.intent_primary) {
    case 'staffing':
      return `Sub — ${clientNames} for '${projTitle}'`;
    case 'sell_project':
    case 'recruit_talent':
      return `Sub — '${projTitle}' to ${companyOrRep}`;
    default:
      return `Sub — ${clientNames} / '${projTitle}' / ${companyOrRep}`;
  }
};

/* -------- Component -------- */
export default function SubPane({ id }: Props) {
  const paneKey = `sub:${id}`;
  const [active, setActive] = usePaneTab(paneKey, 'overview');
  const [sub, setSub] = useState<SubDetail | null>(null);
  const { close } = usePane();

  const load = useCallback(async () => {
    const r = await api.get<SubDetail>(`/subs/${id}`);
    setSub(r.data);
  }, [id]);

  const savePatch = useCallback(
    async (body: Partial<SubDetail>) => {
      await api.patch(`/subs/${id}`, body);
      await load();
    },
    [id, load]
  );

  useEffect(() => {
    let mounted = true;
    load().catch(err => {
      console.error(err);
      if (mounted) close();
    });
    return () => {
      mounted = false;
    };
  }, [load, close]);

  if (!sub) {
    return (
      <PaneFrame
        title={id}
        tabs={TABS}
        activeTabKey={active}
        onTabChange={setActive}
        minWidth={600}
      >
        Loading
      </PaneFrame>
    );
  }

  return (
    <PaneFrame
      title={makeTitle(sub)}
      tabs={TABS}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={600}
    >
      {active === 'overview' ? (
        <OverviewTab sub={sub} onSave={savePatch} />
      ) : (
        <RecipientsFeedbackTab sub={sub} onChange={load} />
      )}
    </PaneFrame>
  );
}
