import "vite-plus/test/config"
import { defineConfig } from "vite-plus"

// Selecting this benchmark config is the explicit opt-in for network/model-backed tests.
process.env.PIX_RUN_RETRIEVAL_BENCHMARK ??= "1"

export default defineConfig({
  test: {
    include: ["benchmarks/tests/**/*.test.ts"],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
})
