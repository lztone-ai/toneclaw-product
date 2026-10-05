import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/fixture.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  sourcemap: true,
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
  unbundle: true,
})
