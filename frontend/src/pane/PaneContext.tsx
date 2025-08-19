// frontend/src/pane/PaneContext.tsx

import React, { createContext, useContext, useState, ReactNode } from 'react';

export type PaneKind =
  | 'creative'
  | 'project'
  | 'executive'
  | 'manager'
  | 'sub'
  | 'writingSample'
  | 'mandate'
  | 'buyer'
  | 'externalRep'
  | 'company'
  | null;

export interface PanePayload {
  kind: PaneKind;
  id:   string;   // the identifier of the item that opened the pane
}

// type PerPaneState = Record<string/*paneKey*/, { tab?: string }>;

interface PaneCtx {
    open   : (p: PanePayload) => void;
    close  : () => void;
    payload: PanePayload | null;
    width  : number;
    setWidth: (w: number) => void;
    back   : () => void;
    forward: () => void;
    canBack   : boolean;
    canForward: boolean;
    paneTabs: Record<string,string>;
    setPaneTabs: (updater: Record<string,string> | ((prev:Record<string,string>)=>Record<string,string>)) => void;
  }

const PaneContext = createContext<PaneCtx>(null as any);

export const usePane = () => useContext(PaneContext);

export function PaneProvider({ children }: { children: ReactNode }) {
  /* ────────── history state ────────── */
  const [history, setHistory] = useState<PanePayload[]>([]);
  const [index,   setIndex]   = useState(-1);              // -1 ⇒ no pane open

  const payload = index >= 0 ? history[index] : null;

  /* open logic --------------------------------------------------- */
  const open = (p: PanePayload) => {
    // toggle-close if it’s the same pane
    if (payload && payload.kind === p.kind && payload.id === p.id) {
      close();
      return;
    }
    setHistory(h => {
      // if we were in the middle of history, drop any “forward” entries
      const head = index >= 0 ? h.slice(0, index + 1) : [];
      return [...head, p];
    });
    setIndex(i => i + 1);
  };

  /* close just hides the pane but keeps history intact */
  const close = () => setIndex(-1);

  /* back / forward ---------------------------------------------- */
  const back = () => setIndex(i => (i > 0 ? i - 1 : i));
  const forward = () =>
    setIndex(i => (i < history.length - 1 ? i + 1 : i));

  const canBack    = index > 0;
  const canForward = index >= 0 && index < history.length - 1;

  // default width = 75% of viewport, fallback to 800px
  const defaultWidth =
    typeof window !== 'undefined'
      ? Math.floor(window.innerWidth * 0.75)
      : 800;
  const [width, setWidth] = useState<number>(defaultWidth);

  const [paneTabs, setPaneTabs] = useState<Record<string,string>>({});

  const ctxValue: PaneCtx = {
      open, close, payload,
      back, forward, canBack, canForward,
      width, setWidth, paneTabs, setPaneTabs,
    };

  return (
    <PaneContext.Provider value={ctxValue}>
      {children}
    </PaneContext.Provider>
  );
}
