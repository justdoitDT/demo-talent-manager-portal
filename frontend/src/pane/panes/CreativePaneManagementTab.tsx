// frontend/src/pane/panes/CreativePaneManagementTab.tsx

import React, { useEffect, useState, useCallback } from "react";
import api from "../../services/api";
import { useBusy } from "../BusyContext";

interface ManagerMini { id: string; name: string }
interface Creative {
  id: string;
  availability: "available" | "unavailable" | null;
  unavailable_until: string | null; // ISO date
  tv_acceptable: boolean | null;
  is_writer: boolean | null;
  is_director: boolean | null;
  writer_level: number | null;
  has_directed_feature: boolean | null;
  industry_notes: string | null;
  managers: ManagerMini[];
}

const WRITER_LEVELS: { value: number; label: string }[] = [
  { value: 0,   label: "Writer’s Assistant" },
  { value: 0.5, label: "Writer's Asst / Staff Writer" },
  { value: 1,   label: "Staff Writer" },
  { value: 1.5, label: "Staff Writer / Story Editor" },
  { value: 2,   label: "Story Editor" },
  { value: 2.5, label: "Story Editor / Exec Story Editor" },
  { value: 3,   label: "Exec Story Editor" },
  { value: 3.5, label: "Exec Story Editor / Co-Producer" },
  { value: 4,   label: "Co-Producer" },
  { value: 4.5, label: "Co-Producer / Producer" },
  { value: 5,   label: "Producer" },
  { value: 5.5, label: "Producer / Supervising Producer" },
  { value: 6,   label: "Supervising Producer" },
  { value: 6.5, label: "Supervising Producer / Co-EP" },
  { value: 7,   label: "Co-EP" },
  { value: 7.5, label: "Co-EP / EP" },
  { value: 8,   label: "EP" },
  { value: 8.5, label: "EP / Showrunner" },
  { value: 9,   label: "Showrunner" },
];

export default function ManagementTab({
  creativeId,
  onOpen,
}: {
  creativeId: string;
  onOpen: (p: { kind: "manager"; id: string }) => void;
}) {
  const [data, setData] = useState<Creative | null>(null);
  const [notes, setNotes] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [, setBusy] = useBusy();

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [addingMgr, setAddingMgr] = useState(false);
  const [allManagers, setAllManagers] = useState<ManagerMini[]>([]);

  const isoDate = (s: string | null) => (s ? s.slice(0, 10) : "");

  /* fetch --------------------------------------------------------- */
  const load = useCallback(() => {
    return api.get<Creative>(`/creatives/${creativeId}`).then((r) => {
      setData(r.data);
      setNotes(r.data.industry_notes ?? "");
    });
  }, [creativeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!addingMgr) return;
    api
      .get<ManagerMini[]>("/managers", { params: { role: "manager", unassigned_to: creativeId } })
      .then((r) => setAllManagers(r.data));
  }, [addingMgr, creativeId]);

  /* helpers ------------------------------------------------------- */
  const patch = async (payload: Partial<Creative>) => {
    setBusy(true);
    try { await api.patch(`/creatives/${creativeId}`, payload); }
    finally { setBusy(false); load(); }
  };

  const saveNotes = () =>
    patch({ industry_notes: notes }).then(() => setEditingNotes(false));

  if (!data) return <>Loading…</>;

  return (
    <div className="relative">
      {/* Availability */}
      <h4 className="mt-5 mb-2 text-lg font-semibold">Availability</h4>
      <div className="flex items-center gap-6">
        <div className="w-36">Currently&nbsp;Available</div>

        {/* Toggle */}
        <label className="relative inline-flex cursor-pointer select-none items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={data.availability !== "unavailable"}
            onChange={(e) =>
              patch({
                availability: e.target.checked ? "available" : "unavailable",
                unavailable_until: e.target.checked ? null : data.unavailable_until,
              })
            }
          />
          <span
            className="h-6 w-12 rounded-full bg-gray-300 transition
                       after:absolute after:ml-0.5 after:h-5 after:w-5 after:translate-x-0.5 after:rounded-full
                       after:bg-white after:transition after:content-[''] peer-checked:bg-green-500
                       peer-checked:after:translate-x-6"
          />
          <span className="ml-3 text-sm text-gray-700">
            {data.availability === "unavailable" ? "No" : "Yes"}
          </span>
        </label>
      </div>

      {/* date picker when unavailable */}
      {data.availability === "unavailable" && (
        <div className="mt-2">
          <label className="mr-2">Unavailable Until&nbsp;(approx.)</label>
          <input
            type="date"
            value={isoDate(data.unavailable_until)}
            onChange={(e) => patch({ unavailable_until: e.target.value || null })}
            className="rounded border border-gray-300 px-2 py-1 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
          />
        </div>
      )}

      {/* Media Type */}
      <h4 className="mt-12 text-lg font-semibold">Media Type</h4>
      <select
        value={data.tv_acceptable ? "tv" : "features"}
        onChange={(e) => patch({ tv_acceptable: e.target.value === "tv" })}
        className="mt-1 rounded border border-gray-300 bg-white px-2 py-1.5 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
      >
        <option value="tv">TV / Features</option>
        <option value="features">Features Only</option>
      </select>

      {/* Role */}
      <h4 className="mt-12 text-lg font-semibold">Role</h4>
      <select
        value={
          data.is_writer && data.is_director
            ? "writer_dir"
            : data.is_writer
            ? "writer"
            : data.is_director
            ? "director"
            : ""
        }
        onChange={(e) => {
          const v = e.target.value;
          patch({
            is_writer: v === "writer" || v === "writer_dir",
            is_director: v === "director" || v === "writer_dir",
          });
        }}
        className="mt-1 rounded border border-gray-300 bg-white px-2 py-1.5 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
      >
        <option value="writer">Writer</option>
        <option value="director">Director</option>
        <option value="writer_dir">Writer &amp; Director</option>
      </select>

      {/* writer level */}
      {data.is_writer && data.tv_acceptable && (
        <div className="mt-2">
          <label className="mr-2">Writer Level (TV):</label>
          <select
            value={data.writer_level ?? ""}
            onChange={(e) => patch({ writer_level: Number(e.target.value) })}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
          >
            {WRITER_LEVELS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* director level */}
      {data.is_director && (
        <div className="mt-2">
          <label className="mr-2">Director Level:</label>
          <select
            value={
              data.has_directed_feature == null
                ? ""
                : data.has_directed_feature
                ? "yes"
                : "no"
            }
            onChange={(e) =>
              patch({
                has_directed_feature:
                  e.target.value === "" ? null : e.target.value === "yes",
              })
            }
            className="rounded border border-gray-300 bg-white px-2 py-1.5 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
          >
            <option value="yes">Directed Feature</option>
            <option value="no">Not Directed Feature</option>
          </select>
        </div>
      )}

      {/* Strengths / Notes */}
      <h4 className="mt-12 text-lg font-semibold">Strengths / Industry Tags</h4>
      {editingNotes ? (
        <div className="space-y-2">
          <textarea
            value={notes}
            rows={4}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
          />
          <div className="flex gap-2">
            <button
              className="rounded bg-black px-3 py-1.5 text-white transition hover:opacity-90 active:scale-[0.98]"
              onClick={saveNotes}
            >
              Save
            </button>
            <button
              className="rounded bg-white px-3 py-1.5 text-black ring-1 ring-gray-300 transition hover:bg-gray-100 active:scale-[0.98]"
              onClick={() => setEditingNotes(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-0 whitespace-pre-wrap">
          {data.industry_notes ? (
            data.industry_notes
          ) : (
            <em className="text-gray-400">None</em>
          )}
          <button
            className="ml-2 rounded bg-white px-3 py-1.5 text-black ring-1 ring-gray-300 transition hover:bg-gray-100 active:scale-[0.98]"
            onClick={() => {
              setNotes(data.industry_notes ?? "");
              setEditingNotes(true);
            }}
          >
            Edit
          </button>
        </div>
      )}

      {/* Managers */}
      <table className="mt-12 min-w-[40ch] w-fit border-collapse">
        <thead>
          <tr>
            <th className="border border-gray-200 px-2 py-2 text-left">
              {`Manager${data.managers.length > 1 ? "s" : ""}`}
              <button
                className="float-right rounded bg-white px-2 py-1 text-sm ring-1 ring-gray-300 transition hover:bg-gray-100 active:scale-[0.98]"
                onClick={() => setAddingMgr((a) => !a)}
              >
                {addingMgr ? "Close" : "Add Manager"}
              </button>
            </th>
          </tr>

          {addingMgr && (
            <tr>
              <td className="px-2 py-2">
                <select
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                  onChange={(e) => {
                    const mid = e.target.value;
                    if (!mid) return;
                    setBusy(true);
                    api
                      .post(
                        "/client-team-assignments",
                        undefined,
                        { params: { team_id: mid, creative_id: creativeId } }
                      )
                      .then(() => {
                        setAddingMgr(false);
                        load();
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  <option value="">— select manager to add —</option>
                  {allManagers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          )}
        </thead>

        <tbody>
          {data.managers.length === 0 ? (
            <tr>
              <td className="border border-gray-200 px-2 py-2 text-left text-gray-400">
                None
              </td>
            </tr>
          ) : (
            data.managers.map((m) => (
              <tr key={m.id} className="group">
                <td className="border border-gray-200 px-2 py-2">
                  <div className="flex items-center justify-between">
                    <span
                      className="cursor-pointer text-[#046A38] hover:font-bold"
                      onClick={() => onOpen({ kind: "manager", id: m.id })}
                    >
                      {m.name}
                    </span>

                    {/* Hover-reveal remove with confirm click */}
                    <button
                      className={[
                        "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
                        "rounded px-2 py-1 text-sm transition active:scale-[0.98]",
                        confirmId === m.id
                          ? "bg-red-600 text-white hover:bg-red-700"
                          : "bg-white text-black ring-1 ring-gray-300 hover:bg-gray-100",
                      ].join(" ")}
                      onClick={() => {
                        if (confirmId === m.id) {
                          setBusy(true);
                          api
                            .delete("/client-team-assignments", {
                              params: { team_id: m.id, creative_id: creativeId },
                            })
                            .then(load)
                            .finally(() => {
                              setBusy(false);
                              setConfirmId(null);
                            });
                        } else {
                          setConfirmId(m.id);
                        }
                      }}
                    >
                      {confirmId === m.id ? "Confirm Remove" : "Remove"}
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
