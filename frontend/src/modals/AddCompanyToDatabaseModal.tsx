// frontend/src/modals/AddCompanyToDatabaseModal.tsx

import React, { useEffect, useState } from "react";
import { Modal } from "./Modal";
import api from "../services/api";

/* ── Types & helpers ───────────────────────────────────────────── */
type CompanyKind = "network" | "studio" | "prodco" | "agency";

const KIND_LABEL: Record<CompanyKind, string> = {
  network: "TV Network",
  studio : "Studio",
  prodco : "Production Company",
  agency : "External Agency",
};

const KIND_ENDPOINT: Record<CompanyKind, string> = {
  network: "/companies/tv_networks",
  studio : "/companies/studios",
  prodco : "/companies/production_companies",
  agency : "/companies/external_agencies",
};

/* ── Props ─────────────────────────────────────────────────────── */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Auto‑select the kind when the modal opens */
  initialKind?: CompanyKind;
}

/* ── Component ─────────────────────────────────────────────────── */
export default function AddCompanyToDatabaseModal({
  isOpen,
  onClose,
  initialKind,
}: Props) {
  const [kind, setKind] = useState<CompanyKind | "">(initialKind ?? "");
  const [name, setName] = useState("");

  const nameOk = name.trim().length >= 2;
  const canSave = nameOk && kind;

  /* Reset when the modal closes */
  useEffect(() => {
    if (!isOpen) {
      setKind(initialKind ?? "");
      setName("");
    }
  }, [isOpen, initialKind]);

  /* ── Save ────────────────────────────────────────────────────── */
  async function handleSave() {
    if (!canSave) return;                       // should never fire
    try {
      await api.post(KIND_ENDPOINT[kind as CompanyKind], { name: name.trim() });
      onClose();                               // close on success
    } catch (err) {
      // eslint‑disable‑next‑line no‑alert
      alert("Failed to create company");
      /* optional: console.error(err); */
    }
  }

  /* ── UI ──────────────────────────────────────────────────────── */
  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Add company" staticBackdrop>
      <h2 className="text-2xl font-semibold mb-4">Add Company to Database</h2>

      {/* Company Type */}
      <label style={{ display: "block", marginBottom: 12 }}>
        Company Type
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as CompanyKind)}
          style={{ marginLeft: 8 }}
        >
          <option value="">— choose —</option>
          <option value="network">TV Network</option>
          <option value="studio">Studio</option>
          <option value="prodco">Production Company</option>
          <option value="agency">External Agency</option>
        </select>
      </label>

      {/* Name input – appears once kind is chosen */}
      {kind && (
        <label style={{ display: "block", marginTop: 8 }}>
          {KIND_LABEL[kind]} Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginLeft: 8, width: "70%" }}
            placeholder="Enter name…"
          />
        </label>
      )}

      {/* Actions */}
      <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 12 }}>
        <button className="tab" onClick={onClose}>
          Cancel
        </button>
        {canSave && (
          <button className="tab" onClick={handleSave}>
            Save
          </button>
        )}
      </div>
    </Modal>
  );
}
