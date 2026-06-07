import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Mail, Server, Users, Webhook,
  ChevronRight, Zap, Menu, Key, BookOpen, LogOut, LogIn
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/authContext";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/relay-pool", label: "Relay Pool", icon: Server },
  { href: "/subscribers", label: "Subscribers", icon: Users },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/dashboard/api-keys", label: "API Keys", icon: Key },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-black flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 border-r border-white/[0.06] bg-[#050505] shrink-0 sticky top-0 h-screen">
        <SidebarContent location={location} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-56 bg-[#050505] border-r border-white/[0.06] flex flex-col">
            <SidebarContent location={location} onNav={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#050505]">
          <Link href="/" className="flex items-center gap-2">
            <Zap size={16} className="text-white" />
            <span className="text-sm font-bold text-white tracking-wider uppercase">ORACLEX</span>
          </Link>
          <button onClick={() => setOpen(true)} className="text-white/60 hover:text-white">
            <Menu size={20} />
          </button>
        </div>
        <main className="flex-1 p-6 md:p-8 max-w-6xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ location, onNav }: { location: string; onNav?: () => void }) {
  const { user, apiKey, logout } = useAuth();

  return (
    <>
      <div className="px-4 py-5 border-b border-white/[0.06]">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center shrink-0">
            <Zap size={14} className="text-black" />
          </div>
          <span className="text-sm font-bold text-white tracking-widest uppercase">ORACLEX</span>
        </Link>
        {user && (
          <p className="text-[10px] text-white/25 mt-2 truncate pl-0.5">{user.email}</p>
        )}
      </div>

      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = location === href || (href !== "/" && location.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={onNav}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all group",
                active
                  ? "bg-white/10 text-white font-medium"
                  : "text-white/45 hover:text-white/80 hover:bg-white/[0.04]"
              )}
            >
              <Icon size={15} className={cn(active ? "text-white" : "text-white/40 group-hover:text-white/70")} />
              {label}
              {active && <ChevronRight size={13} className="ml-auto text-white/30" />}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 pb-5 border-t border-white/[0.06] pt-4 space-y-2">
        <div className="rounded-md bg-white/[0.04] border border-white/[0.08] px-3 py-2.5">
          <p className="text-[10px] text-white/30 uppercase tracking-wider font-medium mb-1">API Key</p>
          <p className="text-[11px] font-mono text-white/60 truncate">
            {apiKey ? `${apiKey.slice(0, 20)}…` : "No key — create one in API Keys"}
          </p>
          <div className="flex items-center gap-1 mt-1">
            <div className={cn("w-1.5 h-1.5 rounded-full", apiKey ? "bg-emerald-400" : "bg-yellow-500")} />
            <span className="text-[10px] text-white/25">{apiKey ? "Live" : "Setup needed"}</span>
          </div>
        </div>

        {user ? (
          <button onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-colors">
            <LogOut size={12} /> Sign out
          </button>
        ) : (
          <Link href="/login"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-colors">
            <LogIn size={12} /> Sign in
          </Link>
        )}
      </div>
    </>
  );
}
