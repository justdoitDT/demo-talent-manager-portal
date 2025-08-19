// frontend/src/components/Layout.tsx

import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import "./Layout.css";

const tabs = [
  { label: "Tasks",      path: "/tasks"      },
  { label: "Managers",   path: "/managers"   },
  { label: "Creatives",  path: "/creatives"  },
  { label: "Projects",   path: "/projects"   },
  { label: "Subs",       path: "/subs"       },
  { label: "Mandates",   path: "/mandates"   },
  { label: "Companies", path: "/companies" },
  { label: "Executives", path: "/executives" },
  { label: "Buyers",     path: "/buyers"     },
] as const;

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="container">
      {/* —— Header —— */}
      <header className="header">
        <div className="logo-title">
          <img src="/RDElogo.png" alt="Redeﬁne Entertainment logo" className="logo" />
          <h1 className="title">Manager Portal</h1>
        </div>
      </header>

      {/* —— Primary navigation —— */}
      <nav className="nav">
        {tabs.map(({ label, path }) => (
          <NavLink
            key={path}
            to={{ pathname: path, search: location.search }}
            className={({ isActive }) => `tab${isActive ? " active" : ""}`}
            end
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* —— Routed content —— */}
      <main className="content">{children}</main>

      {/* —— Footer —— */}
      <footer className="footer">© 2025 David R. Thomas. All rights reserved.</footer>
    </div>
  );
}