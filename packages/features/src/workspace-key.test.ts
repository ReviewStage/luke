import { describe, expect, it } from "vitest";
import { keySpansIn, namesTaskKey, taskKey } from "./workspace-key.js";

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

describe("keySpansIn", () => {
  const known = new Map([
    ["STAG-422", "task-422"],
    ["STAG-42", "task-42"],
    ["3L-7", "task-7"],
  ]);
  const found = (words: string) => keySpansIn(words, known).map((span) => [span.key, span.known]);

  it("finds each known key standing as a word, with where it stands", () => {
    expect(keySpansIn("landed STAG-422, so STAG-42.", known)).toEqual([
      { key: "STAG-422", start: 7, end: 15, known: "task-422" },
      { key: "STAG-42", start: 20, end: 27, known: "task-42" },
    ]);
    expect(found("(3L-7)")).toEqual([["3L-7", "task-7"]]);
  });

  it("leaves a word shaped like a key that names no task, a lower-case one, and one joined to more words", () => {
    expect(found("UTF-8 and ISO-8601 and GPT-5")).toEqual([]);
    expect(found("stag-422")).toEqual([]);
    expect(found("STAG-4220 STAG-422x XSTAG-422 STAG-422-fix")).toEqual([]);
  });

  it("leaves a key inside a path, an address, or a handle, before it or after it", () => {
    expect(found("docs/STAG-422.md #STAG-422 @STAG-422 v.STAG-422")).toEqual([]);
    expect(found("STAG-422/notes STAG-422.md STAG-422#plan")).toEqual([]);
  });

  it("finds a channel's name the words write as #name, but in a path, an address, or joined to more words, and leaves one it does not hold", () => {
    const channels = new Map([["#app", "channel-app"], ...known]);
    const spans = keySpansIn("ask in #app, or STAG-42 and #design", channels);
    expect(spans.map((span) => [span.key, span.known])).toEqual([
      ["#app", "channel-app"],
      ["STAG-42", "task-42"],
    ]);
    expect(keySpansIn("page#app docs/#app #app-x #apple #app/notes", channels)).toEqual([]);
  });

  it("finds a key ending a sentence or a clause", () => {
    expect(found("Shipped STAG-422. Then STAG-42: done; STAG-422!")).toEqual([
      ["STAG-422", "task-422"],
      ["STAG-42", "task-42"],
      ["STAG-422", "task-422"],
    ]);
  });
});
