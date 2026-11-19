# Repository guidance

- Continue in English unless the user requests another language.
- The app is named Rekonvia. The current renewal reference is `docs/research/renewal-flow-v2/renewal-flow-v2.md`, including the SVG files it references. The files in `docs/research/renewal-flow-v1/` are historical.
- Start local research navigation at `docs/research/README.md`. The latest synthesis is `docs/research/post-prototype-research-plan/post-convo-analysis/11-consolidated-synthesis.md`; the approved implementation plan and phase status are in `docs/v1-plan/01-rekonvia-v1-implementation-plan.md`. Both folders are private, Git-ignored local material and may be absent in a fresh checkout.
- The current focus is Property All Risks renewal. Invoicing, policy administration, and endorsements are considerations for later phases.
- Follow the roles defined in flow v2: the client becomes involved after the proposal; the broker reviews without granting formal approval; sums insured and locations must come from client confirmation.
- Skills are installed for this repository only, in `.agents/skills/`. Keep skill installations, runtimes, and additional configuration within this repository; do not install into user directories or change global configuration.
- Use Taste for UI and browser checks relevant to the broker's workflow application, Ponytail for implementation efficiency, and Graphify when a knowledge graph is needed. Adapt upstream design guidance to the renewal application's needs.
- Sources, commits, local adaptations, and dependencies are documented in `.agents/skills/README.md` and `.agents/skills/sources.lock.json`.
