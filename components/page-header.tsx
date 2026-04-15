// components/page-header.tsx
"use client";

import { pageHeader as PH } from "@/lib/design-tokens";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  regime?: string;
  btcReturn?: number;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div style={PH.container}>
      <h1 style={PH.title}>{title}</h1>
      {subtitle && <p style={PH.subtitle}>{subtitle}</p>}
    </div>
  );
}
