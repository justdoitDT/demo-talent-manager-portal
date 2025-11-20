// frontend/src/pane/panes/CreativePanePersonalProjectsTab.tsx

import React, { useEffect, useState, useCallback } from "react";
import api from "../../services/api";
import { useBusy } from "../BusyContext";
import CreateProjectModal from "../../modals/CreateProjectModal";

interface ProjectMini {
  id: string;
  title: string;
  year: number | null;
  media_type: string | null;
  status: string | null;           // Production Phase
  tracking_status: string | null;  // Tracking
}

const PRODUCTION_PHASE_OPTIONS = [
  "Idea / Concept",
  "In Development",
  "Pitch-Ready",
  "Sold",
  "Archived",
] as const;

const TRACKING_OPTIONS = [
  "Internal / Not Tracking",
  "Hot List",
  "Active",
  "Priority Tracking",
  "Tracking",
  "Development",
  "Engaged",
  "Deep Tracking",
  "Archived",
  "Completed",
] as const;

export default function PersonalProjectsTab({
  creativeId,
  onOpen,
}: {
  creativeId: string;
  onOpen: (p: { kind: "project"; id: string }) => void;
}) {
  const [, setBusy] = useBusy();
  const [rows, setRows] = useState<ProjectMini[] | null>(null);

  // row edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [tempPhase, setTempPhase] = useState<string>("");
  const [tempTracking, setTempTracking] = useState<string>("");

  // create modal
  const [showCreate, setShowCreate] = useState(false);

  // load the list
  const load = useCallback(() => {
    return api
      .get<ProjectMini[]>(`/creatives/${creativeId}/personal-projects`)
      .then((r) => setRows(r.data));
  }, [creativeId]);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (p: ProjectMini) => {
    setEditId(p.id);
    setTempPhase(p.status ?? "");
    setTempTracking(p.tracking_status ?? "");
  };

  const cancelEdit = () => {
    setEditId(null);
    setTempPhase("");
    setTempTracking("");
  };

  const saveEdit = async (projectId: string) => {
    setBusy(true);
    try {
      await api.patch(`/projects/${projectId}`, {
        status: tempPhase || null,
        tracking_status: tempTracking || null,
      });
      await load();
      cancelEdit();
    } finally {
      setBusy(false);
    }
  };

  if (rows === null) return <>Loading…</>;

  return (
    <>
      {/* Top bar: Add button + row count */}
      <div className="mb-3 flex items-center justify-between">
        <button
          className="rounded-md bg-white px-3 py-2 text-sm ring-1 ring-gray-300 transition hover:bg-gray-100 active:scale-[0.98]"
          onClick={() => setShowCreate(true)}
        >
          Add Personal Project
        </button>
        <small className="text-gray-700">
          {rows.length} row{rows.length === 1 ? "" : "s"}
        </small>
      </div>

      {/* Table */}
      <table className="mt-1 w-full border-collapse">
        <thead>
          <tr>
            <th className="border border-gray-200 px-2 py-1.5 text-left">Title</th>
            <th className="border border-gray-200 px-2 py-1.5 text-left">Year</th>
            <th className="border border-gray-200 px-2 py-1.5 text-left">Media Type</th>
            <th className="border border-gray-200 px-2 py-1.5 text-left">Production Phase</th>
            <th className="border border-gray-200 px-2 py-1.5 text-left">Tracking</th>
            <th className="border border-gray-200 px-2 py-1.5 text-left">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const isEditing = editId === p.id;

            // ensure unknown values still render as selectable
            const phaseOptions = [
              ...(p.status && !PRODUCTION_PHASE_OPTIONS.includes(p.status as any)
                ? [p.status]
                : []),
              ...PRODUCTION_PHASE_OPTIONS,
            ];
            const trackingOptions = [
              ...(p.tracking_status && !TRACKING_OPTIONS.includes(p.tracking_status as any)
                ? [p.tracking_status]
                : []),
              ...TRACKING_OPTIONS,
            ];

            return (
              <tr key={p.id} className="group align-top">
                {/* Title */}
                <td
                  className="cursor-pointer border border-gray-200 px-2 py-1.5 text-[#046A38] hover:font-bold"
                  onClick={() => onOpen({ kind: "project", id: p.id })}
                  title="Open project"
                >
                  {p.title}
                </td>

                {/* Year */}
                <td className="border border-gray-200 px-2 py-1.5">
                  {p.year ?? "—"}
                </td>

                {/* Media Type */}
                <td className="border border-gray-200 px-2 py-1.5">
                  {p.media_type ?? "—"}
                </td>

                {/* Production Phase */}
                <td className="border border-gray-200 px-2 py-1.5">
                  {isEditing ? (
                    <select
                      value={tempPhase}
                      onChange={(e) => setTempPhase(e.target.value)}
                      className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                    >
                      <option value="">—</option>
                      {phaseOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    p.status ?? "—"
                  )}
                </td>

                {/* Tracking */}
                <td className="border border-gray-200 px-2 py-1.5">
                  {isEditing ? (
                    <select
                      value={tempTracking}
                      onChange={(e) => setTempTracking(e.target.value)}
                      className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                    >
                      <option value="">—</option>
                      {trackingOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    p.tracking_status ?? "—"
                  )}
                </td>

                {/* Actions */}
                <td className="border border-gray-200 px-2 py-1.5">
                  {isEditing ? (
                    <div className="flex gap-2">
                      <button
                        className="rounded bg-black px-3 py-1.5 text-white transition hover:opacity-90 active:scale-[0.98]"
                        onClick={() => saveEdit(p.id)}
                      >
                        Save
                      </button>
                      <button
                        className="rounded bg-white px-3 py-1.5 text-black ring-1 ring-gray-300 transition hover:bg-gray-100 active:scale-[0.98]"
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto
                                 rounded bg-white px-3 py-1.5 text-black ring-1 ring-gray-300 transition
                                 hover:bg-gray-100 active:scale-[0.98]"
                      onClick={() => startEdit(p)}
                      title="Edit"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Modal: prefill with this creative + force personal=Yes */}
      <CreateProjectModal
        isOpen={showCreate}
        onClose={() => {
          setShowCreate(false);
          load();
        }}
        initialCreativeId={creativeId}
        initialIsPersonal="yes"
      />
    </>
  );
}
