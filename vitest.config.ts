import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

/**
 * Two layers, deliberately:
 *
 * - `unit` runs the pure functions (parsing, view mapping, line state, list
 *   arithmetic, edit commands) in node. Milliseconds per file, no browser — this
 *   is the net that catches regressions on every save. Nothing in `src/lib/`
 *   reaches for a DOM, so the project needs no exclusions.
 * - `browser` runs what genuinely needs a DOM: caret placement, key interception,
 *   IME composition, CSS contracts, and the App shell. Real Chromium, so the
 *   browser's own behaviour is what gets tested.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/lib/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'browser',
          // Real Chromium, so editor input flows through the browser's native
          // pipeline (beforeinput → DOM mutation → input) and userEvent.* drives
          // real typing/clicking. No jsdom event shims needed.
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
          include: [
            'src/components/**/*.test.tsx',
            'src/App.test.tsx',
            'src/platform/**/*.test.ts',
          ],
          setupFiles: ['./src/test/setup.ts'],
          css: false,
        },
      },
    ],
  },
})
