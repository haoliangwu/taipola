# taipola

A minimal-but-powerful Markdown editor with Typora semantics: the syntax block holding the caret
shows its Markdown source, and everything else renders in place. No split pane, no preview button.

The editor core is **native TypeScript** (`src/editor/`); React renders only the shell
(`src/shell/App.tsx`, `src/shell/components/Editor.tsx`). See `docs/adr/0001-editor-core-native.md`.

## Commands

```bash
pnpm dev          # http://localhost:5178
pnpm build        # tsc -b && vite build
pnpm typecheck    # tsc -b
pnpm test         # both layers (unit + browser)
pnpm test:unit    # pure functions only — fast, no browser
pnpm test:browser # real Chromium: caret, keys, IME, CSS contracts
```

The browser layer needs Chromium; if it is not in `~/Library/Caches/ms-playwright`, run with
`PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers`.

## Layout

The three source directories are split by **dependency category**, not by topic — that is the
point of the split, and the test projects in `vitest.config.ts` enforce it:

- `src/core/` — in-process pure logic, no browser API: `markdown.ts` (parsing), `view.ts`
  (source → view mapping), `inline.ts` (per-line state), `lists.ts` (numbering, indent),
  `editCommands.ts` (formatting commands), `welcome.ts` (the welcome document), `markdownIt.ts`
  (the shared markdown-it instance)
- `src/platform/` — browser-API adapters: `documents.ts` (open/save/draft), `html.ts` (export)
- `src/shell/` — React: `App.tsx`, `components/Editor.tsx`, `components/Outline.tsx`, `useTheme.ts`
- `src/editor/` — the native kernel: `dom.ts` (imperative rendering + position mapping),
  `kernel.ts` (state, events, same-frame caret)
- `src/test/` — browser-mode helpers
- `docs/adr/`, `docs/agents/`, `CONTEXT.md` — decisions, skill configuration, glossary

## Agent skills

### Issue tracker

Issues and specs are local markdown under `.scratch/<feature>/` (no git remote, nothing is
published). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, label strings equal to their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root (created lazily) plus ADRs in `docs/adr/`. See
`docs/agents/domain.md`.
