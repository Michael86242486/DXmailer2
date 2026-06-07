import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Zap, Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react";

export default function Signup() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Signup failed"); return; }
      navigate(`/verify?email=${encodeURIComponent(email)}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const strong = password.length >= 8;

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center">
            <Zap size={14} className="text-black" />
          </div>
          <span className="text-sm font-bold tracking-widest uppercase text-white">ORACLEX</span>
        </Link>

        <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl p-8">
          <h1 className="text-xl font-bold text-white mb-1">Create account</h1>
          <p className="text-sm text-white/35 mb-6">Send transactional emails with ORACLEX</p>

          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
            <div>
              <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1.5">Email</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
                className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-white/30 transition-colors"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
                  className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-white/20 outline-none focus:border-white/30 transition-colors"
                  placeholder="Min 8 characters"
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {password && (
                <div className={`flex items-center gap-1.5 mt-1.5 text-[11px] ${strong ? "text-emerald-400" : "text-white/30"}`}>
                  <CheckCircle2 size={11} />
                  {strong ? "Password strength: good" : "At least 8 characters required"}
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

            <button type="submit" disabled={loading || !email || !strong}
              className="w-full bg-white text-black font-semibold text-sm py-2.5 rounded-lg hover:bg-white/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 size={14} className="animate-spin" /> : "Create account"}
            </button>
          </form>

          <p className="text-xs text-white/20 mt-4 text-center">
            A 6-digit verification code will be sent to your email.
          </p>
        </div>

        <p className="text-center text-sm text-white/30 mt-4">
          Have an account?{" "}
          <Link href="/login" className="text-white/70 hover:text-white transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
