import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import Layout from "@/components/Layout";
import {
  Send, CheckCircle2, XCircle, Clock, TrendingUp,
  ArrowRight, Loader2, RefreshCw, Zap, AlertTriangle
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const TEMPLATES = ["verification", "otp", "password-reset", "magic-link"];

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  queued: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  processing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

function UsageBar() {
  const { data: usage, isLoading } = useQuery({
    queryKey: ["usage"],
    queryFn: api.getUsage,
    refetchInterval: 10000,
  });

  const pct = usage?.pct_used ?? 0;
  const critical = pct >= 90;
  const warning = pct >= 70;

  const barColor = critical
    ? "bg-gradient-to-r from-red-500 to-red-400"
    : warning
    ? "bg-gradient-to-r from-amber-500 to-yellow-400"
    : "bg-gradient-to-r from-blue-500 to-violet-500";

  const resets = usage?.resets_at
    ? new Date(usage.resets_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap size={13} className="text-blue-400" />
          <span className="text-xs font-semibold text-white">Daily Email Quota</span>
          <span className="text-[10px] uppercase tracking-wider text-white/30 bg-white/5 px-1.5 py-0.5 rounded">
            {usage?.tier ?? "free"}
          </span>
        </div>
        <span className="text-xs text-white/30">
          Resets at {resets} UTC
        </span>
      </div>

      {isLoading ? (
        <div className="h-2 w-full bg-white/[0.05] rounded-full animate-pulse mb-2" />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 bg-white/[0.05] rounded-full h-2 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-700", barColor)}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <span className={cn("text-xs font-semibold tabular-nums w-10 text-right",
              critical ? "text-red-400" : warning ? "text-amber-400" : "text-white/60")}>
              {pct.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/40">
              <span className={cn("font-semibold", critical ? "text-red-400" : "text-white/70")}>{usage?.emails_today ?? 0}</span>
              {" "}/ {usage?.email_quota ?? 100} emails used today
            </span>
            <span className="text-[11px] text-white/30">
              {usage?.remaining ?? 100} remaining
            </span>
          </div>
          {critical && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-400">
              <AlertTriangle size={11} />
              <span>Quota almost full — emails will be blocked at 100%</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();
  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ["stats"], queryFn: api.getStats, refetchInterval: 5000 });
  const { data: emails, isLoading: emailsLoading } = useQuery({ queryKey: ["emails-recent"], queryFn: () => api.getEmails({ limit: 8 }), refetchInterval: 5000 });

  const [to, setTo] = useState("michaelademola8624@gmail.com");
  const [template, setTemplate] = useState("verification");
  const [code, setCode] = useState("882941");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMut = useMutation({
    mutationFn: () => api.sendEmail({ to, template, senderName: "ORACLEX Master Control", data: { code, company: "ORACLEX Lab Ecosystem", date: "2026" } }),
    onSuccess: (d) => { setSent(d.messageId); setError(null); qc.invalidateQueries(); },
    onError: (err: Error & { status?: number }) => {
      setError(err.status === 429 ? "Daily quota exceeded — you've hit today's email limit." : err.message);
      setSent(null);
    },
  });

  const STAT_CARDS = [
    { label: "Sent", value: stats?.sent ?? 0, icon: CheckCircle2, color: "text-emerald-400" },
    { label: "Failed", value: stats?.failed ?? 0, icon: XCircle, color: "text-red-400" },
    { label: "Queued", value: stats?.queue ?? 0, icon: Clock, color: "text-amber-400" },
    { label: "Success Rate", value: `${stats?.success_rate ?? 100}%`, icon: TrendingUp, color: "text-blue-400" },
  ];

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Overview</h1>
          <p className="text-sm text-white/35">ORACLEX Mail Engine · Gmail Rotation Matrix active</p>
        </div>

        {/* Usage bar */}
        <UsageBar />

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {STAT_CARDS.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-white/35 uppercase tracking-wider font-medium">{label}</span>
                <Icon size={14} className={color} />
              </div>
              {statsLoading ? (
                <div className="h-7 w-16 bg-white/[0.05] rounded animate-pulse" />
              ) : (
                <div className="text-2xl font-bold text-white">{value}</div>
              )}
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Quick Send */}
          <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl p-6">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Send size={13} className="text-white/40" /> Send test email
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-white/30 uppercase tracking-wider mb-1.5">To</label>
                <input value={to} onChange={(e) => setTo(e.target.value)}
                  className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/30 transition-colors font-mono" />
              </div>
              <div>
                <label className="block text-[11px] text-white/30 uppercase tracking-wider mb-1.5">Template</label>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATES.map((t) => (
                    <button key={t} onClick={() => setTemplate(t)}
                      className={cn("text-xs px-3 py-1.5 rounded-md border transition-all",
                        template === t ? "bg-white text-black border-white" : "border-white/10 text-white/40 hover:text-white/70")}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              {(template === "verification" || template === "otp") && (
                <div>
                  <label className="block text-[11px] text-white/30 uppercase tracking-wider mb-1.5">Code</label>
                  <input value={code} onChange={(e) => setCode(e.target.value)}
                    className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/30 transition-colors font-mono" />
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
                  <AlertTriangle size={13} className="text-red-400 shrink-0" />
                  <p className="text-xs text-red-300">{error}</p>
                  <button onClick={() => setError(null)} className="ml-auto text-red-400/40 hover:text-red-400"><RefreshCw size={12} /></button>
                </div>
              )}

              {sent ? (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3">
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <div>
                    <p className="text-xs text-emerald-300">Queued successfully</p>
                    <p className="text-[11px] text-emerald-400/60 font-mono truncate">{sent}</p>
                  </div>
                  <button onClick={() => setSent(null)} className="ml-auto text-emerald-400/40 hover:text-emerald-400">
                    <RefreshCw size={12} />
                  </button>
                </div>
              ) : !error ? (
                <button onClick={() => sendMut.mutate()} disabled={sendMut.isPending || !to}
                  className="w-full bg-white text-black font-semibold text-sm py-2.5 rounded-lg hover:bg-white/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                  {sendMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <><Send size={13} /> Send Email</>}
                </button>
              ) : (
                <button onClick={() => { setError(null); sendMut.mutate(); }} disabled={sendMut.isPending || !to}
                  className="w-full bg-white text-black font-semibold text-sm py-2.5 rounded-lg hover:bg-white/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                  {sendMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <><RefreshCw size={13} /> Try again</>}
                </button>
              )}
            </div>
          </div>

          {/* Recent emails */}
          <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Recent Emails</h2>
              <Link href="/emails" className="text-xs text-white/30 hover:text-white flex items-center gap-1 transition-colors">
                View all <ArrowRight size={11} />
              </Link>
            </div>
            {emailsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 bg-white/[0.03] rounded-lg animate-pulse" />
                ))}
              </div>
            ) : emails?.data.length === 0 ? (
              <div className="text-center py-8 text-white/20 text-sm">
                No emails yet. Send one above!
              </div>
            ) : (
              <div className="space-y-1">
                {emails?.data.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.03] transition-colors">
                    <div className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", STATUS_STYLES[e.status] ?? "bg-white/10 text-white/50 border-white/10")}>
                      {e.status}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/70 truncate">{e.to_address}</p>
                      <p className="text-[11px] text-white/25">{e.template}</p>
                    </div>
                    <span className="text-[10px] text-white/20 shrink-0">{formatDate(e.queued_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
