# Prototype design and workflow decisions

The source of truth is [renewal flow v2](renewal-flow-v2/renewal-flow-v2.md), including `Step-3A-dan-3B.svg` and `Step-6.svg`. The v1 documents remain historical. This prototype focuses on Property All Risks renewal; policy administration, invoicing, and endorsements belong to later phases.

## Workflow

The five stages follow the broker's work: Bahan renewal, Review asuransi, Proposal klien, Rekonsiliasi data, and Final review & binding. A visible testing role selector lets an interviewer act as broker, insurer, and client on one device. The client enters only after the first proposal. The broker reviews evidence, matches data, requests clarification, and transmits documents; the broker never grants formal approval or supplies client locations and sums insured.

Client submissions preserve both the historical baseline and the proposed update. An unchanged amount requires a client confirmation too. Cikarang's initial ambiguous address intentionally blocks export, so Falih can test whether the evidence and follow-up controls help him resolve it. Client changes reopen insurer review. Agreement, final checks, export readiness, and binding are tied to the current revision. Insurer acknowledgment is recorded separately from the broker's binding request, and coverage status follows the agreed period.

Original clause wording is preserved. Proposed amendments and their decisions are displayed and exported separately. Readiness is derived from case data, rather than a manually editable “approved” flag, and the Word exporter independently checks the same blockers.

## Taste adaptations

The repository's local copy of the [Taste skill](https://github.com/Leonxlnx/taste-skill) is applied to an operational workflow application, as requested in repository guidance. Its marketing-page recipes are adapted to the task:

- The actual workspace is the primary visual. Stage navigation, comparisons, and contextual evidence replace a sales hero and screen-height sections. Dense task content can grow naturally without hiding evidence below an artificial screen boundary.
- A restrained neutral palette and one blue accent support a consistent type, spacing, border, radius, and button system. Clear status words accompany color. Forms use visible labels and familiar Indonesian instructions with established insurance terms.
- Fictional source documents, addresses, financial values, and simulated submissions are explicitly authorized by this brief and remain labeled as test data. The skill's prohibition on fictional marketing claims is not treated as a prohibition on a fictional interview case.
- Simulation forms and role switching are intentional local actions. They do not claim a real send or require external contact details. An activity entry records only a completed local transition.
- Photography, decorative shaders, scenes, marketing moments, scroll effects, and hero entrance choreography add no evidence to the broker's decision and are omitted. Quiet hover/press feedback and visible focus remain appropriate; reduced motion is respected.
- Desktop supports side-by-side comparisons with stage and evidence navigation. Smaller screens stack labeled comparison values and contextual evidence, with reachable controls and no content covered by fixed bars.
- Browser checks focus on overflow at 320px, touch targets, contrast, keyboard focus, headings/labels, reduced motion, the tour, and the full renewal journey. Marketing-only checker results must be identified as adaptations; they must not be presented as passing workflow checks.

The first-visit tour explains navigation, roles, source documents, comparison, and blockers. It is dismissible and replayable, changes navigation only, and keeps its completion flag separate from the case.

## Ponytail and Graphify

[Ponytail](https://github.com/DietrichGebert/ponytail) guides a small dependency set: React/TypeScript/Vite for the app, plain CSS, `docx` for real Word output, native browser storage/download APIs, and targeted tests for the workflow and document boundary. There is no backend or generalized workflow engine. The domain module owns transitions and readiness rules so controls and downloads use the same rules.

[Graphify](https://github.com/Graphify-Labs/graphify) recommends direct targeted lookup for a small corpus when a graph does not exist. The starting corpus is one current flow document and two diagrams. The implementation traces those sources directly; no Graphify runtime, provider integration, external database, or global configuration is installed. A persistent graph can be introduced if the corpus grows enough to justify structural queries across many sources.

Skill files remain intact. Local installations, caches, browser profiles, and generated artifacts remain inside this repository and outside commits. Dependency and installation provenance for the skills remains in [the skill registry](../.agents/skills/README.md) and [its source lock](../.agents/skills/sources.lock.json).

## Deliberate limits

This is a fictional interview prototype. Browser-local progress cannot synchronize among people or devices, role switching is not access control, and simulated messages are not email. Source documents are inspectable fixtures rather than ingested uploads. A Word draft can be edited after download; the prototype cannot track such edits or issue a policy. Financial totals and premium are indicative, with tax, charges, and real underwriting outside this case.

The browser controls the final download save. Generation failures and failed download setup are surfaced, but the browser does not expose every canceled save or download permission decision to JavaScript. Word package/content checks can run automatically; rendering in Microsoft Word requires an installed copy and a manual open.
