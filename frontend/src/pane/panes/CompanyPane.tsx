// frontend/src/pane/panes/CompanyPane.tsx
import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import PaneFrame, { PaneTab } from '../PaneFrame';
import { usePaneTab } from '../usePaneTab';
import { usePane } from '../PaneContext';

import CompanyPaneDetailsTab         from './CompanyPaneDetailsTab';
import CompanyPaneProjectsTab        from './CompanyPaneProjectsTab';
import CompanyPaneSubsTab            from './CompanyPaneSubsTab';
import CompanyPaneMandatesTab        from './CompanyPaneMandatesTab';
import CompanyPaneExecutivesTab      from './CompanyPaneExecutivesTab';
import CompanyPaneCommunicationsTab  from './CompanyPaneCommunicationsTab';

interface CompanyMini { id: string; name: string; }

type CompanyType = 'tv_network' | 'studio' | 'production_company' | 'creative';
const inferCompanyTypeById = (companyId: string): CompanyType => {
  const p = companyId.slice(0, 2).toUpperCase();
  if (p === 'NW') return 'tv_network';
  if (p === 'ST') return 'studio';
  if (p === 'PC') return 'production_company';
  // CompanyPane is only for companies; creatives use a different pane. Fallback:
  return 'tv_network';
};

const TABS: PaneTab[] = [
  { key: 'details',        label: 'Details' },
  { key: 'projects',       label: 'Projects' },
  { key: 'subs',           label: 'Subs' },
  { key: 'mandates',       label: 'Mandates' },
  { key: 'executives',     label: 'Executives' },
  { key: 'communications', label: 'Communications' },
];

export default function CompanyPane({ id }: { id: string }) {
  const paneKey = `company:${id}`;
  const [active, setActive] = usePaneTab(paneKey, 'details');
  const { open, close } = usePane();

  const [company, setCompany] = useState<CompanyMini | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<CompanyMini>(`/companies/${id}`)
      .then(r => { if (!cancelled) setCompany(r.data); })
      .catch(() => close());
    return () => { cancelled = true; };
  }, [id, close]);

  const companyType: CompanyType = inferCompanyTypeById(id);
  const companyName = company?.name ?? '';

  return (
    <PaneFrame
      title={company?.name ?? id}
      tabs={TABS}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={600}
    >
      {active === 'details' ? (
        <CompanyPaneDetailsTab companyId={id} onOpen={open} />
      ) : active === 'projects' ? (
        <CompanyPaneProjectsTab companyId={id} onOpen={open} />
      ) : active === 'subs' ? (
        <CompanyPaneSubsTab companyId={id} onOpen={open} />
      ) : active === 'mandates' ? (
        <CompanyPaneMandatesTab
          companyId={id}
          companyType={companyType}
          companyName={companyName}
          onOpen={open}
        />
      ) : active === 'executives' ? (
        <CompanyPaneExecutivesTab companyId={id} onOpen={open} />
      ) : (
        <CompanyPaneCommunicationsTab companyId={id} onOpen={open} />
      )}
    </PaneFrame>
  );
}
