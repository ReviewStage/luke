import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ios-parity",
    include: ["*.test.ts"],
  },
});
