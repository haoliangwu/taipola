import { render } from '@testing-library/react'
import App from '../shell/App'

/**
 * App-level browser-test harness shared by the smoke suites: seeds a draft so
 * the shell opens straight into a known document, then renders <App /> with
 * the editor focused and the first run's text node in hand.
 */

/** Puts an unwritten draft in the untitled slot, the way a prior session would. */
export function seedDoc(content: string) {
  localStorage.setItem(
    'taipola:draft:untitled.md',
    JSON.stringify({ savedAt: 1_000, root: null, path: null, content, name: 'untitled.md' }),
  )
  localStorage.setItem('taipola:active-draft', 'untitled.md')
}

export async function renderWithDoc(content: string) {
  seedDoc(content)
  const view = render(<App />)
  const doc = view.container.querySelector('.doc') as HTMLElement
  if (!doc) throw new Error('no .doc')
  doc.focus({ preventScroll: true })
  const run = doc.querySelector('[data-block="0"] [data-vline="0"] [data-run="0"]')
  if (!run?.firstChild) throw new Error('no first run')
  return { view, doc, text: run.firstChild as Text }
}