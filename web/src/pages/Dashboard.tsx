/** Features dashboard — empty-state placeholder for M2. The real money screen
 *  (build vs. inference per feature, confidence, Unattributed row) lands in M6. */
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">Annapurna</span>
        <span className="muted">{user?.email}</span>
        <button className="link" onClick={() => logout().then(() => navigate("/login"))}>
          Sign out
        </button>
      </header>
      <main>
        <h1>Features</h1>
        <div className="empty-state">
          <p className="empty-title">No features yet</p>
          <p className="muted">
            Connect your sources to see what each feature cost to build and to run.
          </p>
          <button onClick={() => navigate("/onboarding")}>Go to onboarding</button>
        </div>
      </main>
    </div>
  );
}
