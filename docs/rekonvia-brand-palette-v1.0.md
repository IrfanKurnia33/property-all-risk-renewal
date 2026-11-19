# Rekonvia — Brand Palette v1.0 (Tailwind CSS edition)

**Status:** Approved brand direction + expanded implementation specification  
**Version:** 1.0
**Updated:** 18 November 2026  
**Stack:** React / TypeScript / Vite / **Tailwind CSS v4** (CSS-first configuration)
**Audience:** Designers, developers, Codex in VS Code  
**Purpose:** Brand identity, product UI, accessible workflow states, and consistent data-rich interfaces

> **Authority:** The **four owner-provided SVG logo assets are authoritative** (`public/assets/logos/`) for Rekonvia's logomark and logotype. Never recreate, refont, or modify them unless explicitly instructed.

## 1. Direction and locked decisions

Rekonvia is an AI-assisted B2B workflow product for commercial insurance brokers. The brand should feel **global, precise, credible, modern, and restrained**, with clarity prioritized over visual novelty.

- **Positioning:** *Complex insurance work. Made clear.* (working brand copy, not a validated product claim)
- **Brand foundation:** Midnight Navy (`#121C31`)
- **Interactive brand:** Electric Indigo (`#514BE8`)
- **Accent:** Signal Mint (`#33CBBE`)
- **Neutrals:** Cloud White (`#F6F8FC`), Slate (`#566479`), Mist (`#E0E6EF`)
- **Brand gradient:** Electric Indigo 600 → Electric Indigo 700 (details below)
- **Implementation:** Tailwind v4 `@theme` primitive scales, CSS semantic aliases, `@theme inline` utility exposure, and optional component tokens
- **Data integrity:** workflow confirmations and review statuses must be driven by actual product rules, never inferred from branding

### Approved anchor shades

| Name | Anchor | Hex | Main function |
|---|---:|---|---|
| Midnight Navy | `950` | `#121C31` | Dark brand grounds, primary light-mode text |
| Electric Indigo | `600` | `#514BE8` | Primary action, brand |
| Signal Mint | `400` | `#33CBBE` | Rare accent, AI/brand storytelling; not confirmation status |
| Cloud White | `50` | `#F6F8FC` | Light-mode canvas |
| Slate | `600` | `#566479` | Secondary and metadata text |
| Mist | `100` | `#E0E6EF` | Subtle borders/dividers; not enough alone for essential input outlines |

Do **not** relocate these anchors to shade `500`. Shade naming is a useful convention, not a requirement that every brand's primary color occur at the same step.

## 2. Supplied logo assets and gradients

The following filenames refer to **user-designed, approved SVG files**. They are already available in the logos folder (`public/assets/logos/`) and reference them rather than rebuilding the mark in CSS or icon libraries.

| Exact filename | Artboard / viewBox | Observed appearance | Intended use |
|---|---|---|---|
| `logomark-flat.svg` | `160 × 160` | Flat Indigo 600 background `#514BE8`, Indigo 400 stroke `#7F8DFA`, Indigo 50 shapes `#EEF2FF` | Flat/utility mark |
| `logomark-gradient.svg` | `160 × 160` | Fill gradient Indigo 600 `#514BE8` to Indigo 700 `#3F36CC`; stroke gradient Indigo 400 `#7F8DFA` to Indigo 500 `#6167F3`; Indigo 50 shapes | Gradient mark / hero branding |
| `logotype-light-mode.svg` | `435 × 85` | Wordmark vector paths, Navy 950 `#121C31` | Light backgrounds |
| `logotype-dark-mode.svg` | `435 × 85` | Wordmark vector paths, Mist 100 `#E0E6EF` | Dark backgrounds |

**Rules:**

1. SVG artwork, proportions, internal geometry, corner radii, and stroke treatments are **approved and should remain unchanged**. Use the shipped SVGs directly.
2. Use light-mode wordmark on sufficiently light backgrounds; use dark-mode wordmark on Midnight Navy or comparable dark sections. **These are wordmarks, not pre-composed symbol-plus-wordmark lockups.** Do not invent one without a separate layout decision.
3. Render at natural aspect ratio; never stretch. When the wordmark is the accessible brand label, use a meaningful accessible name such as `alt="Rekonvia"`. If adjacent readable text already says Rekonvia, mark decorative duplicate imagery appropriately.
4. Do not replace the vector wordmark with Plus Jakarta Sans, which is only an **interface/marketing typography recommendation**.
5. The supplied logo does **not** use Signal Mint. It is a legitimate accent in the wider palette, not an element to add to the logo.

### Gradient instructions — important geometry detail

Owner-provided **CSS marketing gradient** (preserve as provided):

```css
background: #514be8;
background: linear-gradient(135deg, rgba(81, 75, 232, 1) 0%, rgba(63, 54, 204, 1) 100%);
```

Equivalent color-token mapping: `electric-indigo-600 → electric-indigo-700`. The gradient is for **select brand/marketing treatments**, not every UI button or dashboard card.

**SVG-source distinction:** In the actual `logomark-gradient.svg`, the fill vector goes approximately from **bottom-left (`#514BE8`) to top-right (`#3F36CC`)**. The provided CSS `135deg` direction is **not pixel-identical** to this SVG gradient direction. Respect the SVG exactly when showing the logo; retain the supplied CSS `135deg` version for standalone marketing gradients unless a later design decision changes it. The logo also has a **separate gradient stroke** that CSS background alone would not reproduce.

## 3. Primitive color scales — exact 50–950 values

These are the **66 exact shades supplied by the brand owner**, unchanged. These exact values are mapped to native Tailwind v4 theme variables. Do not interpolate, normalize, or regenerate the values.

| Family | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `midnight-navy` | `#F1F7FD` | `#DEEDFB` | `#C5E0F8` | `#9DCEF3` | `#6FB2EB` | `#4D94E4` | `#3879D8` | `#2F65C6` | `#2C52A1` | `#284780` | `#121C31` |
| `electric-indigo` | `#EEF2FF` | `#E0E8FF` | `#C6D2FF` | `#A4B5FD` | `#7F8DFA` | `#6167F3` | `#514BE8` | `#3F36CC` | `#332EA5` | `#2F2D82` | `#1C1A4C` |
| `signal-mint` | `#F1FCFA` | `#CEF9F2` | `#9DF2E5` | `#65E3D4` | `#33CBBE` | `#1CB0A6` | `#138E88` | `#14716E` | `#155A58` | `#164B4A` | `#062C2D` |
| `cloud-white` | `#F6F8FC` | `#E4EAF5` | `#CFDAEE` | `#ADC1E3` | `#86A1D4` | `#6A84C7` | `#566BBA` | `#4C5BA9` | `#424C8B` | `#39416F` | `#262A45` |
| `slate` | `#F6F7F9` | `#ECEEF2` | `#D6DAE1` | `#B2BBC7` | `#8796A9` | `#69798E` | `#566479` | `#444F60` | `#3B4451` | `#353B45` | `#23272E` |
| `mist` | `#F4F6FA` | `#E0E6EF` | `#D4DDE9` | `#B6C6DA` | `#93A9C7` | `#798FB8` | `#677AA9` | `#5B6A9A` | `#4E587F` | `#424A66` | `#2B2F40` |


**Important characteristics:**

- Midnight Navy moves through bright blue tones at many intermediate steps; do **not** assume every shade is a neutral replacement for Navy 950.
- Cloud White becomes a blue-violet family at higher steps; use Cloud 50 mainly as the light canvas, not as a universal grayscale ramp.
- Slate is the reliable text hierarchy family; Mist is best for backgrounds and decorative separators.
- Using a complete shade scale does **not** automatically ensure accessible text contrast or perceptually uniform chart steps.

## 4. Token architecture

Implement a **three-layer model**, without requiring all components to create their own overrides:

1. **Primitive tokens**: fixed hex values such as `--color-electric-indigo-600` or `--color-slate-700` inside `@theme`. Only the theme stylesheet should define primitives.
2. **Semantic tokens**: role-based aliases such as `--rk-color-text-primary`, `--rk-color-surface`, `--rk-color-action-primary`, `--rk-color-border-control`, and workflow status pairs. **Components should use their Tailwind semantic utility equivalents by default**, e.g. `text-text-primary` or `bg-action-primary`.
3. **Component tokens (optional)**: add only if a repeated component needs a distinct standardized role, e.g. `--rk-button-primary-bg: var(--rk-color-action-primary)`. Avoid duplicating the entire semantic system.

### Core light UI mappings

| Role / semantic token | Maps to | Use |
|---|---|---|
| `--rk-color-canvas` | Cloud 50 | Main application background |
| `--rk-color-surface` | White | Cards, panels, tables |
| `--rk-color-surface-subtle` | Slate 50 | Secondary surface |
| `--rk-color-surface-selected` | Indigo 50 | Selected items, supported with border/label |
| `--rk-color-text-primary` | Navy 950 | Headers, body priority |
| `--rk-color-text-secondary` | Slate 600 | Secondary prose, labels |
| `--rk-color-text-muted` | Slate 600 | Normal-size metadata; don't default to Slate 500 |
| `--rk-color-border-subtle` | Mist 100 | Decorative rules only |
| `--rk-color-border-control` | Slate 500 | Input/control boundaries requiring non-text contrast |
| `--rk-color-action-primary` | Indigo 600 | Primary action default |
| `--rk-color-action-primary-hover` | Indigo 700 | Hover |
| `--rk-color-action-primary-active` | Indigo 800 | Active/pressed |
| `--rk-color-action-primary-text` | White | Text on primary CTA |
| `--rk-color-action-secondary-bg` | Indigo 50 | Secondary action background |
| `--rk-color-action-secondary-text` | Indigo 800 | Secondary action text |
| `--rk-color-link` | Indigo 700 | Links on light backgrounds |
| `--rk-color-focus-ring` | Indigo 700 | Visible keyboard focus ring |

Do not encode typography hierarchy using lighter-and-lighter text colors alone. Use **font size, weight, spacing, and grouping**, with Slate 600 or darker when normal-size text must remain legible.

### Workflow status tokens — intentionally separate

| State | Foreground | Background | Meaning / label |
|---|---|---|---|
| Confirmed | `#167B64` | `#E6F6EF` | Client-confirmed / **Terkonfirmasi** |
| Pending | `#996019` | `#FFF4E2` | Awaiting confirmation / **Menunggu konfirmasi** |
| Blocked | `#B93B48` | `#FDEDEE` | Mismatch, incomplete, export blocker / **Perlu klarifikasi** |
| Review | `#315FA3` | `#EBF2FF` | Requires check / **Perlu ditinjau** |

Never use Signal Mint as the *confirmed* status just because it looks green. A predicted site match or extracted value is **not confirmed data**. Each status must be paired with explicit language, and supported with icons/context where useful.

## 5. Accessibility and contrast verification

The following contrast ratios are calculated from the exact hex codes using WCAG relative luminance. They describe **these specific foreground/background pairs**, not a blanket guarantee for an entire interface.

| Pair | Foreground / background | Ratio | Guidance |
|---|---|---:|---|
| White on Indigo 600 | `#FFFFFF` / `#514BE8` | 5.96:1 | Pass — primary CTA |
| White on Indigo 500 | `#FFFFFF` / `#6167F3` | 4.43:1 | Fail — normal text |
| White on Mint 400 | `#FFFFFF` / `#33CBBE` | 2.01:1 | Fail — normal text |
| Navy 950 on Mint 400 | `#121C31` / `#33CBBE` | 8.43:1 | Pass — text if needed on Mint |
| Navy 950 on Cloud 50 | `#121C31` / `#F6F8FC` | 15.98:1 | Pass — primary text |
| Slate 600 on Cloud 50 | `#566479` / `#F6F8FC` | 5.65:1 | Pass — secondary text |
| Slate 500 on Cloud 50 | `#69798E` / `#F6F8FC` | 4.18:1 | Fail — normal text |
| Mint 700 on Cloud 50 | `#14716E` / `#F6F8FC` | 5.46:1 | Pass — when semantic meaning is clear |
| Mist 100 on White | `#E0E6EF` / `#FFFFFF` | 1.25:1 | Fail as essential control boundary (1.25:1) |
| Confirmed fg on bg | `#167B64` / `#E6F6EF` | 4.64:1 | Pass — status badge |
| Pending fg on bg | `#996019` / `#FFF4E2` | 4.77:1 | Pass — status badge |
| Blocked fg on bg | `#B93B48` / `#FDEDEE` | 4.90:1 | Pass — status badge |
| Review fg on bg | `#315FA3` / `#EBF2FF` | 5.67:1 | Pass — status badge |
| Mist 100 on Navy 950 | `#E0E6EF` / `#121C31` | 13.54:1 | Pass — dark logotype color |

**Standards:** WCAG AA targets at least **4.5:1 for normal text**, **3:1 for large text**, and **3:1 for essential non-text UI boundaries/indicators**, subject to the applicable criteria/exceptions. This is a design target, not a claim that the prototype has been audited.

- White on Indigo 600 passes normal-text AA. **Indigo 500 narrowly fails**; don't substitute it for primary buttons with white text.
- White on Mint 400 fails; use Navy 950 on Mint 400 when appropriate, or keep Mint decorative.
- Slate 500 on Cloud 50 fails normal-text AA; prefer Slate 600 or darker for small metadata.
- Mist 100 is fine as a decorative divider; it is **not enough by itself** to identify an essential input border against white.
- Provide a clear `:focus-visible` outline and check focus contrast against the actual adjacent pixels.
- Status meaning must remain understandable without color (text, icons, labels, not merely red/green).
- Confirm hover, active, disabled, error, selected, and actual dark-background states in browser; do not assume theme aliases alone satisfy accessibility.

## 6. Data visualization guidelines (conservative v1.0)

The shade ramps allow more flexibility; they are **not automatically a complete enterprise chart palette**.

| Chart need | Starting point | Constraints |
|---|---|---|
| Single measure | Indigo 600; Mist 100 track | Numeric labels, units, readable axes |
| Sequential magnitude | Indigo 100, 300, 500, 700, 900 | Order only; assess perceptual steps and contrast on actual chart background |
| Small categorical comparison | Indigo 700, Mint 700, Slate 700 (provisional) | Maximum three series initially; legend + labels or line patterns; test visual distinction |
| True positive/negative workflow status | Confirmed/blocked semantic palette only if those meanings truly apply | Do not use red/green merely to distinguish unrelated insurers or categories |
| Change detection | Compare prior vs proposed using labels, values, delta, and explicit confirmation/evidence state | Avoid color-only signals; an AI-suggested delta ≠ a confirmed change |

A **validated categorical/diverging chart palette is out of scope** until a specific real chart needs it. No fictitious numerical insight or accuracy claim should be introduced merely to decorate the demo.

## 7. Typography and density

- **Brand/marketing and major headings:** Plus Jakarta Sans, weights 600–700.
- **App UI, tables, form labels, body:** Inter, weights 400–600.
- **Logo:** Use supplied vector logotype assets as-is. Do not retype with the heading font.
- **Financial and site data:** `font-variant-numeric: tabular-nums;` for premiums, sums insured, rates, dates, percentages, and comparisons where alignment improves scanning.
- Prefer white space, aligned columns, and a stable type hierarchy over adding more saturated shades in data-heavy screens.

## 8. Tailwind CSS v4 implementation — canonical reference

**Decision made by the owner:** Tailwind CSS is now the selected styling system. This replaces current requirement to use plain CSS. It does **not** mean animations require Tailwind; animation libraries are independent. Tailwind will handle layout, states, responsive styling, and reusable design tokens. Add an animation library only when there is a justified interaction need.

**Source of truth:** `src/styles/rekonvia-theme.css` from this kit. It contains the 66 owner-supplied exact primitive values, semantic aliases, workflow states, chart roles, and the approved CSS marketing gradient. There is **one** Tailwind import/entrypoint; don't duplicate it across several CSS files.

### Installation — React + TypeScript + Vite

1. Inspect the existing project and `package.json`. If Tailwind is already installed, check its major version and existing token strategy before changing it. **Do not overwrite an existing working Vite configuration.**
2. For a project not yet using Tailwind, install the v4 Vite integration:

```bash
npm install -D tailwindcss @tailwindcss/vite
```

3. Merge the Tailwind plugin into the existing `vite.config.ts` plugins (keep `react()` and any other current plugins):

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

4. Copy the supplied CSS to `src/styles/rekonvia-theme.css` (adjust paths to the real repository). Ensure the app imports this **once** in its root entrypoint, for example:

```ts
import "./styles/rekonvia-theme.css";
```

5. Reference the original four SVG files in `public/assets/logos/` unchanged. Do not duplicate, redraw, or approximate the owner-provided logo using CSS.
6. Run the existing package scripts (`npm run build` and available tests). Verify styles actually compile and app behavior remains unchanged.

The v4 theme is **CSS-first**: `@import "tailwindcss"`, `@theme` for primitive color/font utilities, `:root` for semantic roles, and `@theme inline` to generate semantic utilities. **Do not use a v3-style** `tailwind.config.js` solely to define these colors, `@tailwind base/components/utilities` directives, or outdated setup commands. For an existing Tailwind v3 project, assess upgrade compatibility separately rather than blindly mixing versions.

Official references: [Tailwind v4 Vite setup](https://tailwindcss.com/docs/installation/using-vite), [Theme variables](https://tailwindcss.com/docs/theme), [Colors](https://tailwindcss.com/docs/colors).

### Token usage in JSX

The CSS token stylesheet exposes primitive utilities like `bg-electric-indigo-600`, plus **preferred semantic utilities** like `bg-canvas` and `text-text-primary`.

```tsx
export function RenewalExample() {
  return (
    <main className="min-h-screen bg-canvas p-6 font-body text-text-primary">
      <section className="rounded-xl border border-border-subtle bg-surface p-5">
        <h1 className="font-heading text-2xl font-bold">Renewal workspace</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Review updates against confirmed evidence.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <span className="rounded-md bg-status-pending-bg px-2 py-1 text-sm font-semibold text-status-pending-fg">
            Menunggu konfirmasi
          </span>
          <button
            type="button"
            className="rounded-md bg-action-primary px-4 py-2 font-medium text-action-primary-text transition-colors hover:bg-action-primary-hover active:bg-action-primary-active focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus-ring"
          >
            Continue review
          </button>
        </div>
      </section>
    </main>
  );
}
```

The example conveys status **with text**, not hue alone. Tailwind's built-in `tabular-nums` utility should be used for aligned currency and numerical columns.

### Semantic implementation rules

- Prefer `bg-surface`, `text-text-primary`, `text-text-secondary`, `border-border-subtle`, `border-border-control`, `bg-action-primary`, and the workflow status classes over primitive values in regular components.
- Use primitives directly for deliberate brand moments, e.g. `bg-midnight-navy-950`, `bg-electric-indigo-600`, or `text-signal-mint-400` on a verified dark background.
- The marketing-only `.rk-brand-gradient` CSS utility preserves the **provided CSS 135° gradient**. The authoritative SVG gradient logo has its **own** diagonal direction and vector stroke; do not recreate or override it.
- Make component states explicit: hover, active, keyboard focus, selected, blocked, and loading. An AI suggestion is not a verified client confirmation.
- Avoid constructing Tailwind utility names dynamically from runtime string interpolation, e.g. `bg-${status}-500`. Prefer a static typed map or semantic component classes so the build can discover all classes.
- This kit specifies a **light product interface** and separately scoped `.rk-brand-dark` sections, **not a complete dark-mode UI**. Do not enable arbitrary full-app dark mode without designing and testing all semantic roles.
- Do not change the existing business workflow, broker permissions, or confirmation/export logic as part of a CSS migration.

### Animation architecture

The introduction of Tailwind should **not** automatically introduce multiple animation libraries. Prefer:

1. **CSS + Tailwind utilities** for hover, focus, opacity, simple transitions, and restrained visual feedback.
2. **One React animation library** (for example, Motion for React) only when needed for coordinated transitions, layout animation, or complex gestures.
3. **A second specialized library** only where an actual feature requires it; audit bundle weight and avoid two libraries owning the same animated property on an element.

Tailwind styles the static state; Motion (if later installed) handles animated properties. See [Motion + Tailwind guidance](https://motion.dev/docs/react-tailwind). Keep important tables and forms calm; animate neither unconfirmed values into verified statuses nor hide important blockers behind motion.

Use `motion-safe:` for optional CSS animations where appropriate, `motion-reduce:` for reduced alternatives, and `prefers-reduced-motion` / the animation library's reduced-motion facilities for JavaScript-driven transitions. Test keyboard use and motion-reduced operation, not just visual polish. **Do not install Motion or GSAP merely because it is mentioned here.**

## 9. Brand assets and component examples

```tsx
{/* Use owner-provided vector files, not a recreated logotype. */}
<img src="/assets/logos/logotype-light-mode.svg" alt="Rekonvia" />
<img src="/assets/logos/logomark-gradient.svg" alt="" aria-hidden="true" />
```

For dark sections, use `logotype-dark-mode.svg`. Preserve original proportions and stroke shapes. The flat and gradient marks are separate approved options. Do not invent a joined lockup without design approval.

## 10. Safe migration from the plain-CSS v1.1 implementation

1. **Inspect and inventory first:** existing Vite plugins, stylesheets, component CSS, CSS variables, asset paths, runtime role views, and responsive behavior.
2. **Install Tailwind v4 via the Vite plugin**, then import the new theme once. Confirm old and new globals do not duplicate or collide; avoid wholesale style deletion before checking rendered screens.
3. **Replace styles incrementally:** migrate one representative screen/component, verify visual parity and accessibility, then proceed across repeated components. Reuse styles where a full rewrite would add risk.
4. **Use semantic utilities by default.** The old `--rk-color-*` variable names are intentionally retained for compatibility, while old primitive references like `--rk-electric-indigo-600` are replaced by Tailwind `--color-electric-indigo-600`. Search and repair any old variable references in custom CSS.
5. **Keep stable layout during migration:** preserve responsive comparison layouts, table headers, overflow, focus indicators, and readable site data. Respect small-screen behavior.
6. **Protect domain logic:** client-sourced site and sum insured confirmations, matching evidence, insurer review, original clauses, and export blockers must not be changed by styling work.
7. **Verify:** production build, actual browser colors, gradient asset fidelity, all four status badge contrasts, reduced-motion behavior, desktop/narrow layouts, keyboard focus, and CSS specificity conflicts.
8. **Report:** files changed, completed components, any temporarily retained legacy CSS, remaining accessibility issues, and build/test evidence.

### Acceptance checklist for Codex

- [ ] Tailwind v4 (or confirmed compatible version) installed via documented Vite integration, with existing plugins preserved.
- [ ] Exactly one `@import "tailwindcss"` entrypoint, CSS-first theme tokens, no accidental v3 directives.
- [ ] All 66 primitive colors match the owner-provided shades byte-for-byte in hex values.
- [ ] Six approved color anchors unchanged.
- [ ] Semantic classes, four workflow statuses, chart roles, and typography available; render correctly.
- [ ] Logo SVG files remain unchanged and correct for light/dark branded backgrounds.
- [ ] Native SVG logomark gradient preserved; CSS 135° marketing gradient remains a separate treatment.
- [ ] Focus, keyboard, contrast, responsive layouts, and reduced-motion controls tested.
- [ ] No unrequested animation dependency added; no conflicting animations on the same properties.
- [ ] Renewal flow, broker permissions, client confirmation evidence, clause preservation, and export readiness rules untouched.
- [ ] Production build succeeds; migration report notes remaining issues.

---

> A full app dark theme and production-tested categorical chart palette remain future design tasks.
