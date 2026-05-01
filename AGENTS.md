# pi-webfetch

## Architecture

This repo implements the **webfetch extension** for the pi coding agent — a tool that fetches web pages, converts HTML to markdown, and returns the result with truncation metadata.

**Extension structure:**

- `extensions/webfetch.ts` — Single-file extension. Registers the `webfetch` tool, defines the fetch logic, HTML→markdown conversion (via Turndown), truncation, and custom TUI renderers for call/result display.

**Key patterns:**

- Fetches only `http:` and `https:` URLs; rejects other protocols.
- HTML responses are converted to markdown via Turndown (ATX headings, fenced code blocks, `-` list markers).
- Responses are truncated to 2000 lines / 50 KB (head truncation) to protect the context window.
- Custom TUI renderers: a `WebfetchResultRenderComponent` (Container subclass) handles collapsed preview with line count hints and expanded full output.
- Result truncation metadata is carried in `details` so the renderer can show a banner.

## Conventions

- **TypeScript**: Strict mode, ES2024, `nodenext` modules. Use `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUncheckedSideEffectImports`.
- **Imports**: Use explicit `.js` extensions for relative imports (TS/Nodenext convention).
- **Naming**: Functions use `camelCase`. Type exports use PascalCase. JSDoc `@param`/`@returns`/`@throws` for public APIs.
- **Error handling**: Wrap fetch logic in try/catch; return typed `{ content, details }` results rather than throwing from the tool executor.
- **TUI**: Use `@mariozechner/pi-tui` primitives (`Container`, `Text`, `truncateToWidth`, `truncateToVisualLines`) for custom renderers.
- **Truncation**: Prefer `truncateHead` from the pi agent SDK; include truncation metadata in result `details` for the renderer to surface.

## Build & Test

```bash
npm run build    # tsgo -p ./tsconfig.json
npm test         # vitest
npm run fmt      # oxfmt
npm run fmt:check # oxfmt --check
npm run lint     # oxlint with tsgo type-checking
npm run lint:fix # oxlint auto-fix
```

Validation: `npm run build` must pass (zero errors).

## Safety

- Only `http:` and `https:` protocols are allowed.
- Responses exceeding 5 MB are rejected at the fetch level.
- No state is persisted between tool calls; each fetch is independent.
