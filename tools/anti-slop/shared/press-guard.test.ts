import { describe, expect, it } from "vitest";

import { configWeakensGuard, guardSuppressionLines, PRESS_GUARD_RULE } from "./press-guard.ts";
import { SKELETON_GUARD_RULE } from "./skeleton-guard.ts";

describe("guardSuppressionLines", () => {
  it("finds a line, next-line, and block directive naming the guard", () => {
    const text = [
      `<div onClick={go} /> // oxlint-disable-line ${PRESS_GUARD_RULE}`,
      `// eslint-disable-next-line ${PRESS_GUARD_RULE} -- a reason`,
      `{/* oxlint-disable-next-line react/no-array-index-key, ${PRESS_GUARD_RULE} */}`,
      `/* oxlint-disable ${PRESS_GUARD_RULE} */`,
    ].join("\n");
    expect(guardSuppressionLines(text)).toEqual([1, 2, 3, 4]);
  });

  it("finds a directive naming no rule, which silences every rule", () => {
    const text = [
      "// oxlint-disable-next-line",
      "/* eslint-disable */",
      "// oxlint-disable -- why",
    ].join("\n");
    expect(guardSuppressionLines(text)).toEqual([1, 2, 3]);
  });

  it("finds the guard named on a later line of a block directive", () => {
    const text = `/* oxlint-disable anti-slop/no-runtime-typeof,\n  ${PRESS_GUARD_RULE} */`;
    expect(guardSuppressionLines(text)).toEqual([1]);
  });

  it("passes directives for other rules, and the guard named only in a reason", () => {
    const text = [
      "// oxlint-disable-next-line react/no-array-index-key -- a skeleton's blocks never move.",
      `/* oxlint-disable anti-slop/no-runtime-typeof -- unlike ${PRESS_GUARD_RULE} */`,
      `// ${PRESS_GUARD_RULE} has no escape hatch`,
      "// oxlint-enable",
    ].join("\n");
    expect(guardSuppressionLines(text)).toEqual([]);
  });
});

describe("configWeakensGuard", () => {
  const holding = { rules: { [PRESS_GUARD_RULE]: "error" }, overrides: [] };

  it("holds where the rule is an error and no override names it", () => {
    expect(configWeakensGuard(holding)).toBeUndefined();
    expect(
      configWeakensGuard({
        ...holding,
        overrides: [{ files: ["**/*.test.ts"], rules: { other: "off" } }],
      }),
    ).toBeUndefined();
  });

  it("refuses the rule left out or set below an error", () => {
    expect(configWeakensGuard({ rules: {} })).toBeDefined();
    expect(configWeakensGuard({ rules: { [PRESS_GUARD_RULE]: "warn" } })).toBeDefined();
    expect(configWeakensGuard({ rules: { [PRESS_GUARD_RULE]: "off" } })).toBeDefined();
  });

  it("refuses an override that names the rule", () => {
    const overridden = {
      ...holding,
      overrides: [{ files: ["packages/panel/**"], rules: { [PRESS_GUARD_RULE]: "off" } }],
    };
    expect(configWeakensGuard(overridden)).toBeDefined();
  });
});

describe("the skeleton guard", () => {
  it("is found silenced by a directive naming it, and not by one naming the press guard", () => {
    const text = [
      `// oxlint-disable-next-line ${SKELETON_GUARD_RULE}`,
      `// oxlint-disable-next-line ${PRESS_GUARD_RULE}`,
    ].join("\n");
    expect(guardSuppressionLines(text, SKELETON_GUARD_RULE)).toEqual([1]);
  });

  it("is weakened where the configuration leaves it short of an error or an override names it", () => {
    const rules = { [PRESS_GUARD_RULE]: "error", [SKELETON_GUARD_RULE]: "error" };
    expect(configWeakensGuard({ rules, overrides: [] }, SKELETON_GUARD_RULE)).toBeUndefined();
    expect(
      configWeakensGuard({ rules: { [PRESS_GUARD_RULE]: "error" } }, SKELETON_GUARD_RULE),
    ).toBeDefined();
    expect(
      configWeakensGuard(
        { rules, overrides: [{ files: ["**/*.tsx"], rules: { [SKELETON_GUARD_RULE]: "off" } }] },
        SKELETON_GUARD_RULE,
      ),
    ).toBeDefined();
  });
});
