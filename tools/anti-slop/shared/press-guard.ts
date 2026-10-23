import { repositoryPathOf } from "./effect-edges.ts";

/**
 * The design system's guard: outside `@luke/ui`, a lowercase JSX element is
 * drawn and never pressed. Root AGENTS.md's "Layout" and `packages/ui`'s
 * AGENTS.md state the rule in prose; this holds it as data, read by the
 * `no-raw-press-outside-ui` rule and by the suppression check beside it.
 */
export const PRESS_GUARD_RULE = "anti-slop/no-raw-press-outside-ui";

/** The one workspace that may draw a control from an intrinsic element. */
const UI_PACKAGE = "packages/ui/";

/** Elements that are controls whatever handler they carry. */
export const RAW_CONTROL_ELEMENTS: ReadonlySet<string> = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "summary",
]);

/**
 * `<input type="hidden">` carries a form's data and draws nothing, so it is
 * no control.
 */
export const HIDDEN_INPUT = { ELEMENT: "input", TYPE: "hidden" } as const;

/** ARIA roles that make an element something a person presses or picks. */
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

/** `role="link"` is a pressable role everywhere but on the anchor it names. */
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

/** Events that hear a press, so an intrinsic that takes one is a control. */
export const PRESS_EVENTS = withCaptureForms(PRESS_EVENT_NAMES);

/**
 * Key events are a press only on an element that takes the focus itself;
 * elsewhere they bubble up from the fields inside it.
 */
export const KEY_EVENTS = withCaptureForms(KEY_EVENT_NAMES);

/** Attributes that let an element take the keyboard's focus of its own. */
export const FOCUS_ATTRIBUTES: ReadonlySet<string> = new Set(["tabIndex", "contentEditable"]);

export function isOutsideUi(filename: string): boolean {
  return !repositoryPathOf(filename).startsWith(UI_PACKAGE);
}

/**
 * A directive that would silence the guard: one naming its rule, or one
 * naming no rule at all, which silences every rule. A line comment's rule
 * list runs to the line's end and a block comment's to its close, and either
 * ends early at `--`, where a directive's reason starts.
 */
const DISABLE_DIRECTIVES = [
  /\/\/\s*(?:eslint|oxlint)-disable(?:-next-line|-line)?(?![\w-])([^\n]*)/gu,
  /\/\*\s*(?:eslint|oxlint)-disable(?:-next-line|-line)?(?![\w-])([\s\S]*?)\*\//gu,
];

function silencesGuard(ruleList: string, guard: string): boolean {
  const rules = (ruleList.split("--")[0] ?? "").split(/[\s,]+/u).filter((rule) => rule.length > 0);
  return rules.length === 0 || rules.includes(guard);
}

/** The 1-based lines of `text` holding a directive that silences `guard`, the press guard where none is named. */
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

/** Extensions a file holding JSX may carry, which are the guard's to watch. */
export const JSX_SOURCE = /\.(?:tsx|jsx|js|mjs|cjs)$/u;

/**
 * Why an oxlint configuration leaves `guard`, the press guard where none is
 * named, short of an error everywhere, or undefined where it holds: the rule
 * must be an error, and no override may name it, since an override can only
 * weaken it for the files it covers.
 */
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
