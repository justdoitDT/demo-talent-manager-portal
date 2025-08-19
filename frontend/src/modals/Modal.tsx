// frontend/src/modals/Modal.tsx

import ReactDOM from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional aria‑label or an id the heading points to */
  ariaLabel?: string;
  /** Optional: if true, clicking the backdrop won’t close */
  staticBackdrop?: boolean;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  ariaLabel,
  staticBackdrop = false,
  children,
}) => {
  if (!isOpen) return null;

  const modalRoot = document.getElementById("modal-root")!;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return ReactDOM.createPortal(
    <AnimatePresence>
      <motion.div
        className="rde-modal-backdrop"          // keep a class if you like
        style={{                                 // fallback for non‑Tailwind env
          position: "fixed",
          inset: 0,                              // top:0 right:0 bottom:0 left:0
          background: "rgba(0,0,0,.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e: React.MouseEvent<HTMLDivElement>) => {
            // only close if the click was directly on the backdrop
            if (!staticBackdrop && e.target === e.currentTarget) {
              onClose();
            }
          }}
      >
        <motion.div
          className="rde-modal-card"
          style={{
            background: "#fff",
            borderRadius: "1rem",
            boxShadow: "0 8px 24px rgba(0,0,0,.15)",
            maxHeight: "90vh",
            overflowY: "auto",
            padding: "24px",
            width: "min(800px,90vw)",
          }}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={stop}
        >
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    modalRoot
  );
};
