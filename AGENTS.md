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

The source directories are split by **dependency category**, not by topic — that is the
point of the split, and the test projects in `vitest.config.ts` enforce it:

- `src/core/` — in-process pure logic, no browser API: `markdown.ts` (parsing), `view.ts`
  (source → view mapping), `inline.ts` (per-line state), `lists.ts` (numbering, indent),
  `lines.ts` (line number ↔ character offset), `imageSize.ts` (the `{width=…}` image suffix),
  `editCommands.ts` (formatting commands),
  `shortcuts.ts` (keystroke → command name), `autosave.ts` (when the draft gets written),
  `welcome.ts` (the welcome document), `markdownIt.ts` (the shared markdown-it instance)
- `src/platform/` — browser-API adapters: `documents.ts` (open/save/export, two adapters behind one
  interface), `draft.ts` (localStorage), `html.ts` (markdown → sanitized HTML)
- `src/shell/` — React: `App.tsx`, `components/Editor.tsx`, `components/Outline.tsx`, `useTheme.ts`
- `src/editor/` — the native kernel: `render.ts` (imperative rendering, DOM → source),
  `position.ts` (source offset ↔ DOM position), `kernel.ts` (state, events, same-frame caret)
- `src/test/` — browser-mode helpers
- `docs/adr/`, `docs/agents/`, `CONTEXT.md` — decisions, skill configuration, glossary.
  Before changing block collection, run segmentation or any inline syntax, read
  `docs/adr/0002-caret-invariants-and-pitfalls.md`: it lists the invariants the caret
  arithmetic depends on and the symptoms each one produced when broken.
  `docs/adr/0003-image-size-syntax.md` covers the one inline syntax this repo adds
  (`{width=…}`), including why it is pixels-only and who reads it.

## Agent skills

### Issue tracker

Issues and specs are local markdown under `.scratch/<feature>/` — gitignored and never
committed, so the tracker is not published even though the app now is. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, label strings equal to their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root (created lazily) plus ADRs in `docs/adr/`. See
`docs/agents/domain.md`.
