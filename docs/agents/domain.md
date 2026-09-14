# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary (created by `/domain-modeling`; see "Lazy
  creation" below).
- **`docs/adr/`**: read the ADRs that touch the area you are about to work in. Today there are
  four: `docs/adr/0001-editor-core-native.md` (the editor core is a native kernel; React renders
  only the shell), `0002-caret-invariants-and-pitfalls.md` (caret arithmetic invariants —
  required before touching block collection or caret code), `0003-image-size-syntax.md` (the
  `{width=…}` inline syntax), `0004-write-back-when-there-is-a-file.md` (content reaches its file
  on its own whenever the document has one — which is why switching documents no longer asks).

If any of these files do not exist, **proceed silently**. Do not flag their absence and do not
suggest creating them upfront.

## Lazy creation

`CONTEXT.md` (the domain glossary) is created lazily by `/domain-modeling` — reached through
`/grill-with-docs` and `/improve-codebase-architecture` — when a term or a decision actually
gets resolved. The same skill writes new ADRs into `docs/adr/`.

## File structure

Single-context repo:

```
/
├── CONTEXT.md              ← glossary, once it exists
├── docs/
│   ├── adr/               ← one file per decision
│   │   ├── 0001-editor-core-native.md
│   │   ├── 0002-caret-invariants-and-pitfalls.md
│   │   └── 0003-image-size-syntax.md
│   └── agents/             ← configuration for these skills
└── src/
    ├── core/               ← in-process pure logic: markdown parsing, view mapping, inline state
    ├── editor/             ← native editor kernel (DOM + events + state)
    ├── platform/           ← browser-API adapters (file access, draft storage, HTML export)
    └── shell/              ← React shell
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a
test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary
explicitly avoids.

Concepts this repo already names consistently, and which new writing should keep using:
**source vs view** (the Markdown source is the model; the view is what is rendered), **run**
(a stretch of characters sharing one styling and one visibility), **marker** (syntax that
collapses to zero width), **reveal** (showing a construct's markers because the caret is inside
it), **block / line box**, **caret offset** (a source offset, never a DOM position).

If the concept you need isn't in the glossary yet, that's a signal: either you are inventing
language the project doesn't use (reconsider) or there is a real gap (note it for
`/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently
overriding:

> _Contradicts ADR-0001 (native editor kernel), but worth reopening because…_
