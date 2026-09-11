import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [react()],
  test: {
    // Browser mode: run inside a real Chromium, so editor input flows through
    // the browser's native pipeline (beforeinput → DOM mutation → input) and
    // userEvent.* / CDP input simulate real typing/clicking/keyboard. No jsdom
    // event shims needed.
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})