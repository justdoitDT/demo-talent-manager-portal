// frontend/src/components/CreativesPage.tsx

import React, { useEffect, useState } from "react";
import { AxiosResponse } from "axios";
import { useSearchParams } from "react-router-dom";
import api from "../services/api";
import { usePane } from "../pane/PaneContext";
import AddPersonToDatabaseModal from "../modals/AddPersonToDatabaseModal";

interface ManagerMini { id: string; name: string; }
interface Creative {
  id: string;
  name: string;
  client_status: string;
  availability?: string | null;
  unavailable_until?: string | null;
  tv_acceptable?: boolean | null;
  is_writer?: boolean | null;
  is_director?: boolean | null;
  writer_level?: number | null;
  has_directed_feature?: boolean | null;
  managers?: ManagerMini[];
}

const Spinner: React.FC = () => (
  <div className="flex items-center justify-center p-10" role="status" aria-label="Loading">
    <div className="h-8 w-8 rounded-full border-4 border-gray-300 border-t-[#004c54] animate-spin" />
  </div>
);

const NA = <span className="text-gray-400">N/A</span>;

const toInitials = (full: string) =>
  full.split(/\s+/).map((w) => w[0] ?? "").join("").toUpperCase();

const writerLabel = (lvl?: number | null) => {
  if (lvl == null) return NA;
  const map: Record<number, string> = {
    0: `Writer’s Assistant`, 0.5: `Writer's Asst / Staff Writer`, 1: `Staff Writer`,
    1.5: `Staff Writer / Story Editor`, 2: `Story Editor`, 2.5: `Story Editor / Exec Story Editor`,
    3: `Exec Story Editor`, 3.5: `Exec Story Editor / Co-Producer`, 4: `Co-Producer`,
    4.5: `Co-Producer / Producer`, 5: `Producer`, 5.5: `Producer / Supervising Producer`,
    6: `Supervising Producer`, 6.5: `Supervising Producer / Co-EP`, 7: `Co-EP`,
    7.5: `Co-EP / EP`, 8: `EP`, 8.5: `EP / Showrunner`, 9: `Showrunner`,
  };
  return map[lvl] ?? String(lvl);
};

export default function CreativesPage() {
  const { open } = usePane();

  const [searchParams, setSearchParams] = useSearchParams();
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [managers, setManagers] = useState<ManagerMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCreative, setShowAddCreative] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters backed in URL:
  const clientStatus = searchParams.get("client_status") || "client";
  const managerId = searchParams.get("manager_id") || "";
  const availability = searchParams.get("availability") || "";
  const medium = searchParams.get("medium") || "";
  const roleFilter = searchParams.get("role") || "";
  const writerBucket = searchParams.get("writer_bucket") || "";

  const showWriter = !(medium === "features" || roleFilter === "director");
  const dirLevel = searchParams.get("dir_level") || ""; // '' | 'yes' | 'no'
  const showDirLevel = roleFilter !== "writer";
  const nameSearch = searchParams.get("q_name") || "";

  const setParam = (k: string, v: string, base = searchParams) => {
    const p = Object.fromEntries(base);
    if (v) p[k] = v;
    else delete p[k];
    setSearchParams(p);
  };

  // load managers for dropdown
  useEffect(() => {
    api
      .get<ManagerMini[]>("/managers", { params: { role: "manager" } })
      .then((r: AxiosResponse<ManagerMini[]>) => setManagers(r.data));
  }, []);

  // fetch /creatives when any filter changes
  useEffect(() => {
    setLoading(true);
    api
      .get<Creative[]>("/creatives", {
        params: {
          client_status: clientStatus,
          manager_id: managerId || undefined,
          availability: availability || undefined,

          ...(medium === "tv_features"
            ? { tv_acceptable: true }
            : medium === "features"
            ? { tv_acceptable: false }
            : {}),

          is_writer: roleFilter === "writer" ? true : undefined,
          is_director: roleFilter === "director" ? true : undefined,

          writer_level_bucket: showWriter ? writerBucket || undefined : undefined,

          has_directed_feature:
            dirLevel === "yes" ? true : dirLevel === "no" ? false : undefined,

          q: nameSearch || undefined,
        },
      })
      .then((r: AxiosResponse<Creative[]>) => setCreatives(r.data))
      .finally(() => setLoading(false));
  }, [
    clientStatus,
    managerId,
    availability,
    medium,
    roleFilter,
    writerBucket,
    showWriter,
    dirLevel,
    nameSearch,
    refreshKey,
  ]);

  return (
    <div>
      <div className="my-1.5">
        <button
          className="rounded bg-white px-4 py-2 text-black shadow-sm ring-1 ring-gray-300 transition hover:bg-black hover:text-white active:scale-[0.98]"
          onClick={() => setShowAddCreative(true)}
        >
          Add creative to database
        </button>
      </div>

      <small className="my-1 block text-sm text-gray-600">
        {creatives.length} row{creatives.length === 1 ? "" : "s"}
      </small>

      <div className="relative">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50">
              {/* Name */}
              <th className="border border-gray-200 px-3 py-2 text-left align-bottom">
                <div className="font-medium">Name</div>
                <div className="mt-1">
                  <input
                    placeholder="Search…"
                    value={nameSearch}
                    onChange={(e) => setParam("q_name", e.target.value)}
                    className="w-[90%] rounded border border-gray-300 px-3 py-1.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                  />
                </div>
              </th>

              {/* Client Status */}
              <th className="border border-gray-200 px-3 py-2 text-left align-bottom">
                <div className="font-medium">Client Status</div>
                <div className="mt-1">
                  <select
                    value={clientStatus}
                    onChange={(e) => setParam("client_status", e.target.value)}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                  >
                    <option value="client">Client</option>
                    <option value="prospective client">Prospective Client</option>
                    <option value="non-client">Non-Client</option>
                    <option value="ex-client">Ex-Client</option>
                  </select>
                </div>
              </th>

              {/* Managers */}
              <th className="border border-gray-200 px-3 py-2 text-left align-bottom">
                <div className="font-medium">Manager(s)</div>
                <div className="mt-1">
                  <select
                    value={managerId}
                    onChange={(e) => setParam("manager_id", e.target.value)}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                  >
                    <option value="">Any</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </th>

              {/* Availability */}
              <th className="border border-gray-200 px-3 py-2 text-left align-bottom">
                <div className="font-medium">Availability</div>
                <div className="mt-1">
                  <select
                    value={availability}
                    onChange={(e) => setParam("availability", e.target.value)}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                  >
                    <option value="">Any</option>
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </div>
              </th>

              {/* Unavailable Until */}
              <th className="border border-gray-200 px-3 py-2 text-left align-bottom">
                <div className="font-medium">Unavailable Until</div>
              </th>

              {/* Media Type */}
              <th className="border border-gray-200 px-3 py-2 text-left align-bottom">
                <div className="font-medium">Media Type</div>
                <div className="mt-1">
                  <select
                    value={medium}
                    onChange={(e) => {
                      const next = new URLSearchParams(searchParams);
                      next.set("medium", e.target.value);
                      if (e.target.value === "features") next.delete("writer_bucket");
                      setSearchParams(next);
                    }}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                  >
                    <option value="">Any</option>
                    <option value="tv_features">TV / Features</option>
                    <option value="features">Features Only</option>
                  </select>
                </div>
              </th>

              {/* Role */}
              <th className="border border-gray-200 px-3 py-2 text-left align-bottom">
                <div className="font-medium">Role</div>
                <div className="mt-1">
                  <select
                    value={roleFilter}
                    onChange={(e) => {
                      const next = new URLSearchParams(searchParams);
                      next.set("role", e.target.value);
                      if (e.target.value === "director") next.delete("writer_bucket");
                      setSearchParams(next);
                    }}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                  >
                    <option value="">Any</option>
                    <option value="writer">Writer</option>
                    <option value="director">Director</option>
                    <option value="writer_dir">Writer &amp; Director</option>
                  </select>
                </div>
              </th>

              {/* Writer Level (TV) */}
              {showWriter && (
                <th className="border border-gray-200 px-3 py-2 text-left align-bottom">
                  <div className="font-medium">Writer Level (TV)</div>
                  <div className="mt-1">
                    <select
                      value={writerBucket}
                      onChange={(e) => setParam("writer_bucket", e.target.value)}
                      className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                    >
                      <option value="">Any</option>
                      <option value="upper">Upper</option>
                      <option value="mid_upper">Mid–Upper</option>
                      <option value="mid">Mid</option>
                      <option value="low_mid">Low–Mid</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </th>
              )}

              {/* Director Level */}
              {showDirLevel && (
                <th className="border border-gray-200 px-3 py-2 text-left align-bottom">
                  <div className="font-medium">Director Level</div>
                  <div className="mt-1">
                    <select
                      value={dirLevel}
                      onChange={(e) => setParam("dir_level", e.target.value)}
                      className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-black/10"
                    >
                      <option value="">Any</option>
                      <option value="yes">Directed Feature</option>
                      <option value="no">Not Directed Feature</option>
                    </select>
                  </div>
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {creatives.map((c) => (
              <tr key={c.id} className="even:bg-gray-50/30">
                <td
                  onClick={() => open({ kind: "creative", id: c.id })}
                  className="cursor-pointer border border-gray-200 px-3 py-2 text-left text-[#046A38] hover:font-bold"
                >
                  {c.name}
                </td>

                <td className="border border-gray-200 px-3 py-2 text-left">
                  {{
                    client: "Client",
                    "prospective client": "Prospective Client",
                    "non-client": "Non-Client",
                    "ex-client": "Ex-Client",
                  }[c.client_status] ?? c.client_status}
                </td>

                <td className="border border-gray-200 px-3 py-2 text-left">
                  {c.managers?.length
                    ? c.managers.map((m) => toInitials(m.name)).join(", ")
                    : NA}
                </td>

                <td className="border border-gray-200 px-3 py-2 text-left">
                  {c.availability != null
                    ? {
                        available: "Available",
                        unavailable: "Unavailable",
                      }[c.availability] ?? c.availability
                    : NA}
                </td>

                <td className="border border-gray-200 px-3 py-2 text-left">
                  {c.unavailable_until
                    ? new Date(c.unavailable_until).toLocaleDateString()
                    : NA}
                </td>

                <td className="border border-gray-200 px-3 py-2 text-left">
                  {c.tv_acceptable ? "TV / Features" : "Features Only"}
                </td>

                <td className="border border-gray-200 px-3 py-2 text-left">
                  {c.is_writer && c.is_director
                    ? "Writer & Director"
                    : c.is_writer
                    ? "Writer"
                    : c.is_director
                    ? "Director"
                    : NA}
                </td>

                {showWriter && (
                  <td className="border border-gray-200 px-3 py-2 text-left">
                    {writerLabel(c.writer_level)}
                  </td>
                )}

                {showDirLevel && (
                  <td className="border border-gray-200 px-3 py-2 text-left">
                    {c.has_directed_feature == null
                      ? NA
                      : c.has_directed_feature
                      ? "Directed Feature"
                      : "Not Directed Feature"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <AddPersonToDatabaseModal
          isOpen={showAddCreative}
          onClose={() => {
            setShowAddCreative(false);
            setRefreshKey((k) => k + 1); // re-fetch list after closing/saving
          }}
          initialRole="creative"
        />

        {loading && (
          <div className="absolute inset-0 z-50 flex items-start justify-center bg-white/60 pt-12">
            <Spinner />
          </div>
        )}
      </div>
    </div>
  );
}
