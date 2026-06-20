/**
 * App routes. Public: /login, /signup. Everything else requires a session and
 * renders inside the AppShell (sidebar + content). Onboarding is no longer a
 * separate wizard — it's a setup checklist on the Overview.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { CostSourcesPage } from "./pages/CostSourcesPage";
import { Dashboard } from "./pages/Dashboard";
import { FeatureDetail } from "./pages/FeatureDetail";
import { FeaturesPage } from "./pages/FeaturesPage";
import { Login } from "./pages/Login";
import { SettingsPage } from "./pages/SettingsPage";
import { Signup } from "./pages/Signup";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-center muted">Loading…</div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <Login />
          </PublicOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicOnly>
            <Signup />
          </PublicOnly>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/cost-sources" element={<CostSourcesPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/features/:id" element={<FeatureDetail />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/dashboard" element={<Navigate to="/" replace />} />
      <Route path="/onboarding" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
