# Lessons

- [2026-04-13] Generated a fake logo with green split coloring for brainstorm HTML → Rule: before writing any standalone HTML that includes brand elements (logo, nav, colors, typography), read `components/nav.tsx` and `lib/design-tokens.ts` first. Never invent visual styles from memory. Replicate exact values from the source files.
- [2026-04-13] Invented a new badge style for TierBadge (custom font, border, colors) when `ios-pill` already exists as the established badge pattern used on /brief, /morning, etc. → Rule: before implementing any UI element, grep the codebase for existing similar components. If one exists, use it. Never design a new visual component without checking first. The question to ask is always "does this already exist?" not "what should this look like?"
