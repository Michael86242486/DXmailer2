import { useState } from "react";
import { useAuth } from "@/lib/authContext";
import Layout from "@/components/Layout";
import { Copy, Check, ChevronRight, Zap, Key, Code2, BookOpen, AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

function useClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string, id: string) {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }
  return { copied, copy };
}

function CodeBlock({ code, lang = "bash", id, copy, copied }: { code: string; lang?: string; id: string; copy: (t: string, id: string) => void; copied: string | null }) {
  return (
    <div className="relative group bg-[#080808] border border-white/[0.07] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        <span className="text-[10px] text-white/25 uppercase tracking-wider font-medium">{lang}</span>
        <button onClick={() => copy(code, id)}
          className={cn("flex items-center gap-1.5 text-[10px] transition-colors", copied === id ? "text-emerald-400" : "text-white/25 hover:text-white/60")}>
          {copied === id ? <Check size={10} /> : <Copy size={10} />}
          {copied === id ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="px-4 py-4 text-xs font-mono text-white/70 overflow-x-auto whitespace-pre leading-relaxed">{code}</pre>
    </div>
  );
}

const SECTIONS = [
  { id: "quickstart", label: "Quick Start", icon: Zap },
  { id: "api-reference", label: "API Reference", icon: BookOpen },
  { id: "examples", label: "Code Examples", icon: Code2 },
  { id: "errors", label: "Error Codes", icon: AlertTriangle },
];

export default function Docs() {
  const { apiKey } = useAuth();
  const displayKey = apiKey || "oraclex_live_YOUR_KEY_HERE";
  const { copied, copy } = useClipboard();
  const [activeTab, setActiveTab] = useState("curl");
  const [activeSection, setActiveSection] = useState("quickstart");

  const BASE = typeof window !== "undefined" ? window.location.origin : "";

  const samples: Record<string, string> = {
    curl: `curl -X POST ${BASE}/api/v1/email/send \\
  -H "Authorization: Bearer ${displayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "user@example.com",
    "template": "verification",
    "data": {
      "code": "882941",
      "company": "Acme Corp"
    }
  }'`,
    nodejs: `const response = await fetch('${BASE}/api/v1/email/send', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${displayKey}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to: 'user@example.com',
    template: 'verification',
    data: { code: '882941', company: 'Acme Corp' },
  }),
});

const { messageId, status } = await response.json();
console.log(\`Queued: \${messageId} (\${status})\`);`,
    python: `import requests

response = requests.post(
    '${BASE}/api/v1/email/send',
    headers={
        'Authorization': 'Bearer ${displayKey}',
        'Content-Type': 'application/json',
    },
    json={
        'to': 'user@example.com',
        'template': 'verification',
        'data': {'code': '882941', 'company': 'Acme Corp'},
    }
)

data = response.json()
print(f"Queued: {data['messageId']} ({data['status']})")`,
    php: `<?php
$ch = curl_init('${BASE}/api/v1/email/send');
curl_setopt_array($ch, [
    CURLOPT_POST           => 1,
    CURLOPT_RETURNTRANSFER => 1,
    CURLOPT_HTTPHEADER     => [
        'Authorization: Bearer ${displayKey}',
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS     => json_encode([
        'to'       => 'user@example.com',
        'template' => 'verification',
        'data'     => ['code' => '882941', 'company' => 'Acme Corp'],
    ]),
]);
$response = json_decode(curl_exec($ch), true);
echo "Queued: {$response['messageId']} ({$response['status']})";`,
    nextjs: `// app/api/send/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json();

  const res = await fetch('${BASE}/api/v1/email/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ${displayKey}',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: body.email,
      template: 'verification',
      data: { code: body.code, company: 'My App' },
    }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}`,
  };

  return (
    <Layout>
      <div className="flex gap-8">
        {/* Sticky sidebar */}
        <aside className="hidden xl:block w-44 shrink-0">
          <div className="sticky top-8 space-y-0.5">
            <p className="text-[10px] text-white/25 uppercase tracking-wider px-3 mb-2">Contents</p>
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <a key={id} href={`#${id}`} onClick={() => setActiveSection(id)}
                className={cn("flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors", activeSection === id ? "text-white bg-white/[0.06]" : "text-white/35 hover:text-white/70")}>
                <Icon size={12} />
                {label}
              </a>
            ))}
            <div className="pt-3 border-t border-white/[0.06] mt-3">
              <a href="/api/docs" target="_blank" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-white/25 hover:text-white/60 transition-colors">
                <ExternalLink size={11} />
                Swagger UI
              </a>
            </div>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-12">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Developer Docs</h1>
            <p className="text-white/40 text-base">Send transactional emails in 3 lines of code.</p>
            {!apiKey && (
              <div className="mt-4 flex items-center gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 text-xs text-amber-400/80">
                <Key size={12} />
                <span>Create an API key first — your key will auto-fill all examples below.</span>
                <a href="/dashboard/api-keys" className="ml-auto text-amber-300 hover:underline font-medium">Get key →</a>
              </div>
            )}
          </div>

          {/* ─── Quick Start ─── */}
          <section id="quickstart">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Zap size={16} className="text-blue-400" /> Quick Start</h2>
            <div className="space-y-4">
              {[
                {
                  step: "1", title: "Get your API key", body: (
                    <p className="text-sm text-white/50">Go to <a href="/dashboard/api-keys" className="text-blue-400 hover:underline">Dashboard → API Keys</a> → <strong className="text-white/70">Create API key</strong>. Save it immediately — it's only shown once.</p>
                  )
                },
                {
                  step: "2", title: "Send your first email", body: (
                    <CodeBlock code={samples.curl} lang="bash" id="qs-curl" copy={copy} copied={copied} />
                  )
                },
                {
                  step: "3", title: "Get a 202 response", body: (
                    <CodeBlock code={`{\n  "messageId": "550e8400-e29b-41d4-a716-446655440000",\n  "status": "queued"\n}`} lang="json" id="qs-resp" copy={copy} copied={copied} />
                  )
                },
              ].map(({ step, title, body }) => (
                <div key={step} className="flex gap-4">
                  <div className="w-7 h-7 rounded-full bg-white/[0.06] border border-white/[0.10] flex items-center justify-center text-xs font-bold text-white/60 shrink-0 mt-0.5">{step}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white mb-2">{title}</p>
                    {body}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ─── API Reference ─── */}
          <section id="api-reference">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><BookOpen size={16} className="text-purple-400" /> API Reference</h2>

            {/* Send email */}
            <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl overflow-hidden mb-4">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                <span className="text-[10px] font-bold bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded">POST</span>
                <code className="text-xs text-white/70">/api/v1/email/send</code>
                <span className="ml-auto text-[11px] text-white/25">Returns 202</span>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Headers</p>
                  <table className="w-full text-xs">
                    <thead><tr>{["Header", "Value", "Required"].map((h) => <th key={h} className="text-left py-1 pr-4 text-white/25 font-normal">{h}</th>)}</tr></thead>
                    <tbody className="text-white/60">
                      <tr><td className="py-1 pr-4 font-mono text-white/50">Authorization</td><td className="py-1 pr-4">Bearer oraclex_live_…</td><td className="py-1 text-red-400">Yes</td></tr>
                      <tr><td className="py-1 pr-4 font-mono text-white/50">Content-Type</td><td className="py-1 pr-4">application/json</td><td className="py-1 text-red-400">Yes</td></tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Body Parameters</p>
                  <table className="w-full text-xs">
                    <thead><tr>{["Field", "Type", "Required", "Description"].map((h) => <th key={h} className="text-left py-1 pr-4 text-white/25 font-normal">{h}</th>)}</tr></thead>
                    <tbody className="text-white/60">
                      {[
                        ["to", "string", "Yes", "Recipient email address"],
                        ["template", "enum", "Yes", "verification · otp · password-reset · magic-link"],
                        ["senderName", "string", "No", "Override relay sender display name"],
                        ["data.code", "string", "No", "6-digit code for verification/otp templates"],
                        ["data.company", "string", "No", "Company name shown in email body"],
                        ["data.resetUrl", "string", "No", "URL for password-reset template"],
                        ["data.magicUrl", "string", "No", "URL for magic-link template"],
                      ].map(([f, t, r, d]) => (
                        <tr key={f}><td className="py-1 pr-4 font-mono text-white/50">{f}</td><td className="py-1 pr-4 text-blue-400/70">{t}</td><td className={cn("py-1 pr-4", r === "Yes" ? "text-red-400" : "text-white/25")}>{r}</td><td className="py-1 text-white/40">{d}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Other endpoints */}
            {[
              { id: "stats", method: "GET", path: "/api/v1/stats", desc: "Delivery statistics (sent, failed, queue, success_rate)" },
              { id: "email-logs", method: "GET", path: "/api/v1/email/logs", desc: "Paginated delivery logs with relay info. ?status=sent|failed|queued&page=1&limit=20" },
              { id: "smtp-pool", method: "GET", path: "/api/v1/smtp/pool", desc: "Gmail rotation matrix status and daily quotas" },
              { id: "exec-detail", method: "GET", path: "/api/v1/activity/:id/execution-details", desc: "Step-by-step execution trace for a message" },
              { id: "webhooks-post", method: "POST", path: "/api/v1/webhooks", desc: "Register webhook URL. Body: {url, events: 'sent,failed'}" },
              { id: "subscribers-get", method: "GET", path: "/api/v1/subscribers", desc: "List subscribers. ?email=&page=1&limit=20" },
              { id: "subscribers-post", method: "POST", path: "/api/v1/subscribers", desc: "Upsert subscriber. Body: {subscriberId, email, firstName, lastName}" },
            ].map(({ id, method, path, desc }) => (
              <div key={id} className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl flex items-center gap-3 px-4 py-3 mb-2">
                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded shrink-0", method === "GET" ? "bg-blue-500/15 text-blue-400" : method === "POST" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>{method}</span>
                <code className="text-xs text-white/60 shrink-0">{path}</code>
                <span className="text-xs text-white/25 ml-2 truncate">{desc}</span>
              </div>
            ))}
          </section>

          {/* ─── Code Examples ─── */}
          <section id="examples">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Code2 size={16} className="text-amber-400" /> Code Examples</h2>
            <div className="flex gap-1 mb-4 bg-white/[0.03] rounded-lg p-1 w-fit">
              {[["curl", "cURL"], ["nodejs", "Node.js"], ["python", "Python"], ["php", "PHP"], ["nextjs", "Next.js"]].map(([id, label]) => (
                <button key={id} onClick={() => setActiveTab(id)}
                  className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-colors", activeTab === id ? "bg-white text-black" : "text-white/40 hover:text-white/70")}>
                  {label}
                </button>
              ))}
            </div>
            <CodeBlock code={samples[activeTab] ?? ""} lang={activeTab === "python" ? "python" : activeTab === "php" ? "php" : "typescript"} id={`ex-${activeTab}`} copy={copy} copied={copied} />
          </section>

          {/* ─── Error Codes ─── */}
          <section id="errors">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><AlertTriangle size={16} className="text-red-400" /> Error Codes</h2>
            <div className="bg-[#0a0a0a] border border-white/[0.07] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {["Code", "Name", "Meaning", "Fix"].map((h) => <th key={h} className="text-left px-4 py-3 text-[11px] text-white/25 uppercase tracking-wider font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["400", "Bad Request", "Missing required field (to, template)", "Add the missing field"],
                    ["401", "Unauthorized", "Missing or invalid API key", "Check your Bearer token"],
                    ["409", "Conflict", "Email already registered", "Use a different email or log in"],
                    ["429", "Rate Limited", "Too many requests", "Back off and retry with exponential delay"],
                    ["500", "Server Error", "Unexpected server failure", "Check /api/v1/health and retry"],
                  ].map(([code, name, meaning, fix]) => (
                    <tr key={code} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-4 py-3"><span className={cn("font-mono text-xs px-2 py-0.5 rounded font-bold", code[0] === "4" ? "bg-red-500/15 text-red-400" : "bg-orange-500/15 text-orange-400")}>{code}</span></td>
                      <td className="px-4 py-3 text-xs text-white/60 font-medium">{name}</td>
                      <td className="px-4 py-3 text-xs text-white/35">{meaning}</td>
                      <td className="px-4 py-3 text-xs text-emerald-400/70">{fix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 bg-blue-500/5 border border-blue-500/15 rounded-xl p-5 flex items-start gap-3">
              <ExternalLink size={14} className="text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-white/70 mb-1">Interactive API Explorer</p>
                <p className="text-xs text-white/30 mb-2">Try every endpoint live with your actual API key directly in the browser.</p>
                <a href="/api/docs" target="_blank" className="text-xs text-blue-400 hover:underline font-medium">Open Swagger UI →</a>
              </div>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
