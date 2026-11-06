import { matchesGlob } from "node:path";

import { repositoryPathOf } from "./effect-edges.ts";

export const PRESS_GUARD_RULE = "anti-slop/no-raw-press-outside-ui";

const UI_PACKAGE = "packages/ui/";

export const RAW_CONTROL_ELEMENTS: ReadonlySet<string> = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "summary",
]);

export const HIDDEN_INPUT = { ELEMENT: "input", TYPE: "hidden" } as const;

export const PRESSABLE_ROLES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "slider",
  "switch",
  "tab",
]);

export const LINK_ROLE = "link";
export const ANCHOR_ELEMENT = "a";

const PRESS_EVENT_NAMES = [
  "onClick",
  "onDoubleClick",
  "onAuxClick",
  "onContextMenu",
  "onMouseDown",
  "onMouseUp",
  "onPointerDown",
  "onPointerUp",
  "onTouchStart",
  "onTouchEnd",
];

const KEY_EVENT_NAMES = ["onKeyDown", "onKeyUp"];

function withCaptureForms(names: readonly string[]): ReadonlySet<string> {
  return new Set(names.flatMap((name) => [name, `${name}Capture`]));
}

export const PRESS_EVENTS = withCaptureForms(PRESS_EVENT_NAMES);

export const KEY_EVENTS = withCaptureForms(KEY_EVENT_NAMES);

export const FOCUS_ATTRIBUTES: ReadonlySet<string> = new Set(["tabIndex", "contentEditable"]);

export function isOutsideUi(filename: string): boolean {
  return !repositoryPathOf(filename).startsWith(UI_PACKAGE);
}

const DISABLE_DIRECTIVES = [
  /\/\/\s*(?:eslint|oxlint)-disable(?:-next-line|-line)?(?![\w-])([^\n]*)/gu,
  /\/\*\s*(?:eslint|oxlint)-disable(?:-next-line|-line)?(?![\w-])([\s\S]*?)\*\//gu,
];

function silencesGuard(ruleList: string, guard: string): boolean {
  const rules = (ruleList.split("--")[0] ?? "").split(/[\s,]+/u).filter((rule) => rule.length > 0);
  return rules.length === 0 || rules.includes(guard);
}

export function guardSuppressionLines(
  text: string,
  guard: string = PRESS_GUARD_RULE,
): readonly number[] {
  const lines: number[] = [];
  for (const directive of DISABLE_DIRECTIVES) {
    for (const match of text.matchAll(directive)) {
      if (!silencesGuard(match[1] ?? "", guard)) continue;
      lines.push(text.slice(0, match.index).split("\n").length);
    }
  }
  return lines.sort((left, right) => left - right);
}

export const JSX_SOURCE = /\.(?:tsx|jsx|js|mjs|cjs)$/u;

export function configWeakensGuard(
  config: unknown,
  guard: string = PRESS_GUARD_RULE,
): string | undefined {
  if (config === null || typeof config !== "object") return "the configuration is not an object";
  const rules: unknown = Reflect.get(config, "rules");
  const level = rules !== null && typeof rules === "object" ? Reflect.get(rules, guard) : undefined;
  if (level !== "error") return `"rules" must set "${guard}" to "error"`;
  const overrides: unknown = Reflect.get(config, "overrides");
  if (!Array.isArray(overrides)) return undefined;
  const named = overrides.some((override: unknown) => {
    if (override === null || typeof override !== "object") return false;
    const overridden: unknown = Reflect.get(override, "rules");
    return overridden !== null && typeof overridden === "object" && guard in overridden;
  });
  return named ? `no override may name "${guard}"` : undefined;
}

function patternHides(pattern: string, file: string): boolean {
  const trimmed = pattern.replace(/^\//u, "").replace(/\/$/u, "");
  const anchored = pattern.replace(/\/$/u, "").includes("/");
  const glob = undotted(anchored ? trimmed : `**/${trimmed}`);
  const path = undotted(file);
  return matchesGlob(path, glob) || matchesGlob(path, `${glob}/**`);
}

function undotted(text: string): string {
  return text.replace(/(^|\/)\./gu, "$1\u0001.");
}

export function ignoredFiles(
  config: unknown,
  files: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const hidden = new Map<string, string[]>();
  const patterns: unknown =
    config !== null && typeof config === "object" ? Reflect.get(config, "ignorePatterns") : [];
  if (!Array.isArray(patterns)) return hidden;
  const entries = patterns.filter((pattern): pattern is string => typeof pattern === "string");
  for (const file of files) {
    const deciding = entries.findLast((entry) => patternHides(entry.replace(/^!/u, ""), file));
    if (deciding === undefined || deciding.startsWith("!")) continue;
    hidden.set(deciding, [...(hidden.get(deciding) ?? []), file]);
  }
  return hidden;
}
