/**
 * Full-screen app shell: a fixed left sidebar (brand, nav, account) wrapping the
 * routed page content. Replaces the per-page top bars.
 *
 * When an allow-listed admin is impersonating a customer, a banner appears and the
 * entire customer UI runs in that tenant (context switched server-side) — no pages
 * are duplicated for the admin.
 */
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/optimize", label: "Optimize", end: false },
  { to: "/cost-sources", label: "Cost sources", end: false },
  { to: "/features", label: "Features", end: false },
  { to: "/install-sdk", label: "Install SDK", end: false },
  { to: "/settings", label: "Settings", end: false },
];

export function AppShell() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();

  const exitImpersonation = async () => {
    await api.stopImpersonate();
    await refresh();
    navigate("/admin/customers");
  };

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
        <div className="sidebar-bottom">
          {user?.org_name && (
            <div className="sidebar-org">
              <span className="sidebar-org-label">Organization</span>
              <span className="sidebar-org-name">{user.org_name}</span>
            </div>
          )}
          <div className="sidebar-foot">
            {user?.is_admin && !user?.impersonating && (
              <Link to="/admin" className="link">
                Admin portal →
              </Link>
            )}
            <span className="sidebar-email muted">{user?.email}</span>
            <button className="link" onClick={() => logout().then(() => navigate("/login"))}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="app-main">
        {user?.impersonating && (
          <div className="impersonation-banner">
            <span>
              Viewing <strong>{user.impersonating.company}</strong> as admin.
            </span>
            <button className="link" onClick={exitImpersonation}>
              Exit impersonation
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
