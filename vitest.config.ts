import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Agent/worktree checkouts live under .claude/ and must not be collected.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
