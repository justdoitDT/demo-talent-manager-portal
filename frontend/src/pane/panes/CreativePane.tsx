// frontend/src/pane/panes/CreativePane.tsx
import React, { useEffect, useState } from "react";
import api from "../../services/api";
import PaneFrame, { PaneTab } from "../PaneFrame";
import { usePane } from "../PaneContext";
import { usePaneTab } from "../usePaneTab";

import ManagementTab from "./CreativePaneManagementTab";
import ProfileTab from "./CreativePaneProfileTab";
import PersonalProjectsTab from "./CreativePanePersonalProjectsTab";
import SubsTab from "./CreativePaneSubsTab";
import CreditsTab from "./CreativePaneCreditsTab";
import WritingSamplesTab from "./CreativePaneWritingSamplesTab";

interface CreativeMini { id: string; name: string; }

const TABS: PaneTab[] = [
  { key: "management",       label: "Management" },
  { key: "profile",          label: "Profile" },
  { key: "personalProjects", label: "Personal Projects" },
  { key: "subs",             label: "Subs" },
  { key: "credits",          label: "Credits" },
  { key: "writingSamples",   label: "Writing Samples" },
];

export default function CreativePane({ id }: { id: string }) {
  const { open } = usePane();
  const paneKey = `creative:${id}`;
  const [active, setActive] = usePaneTab(paneKey, "management");
  const [creative, setCreative] = useState<CreativeMini | null>(null);

  useEffect(() => {
    api.get<CreativeMini>(`/creatives/${id}`).then((r) => setCreative(r.data));
  }, [id]);

  let body: React.ReactNode = null;
  switch (active) {
    case "management":
      body = <ManagementTab creativeId={id} onOpen={open} />; break;
    case "profile":
      body = <ProfileTab creativeId={id} />; break;
    case "personalProjects":
      body = <PersonalProjectsTab creativeId={id} onOpen={open} />; break;
    case "subs":
      body = <SubsTab creativeId={id} onOpen={open} />; break;
    case "credits":
      body = <CreditsTab creativeId={id} onOpen={open} />; break;
    case "writingSamples":
      body = <WritingSamplesTab creativeId={id} onOpen={open} />; break;
  }

  return (
    <PaneFrame
      title={creative?.name ?? (
        <span className="inline-flex items-center gap-2">
          Loading…
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-[#004c54]" />
        </span>
      )}
      tabs={TABS}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={420}
    >
      <div className="min-w-[420px]">
        {body}
      </div>
    </PaneFrame>
  );
}
