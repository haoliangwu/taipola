/**
 * The app's icons, inline rather than from a font or a package.
 *
 * The narrow-screen mini group is the only command entry point on a phone, and the
 * glyphs the desktop buttons use (`☀ ☾ ◐ ‹› 🔗`) render differently per platform and
 * per font — `🔗` worst of all, because it is an emoji and so ignores `font-size` and
 * `color` outright. A handful of `<svg>` elements cost nothing, inherit
 * `currentColor`, and cannot fall back to a tofu box.
 *
 * Every icon is drawn on ONE 16-unit grid with one stroke width, which is the whole
 * point: the toolbar used to mix font glyphs (whose ink is whatever the font decides:
 * `▦` a solid block, `•` a speck, `❝` oversized) with drawn shapes, and no two of
 * them agreed on weight or size. `B`, `I`, `S` and `H1`–`H3` joined them late — as
 * `<text>` INSIDE the same frame, because a bold or italic letterform is not
 * something a drawing can say better, while the frame is what keeps its ink the same
 * size as everything beside it.
 */
import type { ReactNode } from 'react'
import type { IconName } from '../../core/shortcutHelp'

function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/**
 * The toolbar's picture commands, drawn on the same 16-unit grid.
 *
 * They were font glyphs (`‹› ❝ • ☑ ▦ {}`), and a glyph's ink is whatever the font
 * decides: `▦` came out a solid block, `•` a speck, `❝` oversized and bold, `‹›`
 * hairline — four different optical weights in one row, none of them chosen. Drawing
 * them puts every one on the same stroke width, the same `currentColor` and the same
 * roughly-11-unit ink box as the chain link beside them.
 *
 * `B`, `I`, `S` and `H1`–`H3` stay text on purpose: their styling IS their meaning
 * (a drawn "bold" says nothing), and letters read better than any drawing of them.
 */
export function InlineCodeIcon() {
  return (
    <Glyph>
      <path d="M6.3 3.2 2.3 8l4 4.8" />
      <path d="M9.7 3.2 13.7 8l-4 4.8" />
    </Glyph>
  )
}

/** Braces, because `{}` was already this button's label — just drawn now. */
export function CodeBlockIcon() {
  return (
    <Glyph>
      <path d="M6.6 3c-1.4 0-2 .7-2 2v1.5c0 1-.6 1.5-1.9 1.5 1.3 0 1.9.5 1.9 1.5v1.5c0 1.3.6 2 2 2" />
      <path d="M9.4 3c1.4 0 2 .7 2 2v1.5c0 1 .6 1.5 1.9 1.5-1.3 0-1.9.5-1.9 1.5v1.5c0 1.3-.6 2-2 2" />
    </Glyph>
  )
}

/**
 * A bar with lines beside it — which is what a quote looks like in this editor:
 * `.vl-quote::before` draws the same bar down the left of the line.
 */
export function QuoteIcon() {
  return (
    <Glyph>
      <path d="M3.4 2.6v10.8" strokeWidth="2" />
      <path d="M7.4 5.4h6" />
      <path d="M7.4 9.2h4" />
    </Glyph>
  )
}

/** The three list commands share a rhythm: markers at these y's, text after them. */
const LIST_ROWS = [3.8, 8, 12.2]

export function BulletListIcon() {
  return (
    <Glyph>
      {LIST_ROWS.map((y) => (
        <circle key={y} cx="3.6" cy={y} r="1.15" fill="currentColor" stroke="none" />
      ))}
      {LIST_ROWS.map((y) => (
        <path key={y} d={`M7.7 ${y}h5.3`} />
      ))}
    </Glyph>
  )
}

export function OrderedListIcon() {
  return (
    <Glyph>
      {/* The numerals are TEXT, not paths: at this size a drawn `2` is a two-unit
          squiggle, while 4.8px of the UI font is still a legible digit. */}
      {LIST_ROWS.map((y, i) => (
        <text
          key={y}
          x="2.3"
          y={y + 1.7}
          fontSize="4.8"
          fill="currentColor"
          stroke="none"
          fontFamily="var(--font-ui)"
        >
          {i + 1}
        </text>
      ))}
      {LIST_ROWS.map((y) => (
        <path key={y} d={`M7.7 ${y}h5.3`} />
      ))}
    </Glyph>
  )
}

export function TaskListIcon() {
  return (
    <Glyph>
      {/* The box replaces the first row's bullet, which is how a task list reads. */}
      <rect x="2.3" y="1.6" width="4.4" height="4.4" rx="1.1" />
      <path d="M3.5 3.8 4.4 4.7 5.6 3" />
      <path d="M8.7 3.8h4.3" />
      <path d="M8.7 8h4.3" />
      <path d="M8.7 12.2h4.3" />
    </Glyph>
  )
}

export function TableIcon() {
  return (
    <Glyph>
      <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.2" />
      <path d="M2.4 6.5h11.2" />
      <path d="M2.4 9.6h11.2" />
      <path d="M8 3.4v9.2" />
    </Glyph>
  )
}

/**
 * A chain link, for the toolbar's 链接 button.
 *
 * It was the emoji `🔗`, which is why it stood out: an emoji is painted by the
 * colour-emoji font at its own size and ignores both `font-size` and `color`, so
 * beside 12.5px monochrome labels it was the largest and the only coloured thing in
 * the row. Drawing it puts it under the same `currentColor` and the same stroke
 * weight as every other glyph in the app.
 *
 * Two hooks, each rotated 180° from the other about the centre — that offset is what
 * makes them read as interlocking links rather than one bent line. The paths are
 * inset to about 11.8 of the 16 units, so the ink lands near 11.8px: `☑` measures
 * 11.3px and the letter glyphs about 9px, which is the row this has to sit in.
 */
export function LinkIcon() {
  return (
    <Glyph>
      <path d="M6.8 8.6a3 3 0 0 0 4.524.324l1.8-1.8a3 3 0 0 0-4.242-4.242l-1.032 1.026" />
      <path d="M9.2 7.4a3 3 0 0 0-4.524-.324l-1.8 1.8a3 3 0 0 0 4.242 4.242l1.026-1.026" />
    </Glyph>
  )
}

export function SaveIcon() {
  return (
    <Glyph>
      <path d="M3 2.5h10a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" />
      <path d="M5.5 2.5v4h5v-4" />
      <path d="M5.5 13.5v-3h5v3" />
    </Glyph>
  )
}

/**
 * An arrow coming DOWN into a tray: 导出.
 *
 * It pointed the other way at first, which is the classic upload/share glyph —
 * wrong way round for a command that hands the browser a file to download, and
 * easy to confuse with the floppy beside it. The tray is the same either way;
 * the arrow is what decides what a reader thinks the button does.
 */
export function ExportIcon() {
  return (
    <Glyph>
      <path d="M8 2.5v8" />
      <path d="M4.8 7.3 8 10.5l3.2-3.2" />
      <path d="M3 13.5h10" />
    </Glyph>
  )
}

/** A sheet with a plus on it: 新建. */
export function NewIcon() {
  return (
    <Glyph>
      <path d="M9.5 2.5H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6z" />
      <path d="M9.5 2.5V6H13" />
      <path d="M8 8.5v3.5M6.2 10.2h3.6" />
    </Glyph>
  )
}

/** A folder: 打开. */
export function OpenIcon() {
  return (
    <Glyph>
      <path d="M2.5 4.2a1 1 0 0 1 1-1h2.7l1.2 1.6h5.1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1z" />
    </Glyph>
  )
}

/**
 * A folder with a line under it: 打开文件夹.
 *
 * The open glyph is already a folder, so the two would be indistinguishable at
 * 16px. The line underneath is what makes this one mean "the folder as a whole"
 * — the list of documents, rather than one of them.
 */
export function FolderIcon() {
  return (
    <Glyph>
      <path d="M2.5 3.8a1 1 0 0 1 1-1h2.6l1.2 1.5h5.2a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1z" />
      <path d="M3 14h10" />
    </Glyph>
  )
}

/* -------------------------------------------------------------------------- */
/* the toolbar's text commands, in the same frame                              */
/* -------------------------------------------------------------------------- */

/**
 * A letterform inside the 16-unit frame.
 *
 * `fontSize` 13 with the baseline at 12.3 puts a capital's ink at roughly 3–12.3 —
 * the same ~9.5 units of height as the drawn icons beside it — and, just as
 * importantly, keeps the whole TEXT BOX inside the 16-unit frame, which is what the
 * toolbar tests measure. A bare label in the toolbar could promise neither: the
 * toolbar's own font-size decided both.
 */
function Letter({
  children,
  size = 13,
  weight,
  x = 8,
  y = 12.3,
}: {
  children: ReactNode
  size?: number
  weight?: number
  x?: number
  y?: number
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={weight}
      textAnchor="middle"
      fill="currentColor"
      stroke="none"
      fontFamily="var(--font-ui)"
    >
      {children}
    </text>
  )
}

export function BoldIcon() {
  return (
    <Glyph>
      <Letter weight={700}>B</Letter>
    </Glyph>
  )
}

export /**
 * Serifs and a slanted stem — the standard italic icon, drawn rather than lettered.
 *
 * A sans-serif `I` is a bare stem: about two units wide, which reads as a speck
 * between icons this size. The two bars are what make it a letter.
 */
function ItalicIcon() {
  return (
    <Glyph>
      <path d="M6.9 3.1h4.4" />
      <path d="M4.7 12.9h4.4" />
      <path d="M9.1 3.1 6.9 12.9" />
    </Glyph>
  )
}

/**
 * The letter S with a line through it — the line is the meaning, not the letter:
 * that is the same strike the editor draws over struck text.
 */
export function StrikeIcon() {
  return (
    <Glyph>
      <Letter>S</Letter>
      <path d="M2.6 8h10.8" />
    </Glyph>
  )
}

/**
 * `H` with the level beside it, the way every editor spells it.
 *
 * The digit is a second, smaller letter rather than a corner badge: at this size a
 * badge reads as dust, and `H1` is exactly what the button meant as text.
 */
export function HeadingIcon({ level }: { level: number }) {
  return (
    <Glyph>
      <Letter x={5.1} weight={600}>
        H
      </Letter>
      <Letter x={11.7} y={12.4} size={7.2}>
        {level}
      </Letter>
    </Glyph>
  )
}

/** A circled question mark: 帮助. */
export function HelpIcon() {
  return (
    <Glyph>
      <circle cx="8" cy="8" r="6.1" />
      <Letter y={11.2} size={8.6}>
        ?
      </Letter>
    </Glyph>
  )
}

/**
 * The icon for a shortcut-reference entry, by name.
 *
 * A `Record` over `IconName`, so the type is what keeps the two ends together: an
 * entry asking for an icon that does not exist is a compile error rather than an
 * empty spot in the panel.
 */
const ICONS: Record<IconName, ReactNode> = {
  bold: <BoldIcon />,
  italic: <ItalicIcon />,
  strike: <StrikeIcon />,
  inlineCode: <InlineCodeIcon />,
  link: <LinkIcon />,
  heading1: <HeadingIcon level={1} />,
  heading2: <HeadingIcon level={2} />,
  heading3: <HeadingIcon level={3} />,
  quote: <QuoteIcon />,
  codeBlock: <CodeBlockIcon />,
  bulletList: <BulletListIcon />,
  orderedList: <OrderedListIcon />,
  taskList: <TaskListIcon />,
  table: <TableIcon />,
  save: <SaveIcon />,
  new: <NewIcon />,
  open: <OpenIcon />,
  folder: <FolderIcon />,
}

export function iconFor(name: IconName): ReactNode {
  return ICONS[name]
}
