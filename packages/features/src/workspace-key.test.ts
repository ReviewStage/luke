import { describe, expect, it } from "vitest";
import { taskKey } from "./workspace-key.js";

describe("taskKey", () => {
  it("names a task by its workspace's prefix and its number", () => {
    expect(taskKey("Acme", 42)).toBe("ACME-42");
    expect(taskKey("Luke Labs", 7)).toBe("LL-7");
    expect(taskKey("Charles's workspace", 1)).toBe("CW-1");
    expect(taskKey("Initech", 3)).toBe("INIT-3");
  });

  it("falls back on TASK where the workspace's name holds no letter or digit", () => {
    expect(taskKey("  ", 9)).toBe("TASK-9");
  });
});
