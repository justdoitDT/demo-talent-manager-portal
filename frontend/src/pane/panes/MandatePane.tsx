// frontend/src/pane/panes/MandatePane.tsx

import React, { useEffect, useState } from 'react';
import { usePaneTab }                  from '../usePaneTab';
import PaneFrame, { PaneTab }          from '../PaneFrame';
import { usePane }                     from '../PaneContext';
import api                             from '../../services/api';

import { MandateDetail }               from '../../types/mandates';

import MandatePaneDetailsTab           from './MandatePaneDetailsTab';
import MandatePaneSubsTab              from './MandatePaneSubsTab';

/* ------------------------------------------------------------------ */

const TABS: PaneTab[] = [
  { key: 'details', label: 'Details' },
  { key: 'subs',    label: 'Subs'    },
];

interface Props {
  id: string;  // "MD_00001" etc.
}

type CompanyType = 'tv_network' | 'studio' | 'production_company' | 'creative';

/* -------- helpers -------- */
const mandatorTypeLabel = (ct?: string | null) =>
  ct === 'tv_network'         ? 'TV Network'
: ct === 'studio'             ? 'Studio'
: ct === 'production_company' ? 'Production Company'
: ct === 'creative'           ? 'Creative'
: '—';

const makeTitle = (m: MandateDetail | null, mandatorName: string | null, id: string): string => {
  if (!m) return id;
  const who = mandatorName || 'Unknown Mandator';
  return `Mandate — ${who}: ${m.name}`;
};

/* Narrow helper to get a mandator's display name based on type/id */
async function fetchMandatorName(companyId: string, companyType?: string | null): Promise<string | null> {
  // If Creative (or looks like CR_), hit /creatives/:id first
  if (companyType === 'creative' || companyId?.startsWith('CR_')) {
    try {
      const r = await api.get<{ id: string; name: string }>(`/creatives/${companyId}`);
      return r.data?.name ?? null;
    } catch {
      // fall through to /companies/:id as a last resort (just in case)
      try {
        const r2 = await api.get<{ id: string; name: string }>(`/companies/${companyId}`);
        return r2.data?.name ?? null;
      } catch {
        return null;
      }
    }
  }

  // Non-creatives → /companies/:id (works for tv_network / studio / production_company)
  try {
    const r = await api.get<{ id: string; name: string }>(`/companies/${companyId}`);
    return r.data?.name ?? null;
  } catch {
    // If that fails but it’s actually a creative, try creatives as a fallback
    if (companyId?.startsWith('CR_')) {
      try {
        const r2 = await api.get<{ id: string; name: string }>(`/creatives/${companyId}`);
        return r2.data?.name ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/* -------- Component -------- */
export default function MandatePane({ id }: Props) {
  // which tab? (persist per-pane)
  const paneKey = `mandate:${id}`;
  const [active, setActive] = usePaneTab(paneKey, 'details');

  // data
  const [mandate, setMandate] = useState<MandateDetail | null>(null);
  const [mandatorName, setMandatorName] = useState<string | null>(null);

  // for closing if 404
  const { close } = usePane();

  /* ----------------------------------------------------------------
     Fetch helpers
     ---------------------------------------------------------------- */
  const load = async () => {
    // 1) mandate
    const r = await api.get<MandateDetail>(`/mandates/${id}`);
    const m = r.data;
    setMandate(m);

    // 2) mandator (company/creative) name
    if (m?.company_id) {
      const name = await fetchMandatorName(m.company_id, (m as any).company_type as CompanyType | undefined);
      setMandatorName(name);
    } else {
      setMandatorName(null);
    }
  };

  /* initial fetch + reload when id changes */
  useEffect(() => {
    load().catch(err => {
      console.error(err);
      close(); // auto-close if mandate vanishes
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ----------------------------------------------------------------
     Render
     ---------------------------------------------------------------- */
  if (!mandate) {
    return (
      <PaneFrame
        title={makeTitle(null, null, id)}
        tabs={TABS}
        activeTabKey={active}
        onTabChange={setActive}
        minWidth={600}
      >
        Loading…
      </PaneFrame>
    );
  }

  return (
    <PaneFrame
      title={makeTitle(mandate, mandatorName, id)}
      tabs={TABS}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={600}
    >
      {active === 'details' ? (
        <MandatePaneDetailsTab
          mandate={mandate as MandateDetail & { company_type?: CompanyType }}
          mandatorName={mandatorName}
          mandatorTypeLabel={mandatorTypeLabel((mandate as any).company_type)}
          onRefresh={load}
        />
      ) : (
        <MandatePaneSubsTab mandateId={mandate.id} />
      )}
    </PaneFrame>
  );
}
