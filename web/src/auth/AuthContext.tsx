/**
 * Auth context — holds the current user and exposes signup/login/logout.
 *
 * On mount it asks the backend who's logged in (`/auth/me`) so a refresh keeps
 * you signed in. `loading` is true until that first check resolves.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type User } from "../api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) {
          // Unexpected error (e.g. backend down) — leave user null, stop loading.
          console.error("auth check failed", err);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // After auth, hydrate from /auth/me so the user carries the enriched fields
  // (org_name, is_admin, impersonating) — the login/signup responses don't.
  const signup = async (email: string, password: string) => {
    await api.signup(email, password);
    setUser(await api.me());
  };
  const login = async (email: string, password: string) => {
    await api.login(email, password);
    setUser(await api.me());
  };
  const logout = async () => {
    await api.logout();
    setUser(null);
  };
  const refresh = async () => setUser(await api.me());

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
