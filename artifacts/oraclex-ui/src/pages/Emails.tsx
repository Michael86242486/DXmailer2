import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Email } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import Layout from "@/components/Layout";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Search, RefreshCw, Eye } from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  queued: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  processing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const STATUSES = ["", "sent", "failed", "queued", "processing"];

export default function Emails() {
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Email | null>(null);
  const [execMsg, setExecMsg] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["emails", statusFilter, page],
    queryFn: () => api.getEmails({ status: statusFilter || undefined, page }),
    refetchInterval: 8000,
  });

  const { data: execData } = useQuery({
    queryKey: ["exec", execMsg],
    queryFn: () => api.getExecution(execMsg!),
    enabled: !!execMsg,
  });

  const filtered = (data?.data ?? []).filter((e) =>
    !search || e.to_address.toLowerCase().includes(search.toLowerCase()) || e.template.includes(search)
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Emails</h1>
            <p className="text-sm text-white/35">Full delivery log with execution traces</p>
          </div>
          <button onClick={() => refetch()} className="flex items-center gap-2 text-xs text-white/40 hover:text-white border border-white/[0.08] px-3 py-1.5 rounded-lg transition-colors">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email or template…"
              className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-white/25 transition-colors" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
                className={cn("text-xs px-3 py-2 rounded-lg border transition-all capitalize",
                  statusFilter === s ? "bg-white text-black border-white" : "border-white/[0.08] text-white/40 hover:text-white/70 hover:border-white/15")}>
                {s || "All"}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {["Status", "To", "Template", "Relay", "Queued", "Actions"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] text-white/30 uppercase tracking-wider font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-white/[0.04]">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-white/[0.04] rounded animate-pulse" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-white/20 text-sm">No emails found</td></tr>
                ) : (
                  filtered.map((e) => (
                    <tr key={e.id} className={cn("border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer", selected?.id === e.id && "bg-white/[0.03]")}
                      onClick={() => setSelected(selected?.id === e.id ? null : e)}>
                      <td className="px-4 py-3">
                        <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", STATUS_STYLES[e.status] ?? "bg-white/10 text-white/50 border-white/10")}>
                          {e.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/70 font-mono text-xs max-w-[180px] truncate">{e.to_address}</td>
                      <td className="px-4 py-3 text-white/50 text-xs">{e.template}</td>
                      <td className="px-4 py-3 text-white/30 text-xs font-mono truncate max-w-[120px]">{e.relay_node_email?.split("@")[0] ?? "—"}</td>
                      <td className="px-4 py-3 text-white/30 text-xs whitespace-nowrap">{formatDate(e.queued_at)}</td>
                      <td className="px-4 py-3">
                        <button onClick={(ev) => { ev.stopPropagation(); setExecMsg(execMsg === e.message_id ? null : e.message_id); }}
                          className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/70 border border-white/[0.08] hover:border-white/20 px-2 py-1 rounded transition-all">
                          <Eye size={10} /> Trace
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.pagination.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
              <span className="text-xs text-white/30">{data.pagination.total} total</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-1.5 rounded-md border border-white/[0.08] text-white/40 hover:text-white disabled:opacity-30 transition-colors">
                  <ChevronLeft size={13} />
                </button>
                <span className="text-xs text-white/40">{page} / {data.pagination.pages}</span>
                <button onClick={() => setPage((p) => Math.min(data.pagination.pages, p + 1))} disabled={page >= data.pagination.pages}
                  className="p-1.5 rounded-md border border-white/[0.08] text-white/40 hover:text-white disabled:opacity-30 transition-colors">
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Execution detail panel */}
        {execMsg && execData && (
          <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl p-6">
            <h3 className="text-sm font-semibold text-white mb-1">Execution Trace</h3>
            <p className="text-[11px] text-white/25 font-mono mb-4 truncate">{execMsg}</p>
            <div className="relative pl-5">
              <div className="absolute left-1.5 top-0 bottom-0 w-px bg-white/[0.06]" />
              {execData.steps.map((s, i) => (
                <div key={i} className="relative mb-4 last:mb-0">
                  <div className={cn("absolute -left-[17px] w-3 h-3 rounded-full border-2 mt-0.5",
                    s.status === "sent" ? "bg-emerald-400 border-emerald-600" :
                    s.status === "failed" ? "bg-red-400 border-red-600" :
                    s.status === "processing" ? "bg-blue-400 border-blue-600" : "bg-amber-400 border-amber-600"
                  )} />
                  <p className="text-xs text-white/70">{s.detail}</p>
                  <p className="text-[10px] text-white/25 mt-0.5">{formatDate(s.created_at)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
