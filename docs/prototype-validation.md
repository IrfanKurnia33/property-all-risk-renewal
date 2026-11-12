# Prototype validation

Validated on **11 November 2026 (Asia/Jakarta)** with Node.js 24 and Microsoft Edge. This report covers the local production build; GitHub/Vercel publication has not been performed.

## Functional checks

- **25 Node tests passed**: transitions, withdrawn/unchanged confirmations, stale agreements, broker restrictions, coverage dates, persistence, document content/readiness, and download failures/cleanup.
- **9 production-build browser tests passed**. The full journey covers repeated negotiation, amendments, partial client response, blocked export, clarification, matching, renewed insurer agreement, Word download, client consent, binding, and acknowledgment.
- Additional checks cover resume/reset, storage recovery, download failures, tour dismissal/replay, roles, keyboard, reduced motion, long text, and simultaneous unsent broker edits.
- Layouts were checked at **1440×900, 1366×768, 1024×768, 820×1180, 768×1024, 390×844, and 320×844**.

The production TypeScript/Vite build passed. Main JavaScript is **305.63 KB / 89.91 KB gzip**, CSS **28.90 KB / 6.18 KB gzip**, and the separately loaded DOCX chunk **229.58 KB / 68.51 KB gzip**.

## Documents

OOXML tests verify editable tables, confirmed values, Rp8 billion total, premium, period, exact original clauses, separate amendment decisions, and client evidence. Direct exporter calls reject unresolved cases.

A sample opened **read-only in Microsoft Word: 2 pages, 367 words**, preserving updated values, total, original clause, amendments, evidence, and simulation warning. The temporary Word instance was closed. This verifies application loading/content; every possible document layout was not visually reviewed.

## Taste results and adaptations

**GATE: OPEN — 33 findings after three rounds.** No waivers were added and no skill files changed. Applicable consistency checks passed for accessible names, visible labels, heading order, focus rings/visibility, text/button contrast, touch targets, collisions, clipping, and viewport overflow.

The remaining checks apply marketing-page assumptions to the operational workspace:

| Open checks (findings) | Reason retained |
| --- | --- |
| `hero-fill` (1), `hero-screen` (2), `section-height` (1), `section-air` (2), `one-section` (1) | Case context, next action, and task content share the screen instead of full-screen marketing sections. |
| `flush` (4), `container-edges` (8), `off-grid` (3), `container` (1) | Sidebar, nested panels, and contextual evidence use a workspace grid instead of one centered `.wrap`. |
| `nav` (1), `cta` (2), `copy-headline` (1) | Stage navigation replaces a sales navbar; the heading identifies the case, with actions beside their workflow context. |
| `no-visual` (2), `card-visual` (1), `moment-none` (1) | Live forms and evidence replace decorative pictures, mockups, and marketing moments. |
| `button-styles` (1), `heading-scale` (1) | Selected-stage navigation differs from action buttons; the readiness counter is larger than panel headings. |

These remain open checker findings, not a gate pass. See [design adaptations](prototype-design.md). The gate preceded the final nonvisual draft guard; the final build and browser suite verify that guard. Generated screenshots, profiles, and reports are ignored local artifacts.

## Performance

The production performance check at 1440px and 390px returned **0 FAIL and 2 WARN**. Initial transfer was approximately **95 KiB**, with zero broken requests, zero blocking time, and **0.000 layout shift**. Measured LCP was 160–200 ms in these local runs. Both warnings concerned a busy host CPU (up to 74%); these are local laboratory measurements, not a Vercel or real-user benchmark. The Word library loads on demand.

## Limits

Other browsers and screen readers were not verified. Browser-local progress has no shared synchronization. Real communications, policy issuance, and underwriting are excluded. Browser save dialogs/cancellations are not fully observable by JavaScript.
