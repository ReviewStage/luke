import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { TEXT_ROLE_CLASS, type TextRole } from "../components/text/text-role.js";

/**
 * roles.test.ts -- a type role has one size, one leading, and one weight,
 * and a component that draws the job reads the role's, never a weight or a
 * length of its own; a page's sections stand one gap apart, and a Stack's
 * gaps and insets are roles rather than steps of the scale.
 */

/** One rule of a sheet: its selector and its declarations, comments dropped. */
interface Rule {
  readonly selector: string;
  readonly declarations: ReadonlyMap<string, string>;
}

const UI = new URL("../", import.meta.url);

/** Every rule of the sheet at `path` (relative to `packages/ui/src/`), a rule inside a block read as any other. */
function rulesOf(path: string): Rule[] {
  const source = readFileSync(new URL(path, UI), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
    selector: selector.trim().replace(/\s+/g, " "),
    declarations: new Map(
      [...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, name = "", value = ""]) => [
        name,
        value.trim(),
      ]),
    ),
  }));
}

/** What `profile` sets as `name`. */
function profileValue(profile: "desktop" | "web", name: string): string | undefined {
  return rulesOf("tokens/profiles.css")
    .find((rule) => rule.selector === `[data-luke-profile="${profile}"]`)
    ?.declarations.get(name);
}

/** The value of `name` in the rule for `selector` of the sheet at `path`. */
function declared(path: string, selector: string, name: string): string | undefined {
  return rulesOf(path)
    .find((rule) => rule.selector === selector)
    ?.declarations.get(name);
}

/** Every file under `packages/ui/src/` ending in one of `endings`, tests and the shadcn-free tokens included. */
function sourcesEnding(...endings: string[]): string[] {
  return readdirSync(UI, { recursive: true, encoding: "utf8" }).filter(
    (path) =>
      endings.some((ending) => path.endsWith(ending)) &&
      !path.includes(".test.") &&
      !path.startsWith("tokens/"),
  );
}

/** The roles that set words: each has a size, a leading, and a weight, in both profiles. */
const TYPE_ROLES = [
  "body",
  "label",
  "caption",
  "group",
  "tag",
  "section",
  "dialog",
  "toolbar-title",
  "title",
  "reading",
] as const;

test("every type role has a size, a leading, and a weight, set alike by both profiles", () => {
  for (const role of TYPE_ROLES) {
    for (const part of ["size", "leading", "weight"]) {
      const name = `--luke-type-${role}-${part}`;
      for (const profile of ["desktop", "web"] as const) {
        assert.ok(profileValue(profile, name), `${profile} does not set ${name}`);
      }
      if (part === "weight") {
        assert.equal(profileValue("desktop", name), profileValue("web", name), name);
      }
    }
  }
});

test("a page's title, the top bar's, a dialog's, and a section's heading share one weight", () => {
  const weights = new Set(
    ["title", "toolbar-title", "dialog", "section"].map((role) =>
      profileValue("desktop", `--luke-type-${role}-weight`),
    ),
  );
  assert.equal(weights.size, 1, `the headings are set in ${[...weights].join(" and ")}`);
});

test("each Text role reads its own size, leading, and weight from the profile", () => {
  const theme = new Map(
    [
      ...readFileSync(new URL("tailwind/theme.css", UI), "utf8").matchAll(
        /(--[\w-]+):\s*([^;]+);/g,
      ),
    ].map(([, name = "", value = ""]) => [name, value.trim()]),
  );
  for (const role of TYPE_ROLES.filter((name) => name !== "reading" && name !== "tag")) {
    const utilities = TEXT_ROLE_CLASS[role as TextRole].split(" ");
    const size = utilities.find((utility) => utility.startsWith("text-"))?.slice("text-".length);
    const weight = utilities.find((utility) => utility.startsWith("font-"))?.slice("font-".length);
    assert.ok(size && weight, `Text's ${role} role names no size or no weight`);
    assert.equal(
      theme.get(`--text-${size}`),
      `var(--luke-type-${role}-size)`,
      `${role}'s font-size`,
    );
    assert.equal(
      theme.get(`--text-${size}--line-height`),
      `var(--luke-type-${role}-leading)`,
      `${role}'s line-height`,
    );
    assert.equal(
      theme.get(`--font-weight-${weight}`),
      `var(--luke-type-${role}-weight)`,
      `${role}'s font-weight`,
    );
  }
});

test("no component sets a weight, a tracking, or a pixel size of its own, only its role's", () => {
  const sheets = [...sourcesEnding(".css")].filter(
    (path) => path.startsWith("components/") || path.startsWith("chart/"),
  );
  for (const path of sheets) {
    for (const rule of rulesOf(path)) {
      const weight = rule.declarations.get("font-weight");
      assert.ok(
        weight === undefined ||
          /^(var\(--luke-type-[\w-]+-weight\)|var\(--luke-display-[\w-]+, var\(--luke-type-[\w-]+-weight\)\)|inherit)$/.test(
            weight,
          ),
        `${path}: ${rule.selector} sets font-weight: ${weight}`,
      );
      const tracking = rule.declarations.get("letter-spacing");
      assert.ok(
        tracking === undefined ||
          /^(var\(--luke-type-title-tracking\)|var\(--luke-display-[\w-]+, normal\)|0)$/.test(
            tracking,
          ),
        `${path}: ${rule.selector} sets letter-spacing: ${tracking}`,
      );
      const size = rule.declarations.get("font-size");
      // Note that a field's 16px floor under a finger is what keeps iOS from zooming into it.
      assert.ok(
        size === undefined || !/\d(px)/.test(size) || size.startsWith("max(16px"),
        `${path}: ${rule.selector} sets font-size: ${size}`,
      );
    }
  }
});

test("no component's utilities name a weight of their own, only a role's", () => {
  for (const path of sourcesEnding(".ts", ".tsx")) {
    const source = readFileSync(new URL(path, UI), "utf8");
    assert.doesNotMatch(
      source,
      /["'\s:]font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/,
      `${path} names a weight; a utility reads a role's (font-label, font-tag, font-emphasis)`,
    );
  }
});

test("a time, a badge, a count, and a row's count draw tabular figures themselves", () => {
  for (const [path, selector] of [
    ["components/time/time.css", ".luke-time"],
    ["components/badge/badge.css", ".luke-badge"],
    ["components/choice-bar/choice-bar.css", ".luke-count-part"],
    ["components/nav-item/nav-item.css", ".luke-nav-item-count"],
    ["components/corner-count/corner-count.css", ".luke-corner-count-mark"],
  ] as const) {
    assert.equal(
      declared(path, selector, "font-variant-numeric"),
      "tabular-nums",
      `${selector} is not in tabular figures`,
    );
  }
});

test("a page's sections stand 32px apart in both profiles, and Settings reads that role", () => {
  for (const profile of ["desktop", "web"] as const) {
    assert.equal(profileValue(profile, "--luke-page-section-gap"), "var(--luke-space-32)");
  }
  for (const [path, selector] of [
    ["components/settings-page/settings-page.css", ".luke-settings-page-sections"],
    ["components/settings-section/settings-section.css", ".luke-settings-skeleton"],
  ] as const) {
    assert.equal(declared(path, selector, "gap"), "var(--luke-page-section-gap)", path);
  }
});

test("a Stack's gaps and insets are the profile's roles, never steps of the scale", () => {
  const rules = rulesOf("components/layout/layout.css").filter((rule) =>
    /^\[data-(gap|inset)=/.test(rule.selector),
  );
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (property !== "gap" && property !== "padding") continue;
      assert.doesNotMatch(
        value,
        /--luke-space-/,
        `layout.css: ${rule.selector} sets ${property}: ${value}`,
      );
    }
  }
});
