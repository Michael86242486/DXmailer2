import { useState, useRef, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/lib/authContext";
import { Zap, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";

export default function VerifyEmail() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const email = params.get("email") ?? "";
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { inputs.current[0]?.focus(); }, []);

  function handleChange(i: number, val: string) {
    if (!/^\d?$/.test(val)) return;
    const next = [...code];
    next[i] = val;
    setCode(next);
    if (val && i < 5) inputs.current[i + 1]?.focus();
    if (next.every((d) => d) && val) {
      void submit(next.join(""));
    }
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !code[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  async function submit(c: string) {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: c }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Invalid code"); setCode(["", "", "", "", "", ""]); inputs.current[0]?.focus(); return; }
      await login(data.token);
      navigate("/dashboard/api-keys");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setResending(true);
    await fetch("/api/auth/resend-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => {});
    setResent(true);
    setResending(false);
    setTimeout(() => setResent(false), 5000);
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center">
            <Zap size={14} className="text-black" />
          </div>
          <span className="text-sm font-bold tracking-widest uppercase text-white">ORACLEX</span>
        </div>

        <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={22} className="text-blue-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Check your email</h1>
          <p className="text-sm text-white/35 mb-1">We sent a 6-digit code to</p>
          <p className="text-sm font-medium text-white/70 mb-6">{email || "your email"}</p>

          <div className="flex gap-2 justify-center mb-4">
            {code.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputs.current[i] = el; }}
                type="text" inputMode="numeric" maxLength={1} value={d}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className="w-11 h-12 text-center text-lg font-bold bg-[#111] border border-white/10 rounded-lg text-white outline-none focus:border-white/40 transition-colors"
              />
            ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 text-white/50 text-sm mb-3">
              <Loader2 size={13} className="animate-spin" /> Verifying…
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">{error}</p>}
          {resent && <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 mb-3">New code sent!</p>}

          <button onClick={() => { void resend(); }} disabled={resending}
            className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 mx-auto transition-colors">
            <RefreshCw size={11} className={resending ? "animate-spin" : ""} />
            Resend code
          </button>
        </div>
      </div>
    </div>
  );
}
