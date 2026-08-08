// components/page-header.tsx
"use client";

import { pageHeader as PH, space } from "@/lib/design-tokens";
import { DataFreshness } from "@/components/data-freshness";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  regime?: string;
  btcReturn?: number;
  /** Age of the data this page is showing. Omit when the page has no single age. */
  updatedAt?: string | number | null;
}

export function PageHeader({ title, subtitle, updatedAt }: PageHeaderProps) {
  return (
    <div style={{
      ...PH.container,
      display:        "flex",
      alignItems:     "center",
      justifyContent: "space-between",
      gap:            space.cardGap,
    }}>
      <div>
        <h1 style={PH.title}>{title}</h1>
        {subtitle && <p style={PH.subtitle}>{subtitle}</p>}
      </div>
      {updatedAt !== undefined && <DataFreshness updatedAt={updatedAt} />}
    </div>
  );
}
