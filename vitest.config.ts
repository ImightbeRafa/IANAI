import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Agent/worktree checkouts live under .claude/ and must not be collected.
    exclude: [...configDefaults.exclude, '.claude/**', '.vitest-tmp/**'],
    // Ad Pack integration tests run the real pixel pipeline (cut-out, relight stage, fidelity
    // metric) for every ad × ratio; under a full parallel run they need more than the 5 s default.
    testTimeout: 15_000,
  },
})
