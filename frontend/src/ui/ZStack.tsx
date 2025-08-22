// src/ui/ZStack.tsx

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type Layers = Record<string, number>;

type ZStackCtx = {
  layers: Layers;
  register: (name: string) => void;           // stable key: "pane", "ai-modal", etc.
  unregister: (name: string) => void;
  bringToFront: (name: string) => void;
  topZ: number;
};

const ZStackContext = createContext<ZStackCtx>(null as any);

export function ZStackProvider({ children }: { children: React.ReactNode }) {
  // start below nav/tooltips but above page
  const base = 1200;
  const [layers, setLayers] = useState<Layers>({});
  const topRef = useRef(base);

  const register = useCallback((name: string) => {
    setLayers(prev => {
      if (Object.prototype.hasOwnProperty.call(prev, name)) return prev; // instead of if (prev[name])
      const nextZ = ++topRef.current;
      return { ...prev, [name]: nextZ };
    });
  }, []);

  const unregister = useCallback((name: string) => {
    setLayers(prev => {
      const { [name]: _omit, ...rest } = prev;
      return rest;
    });
  }, []);

  const bringToFront = useCallback((name: string) => {
    setLayers(prev => {
      if (!prev[name]) return prev;            // must be registered first
      const nextZ = ++topRef.current;
      return { ...prev, [name]: nextZ };
    });
  }, []);

  const topZ = useMemo(() => (Object.values(layers).length ? Math.max(...Object.values(layers)) : base), [layers]);

  const value: ZStackCtx = { layers, register, unregister, bringToFront, topZ };
  return <ZStackContext.Provider value={value}>{children}</ZStackContext.Provider>;
}

export function useZItem(name: string) {
  const ctx = useContext(ZStackContext);
  if (!ctx) throw new Error('useZItem must be used within ZStackProvider');
  const { layers, register, unregister, bringToFront, topZ } = ctx;

  useEffect(() => {
    register(name);
    return () => unregister(name);
  }, [name, register, unregister]);

  const zIndex = layers[name] ?? topZ;
  const isTop  = zIndex === topZ;

  // ✅ memoize these so their identity is stable
  const focus = React.useCallback(() => bringToFront(name), [bringToFront, name]);
  const bring = React.useCallback((otherName: string) => bringToFront(otherName), [bringToFront]);

  return { zIndex, isTop, focus, bring };
}