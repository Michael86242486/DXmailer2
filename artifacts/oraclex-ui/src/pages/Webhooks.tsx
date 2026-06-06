import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import Layout from "@/components/Layout";
import { Webhook, Trash2, Plus, Loader2, CheckCircle2 } from "lucide-react";

export default function Webhooks() {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("sent,failed");
  const [added, setAdded] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["webhooks"], queryFn: api.getWebhooks });

  const create = useMutation({
    mutationFn: () => api.createWebhook({ url, events }),
    onSuccess: () => { setUrl(""); setAdded(true); qc.invalidateQueries({ queryKey: ["webhooks"] }); setTimeout(() => setAdded(false), 3000); },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteWebhook(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Webhooks</h1>
          <p className="text-sm text-white/35">Get notified on every sent or failed delivery event</p>
        </div>

        {/* Create form */}
        <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Plus size={13} className="text-white/40" /> Register webhook
          </h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <input value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="flex-1 bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-white/25 transition-colors font-mono" />
            <input value={events} onChange={(e) => setEvents(e.target.value)}
              placeholder="sent,failed"
              className="w-40 bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-white/25 transition-colors font-mono" />
            <button onClick={() => create.mutate()} disabled={create.isPending || !url}
              className="bg-white text-black text-sm font-semibold px-5 py-2 rounded-lg hover:bg-white/90 disabled:opacity-40 transition-all flex items-center gap-2 shrink-0">
              {create.isPending ? <Loader2 size={13} className="animate-spin" /> : added ? <CheckCircle2 size={13} className="text-emerald-600" /> : <Plus size={13} />}
              {added ? "Added!" : "Add"}
            </button>
          </div>
          <p className="text-xs text-white/20 mt-2">Events: comma-separated list of <code className="font-mono">sent</code> and/or <code className="font-mono">failed</code></p>
        </div>

        {/* List */}
        <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2].map((i) => <div key={i} className="h-12 bg-white/[0.03] rounded-lg animate-pulse" />)}
            </div>
          ) : !data?.length ? (
            <div className="text-center py-14">
              <Webhook size={28} className="text-white/10 mx-auto mb-3" />
              <p className="text-sm text-white/25">No webhooks configured</p>
              <p className="text-xs text-white/15 mt-1">Add a URL above to receive delivery events</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {["URL", "Events", "Status", "Created", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] text-white/30 uppercase tracking-wider font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((hook) => (
                  <tr key={hook.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 text-xs text-white/60 font-mono max-w-[280px] truncate">{hook.url}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {hook.events.split(",").map((ev) => (
                          <span key={ev} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/50 border border-white/[0.08]">{ev.trim()}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{hook.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-white/25">{formatDate(hook.created_at)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => del.mutate(hook.id)} disabled={del.isPending}
                        className="text-white/20 hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-red-500/10">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Payload reference */}
        <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl p-6">
          <h3 className="text-sm font-semibold text-white mb-3">Webhook Payload</h3>
          <div className="bg-[#080808] rounded-lg p-4 font-mono text-xs text-white/50 leading-relaxed">
            {`{
  "event": "sent" | "failed",
  "timestamp": 1749241234567,
  "messageId": "uuid",
  "to": "user@example.com",
  "template": "verification",
  "relay": "oraclex.relay01@gmail.com",
  "reason": "string (only on failed)"
}`}
          </div>
        </div>
      </div>
    </Layout>
  );
}
