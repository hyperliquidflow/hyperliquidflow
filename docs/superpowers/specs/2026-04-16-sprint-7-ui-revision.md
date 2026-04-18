# Sprint 7 — UI Design + Integration Revision

**Date:** 2026-04-16  
**Status:** Planned (run after Sprints 4, 5, 6 land)  
**Depends on:** Sprints 2, 3, 4, 5, 6 implementation complete

---

## Goal

Revisit the UI end-to-end after all analytics features have shipped. The goal is to step back from individual feature work and look at how everything fits together: visual consistency, navigation, information hierarchy, and the integration between features that were designed in isolation.

---

## Why this sprint exists

Sprints 2 through 6 each ship a page or feature designed on its own. By the time Sprint 6 lands, the app has:

- Bias Trend Chart + Heatmap (unified Divergence page from Sprint 2 + 3 mockup)
- Market Radar (per-asset view)
- Wallet Alerts + Paper Trading (stateful, interactive flows)
- Auth (login, account settings)

Each was approved as a mockup or design pass without seeing the full picture. Some decisions made in isolation will almost certainly feel wrong once they sit next to each other. This sprint is the "second pass" where we revise based on how the whole app reads.

---

## Scope

**In scope:**

- Visual audit across every page: does the design language hold up?
- Navigation and information architecture review: is the 5-item nav still right? Do the Signals tabs still group correctly?
- Cross-feature integration: are there places where two features should talk to each other that currently don't? (e.g. clicking a tier in the heatmap should filter the bias chart; clicking a wallet anywhere should open wallet profile)
- Data density and empty states: now that we have real data flowing across all features, do empty states, loading, and sparse-data handling feel right?
- The Divergence mockup specifically flagged for revision: data density handling, heatmap + lines pairing, visual hierarchy of the three summary stats
- Market Radar liquidation heatmap (Design 6) parked at `/signals/radar/designs` — decide whether to replace current `/signals/radar` view, live alongside it, or merge the two
- Copy and labels: review all user-facing strings for clarity and consistency

**Out of scope:**

- New features or analytics
- Backend/data model changes
- Performance work (belongs in its own sprint if needed)

---

## Inputs for the revision pass

Before starting, gather:

1. Screenshots of every page in production
2. The original mockups from the Divergence session (`.superpowers/brainstorm/38195-1776363699/content/real-data.html`)
3. The parked Radar liquidation heatmap at `app/signals/radar/designs/DesignsClient.tsx` (Design 6, Coinglass-style, 72h × price, 30-min bins, candles overlaid)
4. Any user feedback collected during Sprints 4 through 6
5. The design-tokens.ts file to confirm no drift has occurred

---

## Process

Start with a brainstorming pass (use the brainstorming skill). Walk through each page and list what feels off. Then decide: is this a token-level fix, a layout fix, or an information-architecture fix? Group findings, propose revisions, get approval, then execute.

---

## Deliverables

- Updated pages across the app reflecting the revision pass
- Any new tokens added to design-tokens.ts, with a note in the token file's header changelog
- A short retrospective note: what shipped in isolation that needed fixing, so future sprint design passes can watch for the same patterns
