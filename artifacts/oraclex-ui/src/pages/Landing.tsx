import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Zap, ArrowRight, CheckCircle, Server, Shield, BarChart3, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const DEMO_TEMPLATES = ["verification", "otp", "password-reset", "magic-link"];

export default function Landing() {
  const [email, setEmail] = useState("michaelademola8624@gmail.com");
  const [template, setTemplate] = useState("verification");
  const [sent, setSent] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const send = useMutation({
    mutationFn: () =>
      api.sendEmail({
        to: email,
        template,
        senderName: "ORACLEX Master Control",
        data: { code: "882941", company: "ORACLEX Lab Ecosystem", date: "2026" },
      }),
    onSuccess: () => setSent(true),
  });

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-black/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center">
              <Zap size={14} className="text-black" />
            </div>
            <span className="text-sm font-bold tracking-widest uppercase">ORACLEX</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm text-white/50">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#how" className="hover:text-white transition-colors">How it works</a>
            <a href="#api" className="hover:text-white transition-colors">API</a>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-white/60 hover:text-white transition-colors px-3 py-1.5">
              Dashboard
            </Link>
            <Link href="/dashboard"
              className="text-sm font-medium bg-white text-black px-4 py-1.5 rounded-full hover:bg-white/90 transition-colors">
              Get started
            </Link>
          </div>

          <button className="md:hidden text-white/60 hover:text-white" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t border-white/[0.06] bg-black px-6 py-4 space-y-3">
            <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="block text-sm text-white/60 hover:text-white">Dashboard</Link>
            <Link href="/emails" onClick={() => setMenuOpen(false)} className="block text-sm text-white/60 hover:text-white">Emails</Link>
            <Link href="/relay-pool" onClick={() => setMenuOpen(false)} className="block text-sm text-white/60 hover:text-white">Relay Pool</Link>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="pt-40 pb-28 px-6 text-center relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(255,255,255,0.05),transparent)] pointer-events-none" />
        <div className="max-w-3xl mx-auto relative">
          <div className="inline-flex items-center gap-2 border border-white/10 rounded-full px-4 py-1.5 text-xs text-white/50 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            ORACLEX v2 — Novu-powered architecture
          </div>

          <h1 className="text-5xl md:text-7xl font-serif font-bold leading-[1.05] tracking-tight mb-6 text-white">
            Email for<br />
            <span className="text-white/40">developers.</span>
          </h1>

          <p className="text-lg md:text-xl text-white/40 max-w-xl mx-auto mb-12 leading-relaxed">
            The best way to reach your users instead of spam folders. Deliver transactional emails at scale with Gmail rotation.
          </p>

          {/* Interactive demo — Resend-style */}
          <div className="max-w-md mx-auto">
            <div className="bg-[#0d0d0d] border border-white/10 rounded-2xl p-5 text-left shadow-2xl">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2.5 h-2.5 rounded-full bg-[#333]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#333]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#333]" />
                <span className="ml-auto text-[11px] text-white/20 font-mono">POST /api/v1/email/send</span>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] text-white/30 uppercase tracking-wider mb-1.5">Recipient</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#141414] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-white/30 transition-colors font-mono"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-white/30 uppercase tracking-wider mb-1.5">Template</label>
                  <div className="flex gap-2 flex-wrap">
                    {DEMO_TEMPLATES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setTemplate(t)}
                        className={cn(
                          "text-xs px-3 py-1.5 rounded-md border transition-all",
                          template === t
                            ? "bg-white text-black border-white"
                            : "border-white/10 text-white/40 hover:text-white/70 hover:border-white/20"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {sent ? (
                  <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3">
                    <CheckCircle size={15} className="text-emerald-400 shrink-0" />
                    <span className="text-sm text-emerald-300">Queued! Check {email}</span>
                  </div>
                ) : (
                  <button
                    onClick={() => send.mutate()}
                    disabled={send.isPending || !email}
                    className="w-full bg-white text-black font-semibold text-sm py-2.5 rounded-lg hover:bg-white/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                  >
                    {send.isPending ? (
                      <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    ) : (
                      <>Send test email <ArrowRight size={14} /></>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-white/[0.06] py-10 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { label: "Relay Nodes", value: "2" },
            { label: "Daily Capacity", value: "1,000" },
            { label: "Templates", value: "4" },
            { label: "Delivery", value: "MailChannels" },
          ].map(({ label, value }) => (
            <div key={label}>
              <div className="text-2xl md:text-3xl font-bold text-white mb-1">{value}</div>
              <div className="text-xs text-white/30 uppercase tracking-wider">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-center mb-16 text-white">
            First-class developer<br /><span className="text-white/30">experience.</span>
          </h2>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon: Server,
                title: "Gmail Rotation Matrix",
                desc: "LRU-based rotation across your Gmail pool. 500 emails/day per account, automatic daily reset at midnight UTC.",
              },
              {
                icon: Shield,
                title: "Queue-First Architecture",
                desc: "Requests return 202 instantly. Cloudflare Queues deliver asynchronously. Zero timeouts on your API calls.",
              },
              {
                icon: BarChart3,
                title: "Novu-Inspired Activity Feed",
                desc: "Per-step execution traces, subscriber profiles, webhook events, and full notification history.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-[#090909] border border-white/[0.07] rounded-2xl p-6 hover:border-white/15 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center mb-4">
                  <Icon size={16} className="text-white/60" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
                <p className="text-sm text-white/35 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-20 px-6 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-serif font-bold mb-5 text-white">
            One curl. Email delivered.
          </h2>
          <p className="text-white/35 mb-10 text-sm">No SMTP sockets. No complex setup. Just a POST request.</p>
          <div className="bg-[#080808] border border-white/[0.08] rounded-2xl p-6 text-left overflow-x-auto">
            <pre className="text-xs md:text-sm font-mono text-white/70 leading-relaxed whitespace-pre-wrap break-all">
{`curl -X POST /api/v1/email/send \\
  -H "Authorization: Bearer oraclex_live_test_key_xyz123" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "you@example.com",
    "template": "verification",
    "senderName": "ORACLEX Master Control",
    "data": {
      "code": "882941",
      "company": "ORACLEX Lab Ecosystem",
      "date": "2026"
    }
  }'`}
            </pre>
            <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                <CheckCircle size={11} className="text-emerald-400" />
              </div>
              <code className="text-xs font-mono text-emerald-400">{"{ \"messageId\": \"uuid\", \"status\": \"queued\" }"}</code>
              <span className="ml-auto text-[10px] text-white/20 font-mono">HTTP 202</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 text-center border-t border-white/[0.06]">
        <h2 className="text-3xl md:text-4xl font-serif font-bold text-white mb-4">Ready to send?</h2>
        <p className="text-white/35 mb-8 text-sm">Open your dashboard, view delivery logs, and manage your relay pool.</p>
        <Link href="/dashboard"
          className="inline-flex items-center gap-2 bg-white text-black font-semibold px-6 py-3 rounded-full text-sm hover:bg-white/90 transition-colors">
          Open Dashboard <ArrowRight size={14} />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-8 px-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Zap size={13} className="text-white/30" />
          <span className="text-xs font-bold tracking-widest uppercase text-white/30">ORACLEX</span>
        </div>
        <p className="text-xs text-white/20">© 2026 ORACLEX Lab Ecosystem · Mail Engine v2</p>
      </footer>
    </div>
  );
}
