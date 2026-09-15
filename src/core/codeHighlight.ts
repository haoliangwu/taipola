/**
 * Code-fence highlighting, as an offset-addressable token stream.
 *
 * The editor renders runs that each remember which source characters they came
 * from, and every caret offset is derived from them, so a highlighter that emits
 * an HTML string is useless here: the spans would have to be re-parsed to find
 * out where a token begins. What is needed is the *partition* — a list of pieces
 * whose concatenation is the input, verbatim, each carrying the classes that
 * colour it. `highlight.js` can produce exactly that: its emitter walks a token
 * tree through a builder (`{ addText, openNode, closeNode }`) that its own HTML
 * renderer is the other implementation of, so the pieces are the same ones the
 * exported file is built from.
 *
 * Reusing the instance the export already ships (`highlight.js/lib/common`, 34
 * languages) is deliberate: it is already in the bundle, so in-editor
 * highlighting costs no extra bytes and, because both sides use the same classes
 * and the same theme, the editor and the exported file cannot drift apart.
 *
 * This module is pure — markdown-it's own note says highlight.js is, which is
 * what lets the parse side stay in the node test layer.
 */
import hljs from 'highlight.js/lib/common'

/** One styled piece of the source. Concatenating a token list returns its input. */
export interface CodeToken {
  /** Characters contributed, verbatim. Never empty. */
  text: string
  /** CSS classes colouring them, e.g. `hljs-keyword` or `hljs-title function_`. */
  cls: string
}

/** A scope-carrying node of highlight.js's token tree. */
interface TokenNode {
  scope?: string
}

/**
 * The emitter's tree-walking surface.
 *
 * `walk` is how highlight.js's own `HTMLRenderer` builds its markup, and it is
 * the only way to observe the token boundaries — but the published `Emitter`
 * interface (`highlight.js/types/index.d.ts`) declares just `toHTML`, so the walk
 * is reached through this narrow local type instead of `any`.
 *
 * Note what is NOT used here: `configure({ __emitter })`. A custom emitter has to
 * implement the renderer's `openNode`/`closeNode` as well, which that published
 * interface omits — and because highlight.js ships with `SAFE_MODE` on
 * (`lib/core.js`, `let SAFE_MODE = true`), the resulting `TypeError` is SWALLOWED
 * and the call returns a result that looks successful with no tokens in it.
 */
interface WalkableEmitter {
  walk(builder: {
    addText(text: string): void
    openNode(node: TokenNode): void
    closeNode(node: TokenNode): void
  }): void
}

type HighlightResult = ReturnType<typeof hljs.highlight>

/**
 * Blocks beyond this are left plain.
 *
 * Measured on this machine (warm, node/V8): 100 lines 0.75 ms, 500 lines
 * 3.55 ms, 2000 lines 13.4 ms. Highlighting happens whenever a code block's text
 * changes — that is, once per keystroke inside it — so the ceiling is set where
 * the call still fits in a frame with room for the render that follows, and a
 * pathological 10k-line paste cannot make typing crawl.
 */
const MAX_CODE_LINES = 1000
const MAX_CODE_LENGTH = 100_000

/**
 * Memo for the call above. The working set is one or two blocks (the one being
 * edited and the ones on screen), so a small FIFO is plenty; the point is that
 * re-rendering an unchanged block — which the kernel does on every caret move —
 * does not re-tokenize it.
 */
const CACHE_LIMIT = 64
const cache = new Map<string, CodeToken[] | null>()

/**
 * The language a fence's info string names, or null when it names none.
 *
 * The FIRST whitespace-delimited word, which is the rule markdown-it's own fence
 * renderer applies before handing `langName` to the `highlight` option — the
 * editor and the export must read ` ```js title="x" ` the same way.
 */
export function fenceLanguage(info: string): string | null {
  const first = info.trim().split(/\s+/)[0]
  return first ? first : null
}

/**
 * The highlight.js tokens for `code`, or null when nothing should be coloured.
 *
 * Null is a normal answer, not a failure: an unknown tag, an absent tag, an
 * oversized block and a grammar that broke mid-parse all land here, and the
 * caller falls back to rendering the line as plain source.
 */
export function highlightCode(code: string, lang: string | null): CodeToken[] | null {
  if (!lang) return null
  // `highlight()` THROWS on a language it does not know, so the gate is required.
  if (!hljs.getLanguage(lang)) return null
  if (code.length > MAX_CODE_LENGTH) return null
  if (countLines(code) > MAX_CODE_LINES) return null

  const key = `${lang}\u0000${code}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const tokens = tokenize(code, lang)
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, tokens)
  return tokens
}

/** Splits a highlighted region into one token list per source line. */
export function tokensByLine(tokens: CodeToken[], lineTexts: string[]): CodeToken[][] | null {
  const out: CodeToken[][] = []
  let index = 0
  let at = 0

  for (let line = 0; line < lineTexts.length; line++) {
    const want = lineTexts[line]
    const pieces: CodeToken[] = []
    let got = 0
    while (got < want.length) {
      const token = tokens[index]
      if (!token) return null
      const take = Math.min(token.text.length - at, want.length - got)
      if (take <= 0) return null
      if (token.text.slice(at, at + take) !== want.slice(got, got + take)) return null
      pieces.push({ text: token.text.slice(at, at + take), cls: token.cls })
      got += take
      at += take
      if (at === token.text.length) {
        index++
        at = 0
      }
    }
    out.push(mergeAdjacent(pieces))

    // The lines were joined by `\n` to be highlighted; that separator is not part
    // of any line, so it has to be stepped over here or the next line would be
    // read one character early.
    if (line < lineTexts.length - 1) {
      const token = tokens[index]
      if (!token || token.text[at] !== '\n') return null
      at++
      if (at === token.text.length) {
        index++
        at = 0
      }
    }
  }

  // The split must consume the whole stream: a caller that asked for fewer lines
  // than the tokens cover has a bug, and returning a truncated answer would hide
  // it as silently missing text.
  return index === tokens.length ? out : null
}

function tokenize(code: string, lang: string): CodeToken[] | null {
  let result: HighlightResult
  try {
    result = hljs.highlight(code, { language: lang, ignoreIllegals: true })
  } catch {
    // The `getLanguage` gate above already rules this out; a grammar that throws
    // anyway must not take the editor's render down with it.
    return null
  }

  // SAFE_MODE is ON by default in highlight.js, so a grammar that fails part-way
  // does not throw — it returns `value = escape(code)` with `errorRaised` set and
  // a token stream that stops where the failure did. Checking it is the only way
  // to tell "this language has nothing to colour here" from "this language gave
  // up", and the second must not be rendered as if it were the first.
  if (result.errorRaised) return null

  const pieces: CodeToken[] = []
  const stack: string[] = []
  const emitter = result._emitter as unknown as WalkableEmitter
  emitter.walk({
    addText(text) {
      if (text === '') return
      pieces.push({ text, cls: stack.filter(Boolean).join(' ') })
    },
    openNode(node) {
      // A node without a scope still opens and closes (the tree walks every
      // object node), so an empty entry keeps the stack balanced.
      stack.push(node.scope ? cssClasses(node.scope) : '')
    },
    closeNode() {
      stack.pop()
    },
  })

  const merged = mergeAdjacent(pieces)
  // The stream has to be an exact partition of the input. Anything else means the
  // walk and the grammar disagree with the source, and handing that to the view
  // would put characters in the DOM the model does not have (or lose characters
  // it does) — the one failure this feature must not be able to cause.
  return merged.length > 0 && merged.map((token) => token.text).join('') === code ? merged : null
}

/**
 * highlight.js's own scope-to-class mapping (`scopeToCSSClass` in `lib/core.js`).
 *
 * A TIERED scope becomes several classes, the tail gaining one underscore per
 * level: `title.function` → `hljs-title function_`, which is what the theme's
 * `.hljs-title.function_` selector matches. Collapsing it into a single class
 * name would silently lose that colour.
 *
 * A `language:…` scope is the HTML renderer's marker for an embedded
 * sub-language (`<script>` inside html). No theme styles it, and it would sit on
 * every run of the embedded block, so it is dropped rather than reproduced.
 *
 * The `hljs-` prefix is highlight.js's default `classPrefix`; this app never
 * changes it, and the imported theme depends on it.
 */
function cssClasses(scope: string): string {
  if (scope.startsWith('language:')) return ''
  if (scope.includes('.')) {
    const [head, ...rest] = scope.split('.')
    return [`hljs-${head}`, ...rest.map((part, i) => `${part}${'_'.repeat(i + 1)}`)].join(' ')
  }
  return `hljs-${scope}`
}

/** Merges neighbouring pieces that share a class, so a line does not render one span per token. */
function mergeAdjacent(tokens: CodeToken[]): CodeToken[] {
  const out: CodeToken[] = []
  for (const token of tokens) {
    const last = out[out.length - 1]
    if (last && last.cls === token.cls) last.text += token.text
    else out.push({ ...token })
  }
  return out
}

function countLines(code: string): number {
  let lines = 1
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lines++
  return lines
}
