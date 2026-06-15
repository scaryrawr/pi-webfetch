# Validate Build & Lint

## Purpose

Run the current required validation pipeline for this extension package.

## Steps

1. Run `npm run build` — TypeScript must produce zero errors.
2. Run `npm run lint` — oxlint with type-aware checking must be clean.
3. Run `npm run fmt:check` — formatting/import sorting must already be correct.
4. If Vitest test files exist (`*.test.ts` or `*.spec.ts`), run `npm test -- --run`.

## Note

`npm test -- --run` currently exits 1 because the repository has no test files. Do not report that as a regression unless tests have been added and still fail.

## Exit condition

The first three commands complete with exit code 0; Vitest also passes when test files are present.
