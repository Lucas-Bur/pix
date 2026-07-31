import "vite-plus/test/config"
import { defineConfig } from "vite-plus"

export default defineConfig({
  test: {
    include: ["benchmarks/tests/**/*.test.ts"],
    testTimeout: 14_400_000,
  },
})
