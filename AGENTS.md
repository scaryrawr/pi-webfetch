# pi-webfetch Repository Guidelines

## Project Structure & Module Organization

This is a pi coding-agent extension package. `package.json` loads the extension entry point from `pi.extensions`: `extensions/webfetch.ts`.

- `extensions/webfetch.ts` registers `webfetch`: accepts only `http:`/`https:` URLs, fetches pages, converts `text/html` through Turndown, returns image responses as base64 `ImageContent`, truncates text with `truncateHead`, and renders custom TUI previews.

## Build, Test, and Development Commands

- `npm run build` — TypeScript check with `tsgo -p ./tsconfig.json`; this must pass before handoff.
- `npm run lint` — `oxlint` with type-aware checking over `extensions/**/*.ts`.
- `npm run fmt:check` — verify formatting/import sorting; use `npm run fmt` to rewrite formatting.
- `npm run lint:fix` — auto-fix supported lint issues.
- `npm test -- --run` — Vitest. There are currently no test files, so this exits 1 until tests are added; do not treat that as a repo regression.

Use `npm run build && npm run lint && npm run fmt:check` as the current required validation path.

## Coding Style & Naming Conventions

TypeScript is strict ES2024 with `module: nodenext`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `noUncheckedSideEffectImports`. Keep relative imports compatible with NodeNext (`.js` extensions when any are added). `oxfmt` sorts imports.

Use `camelCase` for functions and `PascalCase` for exported types/classes. Keep public helpers documented with JSDoc `@param`/`@returns`. Tool executors should catch errors and return typed `AgentToolResult` content/details rather than throwing to the agent.

## Testing Guidelines

If you add tests, use Vitest naming that its defaults discover (`*.test.ts` or `*.spec.ts`) and then include `npm test -- --run` in validation. Prefer exported pure helpers over network-dependent tests.

## Security & Agent-Specific Instructions

Preserve protocol and size limits: `webfetch` must not fetch non-HTTP(S) URLs, and outputs must stay bounded by the 5 MB fetch buffer plus `truncateHead` defaults (2000 lines / 50 KB). Do not persist state between tool calls. Keep TUI renderers built from `@earendil-works/pi-tui` primitives and cache width-dependent preview work in component state.
