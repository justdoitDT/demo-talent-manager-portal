// frontend/src/modals/CreateSubModal.tsx

import React, {
  useState,
  useEffect,
  useCallback,
} from "react";
import { Modal } from "./Modal";
import api from "../services/api";
import AddPersonToDatabaseModal from "./AddPersonToDatabaseModal";
import AddCompanyToDatabaseModal from "./AddCompanyToDatabaseModal";
import AttachNeedsModal from "./AttachNeedsModal";

const AddProjectModal = (p: { isOpen: boolean; onClose: () => void }) => null;
const AddMandateModal = (p: { isOpen: boolean; onClose: () => void }) => null;



/* ────────────────────────────────────────────────────────────────
 * Common tiny widgets (very lightweight – no external deps)
 * ────────────────────────────────────────────────────────────────*/
interface Option {
  id:    string;
  label: string;      // ← 1st line: “qualifications”
  group?: string;
  description?: string;   // ← 2nd line (need-only)
}

/** Searchable dropdown that supports optional grouping */
export function SearchDropdown({
  placeholder,
  disabled = false,
  fetchOptions,
  onSelect,
  groupSort = "alpha",            // "alpha" | "none" | explicit string[]
}: {
  placeholder?: string;
  disabled?: boolean;
  fetchOptions: (q: string) => Promise<Option[]>;
  onSelect: (o: Option) => void;
  groupSort?: "alpha" | "none" | string[];
}) {
  const [open,  setOpen]  = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [opts,  setOpts]  = React.useState<Option[]>([]);

  /* ── outside‑click closes ── */
  const boxRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  /* ── 250 ms debounce fetch ── */
  React.useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      fetchOptions(query).then(setOpts).catch(console.error);
    }, 250);
    return () => clearTimeout(id);
  }, [open, query, fetchOptions]);

  /* ── build Map<group,Option[]> + key ordering ── */
  const { map, keys } = React.useMemo(() => {
    const m = new Map<string, Option[]>();
    for (const o of opts) {
      const g = o.group ?? "";                       // "" ⇒ un‑grouped bucket
      (m.get(g) ?? m.set(g, []).get(g)!).push(o);
    }

    let k: string[];
    if (Array.isArray(groupSort)) {
      const explicit = groupSort.filter((g) => m.has(g));
      const rest     = Array.from(m.keys()).filter((g) => !explicit.includes(g));
      k = [...explicit, ...rest];
    } else if (groupSort === "alpha") {
      k = Array.from(m.keys()).sort((a, b) => {
        if (a === "") return  1;                      // un‑grouped → last
        if (b === "") return -1;
        return a.localeCompare(b);
      });
    } else {
      k = Array.from(m.keys());                      // "none"
    }
    return { map: m, keys: k };
  }, [opts, groupSort]);

  /* ── render ── */
  return (
    <div
      ref={boxRef}
      style={{ position: "relative", display: "inline-block", minWidth: 250 }}
    >
      <input
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : ""}
        onFocus={() => !disabled && setOpen(true)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        style={{ width: "100%" }}
      />

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
          {keys.map((g) => (
            <div key={g || "__nogroup"}>
              {/* group header – empty key ⇒ “Other” */}
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

              {map.get(g)!.map((o) => (
                <div
                  key={o.id}
                  style={{ padding: "6px 8px", cursor: "pointer" }}
                  onClick={() => { onSelect(o); setOpen(false); }}
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


/* ───────── Chip helpers (universal) ───────── */
interface ChipItem {
  id: string;
  label: string;          // first row
  description?: string;   // optional second row  (only “need” chips have it)
}

function Chip({
  item,
  onRemove,
}: {
  item: ChipItem;
  onRemove: (id: string) => void;
}) {
  const isNeed = !!item.description;
  const [hover, setHover] = useState(false);          // ← track hover

  /* top | right | bottom | left */
  const pad = isNeed ? "4px 24px 6px 8px" : "2px 24px 2px 6px";

  return (
    <span
      style={{
        position: "relative",
        padding: pad,
        background: "#eee",
        borderRadius: 4,
        fontSize: 12,
        display: "inline-flex",
        flexDirection: "column",
        maxWidth: 260,
        lineHeight: 1.25,
      }}
    >
      {/* first line */}
      <span style={{ fontWeight: isNeed ? 600 : 400 }}>{item.label}</span>

      {/* optional second line */}
      {isNeed && item.description && (
        <span style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>
          {item.description}
        </span>
      )}

      {/* delete “×” */}
      <span
        style={{
          position: "absolute",
          top: 2,
          right: 4,
          width: 16,
          height: 16,
          lineHeight: "16px",
          textAlign: "center",
          borderRadius: 3,
          cursor: "pointer",
          userSelect: "none",
          transition: "all 120ms ease",
          background: hover ? "#000" : "transparent",
          color:       hover ? "#fff" : "inherit",
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => onRemove(item.id)}
      >
        ×
      </span>
    </span>
  );
}

function ChipList({ items, onRemove }:{
  items:ChipItem[]; onRemove:(id:string)=>void;
}) {
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
      {items.map(it=>(
        <Chip key={it.id} item={it} onRemove={onRemove}/>
      ))}
    </div>
  );
}

/* ─────────helper───────────*/
const asArray = (x: any) => (Array.isArray(x) ? x : (x?.items ?? x?.results ?? []));

/* ────────────────────────────────────────────────────────────────
 * Types & props
 * ────────────────────────────────────────────────────────────────*/
export type IntentPrimary =
  | "staffing"
  | "sell_project"
  | "recruit_talent"
  | "general_intro"
  | "other"
  | null;
interface InitialSubData {
  creativeIds?: string[];
  projectId?: string;
  projectNeedId?: string;
  mandateIds?: string[];
  recipientIds?: { id: string; type: "executive" | "external_rep" | "creative" }[];
  managerIds?: string[];
  writingSampleIds?: string[];
  intentPrimary?: IntentPrimary;
}
interface Props {
  isOpen: boolean;
  onClose: () => void;
  initial?: InitialSubData;
}
interface RecipientOption extends Option {
  rtype: "executive" | "external_rep" | "creative";
  companyId: string | null;
}

/* ────────────────────────────────────────────────────────────────
 * Main component
 * ────────────────────────────────────────────────────────────────*/
export default function CreateSubModal({ isOpen, onClose, initial }: Props) {
  /* ── wizard control ── */
  const [step, setStep] = useState(0);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const bump = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));

  /* ── nested‑modal flags ── */
  const [showAddPerson, setShowAddPerson] = useState<"creative" | "executive" | "external_rep" | null>(null);
  const [showAddCompany, setShowAddCompany] = useState<"network" | "studio" | "prodco" | "agency" | null>(null);
  const [showProj, setShowProj] = useState(false);
  const [showMandate, setShowMandate] = useState(false);
  const [needsModalOpen,setNeedsModalOpen] = useState(false);

  /* ── core state ── */
  const [intent, setIntent] = useState<IntentPrimary>(initial?.intentPrimary ?? null);
  const [creatives, setCreatives] = useState<Option[]>([]);
  const [sampleOptions, setSampleOptions] = useState<Option[]>([]);
  const [selectedSamples, setSelectedSamples] = useState<Option[]>([]);
  const [project, setProject] = useState<Option | null>(null);
  const [need,  setNeed ] = useState<Option | null>(null);
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [mandates, setMandates] = useState<Option[]>([]);
  const [mandateOptions, setMandateOptions] = useState<Option[]>([]);
  const [managers, setManagers] = useState<Option[]>([]);

  const [needOptions, setNeedOptions] = useState<Option[]>([]);
  // function onNeedModalSaved(newNeed: Option) {
  //   /* ①  add the brand-new need to the dropdown cache (dedup) */
  //   setNeedOptions(prev =>
  //     prev.some(o => o.id === newNeed.id) ? prev : [...prev, newNeed],
  //   );
  
  //   /* ②  immediately select it */
  //   setNeed(newNeed);
  
  //   setNeedsModalOpen(false);
  // }

  const [companyContext, setCompanyContext] = useState<{
    networks: any[];
    studios: any[];
    prodcos: any[];
  } | null>(null);


  /* ── step-ahead pre-fetching ── */
  const [creativeMaster, setCreativeMaster] = useState<any[]>([]);
  const [projectMaster,  setProjectMaster]  = useState<any[]>([]);
  const [execMaster,     setExecMaster]     = useState<any[]>([]);
  const [managerMaster, setManagerMaster] = useState<any[]>([]);
  const [repMaster] = useState<any[]>([]);
  // const [repMaster, setRepMaster] = useState<any[]>([]);
  // caches that DO NOT trigger re-renders
  const creativeCacheRef = React.useRef<any[] | null>(null);
  const projectCacheRef  = React.useRef<any[] | null>(null);
  const execCacheRef     = React.useRef<any[] | null>(null);
  const managerCacheRef  = React.useRef<any[] | null>(null);


  /* ─── reset form on close helpers ─── */
  const resetForm = React.useCallback(() => {
    setStep(0);
    setSubmitAttempted(false);
    setSaving(false);
    setErrors({});
    /* core fields */
    setIntent(initial?.intentPrimary ?? null);
    setCreatives([]);
    setSelectedSamples([]);
    setProject(null);
    setNeed(null);
    setRecipients([]);
    setMandates([]);
    setManagers([]);
    setCompanyContext(null);
    /* if you cache dropdown masters, clear them too if you prefer */
  }, [initial]);
  /* ─── whenever the modal is (re)opened or fully closed ─── */
  useEffect(() => {
    if (isOpen) {
      /* ↻ start fresh every time user opens the modal */
      resetForm();
    }
  }, [isOpen, resetForm]);

  

  /* ────────────────────────────────────────────────────────────
   *  Auto‑populate on open (creatives / managers / etc.)
   * ────────────────────────────────────────────────────────────*/
  useEffect(() => {
    if (!isOpen) return;

    /* ── pre‑populate creatives ── */
    if (initial?.creativeIds?.length) {
      Promise.all(initial.creativeIds.map((id: string) => api.get(`/creatives/${id}`)))
        .then((res) =>
          setCreatives(res.map((r) => ({ id: r.data.id, label: r.data.name })))
        )
        .catch(console.error);
    }

    /* ── pre‑populate project (NEW) ── */
    if (initial?.projectId) {
      (async () => {
        try {
          const { data } = await api.get(`/projects/${initial.projectId}`);
          setProject({
            id:    data.id,
            label: `${data.title}${data.year ? ` (${data.year})` : ''}`,
          });
        } catch (err) {
          console.error('Failed to pre‑load project', err);
        }
      })();
    }
  }, [isOpen, initial?.creativeIds, initial?.projectId]);

  /* ────────────────────────────────────────────────────────────
  * Background prefetch → refs (no re-render)
  * ────────────────────────────────────────────────────────────*/
  useEffect(() => {
    if (!isOpen) return;
    const ac = new AbortController();
    (async () => {
      try {
        const { data } = await api.get("/creatives?limit=500", { signal: ac.signal });
        creativeCacheRef.current = data;
      } catch (err: any) {
        if (err?.name !== "CanceledError" && err?.message !== "canceled") console.error(err);
      }
    })();
    return () => ac.abort();
  }, [isOpen]);

  useEffect(() => {
    if (step < 1) return;
    const ac = new AbortController();
    (async () => {
      try {
        const { data } = await api.get("/projects?limit=500", { signal: ac.signal });
        projectCacheRef.current = data;
      } catch (err: any) {
        if (err?.name !== "CanceledError" && err?.message !== "canceled") console.error(err);
      }
    })();
    return () => ac.abort();
  }, [step]);

  useEffect(() => {
    if (step < 2) return;
    const ac = new AbortController();
    (async () => {
      try {
        const { data } = await api.get("/executives?limit=500", { signal: ac.signal });
        execCacheRef.current = data;
      } catch (err: any) {
        if (err?.name !== "CanceledError" && err?.message !== "canceled") console.error(err);
      }
    })();
    return () => ac.abort();
  }, [step]);

  useEffect(() => {
    if (step < 3 || managerCacheRef.current) return;
    const ac = new AbortController();
    (async () => {
      try {
        const { data } = await api.get(
          "/managers?role=manager&status=Active&limit=500",
          { signal: ac.signal }
        );
        managerCacheRef.current = data;
      } catch (err: any) {
        if (err?.name !== "CanceledError" && err?.message !== "canceled") console.error(err);
      }
    })();
    return () => ac.abort();
  }, [step]);

  /* ────────────────────────────────────────────────────────────
  * Hydrate state when a step becomes visible (single setState)
  * ────────────────────────────────────────────────────────────*/
  useEffect(() => {
    if (step === 1 && creativeMaster.length === 0 && creativeCacheRef.current) {
      setCreativeMaster(creativeCacheRef.current);
    }
  }, [step, creativeMaster.length]);

  useEffect(() => {
    if (step === 2 && projectMaster.length === 0 && projectCacheRef.current) {
      setProjectMaster(projectCacheRef.current);
    }
  }, [step, projectMaster.length]);

  useEffect(() => {
    if (step === 3 && execMaster.length === 0 && execCacheRef.current) {
      setExecMaster(execCacheRef.current);
    }
  }, [step, execMaster.length]);

  useEffect(() => {
    if (step === 4 && managerMaster.length === 0 && managerCacheRef.current) {
      setManagerMaster(managerCacheRef.current);
    }
  }, [step, managerMaster.length]);



  /* ── whenever creatives list changes, auto‑fetch managers & samples ── */
  useEffect(() => {
    if (!creatives.length) return;
    // managers (via creative detail which includes managers)
    Promise.all(creatives.map((c) => api.get(`/creatives/${c.id}`)))
      .then((res) => {
        const uniq: Record<string, string> = {};
        res.forEach((r) => {
          (r.data.managers || []).forEach((m: any) => (uniq[m.id] = m.name));
        });
        setManagers(Object.entries(uniq).map(([id, label]) => ({ id, label })));
      })
      .catch(console.error);

    // writing samples for all creatives (dedupe)
    Promise.all(creatives.map((c) => api.get(`/creatives/${c.id}/samples`)))
      .then((res) => {
        const list: any[] = [];
        res.forEach((r) => list.push(...r.data));
        const seen = new Set<string>();
        const opts: Option[] = list
        .filter((ws) => {
          if (seen.has(ws.id)) return false;
          seen.add(ws.id);
          return true;
        })
        .map((ws) => ({
          id:    ws.id,
          label: ws.filename,
          group: ws.projects?.[0]?.title      // project‑attached
                 ?? creatives[0]?.label       // else group by first creative
                 ?? "Other",
        }));
        setSampleOptions(opts)
      })
      .catch(console.error);
  }, [creatives]);

  /* ── when project chosen → fetch needs + auto‑populate recipients ── */
  useEffect(() => {
    if (!project) return;
    // needs
    api
      .get(`/projects/${project.id}/needs`)
      .then((r) => {
        setNeed(null);
        setNeedOptions(
            r.data.map((n: any) => ({
              id:           n.id,
              label:        n.qualifications,         // ← plain
              description:  n.description ?? '',
            }))
          );
      })
      .catch(console.error);

    // project executives + linked companies
    api.get(`/projects/${project.id}/executives`).then((r) => {
      const execs: RecipientOption[] = r.data.map((e: any) => {
        const companyId =
          e.tv_networks?.[0]?.id ??
          e.studios?.[0]?.id ??
          e.production_companies?.[0]?.id ??
          null;
    
        return {
          id:   e.id,
          label:e.name,
          group:"Attached to Project",
          rtype:"executive",
          companyId,
        } as RecipientOption;
      });
    
      // de‑dup against anything the user already added
      setRecipients((old) => [
        ...execs.filter(ex => !old.some(o => o.id === ex.id && o.rtype === "executive")),
        ...old,
      ]);
    });

    api
      .get(`/projects/${project.id}/companies`)
      .then((r) => setCompanyContext(r.data))
      .catch(console.error);
  }, [project]);


  /* ── once we know the companies → pre‑fetch ALL execs at those companies ─ */
  useEffect(() => {
    if (!companyContext) return;
  
    (async () => {
      const companies = [
        ...companyContext.networks,
        ...companyContext.studios,
        ...companyContext.prodcos,
      ];
  
      const fetched: any[] = [];
      for (const c of companies) {
        const { data } = await api.get(`/executives/company/${c.id}`);
        const list = asArray(data);
        fetched.push(...list.map((e: any) => ({ ...e, _companyName: c.name })));
      }
  
      /* merge with the old cache without mutating it */
      setExecMaster(prev => {
        const seen = new Set(prev.map((e: any) => e.id));
        return [...prev, ...fetched.filter(e => !seen.has(e.id))];
      });
    })();
  }, [companyContext]);
  

  /* ────────────────────────────────────────────
   *  dynamic option builders
   * ────────────────────────────────────────────*/

    /*  Mandate dropdown options
    – gather every unique companyId on exec‑recipients
    – resolve companyId → companyName (from project context or quick GET)
    – fetch mandates and group them by the *name*, not the id              */
    useEffect(() => {
      // ── 1. figure‑out which companies we need mandates for ────────────────
      const execRecs   = recipients.filter(r => r.rtype === "executive" && r.companyId);
      const companyIds = Array.from(new Set(execRecs.map(r => r.companyId!)));
    
      if (!companyIds.length) {
        setMandateOptions([]);
        return;
      }
    
      // ── 2. build id → name map  (use whatever info we already have) ───────
      const id2name: Record<string,string> = {};
    
      if (companyContext) {
        companyContext.networks.forEach(n =>  id2name[n.id]   = n.name);
        companyContext.studios.forEach(s  =>  id2name[s.id]   = s.name);
        companyContext.prodcos.forEach(p  =>  id2name[p.id]   = p.name);
      }
    
      // any ids still missing a name?  grab them once from /companies/<id>
      const unresolved = companyIds.filter(cid => !id2name[cid]);
      const fetchNames = unresolved.length
        ? Promise.all(
            unresolved.map(async cid => {
              const { data } = await api.get(`/companies/${cid}`); // tiny helper endpoint
              id2name[cid] = data.name;
            })
          )
        : Promise.resolve();
    
      // ── 3. after we know all the names, pull mandates per company ─────────
      (async () => {
        await fetchNames;
    
        const all: Option[] = [];
        for (const cid of companyIds) {
          const { data } = await api.get("/mandates", { params: { company_id: cid } });
          const list = asArray(data);
          all.push(
            ...list.map((m: any) => ({
              id: m.id,
              label: m.name,
              group: id2name[cid],
            }))
          );
        }
        setMandateOptions(all);
      })();
    }, [recipients, companyContext]);

  const fetchCreativeOptions = useCallback(
    async (q: string) => {
      /* prefer cached list */
      if (creativeMaster.length) {
        return creativeMaster
          .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
          .map((c) => ({ id: c.id, label: c.name }));
      }
      /* fall‑back remote search */
      const { data } = await api.get("/creatives", { params: { q } });
      return data.map((c: any) => ({ id: c.id, label: c.name }));
    },
    [creativeMaster]
  );

  const fetchProjectOptions = useCallback(
    async (q: string): Promise<Option[]> => {
      const qlc = q.trim().toLowerCase();
  
      /* ---------- (0) master cache ---------- */
      if (projectMaster.length) {
        return projectMaster
          .filter((p) => p.title.toLowerCase().includes(qlc))
          .map((p) => ({
            id:    p.id,
            label: `${p.title}${p.year ? ` (${p.year})` : ""}`,
            group: p.personal ? "Personal Projects"
                 : p.credit   ? "Credits"
                 : "Other Projects",
          }));
      }
  
      /* ---------- (1) personal + credits (1st creative only) ---------- */
      let personal: Option[] = [];
      let credits : Option[] = [];
  
      if (creatives.length) {
        const cid = creatives[0].id;
  
        /* hit both endpoints in parallel */
        const [persResp, creditResp] = await Promise.all([
          api.get(`/creatives/${cid}/personal-projects`),
          api.get(`/creatives/${cid}/projects`),
        ]);
  
        personal = persResp.data.map((p: any) => ({
          id: p.id,
          label: `${p.title}${p.year ? ` (${p.year})` : ""}`,
          group: "Personal Projects",
        }));
  
        const personalIds = new Set(personal.map((p) => p.id));
        credits  = creditResp.data
          .filter((r: any) => r.project_title && !personalIds.has(r.project_id))
          .map((r: any) => ({
            id: r.project_id,
            label: `${r.project_title}${r.year ? ` (${r.year})` : ""}`,
            group: "Credits",
          }));
      }
  
      /* ---------- (2) global fallback ---------- */
      const { data } = await api.get("/projects", { params: { q, limit: 20 } });
      const global: Option[] = data.items.map((p: any) => ({
        id:    p.id,
        label: `${p.title}${p.year ? ` (${p.year})` : ""}`,
        group: "Other Projects",
      }));
  
      /* ---------- (3) merge ---------- */
      return [...personal, ...credits, ...global];
    },
    [creatives, projectMaster]
  );

  const fetchRecipientOptions = useCallback(
    async (
      q: string,
      type: "executive" | "external_rep" | "creative"
    ): Promise<Option[]> => {
  
      /* ------------------------------------------------ execs */
      if (type === "executive") {
        const out: Option[] = [];
        const seen = new Map<string, Option>();         // id → option you’ve stored
        const qlc  = q.trim().toLowerCase();

        /* 1️⃣ master cache – add EVERYTHING (even if it ends up “Other”) */
        execMaster.forEach((e: any) => {
          if (!qlc || e.name.toLowerCase().includes(qlc)) {
            const opt = {
              id:    e.id,
              label: e.name,
              group: e._companyName ?? "Other",
            };
            seen.set(e.id, opt);
            out.push(opt);
          }
        });

        /* 2️⃣ company‑context execs – overwrite group when we have the name */
        if (companyContext) {
          const companies = [
            ...companyContext.networks,
            ...companyContext.studios,
            ...companyContext.prodcos,
          ];

          for (const c of companies) {
            const { data } = await api.get(`/executives/company/${c.id}`);
            const list = asArray(data);
          
            list.forEach((e: any) => {
              if (!qlc || e.name.toLowerCase().includes(qlc)) {
                const opt = { id: e.id, label: e.name, group: c.name };
          
                if (seen.has(e.id)) {
                  const idx = out.findIndex((o) => o.id === e.id);
                  if (idx !== -1) out[idx] = opt;
                } else {
                  out.unshift(opt);
                }
                seen.set(e.id, opt);
              }
            });
          }
        }

        /* 3️⃣ remote fallback only if we found nothing at all */
        if (!out.length) {
          const { data } = await api.get("/executives", { params: { q, limit: 15 } });
          data.forEach((e: any) =>
            out.push({ id: e.id, label: e.name })        // un‑grouped
          );
        }

        return out;
      }
  
      /* ------------------------------------------------ reps */
      if (type === "external_rep") {
        const out: Option[] = [];
        const seen = new Set<string>();
        const qlc  = q.trim().toLowerCase();
  
        /* cached reps */
        if (repMaster.length) {
          repMaster.forEach((r) => {
            if (!qlc || r.name.toLowerCase().includes(qlc)) {
              seen.add(r.id);
              out.push({ id: r.id, label: r.name });
            }
          });
        }
  
        /* reps linked to selected creatives */
        for (const c of creatives) {
          const { data } = await api.get(`/creatives/${c.id}`);
          (data.reps ?? []).forEach((r: any) => {
            if (!seen.has(r.id) && (!qlc || r.name.toLowerCase().includes(qlc))) {
              seen.add(r.id);
              out.unshift({ id: r.id, label: r.name, group: c.label });
            }
          });
        }
  
        /* remote fallback */
        if (!out.length) {
          const { data } = await api.get("/external_reps", { params: { q, limit: 15 } });
          data.forEach((r: any) => out.push({ id: r.id, label: r.name }));
        }
        return out;
      }
  
      /* ------------------------------------------------ creatives as recipients */
      return fetchCreativeOptions(q);
    },
    [companyContext, creatives, execMaster, repMaster, fetchCreativeOptions]
  );
  

  // const fetchMandateOptions = useCallback(
  //   async (q: string) => {
  //     if (!companyContext) return [];
  //     const companies = [
  //       ...companyContext.networks,
  //       ...companyContext.studios,
  //       ...companyContext.prodcos,
  //     ];
  //     const all: Option[] = [];
  //     for (const c of companies) {
  //       const { data } = await api.get("/mandates", {
  //         params: { company_id: c.id, q },
  //       });
  //       all.push(
  //         ...data.map((m: any) => ({
  //           id: m.id,
  //           label: m.name,
  //           group: c.name,
  //         }))
  //       );
  //     }
  //     return all;
  //   },
  //   [companyContext]
  // );  

  const fetchManagerOptions = useCallback(
    async (q: string) => {
      if (managerMaster.length) {
        return managerMaster
          .filter((m) => m.name.toLowerCase().includes(q.toLowerCase()))
          .map((m) => ({ id: m.id, label: m.name }));
      }
      /* last‑chance remote */
      const { data } = await api.get("/managers", {
        params: { role: "manager", status: "Active", q },
      });
      return data.map((m: any) => ({ id: m.id, label: m.name }));
    },
    [managerMaster]
  );

  /* ────────────────────────────────────────────
   *  Validation
   * ────────────────────────────────────────────*/
  function validateCurrent(): boolean {
    const next: Record<string, string> = {};
    if (step === 0 && !intent) next.intent = "Required";
    if (step === 1 && creatives.length === 0) next.creatives = "Add creative";
    if (step === 2) {
      if (!project) next.project = "Pick project";
      if (intent !== "sell_project" && intent !== "recruit_talent" && !project)
        next.need = "Pick need";
    }
    if (step === 3 && recipients.length === 0) next.recipients = "Add recipient";
    if (step === 4 && managers.length === 0) next.managers = "Add manager";
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  const validateAll = () => {
    const errs: Record<string, string> = {};
  
    if (!intent)                       errs.intent      = "Intent";
    if (creatives.length === 0)        errs.creatives   = "Creatives";
    if (!project)                      errs.project     = "Project";
    if (
      intent !== "sell_project" &&
      intent !== "recruit_talent" &&
      !need
    )                                   errs.need        = "Need";
    if (recipients.length === 0)       errs.recipients  = "Recipients";
    if (managers.length === 0)         errs.managers    = "Managers";
  
    setErrors(errs);
  
    /* ——— extra console insight while debugging ——— */
    const ok = Object.keys(errs).length === 0;
    if (!ok) console.warn("Blocked ‑ missing fields:", errs);
    return ok;
  };

  /* ────────────────────────────────────────────
   *  Navigation handlers
   * ────────────────────────────────────────────*/
  function next() {
    setSubmitAttempted(true);
    if (!validateCurrent()) return;
    bump();
    setSubmitAttempted(false);
  }

  /* ────────────────────────────────────────────
   *  Save submission
   * ────────────────────────────────────────────*/
  async function save() {
    setSubmitAttempted(true);
    if (!validateAll()) return;             // ← will log missing keys
  
    setSaving(true);
  
    const payload = {
      project_id:         project!.id,
      intent_primary:     intent,
      project_need_id: need?.id,
      result:             "no_response",
  
      client_ids:         creatives.map((c) => c.id),
      writing_sample_ids: selectedSamples.map((s) => s.id),
      originator_ids:     managers.map((m) => m.id),
  
      recipient_rows:     recipients.map((r) => ({
        recipient_id:      r.id,
        recipient_type:    r.rtype,
        recipient_company: r.companyId,   // null → DB trigger fills in
      })),
  
      mandate_ids:        mandates.map((m) => m.id),
    };
  
    try {
      console.log("POST /subs →", payload);          // <‑‑ log request body
      await api.post("/subs", payload);
      onClose();                                     // close on 201
    } catch (err) {
      console.error("Save failed:", err);
      alert("Failed to save – please try again.");
    } finally {
      setSaving(false);
    }
  }

  /* ────────────────────────────────────────────
   *  Render helpers
   * ────────────────────────────────────────────*/
  const glow = { outline: "2px solid #e00", outlineOffset: 1 } as const;
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section style={{ marginTop: 18 }}>
      <h3 style={{ fontWeight: 600 }}>{title}</h3>
      {children}
    </section>
  );

  /* ────────────────────────────────────────────
   *  JSX by step
   * ────────────────────────────────────────────*/
  function StepZero() {
    return (
      <Section title="Primary Intent">
        <label style={submitAttempted && errors.intent ? glow : {}}>
          Intent&nbsp;
          <select value={intent ?? ""} onChange={(e) => setIntent(e.target.value as any)}>
            <option value="">— choose —</option>
            <option value="staffing">Staffing</option>
            <option value="sell_project">Sell Project</option>
            <option value="recruit_talent">Recruit Talent</option>
            <option value="general_intro">General Intro</option>
            <option value="other">Other</option>
          </select>
        </label>
      </Section>
    );
  }
  function StepOne() {
    return (
      <>
        <Section title="Client / Creative(s)">
          <SearchDropdown
            placeholder="Search creatives"
            fetchOptions={fetchCreativeOptions}
            onSelect={(o) => {
              if (creatives.some((i) => i.id === o.id)) return;
              setCreatives((prev) => [...prev, o]);
            }}
          />
          <button className="tab" style={{ marginLeft: 8 }} onClick={() => setShowAddPerson("creative")}>
            Add new Creative
          </button>
          {submitAttempted && errors.creatives && <div style={{ color: "#e00", fontSize: 12 }}>Add at least one</div>}
          <ChipList items={creatives} onRemove={(id) => setCreatives((cs) => cs.filter((c) => c.id !== id))} />
        </Section>

        <Section title="Writing Samples (optional)">
          <SearchDropdown
            placeholder={creatives.length ? "Search samples" : "Pick creatives first"}
            disabled={!creatives.length}
            fetchOptions={async (q) => {
              const hits = sampleOptions.filter((s) =>
                s.label.toLowerCase().includes(q.toLowerCase())
              );
              const withProj = project
                ? hits.filter((s) => s.group === project.label)
                : [];
              const rest = hits.filter((s) => s.group !== project?.label);
              return [...withProj, ...rest];
            }}
            onSelect={(o) => {
              if (selectedSamples.some((s) => s.id === o.id)) return; // prevent dup
              setSelectedSamples((arr) => [...arr, o]);
            }}
            groupSort="alpha"
          />
          <ChipList
            items={selectedSamples}
            onRemove={(id) =>
              setSelectedSamples((arr) => arr.filter((w) => w.id !== id))
            }
          />
        </Section>
      </>
    );
  }

  function StepTwo() {
    /* disable the Need UI in the two intent cases, or until a project is chosen */
    const needsDisabled =
      intent === "sell_project" ||
      intent === "recruit_talent" ||
      !project;
  
    return (
      <Section title="Project & Need">
        {/* ────────── Project picker ────────── */}
        <div style={{ display: "flex", gap: 12 }}>
          {project ? (
            <>
              <span>{project.label}</span>
              <button
                className="tab"
                onClick={() => {
                  setProject(null);
                  setNeed(null);            // ← clear the chosen need
                }}
              >
                Change
              </button>
            </>
          ) : (
            <SearchDropdown
              placeholder="Search projects"
              fetchOptions={fetchProjectOptions}
              onSelect={(o) => {
                setProject(o);
                setNeed(null);              // clear need for the new project
              }}
              groupSort={["Personal Projects", "Credits", "Other Projects"]}
            />
          )}

          <button className="tab" onClick={() => setShowProj(true)}>
            Add new Project
          </button>
        </div>

        {submitAttempted && errors.project && (
          <div style={{ color: "#e00", fontSize: 12 }}>Required</div>
        )}
          
        {/* ────────── Need picker (single-select) ────────── */}
        {intent !== "sell_project" && intent !== "recruit_talent" && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <SearchDropdown
                placeholder={project ? "Search needs" : "Pick project first"}
                disabled={needsDisabled}
                fetchOptions={(q) =>
                  Promise.resolve(
                    needOptions
                      .filter((o) =>
                        o.label.toLowerCase().includes(q.toLowerCase()) ||
                        o.description?.toLowerCase().includes(q.toLowerCase())
                      )
                      .sort((a, b) => a.label.localeCompare(b.label))
                      /* apply display-label:  “qualifications – description” */
                      .map((o) => ({
                        ...o,
                        label: o.description ? `${o.label} – ${o.description}` : o.label,
                      }))
                  )
                }
                onSelect={(o: any /* Option w/ description */) => setNeed(o)}
              />

              <button
                className="tab"
                onClick={() => setNeedsModalOpen(true)}
                disabled={needsDisabled}
              >
                Add new Need
              </button>
            </div>

            {/* current selection */}
            {need && (
              <ChipList
                items={[
                  {
                    id: need.id,
                    label: need.label,               // already combined above
                    description: undefined,          // no 2-line chip for single need
                  },
                ]}
                onRemove={() => setNeed(null)}
              />
            )}
          </div>
        )}
      </Section>
    );
  }

  function StepThree() {
    const [rtype, setRtype] = useState<"executive" | "external_rep" | "creative">("executive");
    return (
      <>
        <Section title="Recipients">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={rtype} onChange={(e) => setRtype(e.target.value as any)}>
              <option value="executive">Executive</option>
              <option value="external_rep">External Rep</option>
              <option value="creative">Creative</option>
            </select>

            <SearchDropdown
              placeholder="Search person"
              fetchOptions={(q) => fetchRecipientOptions(q, rtype)}
              onSelect={async (o) => {
                /* de‑dupe */
                if (recipients.some(r => r.id === o.id && r.rtype === rtype)) return;

                /* default */
                let companyId: string | null = null;

                /* only executives carry a company‑lookup */
                if (rtype === "executive") {
                  try {
                    const { data } = await api.get(`/executives/${o.id}`);   // joined‑load

                    companyId =
                      data.tv_networks?.[0]?.id ??
                      data.studios?.[0]?.id ??
                      data.production_companies?.[0]?.id ??
                      null;
                  } catch (err) {
                    console.error("exec lookup failed", err);
                  }
                }

                /* push into state exactly once */
                setRecipients(prev => [
                  ...prev,
                  {
                    ...(o as Option),
                    rtype,          // retains select value: "executive" | "external_rep" | "creative"
                    companyId,
                  } as RecipientOption,
                ]);
              }}

              groupSort={
                  companyContext
                    ? [
                        ...companyContext.networks.map(n => n.name),
                        ...companyContext.studios.map(s => s.name),
                        ...companyContext.prodcos.map(p => p.name),
                        "Other"
                      ]
                    : "alpha"
                }

            />

            <button className="tab" onClick={() => setShowAddPerson(rtype)}>
              Add new…
            </button>
          </div>

          {submitAttempted && errors.recipients && (
            <div style={{ color: "#e00", fontSize: 12 }}>Required</div>
          )}

          <ChipList
            items={recipients}
            onRemove={(id) => setRecipients((rs) => rs.filter((r) => r.id !== id))}
          />
        </Section>

        <Section title="Mandates (optional)">

          <SearchDropdown
            placeholder="Search mandates"
            disabled={!mandateOptions.length}
            fetchOptions={async (q) =>
              mandateOptions.filter((o) =>
                o.label.toLowerCase().includes(q.toLowerCase())
              )
            }
            onSelect={(o) => {
              if (mandates.some((m) => m.id === o.id)) return;
              setMandates((prev) => [...prev, o]);
            }}
          />

          <button className="tab" style={{ marginLeft: 8 }} onClick={() => setShowMandate(true)}>
            Add new Mandate
          </button>
          <ChipList items={mandates} onRemove={(id) => setMandates((m) => m.filter((x) => x.id !== id))} />
        </Section>
      </>
    );
  }
  function StepFour() {
    return (
      <Section title="Submitting Manager(s)">
        <SearchDropdown
          placeholder="Search managers"
          fetchOptions={fetchManagerOptions}
          onSelect={(o) => {
            if (managers.some((i) => i.id === o.id)) return;   // ← guard
            setManagers((prev) => [...prev, o]);
          }}
        />
        {submitAttempted && errors.managers && <div style={{ color: "#e00", fontSize: 12 }}>Required</div>}
        <ChipList items={managers} onRemove={(id) => setManagers((m) => m.filter((x) => x.id !== id))} />
      </Section>
    );
  }

  /* ────────────────────────────────────────────
   *  Main render
   * ────────────────────────────────────────────*/
  return (
    <>
      {/* helper modals */}
      <AddPersonToDatabaseModal
        isOpen={!!showAddPerson}
        initialRole={showAddPerson ?? undefined}
        onClose={() => setShowAddPerson(null)}
      />
      <AddCompanyToDatabaseModal
        isOpen={!!showAddCompany}
        initialKind={showAddCompany ?? undefined}
        onClose={() => setShowAddCompany(null)}
      />
      <AddProjectModal
        isOpen={showProj}
        onClose={() => setShowProj(false)}
      />
      <AddMandateModal
        isOpen={showMandate}
        onClose={() => setShowMandate(false)}
      />
  
      {/* ─────────── Attach-Needs modal ─────────── */}
      {needsModalOpen && project && (
        <AttachNeedsModal
          isOpen={true}
          projectId={project.id}
          initiallySelectedIds={need ? [need.id] : []}
          onClose={() => setNeedsModalOpen(false)}

          onSaved={(selected, all) => {
            setNeed(selected);              // pre-select just this one
          
            if (all) {
              setNeedOptions(prev => {
                const seen = new Set(prev.map(o => o.id));
                return [...prev, ...all.filter(o => !seen.has(o.id))];
              });
            }
          }}

        />
      )}

  
      {/* ─── main wizard modal ─── */}
      <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Create submission" staticBackdrop>
        <div style={{ minHeight: 700, overflow: "visible" }}>
          <h2 className="text-2xl font-semibold mb-4">Create New Submission</h2>
  
          {step === 0 && <StepZero />}
          {step === 1 && <StepOne />}
          {step === 2 && <StepTwo />}
          {step === 3 && <StepThree />}
          {step === 4 && <StepFour />}
  
          <div style={{ marginTop: 28, display: "flex", justifyContent: "flex-end", gap: 12 }}>
            {step > 0 && (
              <button className="tab" onClick={back}>
                Back
              </button>
            )}
            <button className="tab" onClick={onClose}>
              Cancel
            </button>
            {step < 4 ? (
              <button className="tab" onClick={next}>
                Next
              </button>
            ) : (
              <button className="tab" disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
