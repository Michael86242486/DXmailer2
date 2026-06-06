import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import Layout from "@/components/Layout";
import { Search, User, ChevronLeft, ChevronRight } from "lucide-react";

export default function Subscribers() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["subscribers", page, search],
    queryFn: () => api.getSubscribers({ page, email: search || undefined }),
    refetchInterval: 10000,
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Subscribers</h1>
          <p className="text-sm text-white/35">Contact profiles auto-created on each delivery</p>
        </div>

        <div className="relative max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by email…"
            className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-white/25 transition-colors" />
        </div>

        <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-white/[0.03] rounded-lg animate-pulse" />)}
            </div>
          ) : (data?.data ?? []).length === 0 ? (
            <div className="text-center py-16">
              <User size={32} className="text-white/10 mx-auto mb-3" />
              <p className="text-sm text-white/25">No subscribers yet</p>
              <p className="text-xs text-white/15 mt-1">Send emails via /events/trigger to auto-create subscriber profiles</p>
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {["Subscriber", "Email", "Phone", "Joined"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[11px] text-white/30 uppercase tracking-wider font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map((s) => (
                    <tr key={s.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0">
                            <span className="text-[11px] text-white/50 font-medium">
                              {(s.first_name?.[0] || s.email?.[0] || "?").toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="text-xs text-white/70">{s.first_name && s.last_name ? `${s.first_name} ${s.last_name}` : s.first_name || "—"}</p>
                            <p className="text-[10px] text-white/25 font-mono truncate max-w-[140px]">{s.subscriber_id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-white/50 font-mono">{s.email || "—"}</td>
                      <td className="px-4 py-3 text-xs text-white/30">{s.phone || "—"}</td>
                      <td className="px-4 py-3 text-xs text-white/25">{formatDate(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
