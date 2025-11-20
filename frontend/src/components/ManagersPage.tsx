// frontend/src/components/ManagersPage.tsx
import React, { useEffect, useState } from "react";
import { AxiosResponse } from "axios";
import api from "../services/api";
import { usePane } from "../pane/PaneContext";

interface Manager {
  id: string;
  name: string;
}

const Spinner: React.FC = () => (
  <div className="flex items-center justify-center p-10" role="status" aria-label="Loading">
    <div className="h-8 w-8 rounded-full border-4 border-gray-300 border-t-[#004c54] animate-spin" />
  </div>
);

export default function ManagersPage() {
  const { open } = usePane();
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<Manager[]>("/managers", { params: { role: "manager" } })
      .then((res: AxiosResponse<Manager[]>) => setManagers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Managers</h1>
      <small className="block my-1 text-sm text-gray-600">
        {managers.length} row{managers.length === 1 ? "" : "s"}
      </small>

      <div className="relative">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left align-bottom border border-gray-200 px-3 py-2 text-sm font-medium">
                Name
              </th>
            </tr>
          </thead>
          <tbody>
            {managers.map((m) => (
              <tr key={m.id} className="even:bg-gray-50/30">
                <td
                  onClick={() => open({ kind: "manager", id: m.id })}
                  className="border border-gray-200 px-3 py-2 text-left cursor-pointer text-[#046A38] hover:font-bold"
                >
                  {m.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {loading && (
          <div className="absolute inset-0 z-50 bg-white/60 flex justify-center items-start pt-12">
            <Spinner />
          </div>
        )}
      </div>
    </div>
  );
}
