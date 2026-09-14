import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Bot qualification is deliberately CPU-bound. Running those suites in
    // parallel only makes their wall-clock timing noisy on small Render/CI CPUs.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
