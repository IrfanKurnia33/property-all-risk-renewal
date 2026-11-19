# Rekonvia

A fictional Property All Risks renewal workspace, based on [renewal flow v2](docs/research/renewal-flow-v2/renewal-flow-v2.md) and its diagrams. The Indonesian interface supports broker preparation, manual insurer coordination, client confirmation, reconciliation, DFS preparation and recorded binding correspondence.

All people, documents, locations, amounts, confirmations and communications in the case are fictional. The role selector simulates a broker or client on one device. Brokers record external insurer responses and their sources; insurers have no portal role. Nothing is sent to an insurer or client. Use fictional data when testing.

## v1 implementation

The current Phase 2 implementation provides manual source inventory and three-way wording review, separate quotation options, individual insurer positions, decimal premium calculations, immutable snapshots and stage-specific readiness. It still runs locally in the browser. Supabase accounts and shared storage, the full three-template export set, and optional free-only AI assistance follow in later phases.

Local development references:

- [Implementation plan and phase status](docs/v1-plan/01-rekonvia-v1-implementation-plan.md).
- [Research index and complete file manifest](docs/research/README.md).
- [Latest evidence-linked synthesis](docs/research/post-prototype-research-plan/post-convo-analysis/11-consolidated-synthesis.md).

These research and planning files are private and excluded from Git; they may be absent in a fresh checkout. Create the Supabase project at the **Phase 2 to Phase 3 handoff**, after the design foundation and domain/revision checks pass and before integrating authenticated shared storage. Phases 0–2 do not require a Supabase project.

Incorporate OpenRouter in **Phase 5**, after the authenticated backend and complete manual workflow with all three exports have passed their checks. Store its API key only as a server secret for an authenticated broker-only Edge Function. Never put it in a `VITE_*` environment variable or browser code. The planned integration uses free-only routing with manual fallback; the current app makes no AI requests.

## Run locally

Use Node.js 24 LTS and npm. Install dependencies in this repository:

```powershell
npm ci
npm run dev
```

Open the local address printed by Vite. To check the production build:

```powershell
npm run build
npm run preview
```

Run automated checks:

```powershell
npm test
```

On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm` in these commands. Install the repository-local Chromium browser once, then run the browser checks:

```powershell
npm run test:e2e:install
npm run test:e2e
```

The launcher keeps browser downloads and temporary files in `.cache/` inside this repository. It sets the browser path before loading Playwright; setting it in the test configuration would be too late. To use an existing browser instead, set `$env:PLAYWRIGHT_CHANNEL = 'chrome'` or `'msedge'` for that PowerShell session. No global browser installation or configuration change is required.

The project uses React, TypeScript, Vite, and Tailwind CSS v4. Word downloads use `docx`; the archive-content tests use `fflate`. No backend or API keys are required for the current local simulation.

## Design system

The [brand specification](docs/rekonvia-brand-palette-v1.0.md) and [CSS-first theme](src/styles/rekonvia-theme.css) define Rekonvia's colors and typography. `main.tsx` imports the theme once. It imports the retained [stage stylesheet](src/styles/styles.css) in the components layer, so semantic Tailwind utilities can replace individual views incrementally.

The 66 primitive shades are emitted with `@theme static`; semantic aliases live in `:root` and are exposed through `@theme inline`. See [Tailwind's theme guidance](https://tailwindcss.com/docs/theme). Shared controls and navigation use those semantic utilities. Native stage fields and remaining layouts use the compatibility aliases until their later migration.

Original logo SVGs remain in `public/assets/logos/`. Inter and Plus Jakarta Sans load from [self-hosted font files with licenses and attribution](public/assets/fonts/README.md); there are no runtime font requests to a third party. The app stays light by default and respects reduced motion.

After building, verify exact brand values, original SVG hashes, fonts and production CSS:

```powershell
npm run build
npm run test:brand
```

## Test with Falih

1. Open the app. Follow or skip the first-visit tour; **Ulangi tur** replays it without changing case data. If old saved progress is detected, download its backup and confirm a fresh version 2 case before continuing.
2. As **Broker**, inspect the source inventory in **Bahan renewal**. Check document class, period, producer, option, status and immutable version. The source dialog shows manually entered fictional excerpts; no file has been uploaded or verified.
3. Review each prior agreed clause, outgoing QS wording and insurer reply. Record a disposition, explanation and any unresolved question. Preserve historical words. A rejected new enhancement and withdrawal of a previously agreed clause have different meanings.
4. Inspect each premium line: decimal rate, percent or per-mille unit, peril, inclusion and sum-insured basis. The initial 0.0483% rate on IDR 7 billion yields an illustrative IDR 3,381,000.00, separate from the insurer-recorded premium. The populated earthquake rate does not include earthquake cover. Each illustrative line rounds half-up to two decimal places.
5. Prepare the reviewed QS snapshot and download its editable Word file. Historical locations and sums insured are labeled unconfirmed; current client confirmation is not required for this early quotation draft.
6. In **Review asuransi**, remain **Broker** and record an external response. Identify the insurer, external respondent, date, exact QS/version, share, terms, conditions and supporting source. Outreach and leader agreement alone do not establish a full panel. Compatible individual participation must total 100% for this pilot's proposal.
7. Publish the selected option in **Proposal klien**. Alternatives remain separate. Switching options supersedes the active proposal while preserving earlier snapshots and responses.
8. Switch to **Klien** after publication. Confirm every current-period location, address and sum insured, including unchanged values. Try an unclear address or withdrawn confirmation and inspect the blockers. The broker cannot provide client confirmation.
9. Return as **Broker** to **Rekonsiliasi data** and match the client evidence or request clarification. If risk values or terms change, prepare a fresh QS and obtain version-matching external insurer positions before publishing the updated proposal.
10. As **Klien**, agree to the current proposal and provide a separate renewal instruction. As **Broker**, resolve required insurer conditions and complete the final checks, prepare the DFS snapshot, and download its editable Word draft. Inspect exact wording, calculation units, client evidence and source/version provenance.
11. Record the manual binding dispatch with channel, recipient, date and reference. Record external acknowledgment separately for each participating insurer. A leader's response covers only that member; coverage status follows the agreed period after the required acknowledgments are recorded.
12. Add session notes and download the Markdown summary at any stage. Refresh to verify saved progress, then use the confirmed reset to start again.

Also test keyboard navigation, mobile comparisons, tour replay, unsent edits and role changes. Material changes should make affected decisions and snapshots stale while retaining their history. Notes and source annotations should advance only the save version.

## Saved progress and downloads

Progress is saved in `localStorage` under `rekonvia.case.v2` for this site in the current browser. Opening a different browser, profile, device or deployment domain starts a separate case. Clearing site data removes that browser's progress. The tour's completion state is stored separately from the case. Save failures or unreadable saved data are reported in the interface; reset requires confirmation.

Earlier progress under `ruang-renewal.case.v1` is preserved separately. The app offers a raw backup and requires a confirmed fresh case; old simulated decisions are not converted into new evidence. Invalid version 2 data also remains untouched until a confirmed reset.

Successful actions save case progress. Unsent form edits stay on the current page; the app warns before stage or role navigation discards client edits. Submit them before refreshing or closing the browser. Replaying the tour preserves those edits.

Use one tab for the case. The app checks the saved version before a command and rejects a detected stale tab, allowing unsent work to be copied before reload. Browser storage cannot atomically coordinate simultaneous writes; the authenticated server phase adds that guarantee.

The current editable `.docx` outputs are a basic QS and a guarded DFS draft from saved snapshots. Full QS/proposal/DFS templates arrive in Phase 4. Direct exporters recheck readiness and reject stale snapshots. Word files retain exact source wording, separate comparison decisions, source references, decimal units and evidence attribution. The Markdown summary includes revisions, external insurer positions, retained client decisions, stage blockers, coverage status and session notes.

If a browser blocks downloads, allow downloads for the site and retry. The application can report document generation or download setup failures; the browser controls the final save and cannot report every canceled or blocked download to the app.

## Publish from GitHub to Vercel

Git excludes all of `docs/research/` and `docs/v1-plan/`, installed skill packages, dependencies, build outputs, caches, editor settings, and test reports. The research exclusion includes the current v2 flow, historical v1 flow, interviews, recordings and their analysis. These files remain available locally. Application source, tests, brand assets and skill provenance records can be versioned. A fresh checkout needs its own local research files and skill installation if those development references and tools are wanted; skill versions and adaptations are recorded in `.agents/skills/README.md` and `.agents/skills/sources.lock.json`.

1. Commit the application source and `package-lock.json` to your GitHub repository. Do not commit `node_modules`, `dist`, browser profiles, screenshots, caches, or local tool runtimes.
2. In Vercel, add a new project and import that repository.
3. Select **Vite** as the framework preset, keep the project root at the repository root, use `npm run build`, and set the output directory to `dist`. Use Node.js 24 LTS, matching `package.json`.
4. Deploy and share the generated URL with Falih. A new GitHub commit creates the next Vercel deployment. Progress belongs to each browser and deployment origin; preview URLs do not share progress with the production URL.

Vercel's [Vite deployment guide](https://vercel.com/docs/frameworks/frontend/vite) covers Git imports and framework configuration, and its [supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) include Node.js 24. Browser-side Word generation follows the official [`Packer.toBlob` API](https://docx.js.org/api/classes/index.Packer.html).

## Boundaries

This version has one editable fictional case with two separate quotation options. It has no authentication, shared storage, real uploads/document extraction, AI extraction, email delivery, invoicing, policy administration or endorsements. Source references and excerpts are manually recorded fictional evidence. Switching roles is a testing convenience and is not an authorization system. Do not use it for real binding instructions or policy issuance.

See the local [prototype design and skill adaptations](docs/research/prototype-design.md) for the workflow choices and [validation results](docs/research/prototype-validation.md) for automated checks, Word verification, and the remaining Taste findings. Their recorded results describe the earlier prototype; consult the v1 plan for the current implementation status.
