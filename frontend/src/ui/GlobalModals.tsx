import React, { createContext, useCallback, useContext, useState } from 'react';
import AIRecommendProjectNeedForCreative from '../modals/AI_RecommendProjectNeedForCreative';

type OpenOpts = { onClose?: (changed: boolean) => void };
type ModalState = { creativeId: string; onClose?: (changed: boolean) => void } | null;

const Ctx = createContext<{
  openAIModal: (creativeId: string, opts?: OpenOpts) => void;
  closeAIModal: (changed?: boolean) => void;
}>(null as any);

export function GlobalModalsProvider({ children }: { children: React.ReactNode }) {
  const [aiModal, setAIModal] = useState<ModalState>(null);

  const openAIModal = useCallback((creativeId: string, opts?: OpenOpts) => {
    setAIModal({ creativeId, onClose: opts?.onClose });
  }, []);

  const closeAIModal = useCallback((changed = false) => {
    setAIModal(prev => {
      prev?.onClose?.(changed);
      return null;
    });
  }, []);

  return (
    <Ctx.Provider value={{ openAIModal, closeAIModal }}>
      {children}
      {/* Render AI modal here so it survives pane swaps */}
      {aiModal && (
        <AIRecommendProjectNeedForCreative
          creativeId={aiModal.creativeId}
          onClose={(changed: boolean) => closeAIModal(changed)}
        />
      )}
    </Ctx.Provider>
  );
}

export function useGlobalModals() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGlobalModals must be used within GlobalModalsProvider');
  return ctx;
}
