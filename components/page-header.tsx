// components/page-header.tsx
"use client";

import { color } from "@/lib/design-tokens";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  regime?: string;
  btcReturn?: number;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div style={{ padding: "28px 32px 0" }}>
      <h1 style={{ fontSize: "26px", fontWeight: 700, color: color.text, margin: 0 }}>
        {title}
      </h1>
      {subtitle && (
        <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.38)", marginTop: "4px" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
