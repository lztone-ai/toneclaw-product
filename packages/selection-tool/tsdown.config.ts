import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: true,
  sourcemap: true,
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
  unbundle: true,
})
