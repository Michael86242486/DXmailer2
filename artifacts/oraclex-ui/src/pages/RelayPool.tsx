import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Layout from "@/components/Layout";
import { cn } from "@/lib/utils";
import { Server, Zap, AlertCircle, CheckCircle2 } from "lucide-react";

function Bar({ pct }: { pct: number }) {
  return (
    <div className="w-full bg-white/[0.05] rounded-full h-1.5 overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all", pct > 80 ? "bg-red-400" : pct > 50 ? "bg-amber-400" : "bg-emerald-400")}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

export default function RelayPool() {
  const { data: nodes, isLoading } = useQuery({
    queryKey: ["smtp-pool"],
    queryFn: api.getSmtpPool,
    refetchInterval: 10000,
  });

  const total = nodes?.reduce((s, n) => s + n.daily_sent_count, 0) ?? 0;
  const capacity = nodes?.reduce((s, n) => s + n.max_daily_limit, 0) ?? 0;
  const active = nodes?.filter((n) => n.status === "active").length ?? 0;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Relay Pool</h1>
          <p className="text-sm text-white/35">Gmail rotation matrix · LRU load balancing</p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Active Nodes", value: isLoading ? "—" : active, icon: Server, color: "text-emerald-400" },
            { label: "Sent Today", value: isLoading ? "—" : total.toLocaleString(), icon: Zap, color: "text-blue-400" },
            { label: "Daily Capacity", value: isLoading ? "—" : capacity.toLocaleString(), icon: CheckCircle2, color: "text-white/40" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] text-white/30 uppercase tracking-wider">{label}</span>
                <Icon size={13} className={color} />
              </div>
              <div className="text-2xl font-bold text-white">{value}</div>
            </div>
          ))}
        </div>

        {/* Node cards */}
        {isLoading ? (
          <div className="grid md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-48 bg-white/[0.03] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {nodes?.map((node, idx) => (
              <div key={node.id} className={cn(
                "bg-[#0a0a0a] border rounded-xl p-6 transition-all",
                node.status === "active" ? "border-white/[0.07]" : "border-red-500/20"
              )}>
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className={cn("w-2 h-2 rounded-full", node.status === "active" ? "bg-emerald-400 animate-pulse" : "bg-red-400")} />
                      <span className="text-xs text-white/40 uppercase tracking-wider font-medium">Relay Node {String(idx + 1).padStart(2, "0")}</span>
                    </div>
                    <p className="text-sm font-mono text-white/70">{node.email}</p>
                    <p className="text-[11px] text-white/25 mt-0.5">{node.sender_name}</p>
                  </div>
                  <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border",
                    node.status === "active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20")}>
                    {node.status}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-white/30">Daily usage</span>
                    <span className="text-white/60 font-mono">{node.daily_sent_count} / {node.max_daily_limit}</span>
                  </div>
                  <Bar pct={node.utilization_pct} />
                  <div className="flex justify-between text-xs mt-2">
                    <span className="text-white/25">{node.utilization_pct}% used</span>
                    <span className={cn("font-medium", node.remaining_today < 50 ? "text-red-400" : "text-white/50")}>
                      {node.remaining_today} remaining
                    </span>
                  </div>
                </div>

                {node.remaining_today === 0 && (
                  <div className="mt-4 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <AlertCircle size={12} className="text-red-400 shrink-0" />
                    <span className="text-xs text-red-300">Daily quota exhausted · Resets at 00:00 UTC</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* How LRU works */}
        <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl p-6">
          <h3 className="text-sm font-semibold text-white mb-3">LRU Rotation Logic</h3>
          <div className="bg-[#080808] rounded-lg p-4 font-mono text-xs text-white/50 leading-relaxed">
            <span className="text-white/25">-- Atomic LRU selector (runs before every delivery)</span><br />
            <span className="text-blue-400">SELECT</span> * <span className="text-blue-400">FROM</span> smtp_pool<br />
            <span className="text-blue-400">WHERE</span> status = <span className="text-amber-300">'active'</span><br />
            &nbsp;&nbsp;<span className="text-blue-400">AND</span> daily_sent_count {"<"} max_daily_limit<br />
            <span className="text-blue-400">ORDER BY</span> last_used_timestamp <span className="text-blue-400">ASC</span><br />
            <span className="text-blue-400">LIMIT</span> 1;
          </div>
          <p className="text-xs text-white/25 mt-3">The least-recently-used node with remaining quota is always selected. Resets daily at 00:00 UTC.</p>
        </div>
      </div>
    </Layout>
  );
}
