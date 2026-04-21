"use client";
import { useState, useCallback, useEffect } from "react";
import type { AlertEvent } from "@/lib/alert-engine";
import { safeReadJson, safeWriteJson } from "./safe-local-storage";

const KEY       = "hl_alert_events";
const EVT       = "hl:alert-events-changed";
const EXPIRE_MS = 7 * 86_400_000;

type NewAlertEvent = Omit<AlertEvent, "id" | "seen">;

function read(): AlertEvent[] {
  const all = safeReadJson<AlertEvent[]>(KEY, []);
  return all.filter(e => Date.now() - new Date(e.detected_at).getTime() < EXPIRE_MS);
}

function write(events: AlertEvent[]) {
  safeWriteJson(KEY, events);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export function useAlertEvents() {
  const [events, setEvents] = useState<AlertEvent[]>([]);

  useEffect(() => {
    const clean = read();
    setEvents(clean);
    write(clean); // prune expired on mount
    const handler = () => setEvents(read());
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, []);

  const addEvents = useCallback((incoming: NewAlertEvent[]) => {
    if (incoming.length === 0) return;
    const stamped = incoming.map(e => ({ ...e, id: crypto.randomUUID(), seen: false }));
    const next = [...stamped, ...read()];
    write(next); setEvents(next);
  }, []);

  const markAllSeen = useCallback(() => {
    const next = read().map(e => ({ ...e, seen: true }));
    write(next); setEvents(next);
  }, []);

  const unseenCount = events.filter(e => !e.seen).length;

  return { events, addEvents, markAllSeen, unseenCount };
}
