# Project Overrides

Rules below override the global `~/.claude/rules/` for this project.

## File Size

No 200-line limit. Do NOT split files just to hit a line count.
Split only when there is a genuine separation of concerns.

## File Naming

Follow the project's existing conventions — short, idiomatic names:

- `src/` and `test/` files use the same naming as the module/class they contain (e.g. `order-status.ts`, `auth.test.ts`)
- No need for long descriptive names to be self-documenting; the directory path provides context

## Modularization

Do NOT modularize unless the code genuinely benefits from it.
Ignore the global "consider modularizing at 200 lines" rule entirely.
