// frontend/src/pane/BusyContext.tsx

import React, { createContext, useContext, useState } from 'react';

const BusyCtx = createContext<[boolean, (b: boolean) => void]>(null as any);
export const useBusy = () => useContext(BusyCtx);

export function BusyProvider({ children }: { children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <BusyCtx.Provider value={[busy, setBusy]}>
      {children}
    </BusyCtx.Provider>
  );
}
