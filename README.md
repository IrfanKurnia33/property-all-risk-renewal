# PAR renewal prototype

A usable interview prototype for Falih, based on [renewal flow v2](docs/renewal-flow-v2/renewal-flow-v2.md) and its diagrams. The interface uses Indonesian and supports a complete fictional Property All Risks renewal through broker, insurer, and client views.

All people, documents, locations, amounts, confirmations, and communications in the case are fictional. Role switching simulates the participants on one device. Nothing is sent to an insurer or client. Use fictional data when testing.

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

On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm` in these commands. Browser journey checks use the locally installed Microsoft Edge browser:

```powershell
npm run test:e2e
```

Install Microsoft Edge first if it is not available. Playwright uses its `msedge` channel; test reports and browser artifacts stay inside this repository.

The project uses React, TypeScript, Vite, and plain CSS. Word downloads use `docx`; the archive-content tests use `fflate`. No backend, API keys, or environment variables are required.

## Test with Falih

1. Open the app in a normal browser window. Follow or skip the first-visit tour. Use **Ulangi tur** to replay it; replaying the tour does not change the case.
2. As **Broker**, inspect the previous-period final slip and Standard T&C in **Bahan renewal**, then send the quotation to the insurer.
3. Switch to **Asuransi** in **Review asuransi**. Review the terms, propose a change, and send it back. Return as Broker, respond, and repeat until the insurer agrees with the current revision. Check occupation, dates, rate, deductible, coverages, claims history, and separate clause amendments.
4. As Broker, send the first proposal in **Proposal klien**. The **Klien** view becomes available only after this step.
5. As Klien, submit the sample update: Bekasi changes from Rp3.5 billion to Rp4.2 billion; Tangerang stays at Rp2 billion and still needs explicit confirmation; Cikarang proposes Rp1.8 billion from Rp1.5 billion with an unclear address.
6. As Broker, use **Rekonsiliasi data** to inspect each historical value, update, source, and status. Review/match the confirmed locations. Follow up on Cikarang. Try the Word export: blockers should explain what remains unresolved and offer a way to resolve each item.
7. As Klien, send the sample clarification for Cikarang with its complete address and confirmation. Return as Broker and match the clarified location. The broker cannot type a location or sum insured on behalf of the client.
8. Return the changed risk details to insurer review and obtain agreement for the current revision. Send the updated proposal when prompted; earlier agreements must no longer satisfy the latest revision.
9. As Broker, complete the final checks. Resolve any pending clause amendments separately from the original wording. Download the editable Word draft when all export blockers are cleared and inspect its confirmed values, provenance, period, premium, and clauses.
10. As Klien, agree to the current proposal. As Broker, request binding. As Asuransi, record acknowledgment. Confirm that coverage status follows the agreed coverage dates rather than the click date.
11. Add interview notes and download the Markdown session summary. It remains available while the case has unresolved blockers. Refresh the page to verify progress resumes, then use the confirmed reset to start a fresh case.

Also test the role selector, keyboard navigation, mobile layout, tour dismissal/replay, and a changed client value after insurer agreement. All affected checks and agreements should become stale.

## Saved progress and downloads

Progress is saved in `localStorage` for this site in the current browser. Opening a different browser, profile, device, or deployment domain starts a separate case. Clearing site data removes that browser's progress. The tour's completion state is stored separately from the case. Save failures or unreadable saved data are reported in the interface; reset requires confirmation.

Successful actions save case progress. Unsent form edits stay on the current page; the app warns before stage or role navigation discards client edits. Submit them before refreshing or closing the browser. Replaying the tour preserves those edits.

Use one tab for the case: tabs in the same browser share storage, and the last saved change wins without merging or synchronizing open tabs.

The `.docx` file is an editable simulated renewal draft, not an issued policy. The exporter checks readiness again before creating it. Original clauses remain verbatim, with amendment decisions in their own section. The Markdown session summary includes revision, timeline, separate export and binding blockers, coverage status, and test notes.

If a browser blocks downloads, allow downloads for the site and retry. The application can report document generation or download setup failures; the browser controls the final save and cannot report every canceled or blocked download to the app.

## Publish from GitHub to Vercel

Git excludes the historical `docs/renewal-flow-v1/` folder, installed skill packages, dependencies, build outputs, caches, editor settings, and test reports. These files remain available locally. The current v2 flow, application source, tests, and skill provenance records are included. A fresh checkout needs its own local skill installation if those development tools are wanted; versions and adaptations are recorded in `.agents/skills/README.md` and `.agents/skills/sources.lock.json`.

1. Commit the application source and `package-lock.json` to your GitHub repository. Do not commit `node_modules`, `dist`, browser profiles, screenshots, caches, or local tool runtimes.
2. In Vercel, add a new project and import that repository.
3. Select **Vite** as the framework preset, keep the project root at the repository root, use `npm run build`, and set the output directory to `dist`. Use Node.js 24 LTS, matching `package.json`.
4. Deploy and share the generated URL with Falih. A new GitHub commit creates the next Vercel deployment. Progress belongs to each browser and deployment origin; preview URLs do not share progress with the production URL.

Vercel's [Vite deployment guide](https://vercel.com/docs/frameworks/frontend/vite) covers Git imports and framework configuration, and its [supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) include Node.js 24. Browser-side Word generation follows the official [`Packer.toBlob` API](https://docx.js.org/api/classes/index.Packer.html).

## Boundaries

This version has one editable fictional case. It has no authentication, shared storage, real uploads/document extraction, AI extraction, email delivery, invoicing, policy administration, or endorsements. Switching roles is a testing convenience and is not an authorization system. Do not use it for real binding instructions or policy issuance.

See [prototype design and skill adaptations](docs/prototype-design.md) for the workflow choices and [validation results](docs/prototype-validation.md) for automated checks, Word verification, and the remaining Taste findings. The existing skills and historical flow documents remain unchanged.
