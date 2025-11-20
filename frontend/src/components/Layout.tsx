// frontend/src/components/Layout.tsx
import React from "react";
import { NavLink, useLocation } from "react-router-dom";

const tabs = [
  { label: "AI Assistant",  path: "/rag_chat" },
  { label: "Managers",   path: "/managers"    },
  { label: "Creatives",  path: "/creatives"   },
  { label: "Projects",   path: "/projects"    },
  { label: "Subs",       path: "/subs"        },
  { label: "Mandates",   path: "/mandates"    },
  { label: "Companies",  path: "/companies"   },
  { label: "Executives", path: "/executives"  },
] as const;

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex min-h-[120vh] flex-col">
      {/* Header */}
      <header className="text-center py-5">
        <div className="flex flex-col items-center gap-2.5">
          <img
            src="/RDElogo.png"
            alt="Redefine Entertainment logo"
            className="h-20 w-auto"
          />
          <h1 className="m-0 text-2xl font-semibold">Manager Portal</h1>
        </div>
      </header>

      {/* Sticky primary nav */}
      <nav className="sticky top-0 z-[1000] flex justify-center gap-2.5 py-2 bg-white shadow-sm">
        {tabs.map(({ label, path }) => (
          <NavLink
            key={path}
            to={{ pathname: path, search: location.search }}
            end
            className={({ isActive }) =>
              [
                "px-2.5 py-1 rounded text-inherit no-underline transition",
                "hover:bg-black/5",
                "active:scale-[0.98]",
                isActive
                  ? "bg-black text-white hover:bg-black"
                  : "bg-white text-black hover:bg-gray-200",
              ].join(" ")
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Routed content */}
      <main className="flex-1 p-5">{children}</main>

      {/* Footer */}
      <footer className="text-center text-gray-500 py-2">
        © 2025 David R. Thomas. All rights reserved.
      </footer>
    </div>
  );
}
