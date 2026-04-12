"use client";
// components/glow-init.tsx — global mousemove tracker for .glow-btn shimmer effect
import { useEffect } from "react";

export function GlowInit() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      (document.querySelectorAll<HTMLElement>(".glow-btn")).forEach((btn) => {
        const r = btn.getBoundingClientRect();
        btn.style.setProperty("--gx", ((e.clientX - r.left) / r.width  * 100) + "%");
        btn.style.setProperty("--gy", ((e.clientY - r.top)  / r.height * 100) + "%");
      });
    };
    document.addEventListener("mousemove", handler, { passive: true });
    return () => document.removeEventListener("mousemove", handler);
  }, []);
  return null;
}
