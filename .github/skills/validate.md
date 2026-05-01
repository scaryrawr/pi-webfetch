# Validate Build & Lint

## Purpose

Run the full validation pipeline to confirm the extension compiles cleanly and passes linting.

## Steps

1. Run `npm run build` — must produce zero errors.
2. Run `npm run lint` — oxlint with tsgo type-checking; must be clean.
3. Run `npm run fmt:check` — ensure formatting is correct.
4. Run `npm test` — vitest suite (if applicable).

## Exit condition

All four commands complete with exit code 0 and no errors/warnings.
