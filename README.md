# Rekonvia

A fictional Property All Risks renewal workspace for brokers and their assigned clients. Brokers prepare quotations, record external insurer responses, publish proposals, match client evidence, prepare DFS documents and record binding correspondence. Clients confirm their own risk data and give separate proposal agreement and renewal instruction. Insurers have no portal role.

The current lifecycle follows [renewal flow v2](docs/research/renewal-flow-v2/renewal-flow-v2.md), interpreted alongside the [latest research synthesis](docs/research/post-prototype-research-plan/post-convo-analysis/11-consolidated-synthesis.md). Research and planning files are private, Git-ignored local material and may be absent in a fresh checkout. Start local research navigation at [the research index](docs/research/README.md); phase status is in [the implementation plan](docs/v1-plan/01-rekonvia-v1-implementation-plan.md).

## Current implementation

The normal app uses Supabase password login, database-derived roles and case assignments, broker case creation, private file uploads, authenticated server commands and guarded QS, proposal and DFS Word downloads. Canonical case state is stored in Postgres. Clients receive an allowlisted proposal view, not the full broker case. Server transactions reject stale saves and deduplicate identical retries. The [Supabase handoff](docs/supabase-backend.md) explains provisioning, routes, access rules and deployment.

Source inventory and three-way wording review preserve the prior agreed baseline, outgoing QS and insurer reply. Separate quotation options, individual insurer participation, exact decimal premium calculations, immutable snapshots and stage-specific readiness remain shared between browser and server.

The manual five-stage workflow and all three editable Word templates are implemented. Optional broker-only AI source review prepares selected text/page images locally, calls the server-controlled free OpenRouter route and stores suggestions separately for human review. The [AI guide](docs/ai-assistance.md) covers preparation, limits, failures and source handling. Store OPENROUTER_API_KEY only in Supabase Edge Function Secrets, never in a VITE variable.

## Workspace navigation

On desktop, brokers move between five workflow stages in the sidebar and use section tabs below the case heading. The header stays visible while scrolling. The readiness and recent-activity context stays beside the work area on wide screens and returns to the page flow on smaller screens. At narrow widths, stage navigation and account actions are available in expandable menus. Tabs and language changes keep unsaved form entries in the current workspace; they do not save them. Clients use a separate, restricted workspace with **Proposal**, **Location data**, **Renewal decisions** and **Response history**, without broker stage controls. The [backend handoff](docs/supabase-backend.md#navigate-the-current-interface) lists each stage's sections.

## Languages

The interface supports **English (United States)** (`en_US`, the default) and **Bahasa Indonesia** (`id_ID`). Use **Language / Bahasa** on the login page or workspace header. The preference stays in this browser under `rekonvia.locale.v1`, survives sign-out and reload, and updates other open tabs. If browser storage is unavailable, selection works for the current session. Changing language preserves unfinished forms and open dialogs.

Navigation, forms, application validation/recovery messages, readiness checks, the tour and AI controls use the selected language. Displayed dates and numbers follow that locale, with Jakarta time and exact decimal precision. Decimal form inputs continue to use a period, as their labels specify. Client data, names, original wording, source excerpts, AI output and document artifacts retain their authored language; selecting a UI language does not translate or rewrite insurance evidence or existing Word templates.

Translations live in `src/locales/`, with Indonesian source copy as the message key and an English dictionary. Keep enum values and persisted case data independent of translated labels. Translate application messages at display time so stored errors and readiness messages can change language without saving the case.

## Run locally

Use Node.js 24 and install dependencies within this repository:

```powershell
npm ci
npm run dev
```

Create `.env.local` from [.env.example](.env.example), with your Supabase **project base URL** and **publishable key**. The URL must have no `/rest/v1/` suffix. The build rejects a Data API path or server credential in these frontend fields. The running app does not fall back to a local case if authentication or backend access fails.

The separate ignored `.env.supabase.local` is for repository-side deployment/admin tools. Its PAT and database password do not belong in Vite or Vercel's frontend settings.

```powershell
npm run typecheck
npm run test:e2e:install
npm test
npm run build
npm run test:brand
npm run preview
```

If PowerShell blocks `npm.ps1`, use `npm.cmd`. The existing Vite React and Tailwind plugins are retained.

## Codebase map

- `src/main.tsx` bootstraps localization and selects the authenticated app by default; `AuthApp.tsx` handles signed-in workspaces, while `App.tsx` contains the broker workflow and explicit browser-only simulation (`VITE_DEMO_MODE=true`). `ClientWorkspace.tsx`, `CaseManagement.tsx` and `AiWorkspace.tsx` split client, case-access and optional AI flows. `useServerCase.ts`, `server-api.ts` and `supabase.ts` connect the browser to the backend. `domain.ts` and `decimal.ts` re-export shared rules; `document-preparation.ts`, `downloads.ts`, `persistence.ts`, locales, styles and `src/*.test.ts` cover browser preparation, exports, simulation recovery, presentation and unit/contract tests.
- `supabase/functions/_shared/` holds the canonical renewal rules, API projections, document builders and upload validation shared with the browser. `supabase/functions/renewal-api/index.ts` handles authenticated routes and `ai.ts` handles broker-only AI routes; `supabase/migrations/` defines the database, access policies and service-only operations.
- `tests/` contains Playwright journeys and fixtures. `scripts/` contains repository-local Supabase, browser-test, verification, provisioning, AI-test and walkthrough/transcription tools.
- `public/assets/` contains the brand artwork and licensed self-hosted fonts. The product, backend, AI and brand references are in `docs/`; local research and planning material is Git-ignored and may not be present in a fresh checkout.
- `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `playwright.config.ts` and `vercel.json` define the Node/tooling, build, type-check, browser-test and deployment setup.

## Use the authenticated pilot

1. Sign in with an owner-provisioned broker account and open an existing case or **Create fictional renewal case** (**Buat kasus renewal fiktif**). Enter historical and renewal periods, one row per historical location, and the existing client accounts to assign. Historical data is broker transcription, not current client confirmation. New cases have empty source/wording inventories and clearly marked initial terms to replace. A broker sees all cases in that brokerage; clients see only their assigned published proposals. **Renewal materials → Case access** (**Bahan renewal → Akses kasus**) manages existing-client assignments; clients who have contributed evidence/decisions require owner review before removal, and completed binding locks access changes.
2. In **Renewal materials → Document sources** (**Bahan renewal → Sumber dokumen**), inspect source class, period, producer, option and immutable version. Upload fictional PDF, DOCX, XLSX, JPEG, PNG or WebP files, up to 10 MiB each, then finalize them. Format/hash validation does not prove a manually entered quotation matches the source. Check the actual words yourself.
3. In **Renewal materials → Wording** (**Bahan renewal → Wording**), add the baseline clause to an empty case with **Add a clause from the agreed baseline** (**Tambah klausul dari baseline disepakati**), selecting the prior source and outgoing QS source. Add enhancements separately. Review the prior agreed, outgoing QS and insurer reply wording. Preserve original text and record the disposition, reason and unresolved questions. Upload referenced files before release. A rejected enhancement and withdrawal of an agreed clause remain distinct.
4. In **Renewal materials → Terms & premium** (**Bahan renewal → Terms & premi**), inspect exact decimal rates, percent/per-mille units, inclusion, sum-insured basis and recorded premiums. Prepare a reviewed QS snapshot; historical values can be quoted before current-period client confirmation.
5. In **Insurer review → Record response** (**Review asuransi → Catat respons**), record an external insurer response with respondent, time, exact QS/option/wording, share, terms, conditions and uploaded evidence. Compatible participation must total 100% for the pilot proposal; alternative 100% offers remain separate.
6. Publish the selected proposal in **Client proposal** (**Proposal klien**) and use **Download proposal as Word** (**Unduh proposal Word**) to prepare its immutable, client-safe document. Assigned clients can download that published version after broker generation. QS and DFS stay broker-private. The assigned client can then sign in, confirm every current-period location/address/sum insured, and supply its confirmation source. Unchanged historical values still require client confirmation. The broker cannot confirm for the client.
7. In **Data reconciliation** (**Rekonsiliasi data**), the broker matches the client evidence without granting formal approval. Material changes require updated quotation/insurer evidence and proposal publication. The client can clarify incomplete data against the active option and unchanged policy period while an update is pending.
8. The client separately agrees to the current proposal and gives renewal instruction. In **Final review & binding → DFS readiness**, the broker resolves required conditions, completes the final checklist, prepares the DFS and downloads the guarded Word document. Uploaded sources, decisions, versions and exact wording remain attributed.
9. In **Final review & binding → Binding**, record manual binding dispatch and each participating insurer's external acknowledgment. A leader response covers only that member. The app records these communications; it does not send emails or establish real insurance coverage.

Keep pilot data fictional. Word files are editable drafts; external edits become new uploaded source versions and require review. They do not update a snapshot or clear readiness checks. Original Word layout preservation is not promised. Account creation and recovery are owner-assisted while SMTP is deferred; test email addresses are not delivery destinations.

## Saves, drafts and recovery

Successful actions save on the server. Unsent form edits remain in memory. Stage/case navigation warns before discarding broker edits. Logout and account changes clear private views and unfinished forms; copy needed drafts before signing out.

A 409 means the case changed elsewhere. The draft stays available. Use **Muat ulang versi terbaru**, compare the updated case, then save again. Client drafts additionally require explicit review of a changed save version. The app does not silently merge concurrent edits.

If a connection fails after a save may have committed, **Coba ulang tindakan yang sama** reuses the original request key. Other writes remain blocked until that uncertainty is resolved. A retry can return an older successful result; the frontend does not replace a newer known state with an older save version.

Canonical case JSON is never saved to browser storage in authenticated mode. Supabase may persist its login session under `rekonvia.auth.v1`. Earlier fictional snapshots under `rekonvia.case.v2` or `ruang-renewal.case.v1` remain explicit downloadable backups. They are never imported as authoritative evidence or overwritten by authenticated actions.

The legacy local simulation is available only through the explicit `VITE_DEMO_MODE=true` development/test build setting. Its role selector is a simulation aid, and its browser storage cannot atomically coordinate simultaneous tabs. Production builds should keep that flag absent or false.

## Browser verification

Install the repository-local Chromium runtime once:

```powershell
npm run test:e2e:install
npm run test:e2e
```

The ordinary browser suite builds the isolated simulation, checks its existing journeys in Indonesian and bilingual switching, then checks login, broker and client language behavior against deterministic local API responses. These auth UI checks use fictional credentials and make no hosted account changes. The launcher restores an authenticated production build using your normal configuration in `dist`. It starts preview in the launcher process to avoid the Windows npm-child shutdown problem. Browser downloads and temporary files stay in `.cache/`; no global browser configuration changes are required.

Run the stateful hosted acceptance explicitly:

```powershell
$env:REKONVIA_RUN_HOSTED_BROWSER_TESTS='1'
npm run test:e2e:auth
```

Each hosted scenario creates four temporary QA users and isolated fictional cases. The journeys cover historical onboarding, assignments, uploaded baseline/QS sources, all three Word outputs, published-proposal privacy, client consent, stale drafts and manual binding acknowledgment. AI acceptance uses real local document preparation with deterministic provider success/failure fixtures; live inference has a separate opt-in check in the AI guide. Accounts are disabled during cleanup; immutable synthetic QA history is retained. It does not use or change the owner-created pilot users' passwords. Do not run this as a routine production health check.

## Design system

The [brand specification](docs/rekonvia-brand-palette-v1.0.md) and [CSS-first theme](src/styles/rekonvia-theme.css) define the palette and typography. One theme entrypoint imports the retained [stage stylesheet](src/styles/styles.css) in the components layer. The 66 primitive shades use Tailwind v4 `@theme static`; semantic aliases live in `:root` and `@theme inline`.

All six anchors, eight workflow status values and four original SVG assets are preserved. Inter and Plus Jakarta Sans load from [self-hosted files with licenses](public/assets/fonts/README.md). Controls have visible focus and respect reduced motion. The app remains light by default. `npm run test:brand` checks the actual build.

## Publish to Vercel

Use Vite, Node.js 24, `npm run build`, and output directory `dist`. Before deploying this version, add these frontend environment variables in Vercel:

- `VITE_SUPABASE_URL`: the project base URL, without `/rest/v1/`.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the publishable key.

Keep `VITE_DEMO_MODE` absent or false. Never add the database password, PAT, service-role/secret key or OpenRouter secret to frontend variables. The production origin must match Supabase Auth URL settings and the Edge Function's explicit CORS origin list. Preview URLs need an explicit allowed origin before they can call the API.

Deployment does not apply Supabase migrations/functions automatically from a Vercel build; follow the separate reviewed commands in [the backend guide](docs/supabase-backend.md). A repository commit/push and frontend deployment are owner-controlled steps unless explicitly requested.

## Boundaries

This is a fictional PAR renewal pilot for one brokerage. Raw-source sharing beyond published proposals, scheduled abandoned-upload cleanup, production recovery/SMTP, invoicing, policy administration and endorsements remain outside the current implementation. AI suggestions require original-source review and cannot establish acceptance, confirmation or readiness. File inspection is bounded format validation, not malware scanning. QS, proposal and DFS Word exports are editable drafts, not a promise of arbitrary source layout preservation or policy issuance. Researcher-led usability/value testing remains separate from technical acceptance.

Git excludes local research/plans, credentials, CLI linkage state, caches, installed skill packages, dependencies, build outputs and test artifacts. Keep those exclusions when publishing. Skill provenance and repository adaptations remain in `.agents/skills/README.md` and `sources.lock.json`.
