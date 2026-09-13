import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

/**
 * One source logo (docs/logo.png, 1024×1024) → the whole icon family, written
 * into public/ as static PNGs (the repo has no build-time image pipeline).
 *
 * The maskable icon differs from the plain one on purpose: launchers crop it to
 * a circle/rounded square, so the logo must sit inside the safe zone with room
 * around it (`padding`) or the system clips it.
 */
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0.3,
      resizeOptions: {
        background: '#ffffff',
      },
    },
  },
  images: ['docs/logo.png'],
})