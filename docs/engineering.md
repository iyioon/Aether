# Engineering Standards

This document defines the working rules for keeping Aether reliable and easy to change. It complements the architecture overview with concrete implementation expectations.

## Module Boundaries

### Server

- Route modules validate transport input, translate known domain failures into HTTP responses, and delegate all data work.
- Repository modules own SQLite reads, writes, and transaction boundaries. They do not depend on Fastify.
- Pure domain modules contain calculations and selection policies. They do not access the database, clock, filesystem, or network.
- Media-processing modules receive resolved, path-safe source records. Raw request paths never reach filesystem APIs.
- Shared asset filters and score projections have one canonical implementation so listing and comparison behavior cannot drift.

### Web App

- Page components orchestrate focused hooks and presentation components; they should not reimplement API or domain rules.
- Hooks own asynchronous state, cancellation or stale-request protection, and cross-view synchronization.
- Repeated mutations for the same record must preserve user intent: serialize or coalesce them rather than allowing responses to win by arrival order.
- Media surfaces use the shared preview, viewer, annotation, and curation components.
- UI primitives come from `components/ui` and follow shadcn composition patterns. Native elements are used directly only when their semantics are the component, such as an invisible full-surface selection button.
- Page CSS owns layout. Reusable colors, borders, radii, motion timings, and focus states come from design tokens or shared primitives.

## State and Data Rules

- The server is authoritative for assets, scores, favorites, tags, comparison history, and derived rankings.
- Browser state may optimistically reflect a successful response, but it must use the returned asset record rather than reconstructing server calculations.
- Async effects must ignore stale responses after their query changes or component unmounts.
- Abort superseded reads when the transport supports it; polling schedules its next request only after the current request settles.
- Scroll handlers keep synchronous work bounded. Persisted restoration state is updated through the shared coalescing layer and explicitly flushed for page lifecycle events.
- Database changes affecting multiple rows use a transaction.
- Batch database paths validate and hydrate records with bounded set-based queries, reuse prepared statements inside loops, and preserve the caller's requested order.
- Ranking calculations remain deterministic for a fixed set of active pair preferences. Randomness is limited to pair selection and can be injected in tests.
- A score of zero is the sole unranked value. Final score calculation has one SQL definition shared by list and detail queries.

## UI and Accessibility

- Prefer existing shadcn components for buttons, cards, dialogs, alerts, tabs, inputs, progress, skeletons, and tooltips.
- Destructive actions require an `AlertDialog` with an explicit description of retained and removed data.
- Icon-only controls require an accessible name. Tooltips supplement labels; they do not replace them.
- Keyboard actions must not fire while an editable field, dialog, menu, or other keyboard layer is active.
- Focus indicators must remain visible and must not be clipped by overflow containers.
- Motion uses the shared duration tokens and respects reduced-motion preferences.
- Do not add decorative glow effects. Use borders, tokenized backgrounds, and restrained component-default elevation when separation is necessary.

## Quality Gates

Every change must pass:

```bash
npm run verify
```

This runs ESLint, Prettier verification, TypeScript checks, unit and integration tests, and production builds. Run `npm run test:e2e` for browser-level interaction, authentication, media delivery, or release validation when the required browser is available.

Tests should be added at the lowest useful level:

- Pure unit tests for ranking, filtering, parsing, and layout calculations.
- Repository and API integration tests for transactions, authorization, migrations, media responses, and failure behavior.
- Browser tests for critical interactions that cannot be established below the UI boundary.

## Change Discipline

- Keep behavioral changes separate from mechanical formatting whenever practical.
- Do not duplicate a calculation or query fragment to solve a local UI problem; extract the shared rule.
- Preserve source media and unrelated working-tree changes.
- Update user documentation for behavior changes and architecture or development documentation for structural changes.
- A refactor is complete only when obsolete code is removed, docs are current, and the full verification command passes.
