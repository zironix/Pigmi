# Contributing to Pigmi

Thank you for helping improve Pigmi.

## Before you start

For substantial features or changes to the saved texture format, open an issue first. This
keeps implementation work aligned and gives maintainers a chance to discuss compatibility.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Local setup

1. Fork and clone the repository.
2. Install Node.js 22 LTS and npm 10 or newer.
3. Run `npm ci`.
4. Run `npm start` and verify the affected workflow manually.

Before submitting a pull request, run:

```bash
npm run check
```

`npm run check` formats, lints, tests, and packages the app for the current platform. Packaging
can download Electron tooling on its first run.

## Code guidelines

- Keep modules focused and prefer small pure helpers over duplicated inline logic.
- Use clear names and early returns. Avoid clever abstractions that hide simple behavior.
- Comments should explain intent, constraints, or compatibility decisions—not restate the code.
- Add or update tests for parsing, normalization, layout, and other deterministic behavior.
- Never use `eval`, `Function`, renderer-side Node integration, or unrestricted IPC.
- Add renderer capabilities through a named IPC channel and the narrow preload bridge.
- Keep new JavaScript names in `camelCase`.
- Existing saved texture fields use `snake_case` for backward compatibility. Do not rename those
  fields without a documented migration.
- Do not commit generated `.vite`, `out`, `coverage`, or `node_modules` directories.

Prettier and ESLint are the source of truth for formatting and style.

## Pull requests

Keep each pull request focused. Include:

- a short explanation of the problem and solution;
- screenshots or a screen recording for visible UI changes;
- the operating systems you tested;
- tests for behavior that can be verified without Electron UI automation;
- any migration or compatibility notes.

The pull request template contains the final checklist.
