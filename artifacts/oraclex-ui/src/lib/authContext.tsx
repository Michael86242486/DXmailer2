import { createContext, useContext, useState, useEffect, useCallback } from "react";

interface AuthUser { id: number; email: string; }
interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  apiKey: string | null;
  login: (token: string) => Promise<void>;
  logout: () => void;
  setApiKey: (key: string) => void;
  isLoading: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async (t: string) => {
    const res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new Error("Unauthorized");
    return res.json() as Promise<AuthUser>;
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("oraclex_token");
    const savedKey = localStorage.getItem("oraclex_api_key");
    if (savedKey) setApiKeyState(savedKey);
    if (!saved) { setIsLoading(false); return; }
    setToken(saved);
    fetchMe(saved)
      .then((u) => setUser(u))
      .catch(() => { localStorage.removeItem("oraclex_token"); })
      .finally(() => setIsLoading(false));
  }, [fetchMe]);

  const login = useCallback(async (t: string) => {
    localStorage.setItem("oraclex_token", t);
    setToken(t);
    const u = await fetchMe(t);
    setUser(u);
  }, [fetchMe]);

  const logout = useCallback(() => {
    localStorage.removeItem("oraclex_token");
    setToken(null);
    setUser(null);
  }, []);

  const setApiKey = useCallback((key: string) => {
    localStorage.setItem("oraclex_api_key", key);
    setApiKeyState(key);
  }, []);

  return (
    <Ctx.Provider value={{ user, token, apiKey, login, logout, setApiKey, isLoading }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
