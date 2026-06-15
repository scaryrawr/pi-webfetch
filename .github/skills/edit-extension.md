# Edit pi web tools

## Purpose

Make changes to the pi web tool extensions in `extensions/`.

## Steps

1. Read the relevant entry point before editing:
   - `extensions/webfetch.ts` for URL fetching, HTML-to-markdown conversion, image return, truncation, and TUI rendering.
   - `extensions/websearch.ts` for DuckDuckGo Lite search parsing, `lynx` availability, truncation, and TUI rendering.
2. Update the `description` in `defineTool` if you change a tool's behavior or parameters.
3. Run `npm run build && npm run lint && npm run fmt:check` to validate. Run `npm run fmt` only when formatting changes are needed.

## Constraints

- `webfetch` supports only HTTP/HTTPS protocols.
- Preserve truncation to 2000 lines / 50 KB and the 5 MB response/search buffer limits.
- `websearch` should remain optional when `lynx` is unavailable.
- TUI renderers use `@earendil-works/pi-tui` primitives; cache width-dependent preview work in component state.
- Use NodeNext-compatible relative imports (`.js` extensions if relative imports are added).
- Strict TypeScript options are enforced by `tsconfig.json`.
