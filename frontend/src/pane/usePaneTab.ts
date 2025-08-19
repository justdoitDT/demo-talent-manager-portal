import { usePane } from './PaneContext';

export const usePaneTab = (paneKey: string, fallbackTab: string) => {
  const { paneTabs, setPaneTabs } = usePane();
  // pick existing or fall back
  const active = paneTabs[paneKey] ?? fallbackTab;
  // store new
  const setActive = (tab: string) =>
    setPaneTabs(prev => ({ ...prev, [paneKey]: tab }));
  return [active, setActive] as const;
};
