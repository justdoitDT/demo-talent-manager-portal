// frontend/src/pane/panes/CreativePane.tsx
import React, { useEffect, useState } from 'react';
import api                    from '../../services/api';
import PaneFrame, { PaneTab } from '../PaneFrame';
import { usePane }            from '../PaneContext';
import { usePaneTab }       from '../usePaneTab';

/* ───────── sub-tab components ─────────────────────────────────── */
import ManagementTab       from './CreativePaneManagementTab';
import ProfileTab          from './CreativePaneProfileTab';
import PersonalProjectsTab from './CreativePanePersonalProjectsTab';
import SubsTab             from './CreativePaneSubsTab';
import CreditsTab          from './CreativePaneCreditsTab';
import WritingSamplesTab   from './CreativePaneWritingSamplesTab';

/* ───────── constants / helpers ────────────────────────────────── */
interface CreativeMini { id:string; name:string; }

const TABS: PaneTab[] = [
  { key:'management',       label:'Management'        },
  { key:'profile',          label:'Profile'           },
  { key:'personalProjects', label:'Personal Projects' },
  { key:'subs',             label:'Subs'              },
  { key:'credits',          label:'Credits'           },
  { key:'writingSamples',   label:'Writing Samples'   },
];

/* ───────── component ──────────────────────────────────────────── */
export default function CreativePane({ id }: { id:string }) {
  const { open } = usePane();            // for deep-link clicks
  const paneKey = `creative:${id}`;            // unique key
  const [active, setActive] = usePaneTab(paneKey, 'management');

  const [creative, setCreative] = useState<CreativeMini|null>(null);

  /* fetch once for the header title */
  useEffect(() => {
    api.get<CreativeMini>(`/creatives/${id}`).then(r => setCreative(r.data));
  }, [id]);

  /* choose tab body */
  let body = null;
  switch (active) {
    case 'management':
      body = <ManagementTab       creativeId={id} onOpen={open} />; break;
    case 'profile':
      body = <ProfileTab          creativeId={id} />; break;
    case 'personalProjects':
      body = <PersonalProjectsTab creativeId={id} onOpen={open} />; break;
    case 'subs':
      body = <SubsTab             creativeId={id} onOpen={open} />; break;
    case 'credits':
      body = <CreditsTab          creativeId={id} onOpen={open} />; break;
    case 'writingSamples':
      body = <WritingSamplesTab   creativeId={id} onOpen={open} />; break;
  }

  /* render inside the shared frame */
  return (
    <PaneFrame
      title={creative?.name ?? 'Loading…'}
      tabs={TABS}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={420}
    >
      {body}
    </PaneFrame>
  );
}
