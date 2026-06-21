/**
 * Full-screen app shell: a fixed left sidebar (brand, nav, account) wrapping the
 * routed page content. Replaces the per-page top bars.
 */
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/cost-sources", label: "Cost sources", end: false },
  { to: "/features", label: "Features", end: false },
  { to: "/install-sdk", label: "Install SDK", end: false },
  { to: "/settings", label: "Settings", end: false },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand">Annapurna</span>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="sidebar-email muted">{user?.email}</span>
          <button className="link" onClick={() => logout().then(() => navigate("/login"))}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
