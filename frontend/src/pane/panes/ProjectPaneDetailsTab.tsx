// frontend/src/pane/panes/ProjectPaneDetailsTab.tsx

import React, { useEffect, useRef, useState, useCallback } from "react";
import api from "../../services/api";
import AttachNeedsModal from "../../modals/AttachNeedsModal";


/* ──────────── Types ──────────── */
interface GenreTag { id: string; name: string }
interface Project {
  id: string;  title: string;
  tracking_status: string | null;
  status:          string | null;
  imdb_id:         string | null;
  media_type:      string | null;
  updates:         string | null;
  description:     string | null;
  engagement:      string | null;
  genres?:          GenreTag[];
}
interface Note   { id: number; note: string; status: string, created_at: string; updated_at: string; }

interface ProjectNeed {
  id: string;
  qualifications: string;
  description: string | null;
}

/* ──────────── Constants ──────────── */
const NONE_EL = <em style={{ color:"#999" }}>None</em>;

const MEDIA_TYPES     = ["Feature","TV Series","Short","Music Video","Podcast Series",
                         "TV Mini Series","TV Movie","TV Short","TV Special","Video",
                         "Video Game","Other"];
const ENGAGEMENT_OPTS = ["Incoming","Meeting","Pitching","Sub"];

/* ──────────── Helpers ──────────── */
const textBox = (ro:boolean):React.CSSProperties => ({
  width:"100%",background:ro?"#f5f5f5":"#fff",
  color:"#000",border:"1px solid #ccc",padding:6,resize:"vertical"
});
const cellLabel:React.CSSProperties={fontWeight:600,padding:6};
const cell:React.CSSProperties     ={border:"1px solid #ddd",padding:6};
const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year:   "numeric",
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
/* ────────────────────────────────────────────────────────────────────────── */

export default function ProjectPaneDetailsTab({ projectId }:{projectId:string}) {
  /* state ------------------------------------------------------------ */
  const [project,setProject] = useState<Project|null>(null);
  const [notes,  setNotes  ] = useState<Note[]>([]);
  const [newNote,setNewNote] = useState("");
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [needs, setNeeds] = useState<ProjectNeed[]>([]);

  /* enum options pulled from the API once ---------------------------- */
  const [trackingOpts,setTrackingOpts] = useState<string[]>([]);
  const [statusOpts,  setStatusOpts  ] = useState<string[]>([]);

  /* fetch project / needs / notes / enums ------------------------------------ */
  const load = useCallback(async () => {
    const [p, n, needRes] = await Promise.all([
      api.get<Project>(`/projects/${projectId}`),
      api.get<Note[]>(`/projects/${projectId}/notes`),
      api.get<ProjectNeed[]>(`/projects/${projectId}/needs`),
    ]);
  
    setProject(p.data);
  
    setNotes(
      n.data
        .filter(x => x.status === "active")
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    );
  
    setNeeds(
      [...needRes.data].sort((a, b) =>
        (a.qualifications || "").localeCompare(b.qualifications || "") ||
        (a.description || "").localeCompare(b.description || "")
      )
    );
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  /* fetch enum values once (kept app-wide after first fetch) */
  useEffect(()=>{
    (async()=>{
      const [t,s] = await Promise.all([
        api.get<string[]>("/meta/enums/project_tracking_status"),
        api.get<string[]>("/meta/enums/project_status"),
      ]);
      setTrackingOpts(t.data);   setStatusOpts(s.data);
    })();
  },[]);

  /* ----- tiny API helpers ----- */
  const patchProject = (p:Partial<Project>) =>
          api.patch(`/projects/${projectId}`,p).then(load);
  const addNote      = (txt:string)=>
          api.post(`/projects/${projectId}/notes`,{note:txt}).then(load);
  const updateNote   = (id:number,txt:string)=>
          api.patch(`/notes/${id}`,{note:txt}).then(load);
  const archiveNote  = (id:number)=>
          api.patch(`/notes/${id}`,{status:"archived"}).then(load);
  const archiveNeed = (needId: string) =>
    api.patch(`/projects/project_need/${needId}`, { status: "Archived" }).then(load);

  /* ----- tag helpers ----- */
  const addTag = (tagId: string) =>
  api.post(`/projects/${projectId}/genres/${tagId}`)   // ← path now matches FastAPI
     .then(load);

  const removeTag = (tagId: string) =>
    api.delete(`/projects/${projectId}/genres/${tagId}`) // ← same “genres” path
      .then(load);

  if(!project) return <>Loading…</>;

  /* detail-row config (anything with selectOptions will render a <select>) */
  const details: DetailCfg[] = [
    { label: "Title", field: "title" },
    { label: "Tracking Status", field: "tracking_status", selectOptions: trackingOpts },
    { label: "Production Phase", field: "status", selectOptions: statusOpts },
    {
      label: "IMDb",
      field: "imdb_id",
      render: (v) =>
        v ? (
          <a
            href={`https://www.imdb.com/title/${v.split("/").pop()}`}
            target="_blank"
            rel="noreferrer"
          >
            {v}
          </a>
        ) : (
          NONE_EL
        ),
    },
    { label: "Media Type", field: "media_type", selectOptions: MEDIA_TYPES },
  
    // ✨ NEW: Needs row (custom) — placed here, between Media Type and Updates
    {
      label: "Needs",
      field: "media_type", // unused for custom row; just needs some key
      custom: (
        <NeedsRow
          projectId={projectId}
          needs={needs}
          onRefresh={load}
          onDeleteNeed={archiveNeed}
        />
      ),
    },
  
    { label: "Updates", field: "updates", input: "textarea" },
    { label: "Description", field: "description", input: "textarea" },
  
    {
      label: "Genre Tags",
      field: "genres",
      custom: (
        <tr
          key="genres"
          onMouseEnter={() => setHoverKey("genres")}
          onMouseLeave={() => setHoverKey(null)}
        >
          <td style={cellLabel}>Genre Tags</td>
          <td style={{ ...cell, width: "100%" }}>
            <GenreTagsEditor
              project={project}
              addTag={addTag}
              removeTag={removeTag}
              showControls={hoverKey === "genres"}
            />
          </td>
        </tr>
      ),
    },
  
    { label: "Engagement", field: "engagement", selectOptions: ENGAGEMENT_OPTS },
  ];

  /* render ----------------------------------------------------------- */
  return (
    <>
      {/* -------- details table -------- */}
      <h4 style={{marginTop:0}}>Project Details</h4>
      <table style={{borderCollapse:"collapse",width:"100%"}}>
        <tbody>
          {details.map(cfg => cfg.custom ?? (
              <DetailRow key={cfg.field as string}
                        cfg={cfg}
                        project={project}
                        patch={patchProject}
                        hoverKey={hoverKey}
                        setHoverKey={setHoverKey}
              />
            ))
          }
        </tbody>
      </table>

      {/* -------- notes -------- */}
      <h4 style={{ marginTop: 32 }}>Notes</h4>

      {notes.length > 0 && (
        <NoteBox
          key={notes[0].id}
          note={notes[0]}
          onSave={(txt) => updateNote(notes[0].id, txt)}
          onDelete={() => archiveNote(notes[0].id)}
        />
      )}

      {/* ---- New-note input (always shown) ---- */}
      <div style={{ marginBottom: 50 }}>
        <textarea
          rows={4}
          style={textBox(false)}
          placeholder="Add a new note…"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
        />
        <div style={{ marginTop: 4, display: "flex", gap: 8 }}>
          <button
            className="btn"
            disabled={!newNote.trim()}
            onClick={() => {
              addNote(newNote.trim());
              setNewNote("");
            }}
          >
            Save
          </button>
          <button
            className="btn"
            disabled={!newNote.trim()}
            onClick={() => setNewNote("")}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* ---- the rest of the notes ---- */}
      {notes.slice(1).map((n) => (
        <NoteBox
          key={n.id}
          note={n}
          onSave={(txt) => updateNote(n.id, txt)}
          onDelete={() => archiveNote(n.id)}
        />
      ))}
    </>
  );
}

/* ───────── DetailRow ───────── */
type DetailCfg = {
  label:string;
  field:keyof Project;
  render? :(v:any)=>React.ReactNode;
  input?  :"textarea";
  selectOptions?:string[];
  custom? :React.ReactNode;     // used for GenreTags row
};
function DetailRow({
  cfg,
  project,
  patch,
  hoverKey,
  setHoverKey
}: {
  cfg: DetailCfg;
  project: Project;
  patch: (p: Partial<Project>) => Promise<any>; // (returns a promise)
  hoverKey: string | null;
  setHoverKey: (k: string | null) => void;
}) {
  const valInit = project[cfg.field] as any;
  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState(valInit ?? "");
  const [saving, setSaving] = useState(false);            // ← NEW
  const InputEl = cfg.input === "textarea" ? "textarea" : "input";

  // keep temp in sync if project updates under us
  useEffect(() => { setTemp(valInit ?? ""); }, [valInit]); // optional but nice

  return (
    <tr
      onMouseEnter={() => setHoverKey(cfg.field as string)}
      onMouseLeave={() => setHoverKey(null)}
    >
      <td style={cellLabel}>{cfg.label}</td>
      <td style={{ ...cell, width: "100%" }}>
        {editing ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", opacity: saving ? 0.6 : 1 }}>
            {cfg.selectOptions ? (
              <select
                value={temp ?? ""}
                style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => setTemp(e.target.value || null)}
                disabled={saving}
              >
                <option value="">– select –</option>
                {cfg.selectOptions.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <InputEl
                style={{ flex: 1, minWidth: 0 }}
                rows={cfg.input === "textarea" ? 3 : undefined}
                value={temp}
                onChange={(e) => setTemp((e.target as HTMLInputElement).value)}
                disabled={saving}
              />
            )}

            <button
              className="btn"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                setEditing(false); // collapse to read mode while saving
                patch({ [cfg.field]: temp || null })
                  .finally(() => setSaving(false)); // back to black after .then(load) finishes
              }}
            >
              Save
            </button>
            <button
              className="btn"
              disabled={saving}
              onClick={() => { setTemp(valInit ?? ""); setEditing(false); }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                // make Title a bit more prominent
                color: saving ? "#888" : "#000",         // ← grey while saving, black after load()
                transition: "color 150ms ease-in-out"
              }}
            >
              {cfg.render ? cfg.render(valInit) : (valInit ?? NONE_EL)}
            </span>
            <button
              className="btn"
              style={{
                marginLeft: 8,
                visibility: hoverKey === (cfg.field as string) || editing ? "visible" : "hidden"
              }}
              onClick={() => setEditing(true)}
              disabled={saving} // don't allow editing mid-save
            >
              {saving ? "Saving…" : "Edit"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

/* ───────── NoteBox ───────── */
function NoteBox({
  note,
  onSave,
  onDelete,
}: {
  note: Note;
  onSave: (t: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing]  = useState(false);
  const [confirm, setConfirm]  = useState(false);
  const [temp, setTemp]        = useState(note.note);

  /* ─── layout ─── */
  return (
    <div style={{ marginBottom: 50, position: "relative" }}>
      {/* note text */}
      <textarea
        rows={4}
        readOnly={!editing}
        style={textBox(!editing)}
        value={editing ? temp : note.note}
        onChange={e => setTemp(e.target.value)}
      />

      {/* tiny timestamp footer */}
      <div
        style={{
          position: "absolute",
          bottom: 6,
          right: 8,
          fontSize: "0.7em",
          color: "#666",
        }}
      >
        <div>Created {fmt(note.created_at)}</div>
        {/* show Updated only if it’s different */}
        {note.updated_at !== note.created_at && (
          <div>Updated {fmt(note.updated_at)}</div>
        )}
      </div>

      {/* buttons */}
      <div style={{ marginTop: 4, display: "flex", gap: 8 }}>
        {editing ? (
          <>
            <button className="btn" onClick={() => {
              onSave(temp.trim());
              setEditing(false);
            }}>Save</button>
            <button className="btn" onClick={() => {
              setTemp(note.note);
              setEditing(false);
            }}>Cancel</button>
          </>
        ) : (
          <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        )}

        {confirm ? (
          <>
            <button className="btn" onClick={() => {
              onDelete();
              setConfirm(false);
            }}>Confirm Delete</button>
            <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
          </>
        ) : (
          <button className="btn" onClick={() => setConfirm(true)}>Delete Note</button>
        )}
      </div>
    </div>
  );
}


function NeedsRow({
  projectId,
  needs,
  onRefresh,
  onDeleteNeed,
}: {
  projectId: string;
  needs: ProjectNeed[];
  onRefresh: () => void;
  onDeleteNeed: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <tr>
        <td style={cellLabel}>Needs</td>
        <td style={{ ...cell, width: "100%" }}>
          {/* chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {needs.map((n) => (
              <span
                key={n.id}
                style={{
                  position: "relative",
                  background: "#eee",
                  borderRadius: 6,
                  padding: "6px 24px 6px 8px", // room for the ×
                  lineHeight: 1.25,
                  maxWidth: 280,
                }}
              >
                <div style={{ fontWeight: 600 }}>{n.qualifications}</div>
                {n.description && (
                  <div style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {n.description}
                  </div>
                )}

                {/* delete (visible only in edit mode) */}
                {editing && (
                  <span
                    title="Remove need"
                    onClick={() => onDeleteNeed(n.id)}
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      width: 18,
                      height: 18,
                      lineHeight: "18px",
                      textAlign: "center",
                      borderRadius: 3,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#000";
                      e.currentTarget.style.color = "#fff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "inherit";
                    }}
                  >
                    ×
                  </span>
                )}
              </span>
            ))}
          </div>

          {/* controls */}
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            {!editing ? (
              <button className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => setEditing(false)}>
                  Done
                </button>
                <button className="btn" onClick={() => setModalOpen(true)}>
                  Add New Need
                </button>
              </>
            )}
          </div>
        </td>
      </tr>

      {/* modal */}
      {modalOpen && (
        <AttachNeedsModal
          isOpen={true}
          projectId={projectId}
          onClose={() => setModalOpen(false)}
          // Only one need is returned for auto-select, but we just refresh the list
          onSaved={() => {
            setModalOpen(false);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

/* ───────── GenreTagsEditor ───────── */
function GenreTagsEditor({
  project,
  addTag,
  removeTag,
  showControls
}: {
  project: { genres?: GenreTag[] };
  addTag: (id: string) => void;
  removeTag: (id: string) => void;
  showControls: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTxt, setSearchTxt]   = useState("");
  const [debounced, setDebounced]   = useState(searchTxt);
  const [results, setResults]       = useState<GenreTag[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  // 1) debounce the raw input
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(searchTxt), 300);
    return () => clearTimeout(handle);
  }, [searchTxt]);

  // 2) fetch whenever debounced text changes
  useEffect(() => {
    if (!debounced.trim()) {
      setResults([]);
      return;
    }
    api
      .get<GenreTag[]>("/genre_tags", { params: { q: debounced } })
      .then(r => setResults(r.data))
      .catch(() => setResults([]));
  }, [debounced]);

  // 3) close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {/* existing tags */}
      {(project.genres ?? []).map((t) => (
        <span
          key={t.id}
          style={{ background: "#eee", padding: "4px 8px", borderRadius: 12 }}
        >
          {t.name}
          {showControls && (
            <button
              style={{
                marginLeft: 4,
                border: "none",
                background: "none",
                cursor: "pointer",
              }}
              onClick={() => removeTag(t.id)}
            >
              ✕
            </button>
          )}
        </span>
      ))}

      {/* add-tag UI */}
      {showControls && (
        <div ref={boxRef} style={{ position: "relative" }}>
          <button className="btn" onClick={() => setSearchOpen((o) => !o)}>
            Add Tag
          </button>

          {searchOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                zIndex: 10,
                background: "#fff",
                border: "1px solid #ccc",
                width: 220,
                maxHeight: 240,
                overflowY: "auto",
              }}
            >
              <input
                autoFocus
                value={searchTxt}
                onChange={(e) => setSearchTxt(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 6,
                  border: "none",
                  borderBottom: "1px solid #ccc",
                }}
              />

              {results.map((r) => (
                <div
                  key={r.id}
                  style={{ padding: 6, cursor: "pointer" }}
                  onClick={() => {
                    addTag(r.id);
                    setSearchTxt("");
                    setSearchOpen(false);
                  }}
                >
                  {r.name}
                </div>
              ))}

              <div style={{ padding: 6, borderTop: "1px solid #eee" }}>
                <button
                  className="btn-small"
                  onClick={async () => {
                    if (!searchTxt.trim()) return;
                    const { data: newTag } = await api.post<GenreTag>(
                      "/genre_tags",
                      { name: searchTxt.trim() }
                    );
                    await addTag(newTag.id);
                    setSearchTxt("");
                    setSearchOpen(false);
                  }}
                >
                  ➕ Add “{searchTxt.trim() || "..."}” to database
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}