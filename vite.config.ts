import { defineConfig } from "vite-plus"

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: false,
    minify: true,
    banner: { js: "#!/usr/bin/env node" },
    deps: {
      neverBundle: ["@huggingface/transformers"],
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      include: ["src/**/*.ts"],
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    semi: false,
    singleQuote: false,
    jsdoc: true,
    sortImports: true,
    sortPackageJson: true,
    useTabs: false,
    trailingComma: "all",
    ignorePatterns: ["CHANGELOG.md", ".release-please-manifest.json"],
  },
  staged: {
    "*.{ts,tsx,js,jsx}": "vp check --fix",
  },
})
