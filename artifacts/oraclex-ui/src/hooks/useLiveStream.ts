import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type StreamEvent =
  | { type: "queued"; messageId: string; to: string; template: string; emailId: number }
  | { type: "processing"; messageId: string; to: string; template: string }
  | { type: "sent"; messageId: string; to: string; template: string; relay: string; emailId: number }
  | { type: "failed"; messageId: string; to: string; template: string; reason: string; emailId: number }
  | { type: "connected"; clientId: string; ts: number };

const API_KEY = "oraclex_live_test_key_xyz123";

export function useLiveStream(onEvent?: (evt: StreamEvent) => void) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    // EventSource doesn't support custom headers, so we pass the key as a query param
    // backed by a short-lived token approach — we use a URL that the server will accept
    const url = `/api/v1/stream?apiKey=${encodeURIComponent(API_KEY)}`;
    const es = new EventSource(url);
    esRef.current = es;

    const EVENTS = ["connected", "queued", "processing", "sent", "failed"] as const;

    for (const evt of EVENTS) {
      es.addEventListener(evt, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as StreamEvent;
          onEventRef.current?.({ ...data, type: evt } as StreamEvent);
          // Invalidate queries on delivery state changes
          if (evt === "sent" || evt === "failed") {
            void qc.invalidateQueries({ queryKey: ["stats"] });
            void qc.invalidateQueries({ queryKey: ["emails"] });
            void qc.invalidateQueries({ queryKey: ["emails-recent"] });
            void qc.invalidateQueries({ queryKey: ["smtp-pool"] });
          }
        } catch { /* ignore parse errors */ }
      });
    }

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // Reconnect after 3 s
      setTimeout(connect, 3000);
    };
  }, [qc]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);
}
