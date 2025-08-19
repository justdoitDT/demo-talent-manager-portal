// frontend/src/components/SearchDropdown.tsx

import React, { CSSProperties, useEffect, useMemo, useRef, useState } from "react";

export interface Option {
  id: string;
  label: string;
  group?: string;     // optional section header
}

interface Props {
  placeholder?: string;
  disabled?: boolean;
  fetchOptions: (q: string) => Promise<Option[]>;
  onSelect: (o: Option) => void;
  /** "alpha" (default), "none", or an explicit ordered array of group names */
  groupSort?: "alpha" | "none" | string[];
  /** style applied to the outer box (lets callers pass width, etc.) */
  style?: CSSProperties;
  /** convenience alias for width in px (overrides minWidth / style.width) */
  width?: number | string;
}

export function SearchDropdown({
  placeholder,
  disabled = false,
  fetchOptions,
  onSelect,
  groupSort = "alpha",
  style,
  width,
}: Props) {
  /* ───────────── state ───────────── */
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState("");
  const [opts, setOpts]       = useState<Option[]>([]);

  /* ───────────── close on outside‑click ───────────── */
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  /* ───────────── debounce + fetch ───────────── */
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      fetchOptions(query).then(setOpts).catch(console.error);
    }, 250);
    return () => clearTimeout(id);
  }, [open, query, fetchOptions]);

  /* ───────────── group map & key order ───────────── */
  const { map, keys } = useMemo(() => {
    const m = new Map<string, Option[]>();
    for (const o of opts) {
      const g = o.group ?? "";                  // "" = un‑grouped bucket
      (m.get(g) ?? m.set(g, []).get(g)!).push(o);
    }

    let k: string[];
    if (Array.isArray(groupSort)) {
      const explicit = groupSort.filter(g => m.has(g));
      const rest     = Array.from(m.keys()).filter(g => !explicit.includes(g));
      k = [...explicit, ...rest];
    } else if (groupSort === "alpha") {
      k = Array.from(m.keys()).sort((a, b) => {
        if (a === "") return  1;                // empty key → last
        if (b === "") return -1;
        return a.localeCompare(b);
      });
    } else {
      k = Array.from(m.keys());                 // "none"
    }
    return { map: m, keys: k };
  }, [opts, groupSort]);

  /* ───────────── render ───────────── */
  return (
    <div
      ref={boxRef}
      style={{
        position: "relative",
        display:  "inline-block",
        minWidth: width ?? 250,
        ...(style ?? {}),
      }}
    >
      <input
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : ""}
        onFocus={() => !disabled && setOpen(true)}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => e.key === "Escape" && setOpen(false)}
        style={{ width: "100%" }}
      />

      {/* dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            maxHeight: 300,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #ccc",
            zIndex: 99,
          }}
        >
          {keys.map(g => (
            <div key={g || "__nogroup"}>
              {/* group header – skip if single un‑grouped list */}
              <div
                style={{
                  padding: "4px 6px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: "#f6f6f6",
                  display: g === "" && map.size === 1 ? "none" : "block",
                }}
              >
                {g || "Other"}
              </div>

              {map.get(g)!.map(o => (
                <div
                  key={o.id}
                  onClick={() => { onSelect(o); setOpen(false); }}
                  style={{
                    padding:      "6px 8px",
                    cursor:       "pointer",
                    color:        o.id === "__new__" ? "#666" : undefined,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.background = "#000";
                    (e.currentTarget as HTMLDivElement).style.color      = "#fff";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.background = "";
                    (e.currentTarget as HTMLDivElement).style.color      = o.id === "__new__" ? "#666" : "";
                  }}
                >
                  {o.label}
                </div>
              ))}
            </div>
          ))}

          {opts.length === 0 && (
            <div style={{ padding: 8, fontSize: 12 }}>No matches</div>
          )}
        </div>
      )}
    </div>
  );
}
