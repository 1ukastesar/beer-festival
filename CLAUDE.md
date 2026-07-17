# Project conventions

## Code style

- **Code comments must be written in English.** This applies to all comments
  in `.ts`, `.html`, CSS, and any other source files.
- **Do not use ligatures or fancy typographic characters in code internals.**
  In comments, identifiers, and log messages use plain ASCII: `-` instead of
  en/em dashes (`–`, `—`), `...` instead of the ellipsis character (`…`), `->`
  instead of arrows (`→`).
- **Do not use emojis in code internals** (comments, log messages, identifiers)
  or in this assistant's conversation output.
- **Never rewrite user-facing copy to satisfy the two rules above.** Text a user
  reads is product content and keeps its intended typography and emojis. This
  includes visible HTML body text, page `<title>`s, button and loading labels,
  display placeholders, and API error messages surfaced in the UI. Examples that
  must stay as authored: rank medals and beer-mug/star/warning icons; ranges
  like `1–10` (en dash); loading text like `Načítám…` (ellipsis). Only comments
  and code internals get ASCII-ised.

## Language

- The user-facing UI is in **Czech** (e.g. `public/*.html` visible text, API
  error messages). Keep those strings in Czech - do not translate them to
  English. Only comments are English.

## Git

- Use **Conventional Commits** for commit messages (e.g. `feat(display): ...`,
  `fix(admin): ...`, `chore: ...`).
