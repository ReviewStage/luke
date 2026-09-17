import { expect, it, vi } from "vitest";

it("stubs the environment, which is a process boundary", () => {
  vi.stubEnv("LUKE_FIXTURE", "1");
  expect(process.env.LUKE_FIXTURE).toBe("1");
});
