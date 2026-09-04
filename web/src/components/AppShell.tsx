/**
 * Full-screen app shell: a fixed left sidebar (brand, nav, account) wrapping the
 * routed page content. Replaces the per-page top bars.
 *
 * When an allow-listed admin is impersonating a customer, a banner appears and the
 * entire customer UI runs in that tenant (context switched server-side) — no pages
 * are duplicated for the admin.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { REFRESH_ALERTS_EVENT } from "../pages/Dashboard";
import { Assistant } from "./Assistant";
import { BrandMark } from "./BrandMark";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/optimize", label: "Optimize", end: false },
  { to: "/cost-sources", label: "Cost sources", end: false },
  { to: "/features", label: "Features", end: false },
  { to: "/install-sdk", label: "Install SDK", end: false },
  { to: "/alerts", label: "Alerts", end: false, icon: "bell" },
  { to: "/settings", label: "Settings", end: false },
  { to: "/help", label: "Knowledge base", end: false },
];

function BellIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden className="nav-icon">
      <path
        fill="currentColor"
        d="M10 2a5 5 0 0 0-5 5v2.6l-1.2 2.4A1 1 0 0 0 4.7 13.5h10.6a1 1 0 0 0 .9-1.5L15 9.6V7a5 5 0 0 0-5-5Zm0 16a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 10 18Z"
      />
    </svg>
  );
}

export function AppShell() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [alertBadge, setAlertBadge] = useState(0);

  const refreshBadge = useCallback(() => {
    api
      .alertsSummary()
      .then((s) => setAlertBadge(s.unread))
      .catch(() => setAlertBadge(0));
  }, []);

  // Refresh the unread badge on mount and whenever navigation lands on /alerts
  // (where the user may mark items read).
  useEffect(() => {
    refreshBadge();
  }, [refreshBadge, location.pathname]);

  // The Overview's refresh button re-polls the badge alongside its own data.
  useEffect(() => {
    window.addEventListener(REFRESH_ALERTS_EVENT, refreshBadge);
    return () => window.removeEventListener(REFRESH_ALERTS_EVENT, refreshBadge);
  }, [refreshBadge]);

  const exitImpersonation = async () => {
    await api.stopImpersonate();
    await refresh();
    navigate("/admin/customers");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand">
            <BrandMark />
            Annapurna
          </span>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              <span className="nav-link-label">
                {item.icon === "bell" && <BellIcon />}
                {item.label}
              </span>
              {item.to === "/alerts" && alertBadge > 0 && (
                <span className="nav-badge" aria-label={`${alertBadge} unread alerts`}>
                  {alertBadge > 99 ? "99+" : alertBadge}
                </span>
              )}
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
      <Assistant />
    </div>
  );
}
