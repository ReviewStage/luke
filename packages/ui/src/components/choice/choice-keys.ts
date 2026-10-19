/**
 * choice-keys.ts -- where a key takes the focus in a row of options where you choose one, which every such row in `@luke/ui` shares.
 *
 * A row of options is either a tablist, whose options are tabs over views,
 * or a radio group, whose options set a value; `CHOICE_ROLE` names which, by
 * the role its options carry. ← and → step along the row a step at a time,
 * wrapping at either end, and a radio group takes ↑ and ↓ the same way, as a
 * reader expects of one; Home and End go to either end. A key held with ⌘,
 * ⌥, ⌃, or ⇧ is the app's or the system's, never the row's. An option the
 * caller marks disabled is stepped past, and a row whose every option is
 * disabled moves nowhere. This holds no DOM and no React: `useChoiceKeys`
 * is the door a component reaches it through.
 */

/** The role a row's options carry, which decides the keys it steps by: a tab's, or a radio's. */
export const CHOICE_ROLE = {
  TAB: "tab",
  RADIO: "radio",
} as const;

export type ChoiceRole = (typeof CHOICE_ROLE)[keyof typeof CHOICE_ROLE];

/** The keys that step along a row of each role, and which way. */
const STEP_KEYS = {
  [CHOICE_ROLE.TAB]: new Map([
    ["ArrowRight", 1],
    ["ArrowLeft", -1],
  ]),
  [CHOICE_ROLE.RADIO]: new Map([
    ["ArrowRight", 1],
    ["ArrowDown", 1],
    ["ArrowLeft", -1],
    ["ArrowUp", -1],
  ]),
} as const satisfies Record<ChoiceRole, ReadonlyMap<string, number>>;

/** A key as it was pressed: its name and the modifiers held with it. */
export interface ChoicePress {
  readonly key: string;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

/** An option as the keys see it: one they may land on, or one they pass over. */
export interface ChoiceStop {
  readonly disabled?: boolean | undefined;
}

/** The first option from `start` on, `step` at a time and wrapping, that is not disabled; none where every one is. */
function enabledFrom(
  options: readonly ChoiceStop[],
  start: number,
  step: number,
): number | undefined {
  const length = options.length;
  for (let walked = 0; walked < length; walked += 1) {
    const at = (((start + step * walked) % length) + length) % length;
    if (options[at]?.disabled !== true) return at;
  }
  return undefined;
}

/**
 * The index of the option `press` takes the focus to from the one at `from`
 * (-1 for none) in a row of `role`, or none for a key the row does not move
 * by. An arrow from no option steps as though from the first.
 */
export function choiceKeyTarget(
  press: ChoicePress,
  from: number,
  options: readonly ChoiceStop[],
  role: ChoiceRole,
): number | undefined {
  if (press.metaKey || press.altKey || press.ctrlKey || press.shiftKey) return undefined;
  if (options.length === 0) return undefined;
  if (press.key === "Home") return enabledFrom(options, 0, 1);
  if (press.key === "End") return enabledFrom(options, options.length - 1, -1);
  const step = STEP_KEYS[role].get(press.key);
  return step === undefined ? undefined : enabledFrom(options, Math.max(from, 0) + step, step);
}

/** The option a row's one tab stop stands on: the chosen one, or the first that is not disabled while none is. */
export function choiceTabStop<Value extends string>(
  options: readonly (ChoiceStop & { readonly value: Value })[],
  value: Value | undefined,
): Value | undefined {
  const chosen = options.find((option) => option.value === value && option.disabled !== true);
  if (chosen !== undefined) return chosen.value;
  const first = enabledFrom(options, 0, 1);
  return first === undefined ? undefined : options[first]?.value;
}
