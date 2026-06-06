import { useEffect, useState, useCallback } from "react";
import { useLiveStream, type StreamEvent } from "@/hooks/useLiveStream";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Clock, Zap, Wifi, WifiOff } from "lucide-react";

interface Toast {
  id: string;
  type: "queued" | "sent" | "failed" | "processing";
  to: string;
  template: string;
  relay?: string;
  reason?: string;
  ts: number;
}

const MAX_TOASTS = 5;
const TOAST_TTL = 6000;

export function LiveToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [connected, setConnected] = useState(false);

  const remove = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const onEvent = useCallback((evt: StreamEvent) => {
    if (evt.type === "connected") { setConnected(true); return; }
    if (evt.type === "processing") return; // don't toast processing

    const toast: Toast = {
      id: `${evt.type}-${Date.now()}-${Math.random()}`,
      type: evt.type,
      to: evt.to,
      template: evt.template,
      relay: "relay" in evt ? evt.relay : undefined,
      reason: "reason" in evt ? evt.reason : undefined,
      ts: Date.now(),
    };

    setToasts((prev) => [toast, ...prev].slice(0, MAX_TOASTS));
    setTimeout(() => remove(toast.id), TOAST_TTL);
  }, [remove]);

  useLiveStream(onEvent);

  // Track disconnect: if we get no event for 30s mark disconnected
  useEffect(() => {
    const t = setTimeout(() => setConnected(false), 30000);
    return () => clearTimeout(t);
  }, [connected]);

  return (
    <>
      {children}
      {/* Connection pill */}
      <div className="fixed bottom-4 left-4 z-50">
        <div className={cn(
          "flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1.5 rounded-full border transition-all",
          connected
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            : "bg-white/[0.04] border-white/10 text-white/30"
        )}>
          {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
          {connected ? "Live" : "Connecting…"}
        </div>
      </div>

      {/* Toast stack */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end" style={{ maxWidth: 340 }}>
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </>
  );
}

function Toast({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => { setVisible(false); setTimeout(onClose, 300); }, TOAST_TTL - 300);
    return () => clearTimeout(t);
  }, [onClose]);

  const cfg = {
    sent: {
      icon: CheckCircle2,
      label: "Delivered",
      iconClass: "text-emerald-400",
      bg: "bg-[#0d1a10] border-emerald-500/25",
    },
    failed: {
      icon: XCircle,
      label: "Failed",
      iconClass: "text-red-400",
      bg: "bg-[#1a0d0d] border-red-500/25",
    },
    queued: {
      icon: Clock,
      label: "Queued",
      iconClass: "text-amber-400",
      bg: "bg-[#1a160a] border-amber-500/20",
    },
    processing: {
      icon: Zap,
      label: "Sending…",
      iconClass: "text-blue-400",
      bg: "bg-[#0d1020] border-blue-500/20",
    },
  }[toast.type];

  const Icon = cfg.icon;

  return (
    <div className={cn(
      "flex items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl text-sm transition-all duration-300 w-full cursor-pointer",
      cfg.bg,
      visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
    )}
      onClick={onClose}
      style={{ backdropFilter: "blur(12px)" }}
    >
      <Icon size={15} className={cn("mt-0.5 shrink-0", cfg.iconClass)} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-white/80 text-xs">{cfg.label} · {toast.template}</p>
        <p className="text-[11px] text-white/40 truncate mt-0.5">{toast.to}</p>
        {toast.relay && (
          <p className="text-[10px] text-white/25 font-mono truncate mt-0.5">via {toast.relay.split("@")[0]}</p>
        )}
        {toast.reason && (
          <p className="text-[10px] text-red-400/60 truncate mt-0.5">{toast.reason}</p>
        )}
      </div>
    </div>
  );
}
