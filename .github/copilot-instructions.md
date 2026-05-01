# pi-webfetch — Copilot Instructions

## Quick start

- Run `npm run build` to validate TypeScript compiles cleanly.
- Run `npm test` for vitest tests.
- Run `npm run lint` for oxlint (includes tsgo type-checking).

## Extension architecture

This is a single-file extension at `extensions/webfetch.ts`. It:

1. Registers a `webfetch` tool via `pi.registerTool(defineTool({...}))`.
2. Fetches URLs (HTTP/HTTPS only), converts HTML → markdown via Turndown, truncates to 2000 lines / 50 KB.
3. Returns `{ content, details }` with optional truncation metadata.
4. Provides custom TUI renderers (`WebfetchResultRenderComponent`) for collapsed/expanded display.

## Conventions

- **TypeScript**: Strict, ES2024, `nodenext` modules. Enable `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUncheckedSideEffectImports`.
- **Imports**: Explicit `.js` extensions for relative imports.
- **Naming**: `camelCase` functions, `PascalCase` types, JSDoc on public APIs.
- **Error handling**: Catch errors in the tool executor; return typed error results rather than throwing.
- **TUI**: Use `Container`/`Text` from `@mariozechner/pi-tui` for renderers; cache computed values in `component.state`.

## What not to do

- Don't add new files unless the feature genuinely requires it — this extension is intentionally single-file.
- Don't persist any state between tool calls.
- Don't fetch non-HTTP(S) URLs.
- Don't remove the truncation logic — it's a core safety feature.
