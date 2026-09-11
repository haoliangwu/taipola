import { useMemo } from 'react'
import type { Heading } from '../../core/markdown'

interface OutlineProps {
  headings: Heading[]
  /** 1-based source line the caret currently sits on. */
  activeLine: number
  onJump: (line: number) => void
}

/** Sidebar document outline; highlights the section containing the caret. */
export function Outline({ headings, activeLine, onJump }: OutlineProps) {
  // The active entry is the last heading at or above the caret line.
  const activeIndex = useMemo(() => {
    let index = -1
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].line <= activeLine) index = i
      else break
    }
    return index
  }, [activeLine, headings])

  return (
    <aside className="outline" aria-label="大纲">
      <div className="outline-header">大纲</div>
      {headings.length === 0 ? (
        <div className="outline-empty">还没有标题。用 # 写一个试试。</div>
      ) : (
        <ul className="outline-list">
          {headings.map((heading, index) => (
            <li key={`${heading.line}:${index}`}>
              <button
                type="button"
                className={`outline-item${index === activeIndex ? ' is-active' : ''}`}
                data-level={heading.level}
                title={heading.text}
                onClick={() => onJump(heading.line)}
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
