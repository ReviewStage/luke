import { expect, it, vi } from "vitest";

vi.mock("node:fs");
vi.doMock("node:path");

it("counts calls", () => {
  const spy = vi.fn();
  vi.spyOn(console, "log");
  const typed = vi.mocked(spy);
  expect(typed).toBeDefined();
});
