import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/authContext";
import Layout from "@/components/Layout";
import { formatDate } from "@/lib/utils";
import { Key, Plus, Trash2, Copy, Check, Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ApiKeyData { id: number; name: string; key_prefix: string; is_active: boolean; last_used_at: number | null; created_at: number; }
interface ApiKeyCreated extends ApiKeyData { key: string; }

export default function ApiKeys() {
  const { token, setApiKey: setGlobalKey } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<ApiKeyCreated | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [copied, setCopied] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const { data: keys, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async (): Promise<ApiKeyData[]> => {
      const res = await fetch("/api/v1/api-keys", { headers: { Authorization: `Bearer ${token}` } });
      return res.json();
    },
    enabled: !!token,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      return res.json() as Promise<ApiKeyCreated>;
    },
    onSuccess: (k) => {
      setNewKey(k);
      setGlobalKey(k.key);
      setName("");
      setFormOpen(false);
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/v1/api-keys/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">API Keys</h1>
            <p className="text-sm text-white/35">Manage your Bearer tokens for the ORACLEX API</p>
          </div>
          <button onClick={() => setFormOpen(!formOpen)}
            className="flex items-center gap-2 bg-white text-black text-sm font-semibold px-4 py-2 rounded-lg hover:bg-white/90 transition-colors shrink-0">
            <Plus size={13} /> Create API key
          </button>
        </div>

        {/* Create form */}
        {formOpen && (
          <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">New API key</h2>
            <div className="flex gap-3">
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production"
                className="flex-1 bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-white/30 transition-colors"
                onKeyDown={(e) => e.key === "Enter" && name && create.mutate()}
              />
              <button onClick={() => create.mutate()} disabled={create.isPending || !name}
                className="bg-white text-black text-sm font-semibold px-4 py-2 rounded-lg hover:bg-white/90 disabled:opacity-40 flex items-center gap-2">
                {create.isPending ? <Loader2 size={13} className="animate-spin" /> : "Create"}
              </button>
              <button onClick={() => setFormOpen(false)} className="text-white/30 hover:text-white px-2 transition-colors">✕</button>
            </div>
          </div>
        )}

        {/* New key reveal */}
        {newKey && (
          <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-300 mb-1">Save this key — it won't be shown again</p>
                <p className="text-xs text-amber-400/60 mb-3">{newKey.name}</p>
                <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs text-white/80">
                  <span className="flex-1 truncate">{showNew ? newKey.key : newKey.key.replace(/./g, "•").slice(0, 40)}</span>
                  <button onClick={() => setShowNew(!showNew)} className="text-white/30 hover:text-white shrink-0">
                    {showNew ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button onClick={() => copy(newKey.key)} className={cn("shrink-0 transition-colors", copied ? "text-emerald-400" : "text-white/40 hover:text-white")}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            </div>
            <button onClick={() => setNewKey(null)} className="mt-3 text-xs text-amber-400/40 hover:text-amber-300 transition-colors">I've saved this key ✓</button>
          </div>
        )}

        {/* Key list */}
        <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">{[1, 2].map((i) => <div key={i} className="h-14 bg-white/[0.03] rounded-lg animate-pulse" />)}</div>
          ) : !keys?.length ? (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
                <Key size={22} className="text-white/20" />
              </div>
              <p className="text-sm font-medium text-white/40 mb-1">No API keys yet</p>
              <p className="text-xs text-white/20">Generate an API key to authenticate requests and send emails through the API.</p>
              <button onClick={() => setFormOpen(true)}
                className="mt-4 flex items-center gap-2 bg-white text-black text-xs font-semibold px-4 py-2 rounded-lg hover:bg-white/90 transition-colors mx-auto">
                <Plus size={11} /> Create API key
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {["Name", "Key", "Last used", "Created", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] text-white/30 uppercase tracking-wider font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 text-sm text-white/80 font-medium">{k.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-white/40">{k.key_prefix}…</td>
                    <td className="px-4 py-3 text-xs text-white/30">{k.last_used_at ? formatDate(k.last_used_at) : "Never"}</td>
                    <td className="px-4 py-3 text-xs text-white/25">{formatDate(k.created_at)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => revoke.mutate(k.id)} disabled={revoke.isPending}
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

        <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl p-5">
          <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Usage</h3>
          <div className="bg-[#080808] rounded-lg p-4 font-mono text-xs text-white/50 leading-relaxed">
            <span className="text-white/25"># Use your API key as a Bearer token</span><br />
            curl -X POST /api/v1/email/send \<br />
            &nbsp;&nbsp;-H <span className="text-amber-300">"Authorization: Bearer oraclex_live_..."</span> \<br />
            &nbsp;&nbsp;-H <span className="text-amber-300">"Content-Type: application/json"</span> \<br />
            &nbsp;&nbsp;-d <span className="text-amber-300">'{`{"to":"user@example.com","template":"verification","data":{"code":"882941"}}`}'</span>
          </div>
          <p className="text-xs text-white/20 mt-2">Full docs at <a href="/api/docs" target="_blank" className="text-blue-400/70 hover:text-blue-400">/api/docs</a></p>
        </div>
      </div>
    </Layout>
  );
}
