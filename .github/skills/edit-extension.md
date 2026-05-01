# Edit the webfetch extension

## Purpose

Make changes to the `webfetch` extension (`extensions/webfetch.ts`) — the single-file extension entry point.

## Steps

1. Read `extensions/webfetch.ts` to understand the current implementation.
2. Make your changes. Keep the file as a single extension — don't split into multiple files unless absolutely necessary.
3. Update the `description` in `defineTool` if you change the tool's behavior or parameters.
4. Run `npm run build && npm run lint && npm run fmt` to validate.

## Constraints

- Only HTTP/HTTPS protocols are supported — don't add other protocol support without explicit direction.
- Truncation to 2000 lines / 50 KB is a core safety feature — preserve it.
- TUI renderers use `@mariozechner/pi-tui` primitives; cache computed values in `component.state`.
- Use explicit `.js` extensions for relative imports.
- Strict TypeScript: `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUncheckedSideEffectImports`.
