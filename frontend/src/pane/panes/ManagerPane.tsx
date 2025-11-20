// frontend/src/pane/panes/ManagerPane.tsx
import React, { useEffect, useState, useCallback } from "react";
import api from "../../services/api";
import { usePane } from "../PaneContext";
import { useBusy } from "../BusyContext";
import PaneFrame from "../PaneFrame";
import { usePaneTab } from "../usePaneTab";

interface CreativeMini {
  id: string;
  name: string;
}
interface Manager {
  id: string;
  name: string;
  email: string | null;
  clients: CreativeMini[];
}

export default function ManagerPane({ id }: { id: string }) {
  const { open } = usePane();
  const paneKey = `creative:${id}`;
  const [active, setActive] = usePaneTab(paneKey, "clients");

  const [mgr, setMgr] = useState<Manager | null>(null);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [allCreatives, setAllCreatives] = useState<CreativeMini[]>([]);
  const [, setBusy] = useBusy();
  const [search, setSearch] = useState("");

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  /* ───────── fetch manager ───────── */
  const load = useCallback(() => {
    return api.get<Manager>(`/managers/${id}`).then((r) => {
      setMgr(r.data);
      setEmail(r.data.email ?? "");
    });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /* ───────── edit email ───────── */
  const saveEmail = async () => {
    setBusy(true);
    try {
      await api.patch(`/managers/${id}`, { email });
      setEditing(false);
      load();
    } finally {
      setBusy(false);
    }
  };

  /* ───────── remove client ───────── */
  const removeClient = async (cid: string) => {
    setBusy(true);
    try {
      await api
        .delete("/client-team-assignments", {
          params: { team_id: id, creative_id: cid },
        })
        .catch((err) => {
          console.error("remove failed", err);
          alert("Could not remove client – see console for details.");
        });
      load();
    } finally {
      setBusy(false);
    }
  };

  /* ───────── open “add client” list once ───────── */
  useEffect(() => {
    if (!adding) return;
    api
      .get<CreativeMini[]>("/creatives", {
        params: { unmanaged_by: id },
      })
      .then((r) => setAllCreatives(r.data));
  }, [adding, id]);

  const addClient = async (cid: string) => {
    setBusy(true);
    try {
      await api.post(
        "/client-team-assignments",
        undefined,
        { params: { team_id: id, creative_id: cid } }
      );
      setAdding(false);
      load();
    } finally {
      setBusy(false);
    }
  };

  if (!mgr) {
    return <div className="p-4">Loading…</div>;
  }

  return (
    <PaneFrame
      title={mgr?.name ?? "Loading…"}
      tabs={[{ key: "clients", label: "Clients" }]}
      activeTabKey={active}
      onTabChange={setActive}
      minWidth={420}
    >
      {/* ─── editable-email row ─── */}
      <div className="relative mb-3">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-7/12 rounded border border-gray-300 px-3 py-2 text-base outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
            />
            <button
              onClick={saveEmail}
              className="inline-flex items-center rounded bg-black px-3 py-1.5 text-white transition hover:opacity-90 active:scale-[0.98]"
              title="Save email"
            >
              ✔
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-base">
              {mgr.email ?? <em className="text-gray-400">No email</em>}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="opacity-60 transition hover:opacity-100"
              title="Edit email"
            >
              ✎
            </button>
          </div>
        )}
      </div>

      {/* ─── client count ─── */}
      <small className="my-1 block text-sm text-gray-600">
        {mgr.clients.length} row{mgr.clients.length === 1 ? "" : "s"}
      </small>

      {/* ─── clients table ─── */}
      <table className="border-collapse min-w-[40ch] w-fit">
        <thead>
          <tr>
            <th className="border border-gray-200 px-3 py-2 text-left align-bottom">
              <div className="flex items-center justify-between">
                <span className="font-medium">Clients</span>
                <button
                  onClick={() => setAdding((a) => !a)}
                  className="rounded border border-gray-300 bg-white px-3 py-1.5 text-[0.85rem] transition hover:bg-gray-100 active:scale-[0.98]"
                >
                  {adding ? "Cancel" : "Add Client"}
                </button>
              </div>
            </th>
          </tr>

          {adding && (
            <tr>
              <td className="px-2 py-2">
                <input
                  type="text"
                  placeholder="Search…"
                  onChange={(e) => setSearch(e.target.value.toLowerCase())}
                  className="mb-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                />
                <div className="max-h-72 overflow-y-auto rounded border border-gray-200 bg-white p-1.5 shadow-md">
                  <div
                    className="cursor-pointer px-2 py-1 text-[#046A38] hover:font-bold"
                    onClick={() => alert("TODO: open New-Creative form")}
                  >
                    ➕ Add New Client to Database
                  </div>
                  {allCreatives
                    .filter((c) => c.name.toLowerCase().includes(search))
                    .map((c) => (
                      <div
                        key={c.id}
                        className="cursor-pointer px-2 py-1 hover:bg-black hover:text-white"
                        onClick={() => addClient(c.id)}
                      >
                        {c.name}
                      </div>
                    ))}
                </div>
              </td>
            </tr>
          )}
        </thead>

        <tbody>
          {mgr.clients.map((c) => (
            <tr
              key={c.id}
              onMouseEnter={() => setHoverId(c.id)}
              onMouseLeave={() => {
                setHoverId(null);
                setConfirmId(null);
              }}
              className="even:bg-gray-50/50"
            >
              <td className="border border-gray-200 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  {/* left: name */}
                  <span
                    className="cursor-pointer text-[#046A38] hover:font-bold"
                    onClick={() => open({ kind: "creative", id: c.id })}
                  >
                    {c.name}
                  </span>

                  {/* right: remove button (hover-reveal) */}
                  <button
                    className={[
                      "rounded px-3 py-1.5 text-sm transition",
                      confirmId === c.id
                        ? "bg-red-300 font-bold text-black"
                        : "bg-white text-black border border-gray-300 hover:bg-gray-100",
                      hoverId === c.id ? "visible" : "invisible",
                    ].join(" ")}
                    onClick={() => {
                      if (confirmId === c.id) removeClient(c.id);
                      else setConfirmId(c.id);
                    }}
                  >
                    {confirmId === c.id ? "Confirm Remove" : "Remove Client"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PaneFrame>
  );
}
