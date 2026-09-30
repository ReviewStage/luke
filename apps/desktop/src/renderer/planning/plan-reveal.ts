/**
 * plan-reveal.ts -- how the open plan types itself in: the body cut into the template's units, and each unit's shown words chasing the newest document.
 *
 * The formatter owns every section and field heading and escapes any heading
 * the model writes, so a line opening `## ` or `### ` outside a fence is
 * always the template's own, and the template's order is fixed, so units line
 * up by position from one document to the next. Each unit holds its target,
 * the newest words, and how much of them is shown; a frame grows the shown
 * words toward the target at a person's typing pace, so the plan reads as
 * being written rather than pasted. Everything here is pure; the frame clock
 * is the hook's.
 */

/** The pace every change types at: a fast typist, about 140 words a minute. */
export const CHASE_CHARS_PER_SECOND = 12;

/** A line the formatter opens a section or a field with. */
const UNIT_HEADING = /^#{2,3} /u;

/** A code fence's opening or closing line: up to three spaces, then three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/u;

/** One unit: its newest words, how many of them are shown, and whether it has just finished typing. */
interface ChaseUnit {
  readonly target: string;
  /** Characters of the target shown, fractional between frames. */
  readonly shown: number;
  /** Set when the unit catches up after typing, cleared when it starts again. */
  readonly fresh: boolean;
}

/** Every unit of the open plan's body, which assumptions the newest document added, and where the typing last stood. */
export interface ChaseState {
  readonly units: readonly ChaseUnit[];
  readonly freshAssumptions: ReadonlySet<number>;
  /** The unit the typing last grew, where the caret rests once it catches up; absent until anything types. */
  readonly lastTyped: number | undefined;
}

/** What one unit draws: its words, how far, whether the caret is in it, and whether it is lit. */
export interface UnitView {
  readonly words: string;
  /** Absent while the unit is shown whole with no caret in it. */
  readonly reveal: { readonly upTo: number; readonly caret: boolean } | undefined;
  readonly writing: boolean;
  /** Whether the caret stands at the unit's end waiting, which blinks where a typing caret holds solid. */
  readonly resting: boolean;
  readonly fresh: boolean;
}

/** Whether a fence line closes the fence standing: the same character, at least as long. */
function closesFence(marker: string, fence: string): boolean {
  return marker[0] === fence[0] && marker.length >= fence.length;
}

/**
 * How much of what is shown still stands under a new target. Words added
 * after it keep all of it; a rewrite cuts back to the start of the first line
 * that differs, so a rewritten answer never shows half an old word.
 */
function keptLength(shown: string, target: string): number {
  if (target.startsWith(shown)) return shown.length;
  let shared = 0;
  while (shared < shown.length && shown[shared] === target[shared]) shared += 1;
  return target.lastIndexOf("\n", shared) + 1;
}

/**
 * The body cut before every section and field heading outside a fence: the
 * header block, then each section's heading, then each field with its answer.
 */
export function planUnits(body: string): readonly string[] {
  const units: string[] = [];
  let current: string[] = [];
  let fence: string | undefined;
  for (const line of body.split("\n")) {
    const marker = FENCE_LINE.exec(line)?.[1];
    if (fence === undefined && marker !== undefined) fence = marker;
    else if (fence !== undefined && marker !== undefined && closesFence(marker, fence)) {
      fence = undefined;
    } else if (fence === undefined && UNIT_HEADING.test(line) && current.length > 0) {
      units.push(current.join("\n").trimEnd());
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) units.push(current.join("\n").trimEnd());
  return units;
}

/** A plan as it opens: every unit shown whole, since what stood before is the document, not news. */
export function chaseOpened(body: string): ChaseState {
  return {
    units: planUnits(body).map((target) => ({ target, shown: target.length, fresh: false })),
    freshAssumptions: new Set(),
    lastTyped: undefined,
  };
}

/**
 * The same plan's newer document as the next target. What is shown and still
 * stands stays; the rest types in. Under reduced motion every change is
 * shown at once and lit.
 */
export function chaseRetargeted(
  state: ChaseState,
  body: string,
  added: { readonly before: readonly string[]; readonly after: readonly string[] },
  reduced: boolean,
): ChaseState {
  let lastTyped = state.lastTyped;
  const units = planUnits(body).map((target, index): ChaseUnit => {
    const previous = state.units[index];
    if (previous?.target === target) return previous;
    const shownWords = previous?.target.slice(0, Math.floor(previous.shown)) ?? "";
    // Shown at once, a change is where the last word went in all the same.
    if (reduced) lastTyped = index;
    if (reduced) return { target, shown: target.length, fresh: true };
    return { target, shown: keptLength(shownWords, target), fresh: false };
  });
  const before = new Set(added.before);
  const freshAssumptions = new Set<number>();
  added.after.forEach((text, index) => {
    if (!before.has(text)) freshAssumptions.add(index);
  });
  return { units, freshAssumptions, lastTyped };
}

/** Whether any unit is still behind its target. */
export function chaseBehind(state: ChaseState): boolean {
  return state.units.some((unit) => unit.shown < unit.target.length);
}

/** One frame of `elapsedMs`: the typing pace's budget, spent on the units behind in document order. */
export function chaseStepped(state: ChaseState, elapsedMs: number): ChaseState {
  if (!chaseBehind(state)) return state;
  let budget = (Math.max(0, elapsedMs) * CHASE_CHARS_PER_SECOND) / 1_000;
  let lastTyped = state.lastTyped;
  const units = state.units.map((unit, index): ChaseUnit => {
    const behind = unit.target.length - unit.shown;
    if (behind <= 0 || budget <= 0) return unit;
    const step = Math.min(behind, budget);
    budget -= step;
    lastTyped = index;
    const shown = unit.shown + step;
    return { target: unit.target, shown, fresh: shown >= unit.target.length };
  });
  return { units, freshAssumptions: state.freshAssumptions, lastTyped };
}

/**
 * What each unit draws now: the caret and the writing mark on the first unit
 * still behind. With nothing behind and the plan still `live`, being written
 * on a call, the caret rests at the end of the unit the typing last grew, the
 * way an editor's cursor waits where the last word went in.
 */
export function chaseView(state: ChaseState, live: boolean): readonly UnitView[] {
  const resting = live && !chaseBehind(state) ? state.lastTyped : undefined;
  let caretPlaced = false;
  return state.units.map((unit, index) => {
    const words = unit.target;
    if (index === resting) {
      const reveal = { upTo: words.length, caret: true };
      return { words, reveal, writing: false, resting: true, fresh: unit.fresh };
    }
    if (unit.shown >= words.length) {
      return { words, reveal: undefined, writing: false, resting: false, fresh: unit.fresh };
    }
    const caret = !caretPlaced;
    caretPlaced = true;
    const reveal = { upTo: Math.floor(unit.shown), caret };
    return { words, reveal, writing: caret, resting: false, fresh: false };
  });
}
