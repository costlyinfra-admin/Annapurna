/**
 * Settings — connection status of every source (grouped by purpose) plus the
 * account/sign-out. Connecting a source happens where it's used (Features /
 * Cost sources); this page is the at-a-glance overview.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type ConnectorStatus } from "../api";
import { useAuth } from "../auth/AuthContext";

const GROUPS: { key: string; title: string; hint: string }[] = [
  { key: "features", title: "Features", hint: "Feature discovery from your repos" },
  { key: "build_activity", title: "Build cost", hint: "AI coding-tool spend" },
  { key: "inference", title: "Inference cost", hint: "Provider cost APIs" },
];

export function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .connectors()
      .then(setConnectors)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load sources."));
  }, []);

  return (
    <div className="content">
      <div className="dash-head">
        <h1>Settings</h1>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="settings-card">
        <h2>Connected sources</h2>
        <p className="muted">
          Connect a source from <strong>Features</strong> or <strong>Cost sources</strong>; this is
          the status overview.
        </p>
        {connectors === null ? (
          <p className="muted">Loading…</p>
        ) : (
          GROUPS.map((g) => {
            const rows = connectors.filter((c) => c.category === g.key);
            if (rows.length === 0) return null;
            return (
              <div key={g.key} className="settings-group">
                <div className="settings-group-head">
                  <span className="connector-name">{g.title}</span>
                  <span className="connector-category">{g.hint}</span>
                </div>
                <ul className="connector-list">
                  {rows.map((c) => (
                    <li key={c.type} className="connector-row">
                      <span className="connector-name">{c.name}</span>
                      {c.connected ? (
                        <span className="badge connected">Connected</span>
                      ) : (
                        <span className="badge">Not connected</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>

      <section className="settings-card">
        <h2>Account</h2>
        <p className="muted">{user?.email}</p>
        <button className="secondary" onClick={() => logout().then(() => navigate("/login"))}>
          Sign out
        </button>
      </section>
    </div>
  );
}
