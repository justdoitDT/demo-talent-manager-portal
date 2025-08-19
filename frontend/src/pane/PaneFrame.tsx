// frontend/src/pane/PaneFrame.tsx

import React, { ReactNode, CSSProperties } from 'react';
import { usePane } from './PaneContext';
import { useBusy } from './BusyContext';

export interface PaneTab {
  key: string;
  label: string;
}

interface PaneFrameProps {
  /** The title to show next to the close button */
  title: ReactNode;
  /** Tabs to render under the title */
  tabs: PaneTab[];
  /** Which tab is currently active */
  activeTabKey: string;
  /** Called when user clicks a tab */
  onTabChange: (key: string) => void;
  /** Minimum width of the pane */
  minWidth?: number;
  /** The scrollable content */
  children: ReactNode;
}

export default function PaneFrame({
  title,
  tabs,
  activeTabKey,
  onTabChange,
  minWidth = 300,
  children,
}: PaneFrameProps) {
  const { close, back, forward, canBack, canForward } = usePane();
  const [busy]    = useBusy();
  const overlayCSS: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: 'rgba(255,255,255,.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  };
  const navBtn: CSSProperties = {
    border : 'none',
    background: 'none',
    fontSize: 18,
    width  : 26,
    height : 26,
    lineHeight: '26px',
    textAlign : 'center',
  };

  return (
    <div style={{ position:'relative', display:'flex', flexDirection:'column', height:'100%' }}>
      {busy && (
        <div style={overlayCSS}>
          <div className="spinner" />
        </div>
      )}
      {/* ★ Sticky header (never scrolls away) ★ */}
      <div
        style={{
          flex: '0 0 auto',
          padding: 16,
          borderBottom: '1px solid #eee',
          boxSizing: 'border-box',
          filter:   busy ? 'grayscale(30%) opacity(70%)' : 'none',
        }}
      >
        {/* Row 1: close button + title */}
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <button
            onClick={back}
            disabled={!canBack}
            title="Back"
            style={{
                ...navBtn,
                opacity: canBack ? 1 : 0.3,
                cursor : canBack ? 'pointer' : 'default',
              }}
          >◀</button>

          <button
            onClick={close}
            title="Close"
            style={closeBtnStyle}
          >×</button>

          <button
            onClick={forward}
            disabled={!canForward}
            title="Forward"
            style={{
                ...navBtn,
                opacity: canForward ? 1 : 0.3,
                cursor : canForward ? 'pointer' : 'default',
              }}
          >▶</button>

          <h2 style={{ margin:0, marginLeft:8, fontSize:'1.25rem' }}>{title}</h2>
        </div>

        {/* Row 2: tabs */}
        <nav style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`tab${tab.key === activeTabKey ? ' active' : ''}`}
              onClick={() => onTabChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ★ Scrollable body below the header ★ */}
      <div
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          padding: 16,
          boxSizing: 'border-box',
        }}
      >
        {children}
      </div>
    </div>
  );
}

const closeBtnStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  fontSize: 24,
  cursor: 'pointer',
};
