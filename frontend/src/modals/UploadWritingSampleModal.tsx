// frontend/src/modals/UploadWritingSampleModal.tsx

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Modal } from "./Modal";
import api from '../services/api';
import CreateProjectModal from "./CreateProjectModal";

/* ──────────── Types ──────────── */
interface CreativeMini {
  id: string;
  name: string;
}
interface ProjectMini {
  id: string;
  title: string;
}
// interface DuoMember {
//   duo_id: string;
//   creative_id: string;
//   creative_name: string;
// }
// interface CreativeProjectRole {
//   creative_id: string;
//   creative_name: string;
//   project_id: string;
//   project_title: string;
//   role: string | null;
// }
interface Props {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Close‑handler */
  onClose: () => void;
  onSaved?: () => void;
  /** If provided the modal pre‑links this creative */
  initialCreativeId?: string | null;
  /** If provided the modal pre‑links this project  */
  initialProjectId?: string | null;
}


/**
 * Overlay/modal to upload a new writing sample.  
 * – Pass either a creativeId or projectId (or both) and the corresponding list(s)
 *   are auto‑populated.  
 * – After choosing a file, description + summary fields appear.  
 * – “Generate with AI” uses /ai/summary to create a draft summary.  
 * – “Save” uploads to the server → S3 + join‑tables, then closes the modal.
 */
const UploadWritingSampleModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSaved,
  initialCreativeId,
  initialProjectId,
}) => {
  /*────────── linked creatives / projects ─────────*/
  const [linkedCreatives, setLinkedCreatives] = useState<CreativeMini[]>([]);
  const [linkedProjects, setLinkedProjects] = useState<ProjectMini[]>([]);

  /* suggested / contextual items */
  const [duoCreativesRaw, setDuoCreativesRaw] = useState<CreativeMini[]>([]);
  const [projectCreativesRaw, setProjectCreativesRaw] = useState<CreativeMini[]>([]);
  const [creativePartners, setCreativePartners] = useState<CreativeMini[]>([]);
  const [affiliatedCreatives, setAffiliatedCreatives] = useState<CreativeMini[]>([]);
  interface ProjectWithRoleMini {
    id:         string;
    title:      string;
    year?:      number | null;
    media_type?:string | null;
    status?:    string | null;
    role?:      string | null;
  }
  const [projectsFromCreativesRaw, setProjectsFromCreativesRaw] = useState<ProjectWithRoleMini[]>([]);

  /* render-ready grouped projects (alpha) */
  const [personalProjects, setPersonalProjects] = useState<ProjectMini[]>([]);
  const [creditProjects, setCreditProjects]     = useState<ProjectMini[]>([]);

  /*────────── add‑search dropdown state (same pattern as existing UI) ─────────*/
  const [addingCr, setAddingCr] = useState(false);
  const [addingPr, setAddingPr] = useState(false);
  const [searchCr, setSearchCr] = useState("");
  const [searchPr, setSearchPr] = useState("");
  const [allCreatives, setAllCreatives] = useState<CreativeMini[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectMini[]>([]);
  const [hoverCid, setHoverCid] = useState<string | null>(null);
  const [confirmCid, setConfirmCid] = useState<string | null>(null);
  const [hoverPid, setHoverPid] = useState<string | null>(null);
  const [confirmPid, setConfirmPid] = useState<string | null>(null);
  const creativeMenuRef = useRef<HTMLDivElement | null>(null);
  const projectMenuRef  = useRef<HTMLDivElement | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);

  /*────────── close dropdown on click outside ─────────*/
  useEffect(() => {
    if (!addingCr && !addingPr) return;
  
    function handleDocClick(ev: MouseEvent) {
      const target = ev.target as Node;
      // If Creative menu open and click outside both menu + Add button → close
      if (addingCr && creativeMenuRef.current && !creativeMenuRef.current.contains(target)) {
        setAddingCr(false);
      }
      // If Project menu open and click outside
      if (addingPr && projectMenuRef.current && !projectMenuRef.current.contains(target)) {
        setAddingPr(false);
      }
    }
  
    function handleEsc(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        if (addingCr) setAddingCr(false);
        if (addingPr) setAddingPr(false);
      }
    }
  
    document.addEventListener("mousedown", handleDocClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleDocClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [addingCr, addingPr]);

  /*────────── upload & form fields ─────────*/
  const [file, setFile] = useState<File | null>(null);
  const [fileDescription, setFileDescription] = useState("");
  const [summary, setSummary] = useState("");
  const [generating, setGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /*────────── validation state ─────────*/
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [errors, setErrors] = useState<{
    creatives?: string;
    projects?: string;
    file?: string;
    description?: string;
    summary?: string;
  }>({});

  /*────────── fetch initial linked ids ─────────*/
  useEffect(() => {
    if (!isOpen) return;

    async function fetchInitial() {
      try {
        if (initialCreativeId) {
          const { data } = await api.get<CreativeMini>(`/creatives/${initialCreativeId}`);
          setLinkedCreatives([data]);
        }
        if (initialProjectId) {
          const { data } = await api.get<ProjectMini>(`/projects/${initialProjectId}`);
          setLinkedProjects([data]);
        }
      } catch (err) {
        console.error("Failed to pre‑load creative/project", err);
      }
    }

    fetchInitial();
  }, [isOpen, initialCreativeId, initialProjectId]);


  /*────────── fetch duo mates for a set of creative IDs ─────────*/
  const fetchDuoMatesForCreatives = useCallback(async (creativeIds: string[]): Promise<CreativeMini[]> => {
    const seen: Record<string, CreativeMini> = {};
    await Promise.all(
      creativeIds.map(async cid => {
        try {
          const { data } = await api.get<{ duo_id: string; creative_id: string; creative_name: string; }[]>(
            `/creatives/${cid}/duos`
          );
          data.forEach(row => {
            if (creativeIds.includes(row.creative_id)) return;
            seen[row.creative_id] = { id: row.creative_id, name: row.creative_name };
          });
        } catch (err) {
          console.error("fetchDuoMatesForCreatives", err);
        }
      })
    );
    return Object.values(seen);
  }, []);

  /*────────── fetch creatives attached to a set of projects ─────────*/
  const fetchCreativesForProjects = useCallback(async (projectIds: string[]): Promise<CreativeMini[]> => {
    const seen: Record<string, CreativeMini> = {};
    await Promise.all(
      projectIds.map(async pid => {
        try {
          const { data } = await api.get<{ creative_id: string; creative_name: string; project_id: string; role: string | null; }[]>(
            `/projects/${pid}/creatives`
          );
          data.forEach(row => {
            seen[row.creative_id] = { id: row.creative_id, name: row.creative_name };
          });
        } catch (err) {
          console.error("fetchCreativesForProjects", err);
        }
      })
    );
    return Object.values(seen);
  }, []);

  /*────────── fetch projects attached to a set of creatives ─────────*/
  const fetchProjectsWithRoleForCreatives = useCallback(async (creativeIds: string[]): Promise<ProjectWithRoleMini[]> => {
    const seen: Record<string, ProjectWithRoleMini> = {};
    await Promise.all(
      creativeIds.map(async cid => {
        try {
          const { data } = await api.get<{ project_id: string; project_title: string; role: string | null; year?: number | null; media_type?: string | null; status?: string | null; }[]>(
            `/creatives/${cid}/projects_roles`
          );
          data.forEach(row => {
            const id = row.project_id;
            const prev = seen[id];
            const role = row.role;
            if (!prev) {
              seen[id] = {
                id,
                title: row.project_title,
                year: row.year ?? undefined,
                media_type: row.media_type ?? undefined,
                status: row.status ?? undefined,
                role,
              };
            } else if (role === "Creative Developer") {
              prev.role = role;
            }
          });
        } catch (err) {
          console.error("fetchProjectsWithRoleForCreatives", err);
        }
      })
    );
    return Object.values(seen);
  }, []);


  /*────────── recompute all render‑ready suggestion groups ─────────*/
  useEffect(() => {
    const linkedCreativeIds = new Set(linkedCreatives.map(c => c.id));
    const linkedProjectIds  = new Set(linkedProjects.map(p => p.id));
  
    // CREATIVE PARTNERS = duos (alpha)
    const partners = duoCreativesRaw
      .filter(c => !linkedCreativeIds.has(c.id))
      .sort((a,b) => a.name.localeCompare(b.name));
    setCreativePartners(partners);
  
    // AFFILIATED CREATIVES = project mates (exclude already linked & duplicates & any that are in partners)
    const partnerIds = new Set(partners.map(c => c.id));
    const affiliated = projectCreativesRaw
      .filter(c => !linkedCreativeIds.has(c.id) && !partnerIds.has(c.id))
      .sort((a,b) => a.name.localeCompare(b.name));
    setAffiliatedCreatives(affiliated);
  
    // PROJECT GROUPS
    const personal: ProjectMini[] = [];
    const credits:  ProjectMini[] = [];
    projectsFromCreativesRaw.forEach(p => {
      if (linkedProjectIds.has(p.id)) return;            // skip already linked
      if (p.role === "Creative Developer") personal.push(p);
      else credits.push(p);
    });
    personal.sort((a,b) => a.title.localeCompare(b.title));
    credits.sort((a,b)  => a.title.localeCompare(b.title));
    setPersonalProjects(personal);
    setCreditProjects(credits);
  }, [duoCreativesRaw, projectCreativesRaw, projectsFromCreativesRaw, linkedCreatives, linkedProjects]);
  

  /*────────── Prefetch suggestions ─────────*/
  useEffect(() => {
    if (!isOpen) return;
    const cids = linkedCreatives.map(c => c.id);
    const pids = linkedProjects.map(p => p.id);
  
    (async () => {
      const [duos, projmates, projRoles] = await Promise.all([
        cids.length ? fetchDuoMatesForCreatives(cids) : Promise.resolve([]),
        pids.length ? fetchCreativesForProjects(pids) : Promise.resolve([]),
        cids.length ? fetchProjectsWithRoleForCreatives(cids) : Promise.resolve([]),
      ]);
      setDuoCreativesRaw(duos);
      setProjectCreativesRaw(projmates);
      setProjectsFromCreativesRaw(projRoles);
    })();
  }, [
    isOpen,
    linkedCreatives,
    linkedProjects,
    fetchDuoMatesForCreatives,
    fetchCreativesForProjects,
    fetchProjectsWithRoleForCreatives,
  ]);
   


  /*────────── dropdown fetching (creatives) ─────────*/
  useEffect(() => {
    if (!addingCr) return;
    const t = setTimeout(() => {
      api
        .get<CreativeMini[]>("/creatives", {
          params: { q: searchCr || undefined, limit: 20 },
        })
        .then(r => setAllCreatives(r.data))
        .catch(console.error);
    }, 250);
    return () => clearTimeout(t);
  }, [addingCr, searchCr]);

  /*────────── dropdown fetching (projects) ─────────*/
  useEffect(() => {
    if (!addingPr) return;
    const t = setTimeout(() => {
      api
        .get<{ total: number; items: ProjectMini[] }>("/projects", {
          params: { q: searchPr || undefined, limit: 20, offset: 0 },
        })
        .then(r => setAllProjects(r.data.items))
        .catch(console.error);
    }, 250);
    return () => clearTimeout(t);
  }, [addingPr, searchPr]);


  /*────────── pluralization ─────────*/
  const projectCount  = linkedProjects.length;
  const creativeCount  = linkedCreatives.length;
  const affiliatedCreativesLabel = projectCount === 1 ? "Affiliated with Project" : "Affiliated with Projects";
  const unaffiliatedProjectsLabel =
    creativeCount === 0
      ? ""
      : creativeCount === 1
        ? "Unaffiliated with Creative"
        : "Unaffiliated with Creatives";


  /*────────── helper fns to link/unlink ─────────*/
  const linkCreative = async (cid: string) => {
    if (linkedCreatives.find(c => c.id === cid)) return; // already linked
    try {
      const { data } = await api.get<CreativeMini>(`/creatives/${cid}`);
      setLinkedCreatives(arr => [...arr, data]);
    } catch (err) { console.error(err); }
  };
  const unlinkCreative = (cid: string) => setLinkedCreatives(arr => arr.filter(c => c.id !== cid));

  const linkProject = async (pid: string) => {
    if (linkedProjects.find(p => p.id === pid)) return;
    try {
      const { data } = await api.get<ProjectMini>(`/projects/${pid}`);
      setLinkedProjects(arr => [...arr, data]);
    } catch (err) { console.error(err); }
  };
  const unlinkProject = (pid: string) => setLinkedProjects(arr => arr.filter(p => p.id !== pid));

  /*────────── AI Summary generation ─────────*/
  const generateSummary = async () => {
    if (!file) return;
    setGenerating(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await api.post<{ summary: string }>("/ai/summarize_writing_sample", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSummary(data.summary);
    } catch (err) {
      alert("Failed to generate summary");
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  /*────────── save / upload ─────────*/
  const validate = () => {
    const next: typeof errors = {};
    if (linkedCreatives.length === 0) next.creatives = 'Add at least one creative.';
    if (linkedProjects.length === 0) next.projects   = 'Add at least one project.';
    if (!file)                          next.file    = 'Choose a file.';
    if (!fileDescription.trim())        next.description = 'Enter a file description.';
    if (!summary.trim())                next.summary = 'Enter a summary.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    setSubmitAttempted(true);
    if (!validate()) {
      // don't POST; errors state drives red text & glows
      return;
      }
    if (!file) return;
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("file_description", fileDescription);
      form.append("synopsis", summary);  // backend expects 'synopsis'
      form.append("creativeIds", JSON.stringify(linkedCreatives.map(c => c.id)));
      form.append("projectIds", JSON.stringify(linkedProjects.map(p => p.id)));

      await api.post("/writing_samples", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onClose();
      onSaved?.();
    } catch (err) {
      alert("Failed to save writing sample");
      console.error(err);
    }
  };

  /*────────── close & reset when hidden ─────────*/
  useEffect(() => {
    if (!isOpen) {
      // reset state when closed
      setLinkedCreatives([]);
      setLinkedProjects([]);
      setAddingCr(false);
      setAddingPr(false);
      setSearchCr("");
      setSearchPr("");
      setAllCreatives([]);
      setAllProjects([]);
      setFile(null);
      setFileDescription("");
      setSummary("");
      setSubmitAttempted(false);
      setErrors({});
    }
  }, [isOpen]);

  /*──────────  styles  ─────────*/
  const th: React.CSSProperties = { textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" };
  const td: React.CSSProperties = { padding: 8, borderBottom: "1px solid #eee" };
  const menuBox: React.CSSProperties = { maxHeight: 240, overflowY: "auto", border: "1px solid #ddd", borderRadius: 4 };
  const pickStyle: React.CSSProperties = { padding: 8, cursor: "pointer" };
  
  const sectionHeader: React.CSSProperties = {
    fontWeight: 600,
    marginTop: 32,
    marginBottom: 8,
    borderBottom: '1px solid #ddd',
    paddingBottom: 4,
    fontSize: '1.1rem',
  };

  const invalidGlow: React.CSSProperties = {
    outline: '2px solid #e00',
    outlineOffset: 1,
    boxShadow: '0 0 0 2px rgba(255,0,0,.4)',
  };


  /*────────── render  ─────────*/
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Upload writing sample"
      staticBackdrop
    >
      <h2 className="text-2xl font-semibold mb-4">Upload Writing Sample</h2>

        {/* ───── Linked Creatives ───── */}
        <table style={{ borderCollapse: "collapse", minWidth: "40ch", width: "fit-content", marginTop: 0 }}>
          <thead>
            <tr>
              <th
                style={{
                  ...th,
                  ...(submitAttempted && errors.creatives ? invalidGlow : null),
                  position: "relative",
                }}
              >
                <span>Linked Creative{linkedCreatives.length !== 1 ? "s" : ""}</span>

                <span style={{ float: "right", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {/* Add Creative button */}
                  <button
                    className="tab"
                    style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                    onClick={() => setAddingCr(a => !a)}
                  >
                    {addingCr ? "Cancel" : "Link Creative"}
                  </button>

                  {/* nudge (non-clickable) */}
                  {creativePartners.length > 0 && (
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "#06c",
                        maxWidth: "25ch",
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={creativePartners.map(c => c.name).join(", ")}
                    >
                      {(() => {
                        const names = creativePartners.map(c => c.name);
                        return names.length <= 3
                          ? `Link ${names.join(", ")}?`
                          : `Link ${names.slice(0, 3).join(", ")} +${names.length - 3} more?`;
                      })()}
                    </span>
                  )}
                </span>
              </th>
            </tr>

            {addingCr && (
              <>
                {/* search box */}
                <tr>
                  <td style={{ padding: 8 }}>
                    <input
                      type="search"
                      placeholder="Search creatives…"
                      value={searchCr}
                      onChange={e => setSearchCr(e.target.value)}
                      style={{ width: "100%" }}
                    />
                  </td>
                </tr>

                {/* grouped results */}
                <tr>
                  <td> 
                    <div
                      ref={creativeMenuRef}
                      style={menuBox}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={   e => e.stopPropagation()}
                    >
                      {/* Creative Partners */}
                      {creativePartners.length > 0 && (
                        <>
                          <div
                            className="clickable"
                            style={{ ...pickStyle, cursor: "default", fontWeight: 600, fontSize: "0.75rem", color: "#555" }}
                          >
                            Creative Partners
                          </div>
                          {creativePartners.map(c => (
                            <div
                              key={`duo-${c.id}`}
                              className="clickable menu-item"
                              style={pickStyle}
                              onClick={() => {
                                linkCreative(c.id);
                                setAddingCr(false);
                              }}
                            >
                              {c.name}
                            </div>
                          ))}
                          <hr style={{ margin: "4px 0", border: "none", borderTop: "1px solid #ddd" }} />
                        </>
                      )}

                      {/* Affiliated with Project(s) */}
                      {affiliatedCreatives.length > 0 && (
                        <>
                          <div
                            className="clickable"
                            style={{ ...pickStyle, cursor: "default", fontWeight: 600, fontSize: "0.75rem", color: "#555" }}
                          >
                            {affiliatedCreativesLabel}
                          </div>
                          {affiliatedCreatives.map(c => (
                            <div
                              key={`projmate-${c.id}`}
                              className="clickable menu-item"
                              style={pickStyle}
                              onClick={() => {
                                linkCreative(c.id);
                                setAddingCr(false);
                              }}
                            >
                              {c.name}
                            </div>
                          ))}
                          <hr style={{ margin: "4px 0", border: "none", borderTop: "1px solid #ddd" }} />
                        </>
                      )}

                      {/* All Creatives */}
                      <div
                        className="clickable"
                        style={{ ...pickStyle, cursor: "default", fontWeight: 600, fontSize: "0.75rem", color: "#555" }}
                      >
                        All Creatives
                      </div>
                      {allCreatives.length === 0 ? (
                        <div style={{ color: "#999", padding: "4px 8px" }}>No matches</div>
                      ) : (
                        [...allCreatives]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(c => (
                            <div
                              key={`pick-${c.id}`}
                              className="clickable menu-item"
                              style={pickStyle}
                              onClick={() => {
                                linkCreative(c.id);
                                setAddingCr(false);
                              }}
                            >
                              {c.name}
                            </div>
                          ))
                      )}
                    </div>
                  </td>
                </tr>
              </>
            )}

          </thead>

          <tbody>
            {linkedCreatives.length === 0 ? (
              <tr>
                <td style={{ ...td, color: "#aaa" }}>None</td>
              </tr>
            ) : (
              linkedCreatives.map(c => (
                <tr
                  key={c.id}
                  onMouseEnter={() => setHoverCid(c.id)}
                  onMouseLeave={() => {
                    setHoverCid(null);
                    setConfirmCid(null);
                  }}
                >
                  <td style={{ ...td, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="clickable" onClick={() => {/* open creative page */}}>{c.name}</span>
                    {hoverCid === c.id && (
                      <button
                        className={`btn ${confirmCid === c.id ? "confirm-remove" : ""}`}
                        onClick={() => {
                          if (confirmCid === c.id) {
                            unlinkCreative(c.id);
                            setConfirmCid(null);
                          } else setConfirmCid(c.id);
                        }}
                      >
                        {confirmCid === c.id ? "Confirm Remove" : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Error Text */}
        {submitAttempted && errors.creatives && (
          <div style={{ color:'#e00', fontSize:12, marginTop:4 }}>{errors.creatives}</div>
        )}

        {/* Spacing */}
        <div style={{ height: 24 }} />

        {/* ───── Linked Projects (same pattern) ───── */}
        <table style={{ borderCollapse: "collapse", minWidth: "40ch", width: "fit-content", marginTop: 0 }}>
          <thead>
            <tr>              
              <th
                style={{
                  ...th,
                  ...(submitAttempted && errors.projects ? invalidGlow : null),
                }}
              >
                Linked Project{linkedProjects.length !== 1 ? "s" : ""}
                <button
                  className="tab"
                  style={{ float: "right", fontSize: "0.8rem", padding: "4px 8px" }}
                  onClick={() => setAddingPr(a => !a)}
                >
                  {addingPr ? "Cancel" : "Link Project"}
                </button>
              </th>
            </tr>

            {addingPr && (
              <>
                {/* search box */}
                <tr>
                  <td style={{ padding: 8 }}>
                    <input
                      type="search"
                      placeholder="Search projects…"
                      value={searchPr}
                      onChange={e => setSearchPr(e.target.value)}
                      style={{ width: "100%" }}
                    />
                  </td>
                </tr>

                {/* grouped results */}
                <tr>
                  <td>
                    <div
                      ref={projectMenuRef}
                      style={menuBox}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={   e => e.stopPropagation()}
                    >
                      {/* Personal Projects */}
                      {personalProjects.length > 0 && (
                        <>
                          <div
                            className="clickable"
                            style={{ ...pickStyle, cursor: "default", fontWeight: 600, fontSize: "0.75rem", color: "#555" }}
                          >
                            Personal Projects
                          </div>
                          {personalProjects.map(p => (
                            <div
                              key={`personal-${p.id}`}
                              className="clickable menu-item"
                              style={pickStyle}
                              onClick={() => {
                                linkProject(p.id);
                                setAddingPr(false);
                              }}
                            >
                              {p.title}
                            </div>
                          ))}
                          <hr style={{ margin: "4px 0", border: "none", borderTop: "1px solid #ddd" }} />
                        </>
                      )}

                      {/* Credits */}
                      {creditProjects.length > 0 && (
                        <>
                          <div
                            className="clickable"
                            style={{ ...pickStyle, cursor: "default", fontWeight: 600, fontSize: "0.75rem", color: "#555" }}
                          >
                            Credits
                          </div>
                          {creditProjects.map(p => (
                            <div
                              key={`credit-${p.id}`}
                              className="clickable menu-item"
                              style={pickStyle}
                              onClick={() => {
                                linkProject(p.id);
                                setAddingPr(false);
                              }}
                            >
                              {p.title}
                            </div>
                          ))}
                          <hr style={{ margin: "4px 0", border: "none", borderTop: "1px solid #ddd" }} />
                        </>
                      )}

                      {/* Unaffiliated w/ Creative(s) */}
                      {projectCount > 0 && (
                        <>
                          <div
                            className="clickable"
                            style={{ ...pickStyle, cursor: "default", fontWeight: 600, fontSize: "0.75rem", color: "#555" }}
                          >
                            {unaffiliatedProjectsLabel}
                          </div>
                          {allProjects.length === 0 ? (
                            <div style={{ color: "#999", padding: "4px 8px" }}>No matches</div>
                          ) : (
                            [...allProjects]
                              .filter(p => {
                                const id = p.id;
                                return (
                                  !personalProjects.some(pp => pp.id === id) &&
                                  !creditProjects.some(pp => pp.id === id) &&
                                  !linkedProjects.some(lp => lp.id === id)
                                );
                              })
                              .sort((a, b) => a.title.localeCompare(b.title))
                              .map(p => (
                                <div
                                  key={`pick-p-${p.id}`}
                                  className="clickable menu-item"
                                  style={pickStyle}
                                  onClick={() => {
                                    linkProject(p.id);
                                    setAddingPr(false);
                                  }}
                                >
                                  {p.title}
                                </div>
                              ))
                          )}
                        </>
                      )}

                      {/* Always-at-bottom: Add new project */}
                      <hr style={{ margin: "6px 0", border: "none", borderTop: "1px solid #ddd" }} />
                      <div
                        className="clickable menu-item"
                        style={{ ...pickStyle, fontWeight: 600 }}
                        onClick={() => {
                          setAddingPr(false);
                          setShowCreateProject(true);
                        }}
                      >
                        ＋ Add new project to database
                      </div>
                      
                    </div>
                  </td>
                </tr>
              </>
            )}


          </thead>

          <tbody>
            {linkedProjects.length === 0 ? (
              <tr>
                <td style={{ ...td, color: "#aaa" }}>None</td>
              </tr>
            ) : (
              linkedProjects.map(p => (
                <tr
                  key={p.id}
                  onMouseEnter={() => setHoverPid(p.id)}
                  onMouseLeave={() => {
                    setHoverPid(null);
                    setConfirmPid(null);
                  }}
                >
                  <td style={{ ...td, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="clickable" onClick={() => {/* open project page */}}>{p.title}</span>
                    {hoverPid === p.id && (
                      <button
                        className={`btn ${confirmPid === p.id ? "confirm-remove" : ""}`}
                        onClick={() => {
                          if (confirmPid === p.id) {
                            unlinkProject(p.id);
                            setConfirmPid(null);
                          } else setConfirmPid(p.id);
                        }}
                      >
                        {confirmPid === p.id ? "Confirm Remove" : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Error Text */}
        {submitAttempted && errors.projects && (
          <div style={{ color:'#e00', fontSize:12, marginTop:4 }}>{errors.projects}</div>
        )}

        {/* Spacing */}
        <div style={{ height: 24 }} />

        {/* ───── Upload Writing Sample ───── */}
        <div style={{ ...sectionHeader, marginTop: 32 }}>Upload Writing Sample</div>
        <div
          style={{
            marginBottom: 16,
            ...(submitAttempted && errors.file ? invalidGlow : null),
            padding: submitAttempted && errors.file ? 4 : 0,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={e => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (submitAttempted) validate();  // live re-validate
            }}
          />
          {submitAttempted && errors.file && (
            <div style={{ color:'#e00', fontSize:12, marginTop:4 }}>{errors.file}</div>
          )}
        </div>

        {/* ───── Additional fields appear after choosing a file ───── */}
        {file && (
          <>
            {/* ───── File Description ───── */}
            <div style={sectionHeader}>File Description</div>
            <div
              style={{
                marginBottom: 16,
                ...(submitAttempted && errors.description ? invalidGlow : null),
              }}
            >
              <textarea
                id="desc"
                value={fileDescription}
                placeholder="Example: 23 page script, single episode&#10;Example: Condensed pitch deck, 6 slides"
                onChange={e => {
                  setFileDescription(e.target.value);
                  if (submitAttempted) validate();
                }}
                style={{
                  width:'100%',
                  fontFamily:'inherit',
                  fontSize:'1rem',
                  lineHeight:1.4,
                  padding:8,
                  border:'1px solid #ccc',
                  borderRadius:4,
                  resize:'vertical',
                  minHeight:72, // ~3 rows
                  background:'#fff',
                  color:'#000',
                }}
              />
              {submitAttempted && errors.description && (
                <div style={{ color:'#e00', fontSize:12, marginTop:4 }}>{errors.description}</div>
              )}
            </div>

            {/* ───── Summary ───── */}
            <div style={{ ...sectionHeader, display:'flex', alignItems:'center', gap:8 }}>
              <span>Summary</span>
              <button
                className="tab"
                disabled={generating || !file}
                onClick={generateSummary}
                style={{ fontSize:'0.85rem', padding:'2px 8px' }}
              >
                {generating ? "Generating…" : "Generate with AI"}
              </button>
            </div>
            <div
              style={{
                marginBottom: 16,
                ...(submitAttempted && errors.summary ? invalidGlow : null),
              }}
            >
              <textarea
                id="summary"
                value={summary}
                placeholder="~400 words: logline, style, tone, genres, etc..."
                onChange={e => {
                  setSummary(e.target.value);
                  if (submitAttempted) validate();
                }}
                style={{
                  width:'100%',
                  fontFamily:'inherit',
                  fontSize:'1rem',
                  lineHeight:1.4,
                  padding:8,
                  border:'1px solid #ccc',
                  borderRadius:4,
                  resize:'vertical',
                  minHeight:140, // at least ~6 lines
                  background:'#fff',
                  color:'#000',
                }}
              />
              {submitAttempted && errors.summary && (
                <div style={{ color:'#e00', fontSize:12, marginTop:4 }}>{errors.summary}</div>
              )}
            </div>
          </>
        )}

        {/* ───── Top-level error text ───── */}
        {submitAttempted && Object.keys(errors).length > 0 && (
          <div style={{ color:'#e00', fontSize:12, marginTop:8, textAlign:'right' }}>
            Please complete all required fields.
          </div>
        )}

        {/* ───── Action buttons ───── */}
        <div style={{ marginTop: 32, display:'flex', justifyContent:'flex-end', gap:16 }}>
          <button className="tab" onClick={onClose}>Cancel</button>
          <button
            className="tab"            // use same class as Cancel → identical styling
            onClick={handleSave}
            disabled={generating}
          >
            Save
          </button>
        </div>

        {/* Inline create-project flow */}
        <CreateProjectModal
          isOpen={showCreateProject}
          onClose={() => setShowCreateProject(false)}
          initialCreativeId={linkedCreatives.length === 1 ? linkedCreatives[0].id : undefined}
          onSaved={(project, samplesLinked) => {
            setShowCreateProject(false);
            if (samplesLinked) {
              // The new project already has a writing sample linked in CreateProjectModal; we're done here.
              onClose();
              onSaved?.();
              return;
            }
            if (project?.id) {
              // Auto-select the newly created project as a linked project
              linkProject(project.id);
            }
          }}
        />

    </Modal>
  );
};

export default UploadWritingSampleModal;
