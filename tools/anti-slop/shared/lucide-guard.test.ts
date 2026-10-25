import { describe, expect, it } from "vitest";

import { parseBaseline } from "./lucide-guard.ts";

describe("the lucide baseline", () => {
  it("refuses a count that is not a whole number of imports", () => {
    expect(() => parseBaseline('{"a.ts": 0}')).toThrow();
    expect(() => parseBaseline('{"a.ts": 1.5}')).toThrow();
    expect(parseBaseline('{"a.ts": 2}').get("a.ts")).toBe(2);
  });
});
