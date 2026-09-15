/**
 * The keyboard reference, in a panel behind the titlebar's 帮助 button.
 *
 * A shortcut list has to be *somewhere* a reader can find it, and the two places it
 * already lived are both wrong for that: `README.md` is not in the app, and the
 * welcome document's table is something you scroll past on the first day and then
 * edit away. This is the third copy — and it is generated from
 * `core/shortcutHelp.ts`, whose test presses every key through `shortcutFor`, so it
 * cannot drift from the bindings the way the welcome document once did.
 *
 * Every entry that has a toolbar icon shows it, which makes this panel the legend
 * for the toolbar as well as a key list.
 */
import { useEffect, useRef } from 'react'
import { SHORTCUT_GROUPS } from '../../core/shortcutHelp'
import { iconFor } from './icons'

interface HelpPanelProps {
  onClose: () => void
}

export function HelpPanel({ onClose }: HelpPanelProps) {
  const ref = useRef<HTMLDivElement>(null)

  // It closes the way the app's other popups do: a pointer down outside, or Escape.
  // The toggle BUTTON itself is exempt: the point of clicking it is to switch the
  // panel's state, and closing on its own pointer-down would fight the click that
  // follows (mousedown 先到：关掉，click 再按新状态把它又开起来).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      const inPanel = ref.current?.contains(target) === true
      const inToggle =
        target instanceof Element && target.closest?.('[aria-label="快捷键"]') !== null
      if (!inPanel && !inToggle) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div className="help-panel" role="dialog" aria-label="快捷键" ref={ref}>
      <div className="help-panel-head">
        <span>快捷键</span>
        <button type="button" className="help-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
      <div className="help-groups">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="help-group">
            <h2>{group.title}</h2>
            <ul>
              {group.items.map((item) => (
                <li key={`${group.title}-${item.keys}`}>
                  <span className="help-icon" aria-hidden="true">
                    {item.icon === undefined ? null : iconFor(item.icon)}
                  </span>
                  <span className="help-name">{item.name}</span>
                  <kbd>{item.keys}</kbd>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
