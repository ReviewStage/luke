import { describe, expect, it } from "vitest";
import { namesTaskKey, taskKey } from "./workspace-key.js";

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

describe("namesTaskKey", () => {
  it("reads a key typed in any case, with space around it, as the key", () => {
    expect(namesTaskKey(" stag-422 ", "STAG-422")).toBe(true);
    expect(namesTaskKey("STAG-422", "STAG-422")).toBe(true);
  });

  it("reads part of a key, or a longer one, as another", () => {
    expect(namesTaskKey("STAG-42", "STAG-422")).toBe(false);
    expect(namesTaskKey("STAG-4220", "STAG-422")).toBe(false);
    expect(namesTaskKey("422", "STAG-422")).toBe(false);
  });
});
