// frontend/src/modals/CreateMandateModal.tsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./Modal";
import api from "../services/api";

/* ──────────────────────────────────────────────────────────────
 * Types / mappings
 * ──────────────────────────────────────────────────────────────*/
type MandatorType = "tv_network" | "studio" | "production_company" | "creative";

const TYPE_LABEL: Record<MandatorType, string> = {
  tv_network: "TV Network",
  studio: "Studio",
  production_company: "Production Company",
  creative: "Creative",
};

const TYPE_ENDPOINT: Record<MandatorType, string> = {
  tv_network: "/companies/tv_networks",
  studio: "/companies/studios",
  production_company: "/companies/production_companies",
  creative: "/creatives",
};

type Option = { id: string; name: string };

/* ──────────────────────────────────────────────────────────────
 * Props
 * ──────────────────────────────────────────────────────────────*/
interface Props {
  isOpen: boolean;
  onClose: () => void;

  /** Optional preselection (e.g., when opening from a Studio page) */
  initialMandatorType?: MandatorType;
  initialMandatorId?: string;
  /** Optional label for initial selection (nice UX while options load) */
  initialMandatorName?: string;
}

/* ──────────────────────────────────────────────────────────────
 * Component
 * ──────────────────────────────────────────────────────────────*/
export default function CreateMandateModal({
  isOpen,
  onClose,
  initialMandatorType,
  initialMandatorId,
  initialMandatorName,
}: Props) {
  // Form state
  const [mandatorType, setMandatorType] = useState<MandatorType | "">(
    initialMandatorType ?? ""
  );
  const [mandatorId, setMandatorId] = useState<string>(initialMandatorId ?? "");
  const [mandateName, setMandateName] = useState("");
  const [mandateDesc, setMandateDesc] = useState("");

  // Options / loading
  const [options, setOptions] = useState<Option[]>([]);
  const [loadingOpts, setLoadingOpts] = useState(false);

  // Combobox state
  const [query, setQuery] = useState<string>(initialMandatorName ?? "");
  const [openMenu, setOpenMenu] = useState<boolean>(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Refs
  const comboRef = useRef<HTMLDivElement | null>(null);
  const blurTimeoutRef = useRef<number | null>(null);

  // Validation
  const mandateNameOk = mandateName.trim().length >= 2;
  const canSave = !!mandatorType && !!mandatorId && mandateNameOk;

  /* Reset when closed */
  useEffect(() => {
    if (!isOpen) {
      setMandatorType(initialMandatorType ?? "");
      setMandatorId(initialMandatorId ?? "");
      setMandateName("");
      setMandateDesc("");
      setOptions([]);
      setLoadingOpts(false);
      setQuery(initialMandatorName ?? "");
      setOpenMenu(false);
      setActiveIndex(-1);
    }
  }, [isOpen, initialMandatorType, initialMandatorId, initialMandatorName]);

  /* Load options when a type is chosen */
  useEffect(() => {
    if (!isOpen || !mandatorType) return;

    setLoadingOpts(true);
    const endpoint = TYPE_ENDPOINT[mandatorType];

    const pick = (r: any): Option[] => {
      const d = r?.data;
      if (Array.isArray(d)) return d;
      if (d?.items && Array.isArray(d.items)) return d.items;
      return [];
    };

    api
      .get(endpoint)
      .then((r) => {
        const rows = pick(r);
        setOptions(rows);

        // If we have just an ID (no label yet), hydrate the visible label from options
        if (initialMandatorId && !initialMandatorName) {
          const hit = rows.find((o) => o.id === initialMandatorId);
          if (hit) setQuery(hit.name);
        }

        // If the initial ID isn't in this page but we have its name, inject so it shows up
        if (
          initialMandatorId &&
          initialMandatorName &&
          !rows.some((o) => o.id === initialMandatorId)
        ) {
          setOptions((prev) => [
            { id: initialMandatorId, name: initialMandatorName },
            ...prev,
          ]);
        }
      })
      .catch(() => setOptions([]))
      .finally(() => setLoadingOpts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mandatorType]);

  /* Changing type clears selection & query */
  function handleTypeChange(next: MandatorType | "") {
    setMandatorType(next);
    setMandatorId("");
    setQuery("");
    setOptions([]);
    setOpenMenu(false);
    setActiveIndex(-1);
  }

  /* Filter options by query */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  /* Select an option */
  function selectOption(opt: Option) {
    setMandatorId(opt.id);
    setQuery(opt.name);
    setOpenMenu(false);
    setActiveIndex(-1);
  }

  /* Keyboard handling for combobox */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!openMenu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpenMenu(true);
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (openMenu && activeIndex >= 0 && activeIndex < filtered.length) {
        e.preventDefault();
        selectOption(filtered[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpenMenu(false);
      setActiveIndex(-1);
    }
  }

  /* Click outside to close */
  useEffect(() => {
    function handleDocClick(ev: MouseEvent) {
      if (!comboRef.current) return;
      if (!comboRef.current.contains(ev.target as Node)) {
        setOpenMenu(false);
        setActiveIndex(-1);
      }
    }
    if (openMenu) {
      document.addEventListener("mousedown", handleDocClick);
      return () => document.removeEventListener("mousedown", handleDocClick);
    }
  }, [openMenu]);

  /* Gentle blur so menu clicks register */
  function onBlur() {
    if (blurTimeoutRef.current) window.clearTimeout(blurTimeoutRef.current);
    blurTimeoutRef.current = window.setTimeout(() => {
      setOpenMenu(false);
      setActiveIndex(-1);
    }, 120);
  }
  function onFocus() {
    if (blurTimeoutRef.current) window.clearTimeout(blurTimeoutRef.current);
  }

  /* Save */
  async function handleSave() {
    if (!canSave) return;
    try {
      await api.post("/mandates", {
        company_type: mandatorType,
        company_id: mandatorId,
        name: mandateName.trim(),
        description: mandateDesc.trim() || null,
        status: "active", // per spec
      });
      onClose();
    } catch {
      alert("Failed to create mandate");
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Create mandate" staticBackdrop>
      <h2 className="text-2xl font-semibold mb-4">Create Mandate</h2>

      {/* Mandator Type */}
      <label style={{ display: "block", marginBottom: 12 }}>
        Mandator Type
        <select
          value={mandatorType}
          onChange={(e) => handleTypeChange(e.target.value as MandatorType | "")}
          style={{ marginLeft: 8 }}
        >
          <option value="">— choose —</option>
          <option value="tv_network">TV Network</option>
          <option value="studio">Studio</option>
          <option value="production_company">Production Company</option>
          <option value="creative">Creative</option>
        </select>
      </label>

      {/* Mandator Name — single searchable dropdown (combobox) */}
      {mandatorType && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>{TYPE_LABEL[mandatorType]} Name</div>

          <div
            ref={comboRef}
            style={{ position: "relative", width: "70%" }}
            onFocus={onFocus}
            onBlur={onBlur}
          >
            <input
              role="combobox"
              aria-expanded={openMenu}
              aria-autocomplete="list"
              aria-controls="mandator-listbox"
              aria-activedescendant={
                openMenu && activeIndex >= 0 ? `mandator-opt-${activeIndex}` : undefined
              }
              placeholder={loadingOpts ? "Loading options…" : "Start typing…"}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpenMenu(true);
                setActiveIndex(0);
                setMandatorId(""); // clear selection until confirmed
              }}
              onKeyDown={onKeyDown}
              onClick={() => setOpenMenu(true)}
              style={{ width: "100%" }}
            />

            {openMenu && (
              <ul
                id="mandator-listbox"
                role="listbox"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  maxHeight: 220,
                  overflowY: "auto",
                  border: "1px solid #ddd",
                  background: "#fff",
                  zIndex: 1000,
                  margin: 0,
                  padding: 0,
                  listStyle: "none",
                }}
              >
                {loadingOpts && (
                  <li
                    id="mandator-opt-loading"
                    role="option"
                    aria-selected="false"
                    aria-disabled="true"
                    style={{ padding: "6px 8px", color: "#666", pointerEvents: "none" }}
                  >
                    Loading…
                  </li>
                )}

                {!loadingOpts && filtered.length === 0 && (
                  <li
                    id="mandator-opt-empty"
                    role="option"
                    aria-selected="false"
                    aria-disabled="true"
                    style={{ padding: "6px 8px", color: "#666", pointerEvents: "none" }}
                  >
                    No matches
                  </li>
                )}

                {!loadingOpts &&
                  filtered.map((opt, idx) => {
                    const active = idx === activeIndex;
                    return (
                      <li
                        id={`mandator-opt-${idx}`}
                        key={opt.id}
                        role="option"
                        aria-selected={active}
                        className="clickable"
                        onMouseDown={(e) => {
                          e.preventDefault(); // keep input from blurring
                          selectOption(opt);
                        }}
                        onMouseEnter={() => setActiveIndex(idx)}
                        style={{
                          padding: "6px 8px",
                          background: active ? "#eef5ff" : "#fff",
                          cursor: "pointer",
                        }}
                        title={opt.name}
                      >
                        {opt.name}
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>

          {/* Current selection helper */}
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
            {mandatorId ? "Selected" : "Not selected"}{" "}
            {mandatorId && <span style={{ color: "#000" }}>– {query}</span>}
          </div>
        </div>
      )}

      {/* Mandate Name */}
      <label style={{ display: "block", marginTop: 12 }}>
        Mandate Name
        <input
          value={mandateName}
          onChange={(e) => setMandateName(e.target.value)}
          style={{ marginLeft: 8, width: "70%" }}
          placeholder="Short name…"
        />
      </label>

      {/* Mandate Description */}
      <label style={{ display: "block", marginTop: 12 }}>
        Mandate Description
        <textarea
          value={mandateDesc}
          onChange={(e) => setMandateDesc(e.target.value)}
          style={{ marginLeft: 8, width: "100%", minHeight: 120 }}
          placeholder="Describe the mandate…"
        />
      </label>

      {/* Actions */}
      <div
        style={{
          marginTop: 24,
          display: "flex",
          justifyContent: "flex-end",
          gap: 12,
        }}
      >
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
