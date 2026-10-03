import type { MarkdownEdit } from "../markdown-message";
import { diffHunks, type Hunk, heldWords, isPlaceholder, MOVE_HALF } from "./plan-diff";

/**
 * plan-reveal.ts -- how the open plan writes itself in: one caret moving through the document as a person editing it would.
 *
 * The formatter owns every section and field heading and escapes any heading
 * the model writes, so a line opening `## ` or `### ` outside a fence is
 * always the template's own, and the template's order is fixed, so units line
 * up by position from one document to the next. Each unit holds its newest
 * words and the words shown, and one caret works through the difference an
 * act at a time: it travels to the next change, sweeps a selection over
 * words to erase or a line to cut, backspaces a few letters, types, and
 * pastes, pausing where a hand would. Each act is read from a fresh diff of
 * what is shown against what is aimed at, so a newer document arriving
 * mid-act is simply the next diff. While a unit's words are still streaming,
 * only growth is typed as it arrives; a rewrite waits until the unit settles
 * and its whole change can be read (`heldWords`). The average pace is still a
 * streaming model's: what makes it read as a person is the shape of the
 * edits and the pauses, not slow typing. Everything here is pure; the frame
 * clock is the hook's.
 */

/** The pace words are typed at: a model streaming its answer, about 50 tokens a second. */
export const CHASE_CHARS_PER_SECOND = 200;

/** The rest of the hand's pace: how fast it selects and backspaces, and where it stops to think. */
export const CHASE_PACE = {
  SELECT_CHARS_PER_SECOND: 600,
  BACKSPACE_CHARS_PER_SECOND: 60,
  /** The longest erase made letter by letter; anything longer is selected and erased at once. */
  BACKSPACE_MAX_CHARS: 12,
  /** The pause before the caret jumps to a change somewhere else. */
  TRAVEL_MS: 350,
  /** How long a finished selection stands before it is erased or cut. */
  SELECT_HOLD_MS: 160,
  /** The pause before a cut line lands. */
  PASTE_MS: 250,
  SENTENCE_PAUSE_MS: 180,
  CLAUSE_PAUSE_MS: 80,
  LINE_PAUSE_MS: 120,
  /** The work left, in time at the pace above, past which the whole pace speeds up to keep up with the notetaker. */
  CATCH_UP_LAG_MS: 2_500,
  /** How long a unit's newest words must stand unchanged before the lines held for the stream are let go. */
  SETTLE_MS: 1_200,
} as const;

/** A line the formatter opens a section or a field with. */
const UNIT_HEADING = /^#{2,3} /u;

/** A code fence's opening or closing line: up to three spaces, then three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/u;

/** The most acts one frame may play, so a frame given a long time cannot spin. */
const MAX_ACTS_PER_FRAME = 64;

/** The kinds of act the caret makes. */
const ACT = {
  TRAVEL: "travel",
  TYPE: "type",
  BACKSPACE: "backspace",
  SELECT: "select",
  PASTE: "paste",
} as const;

/** What a finished selection becomes. */
const SELECTED = {
  ERASE: "erase",
  CUT: "cut",
} as const;

type Selected = (typeof SELECTED)[keyof typeof SELECTED];

/** One act of the caret, offsets in its unit's shown words as they stand when it starts. */
type Act =
  | { readonly kind: typeof ACT.TRAVEL; readonly unit: number; readonly to: number }
  | {
      readonly kind: typeof ACT.TYPE;
      readonly unit: number;
      readonly at: number;
      readonly words: string;
    }
  | {
      readonly kind: typeof ACT.BACKSPACE;
      readonly unit: number;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: typeof ACT.SELECT;
      readonly unit: number;
      readonly from: number;
      readonly to: number;
      readonly becomes: Selected;
    }
  | {
      readonly kind: typeof ACT.PASTE;
      readonly unit: number;
      readonly at: number;
      readonly words: string;
    };

/** One unit: its newest words, the words shown, how long the newest have stood, and whether it is lit. */
interface ChaseUnit {
  readonly target: string;
  readonly shown: string;
  /** How long the target has stood unchanged; settled once past `SETTLE_MS`. */
  readonly steadyMs: number;
  /** Set when the unit catches up after an edit, cleared when the caret edits it again. */
  readonly fresh: boolean;
}

/** Where the caret stands: a unit, and an offset in its shown words. */
interface Caret {
  readonly unit: number;
  readonly at: number;
}

/** Every unit of the open plan's body, which assumptions the newest document added, and the caret's work. */
export interface ChaseState {
  readonly units: readonly ChaseUnit[];
  readonly freshAssumptions: ReadonlySet<number>;
  /** Absent until anything is edited. */
  readonly caret: Caret | undefined;
  readonly act: Act | undefined;
  /** How far the act has gone: letters typed, erased, or swept. */
  readonly progress: number;
  /** A pause owed before the act goes on. */
  readonly waitMs: number;
  /** A line cut and not yet pasted. */
  readonly clipboard: string | undefined;
  /** How many times the caret has jumped, so a view can tell a jump from typing. */
  readonly jumps: number;
}

/** What one unit draws: its words, the edit they are drawn partway through, and how it is marked. */
export interface UnitView {
  readonly words: string;
  /** Absent while the unit is drawn whole with no caret in it. */
  readonly edit: MarkdownEdit | undefined;
  readonly writing: boolean;
  /** Whether the caret stands still waiting, which blinks where a working caret holds solid. */
  readonly resting: boolean;
  readonly fresh: boolean;
}

/** How a newer document lands: shown at once under reduced motion, and whether it lets go of every held line. */
export interface ChaseAim {
  readonly reduced: boolean;
  /** Set when the plan was saved or its call ended, so nothing still streams. */
  readonly settle: boolean;
}

/** A unit already standing as it should, its target long settled. */
function standing(words: string): ChaseUnit {
  return { target: words, shown: words, steadyMs: Number.POSITIVE_INFINITY, fresh: false };
}

/** Whether a fence line closes the fence standing: the same character, at least as long. */
function closesFence(marker: string, fence: string): boolean {
  return marker[0] === fence[0] && marker.length >= fence.length;
}

/** The words a unit is aimed at now: its target once settled, and while it streams, the target with the lines it has not reached held. */
function aimOf(unit: ChaseUnit): string {
  return unit.steadyMs >= CHASE_PACE.SETTLE_MS ? unit.target : heldWords(unit.shown, unit.target);
}

function spliced(words: string, from: number, to: number, insert: string): string {
  return words.slice(0, from) + insert + words.slice(to);
}

/** The pause a hand takes after typing a letter: at the end of a sentence, a clause, or a line, and only before a space. */
function pauseAfter(letter: string | undefined, next: string | undefined): number {
  if (letter === "\n") return CHASE_PACE.LINE_PAUSE_MS;
  if (next !== undefined && next !== " " && next !== "\n") return 0;
  if (letter === "." || letter === "!" || letter === "?") return CHASE_PACE.SENTENCE_PAUSE_MS;
  if (letter === "," || letter === ";" || letter === ":") return CHASE_PACE.CLAUSE_PAUSE_MS;
  return 0;
}

/** The pause owed before an act starts. */
function leadOf(act: Act): number {
  if (act.kind === ACT.TRAVEL) return CHASE_PACE.TRAVEL_MS;
  if (act.kind === ACT.PASTE) return CHASE_PACE.PASTE_MS;
  return 0;
}

/** The act that works on one change, given where the caret stands in the change's unit. */
function actFor(unit: number, shown: string, hunk: Hunk, here: number | undefined): Act {
  const travel = (to: number): Act => ({ kind: ACT.TRAVEL, unit, to });
  if (hunk.move === MOVE_HALF.CUT) {
    if (here !== hunk.from) return travel(hunk.from);
    return { kind: ACT.SELECT, unit, from: hunk.from, to: hunk.to, becomes: SELECTED.CUT };
  }
  const erased = shown.slice(hunk.from, hunk.to);
  if (
    erased.length > 0 &&
    erased.length <= CHASE_PACE.BACKSPACE_MAX_CHARS &&
    !isPlaceholder(erased)
  ) {
    if (here !== hunk.to) return travel(hunk.to);
    return { kind: ACT.BACKSPACE, unit, from: hunk.from, to: hunk.to };
  }
  if (here !== hunk.from) return travel(hunk.from);
  if (erased.length > 0) {
    return { kind: ACT.SELECT, unit, from: hunk.from, to: hunk.to, becomes: SELECTED.ERASE };
  }
  return { kind: ACT.TYPE, unit, at: hunk.from, words: hunk.insert };
}

/** Where the line on the clipboard lands in a unit, if anywhere: the change inserting that same line. */
function pasteSite(shown: string, aim: string, line: string): Hunk | undefined {
  return diffHunks(shown, aim).find(
    (hunk) => hunk.from === hunk.to && hunk.insert.replace(/^\n|\n$/gu, "") === line,
  );
}

/**
 * The caret's next act: a held cut lands first, then the caret's own unit is
 * worked from where it stands forward, then every other unit in document
 * order from there, wrapping, so the caret never bounces back and forth.
 * Within a unit the next change is the first ending at or after the caret,
 * and the landing half of a move waits for its cut. Nothing to do answers
 * nothing.
 */
function nextAct(state: ChaseState): Act | undefined {
  const { units, caret, clipboard } = state;
  const start = caret?.unit ?? 0;
  if (clipboard !== undefined && caret !== undefined) {
    const unit = units[caret.unit];
    const site = unit === undefined ? undefined : pasteSite(unit.shown, aimOf(unit), clipboard);
    if (site !== undefined) {
      if (caret.at !== site.from) return { kind: ACT.TRAVEL, unit: caret.unit, to: site.from };
      return { kind: ACT.PASTE, unit: caret.unit, at: site.from, words: site.insert };
    }
  }
  for (let step = 0; step < units.length; step += 1) {
    const index = (start + step) % units.length;
    const unit = units[index];
    if (unit === undefined) continue;
    const hunks = diffHunks(unit.shown, aimOf(unit)).filter(
      (hunk) => hunk.move !== MOVE_HALF.PASTE,
    );
    const here = caret?.unit === index ? caret.at : undefined;
    const hunk = hunks.find((candidate) => candidate.to >= (here ?? 0)) ?? hunks[0];
    if (hunk !== undefined) return actFor(index, unit.shown, hunk, here);
  }
  return undefined;
}

/** The state with one unit's shown words changed by a finished act, lit if that caught it up. */
function edited(state: ChaseState, index: number, shown: string): ChaseState {
  const units = state.units.map((unit, at) =>
    at === index ? { ...unit, shown, fresh: shown === unit.target } : unit,
  );
  return { ...state, units };
}

/** The state with the act finished and the caret left where it ends. */
function finished(state: ChaseState, caret: Caret): ChaseState {
  return { ...state, act: undefined, progress: 0, caret };
}

/** Letters an act at `perSecond` gets through in `budgetMs`, up to `limit`, and the time that took. */
function spent(progress: number, limit: number, perSecond: number, budgetMs: number) {
  const letters = Math.min(limit - progress, (budgetMs * perSecond) / 1_000);
  return { progress: progress + letters, usedMs: (letters * 1_000) / perSecond };
}

/** The act standing, played for up to `budgetMs`: the state after, and the time it took. */
function played(state: ChaseState, act: Act, budgetMs: number): [ChaseState, number] {
  const shown = state.units[act.unit]?.shown ?? "";
  switch (act.kind) {
    case ACT.TRAVEL:
      return [{ ...finished(state, { unit: act.unit, at: act.to }), jumps: state.jumps + 1 }, 0];
    case ACT.PASTE: {
      const pasted = edited(state, act.unit, spliced(shown, act.at, act.at, act.words));
      const caret = { unit: act.unit, at: act.at + act.words.length };
      return [{ ...finished(pasted, caret), clipboard: undefined }, 0];
    }
    case ACT.TYPE: {
      // Typing runs to the next letter a hand pauses after, and the pause is owed there.
      let stop = act.words.length;
      for (let at = Math.floor(state.progress); at < act.words.length; at += 1) {
        if (pauseAfter(act.words[at], act.words[at + 1] ?? shown[act.at]) > 0) {
          stop = at + 1;
          break;
        }
      }
      const step = spent(state.progress, stop, CHASE_CHARS_PER_SECOND, budgetMs);
      if (step.progress < stop) return [{ ...state, progress: step.progress }, step.usedMs];
      const pause = pauseAfter(act.words[stop - 1], act.words[stop] ?? shown[act.at]);
      if (stop < act.words.length) {
        return [{ ...state, progress: stop, waitMs: pause }, step.usedMs];
      }
      const typed = edited(state, act.unit, spliced(shown, act.at, act.at, act.words));
      const caret = { unit: act.unit, at: act.at + act.words.length };
      return [{ ...finished(typed, caret), waitMs: pause }, step.usedMs];
    }
    case ACT.BACKSPACE: {
      const length = act.to - act.from;
      const step = spent(state.progress, length, CHASE_PACE.BACKSPACE_CHARS_PER_SECOND, budgetMs);
      if (step.progress < length) return [{ ...state, progress: step.progress }, step.usedMs];
      const erased = edited(state, act.unit, spliced(shown, act.from, act.to, ""));
      return [finished(erased, { unit: act.unit, at: act.from }), step.usedMs];
    }
    case ACT.SELECT: {
      const length = act.to - act.from;
      // A selection swept whole stands for a beat, and the next play erases or cuts it.
      if (state.progress >= length) {
        const cut = edited(state, act.unit, spliced(shown, act.from, act.to, ""));
        const clipboard =
          act.becomes === SELECTED.CUT
            ? shown.slice(act.from, act.to).replace(/^\n|\n$/gu, "")
            : state.clipboard;
        return [{ ...finished(cut, { unit: act.unit, at: act.from }), clipboard }, 0];
      }
      const step = spent(state.progress, length, CHASE_PACE.SELECT_CHARS_PER_SECOND, budgetMs);
      const waitMs = step.progress >= length ? CHASE_PACE.SELECT_HOLD_MS : 0;
      return [{ ...state, progress: step.progress, waitMs }, step.usedMs];
    }
  }
}

/**
 * The act standing folded into the shown words where it can stop partway:
 * the letters typed stay typed, the letters erased stay gone. A travel, a
 * selection, or a paste is let finish, since each is short and a newer
 * document arrives every few frames while the notetaker writes.
 */
function folded(state: ChaseState): ChaseState {
  const { act } = state;
  if (act === undefined) return state;
  const shown = state.units[act.unit]?.shown ?? "";
  const done = Math.floor(state.progress);
  if (act.kind === ACT.TYPE) {
    const typed = edited(state, act.unit, spliced(shown, act.at, act.at, act.words.slice(0, done)));
    return finished(typed, { unit: act.unit, at: act.at + done });
  }
  if (act.kind === ACT.BACKSPACE) {
    const erased = edited(state, act.unit, spliced(shown, act.to - done, act.to, ""));
    return finished(erased, { unit: act.unit, at: act.to - done });
  }
  return state;
}

/** How long the work left would take at the typing pace: every unit's differing stretch, both sides. */
function backlogMs(units: readonly ChaseUnit[]): number {
  let letters = 0;
  for (const { shown, target } of units) {
    if (shown === target) continue;
    let head = 0;
    while (head < shown.length && head < target.length && shown[head] === target[head]) head += 1;
    let tail = 0;
    while (
      tail < shown.length - head &&
      tail < target.length - head &&
      shown[shown.length - 1 - tail] === target[target.length - 1 - tail]
    ) {
      tail += 1;
    }
    letters += shown.length + target.length - 2 * (head + tail);
  }
  return (letters * 1_000) / CHASE_CHARS_PER_SECOND;
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
    units: planUnits(body).map(standing),
    freshAssumptions: new Set(),
    caret: undefined,
    act: undefined,
    progress: 0,
    waitMs: 0,
    clipboard: undefined,
    jumps: 0,
  };
}

/**
 * The same plan's newer document as the next target. What is shown stays,
 * the act standing folded into it, and the caret works toward the newer
 * words from there. A unit whose words changed is streaming until a later
 * document leaves it unchanged, its words stand for `SETTLE_MS`, or a
 * settling document arrives, since the notetaker writes one field at a time. Under
 * reduced motion every change is shown at once and lit, the caret left at
 * the end of the last.
 */
export function chaseRetargeted(
  state: ChaseState,
  body: string,
  added: { readonly before: readonly string[]; readonly after: readonly string[] },
  aim: ChaseAim,
): ChaseState {
  const held = folded(state);
  let caret = held.caret;
  const units = planUnits(body).map((target, index): ChaseUnit => {
    const previous = held.units[index];
    const steadyMs = aim.settle ? Number.POSITIVE_INFINITY : 0;
    if (aim.reduced) {
      if (previous?.target === target && previous.shown === target) return previous;
      caret = { unit: index, at: target.length };
      return { ...standing(target), fresh: true };
    }
    // A unit this document left unchanged is not the one the stream is writing.
    if (previous?.target === target) return { ...previous, steadyMs: Number.POSITIVE_INFINITY };
    return { target, shown: previous?.shown ?? "", steadyMs, fresh: false };
  });
  const before = new Set(added.before);
  const freshAssumptions = new Set<number>();
  added.after.forEach((text, index) => {
    if (!before.has(text)) freshAssumptions.add(index);
  });
  const caretUnit = caret === undefined ? undefined : units[caret.unit];
  const placed =
    caret === undefined || caretUnit === undefined
      ? undefined
      : { unit: caret.unit, at: Math.min(caret.at, caretUnit.shown.length) };
  const act = aim.reduced || placed === undefined ? undefined : held.act;
  return {
    ...held,
    units,
    freshAssumptions,
    caret: placed,
    act,
    progress: act === undefined ? 0 : held.progress,
    clipboard: aim.reduced ? undefined : held.clipboard,
  };
}

/** Whether the caret still has work: an act or a pause standing, or any unit not yet as its newest words say. */
export function chaseBehind(state: ChaseState): boolean {
  return (
    state.act !== undefined ||
    state.waitMs > 0 ||
    state.units.some((unit) => unit.shown !== unit.target)
  );
}

/**
 * One frame of `elapsedMs`: every unit's newest words have stood that much
 * longer, and the caret spends the time on pauses and acts. Far behind the
 * notetaker, the whole pace speeds up in proportion, pauses included, so the
 * document never trails the call by more than a few seconds of work.
 */
export function chaseStepped(state: ChaseState, elapsedMs: number): ChaseState {
  if (!chaseBehind(state)) return state;
  const elapsed = Math.max(0, elapsedMs);
  const units = state.units.map((unit) => ({ ...unit, steadyMs: unit.steadyMs + elapsed }));
  let next: ChaseState = { ...state, units };
  let budget = elapsed * Math.max(1, backlogMs(units) / CHASE_PACE.CATCH_UP_LAG_MS);
  for (let round = 0; round < MAX_ACTS_PER_FRAME && budget > 0; round += 1) {
    if (next.waitMs > 0) {
      const waited = Math.min(next.waitMs, budget);
      next = { ...next, waitMs: next.waitMs - waited };
      budget -= waited;
      continue;
    }
    const act = next.act ?? nextAct(next);
    if (act === undefined) break;
    if (next.act === undefined) {
      // Starting an act unlights its unit and owes the pause before it.
      const unlit = next.units.map((unit, at) =>
        at === act.unit ? { ...unit, fresh: false } : unit,
      );
      next = { ...next, units: unlit, act, progress: 0, waitMs: leadOf(act) };
      continue;
    }
    const [after, usedMs] = played(next, act, budget);
    next = after;
    budget -= usedMs;
  }
  return next;
}

/** One act drawn partway in the unit it works on. */
function actView(unit: ChaseUnit, act: Act, progress: number): UnitView {
  const done = Math.floor(progress);
  const working = { writing: true, resting: false, fresh: false };
  switch (act.kind) {
    case ACT.TYPE: {
      const words = spliced(unit.shown, act.at, act.at, act.words);
      const hidden = { from: act.at + done, to: act.at + act.words.length };
      return { words, edit: { hidden, caret: act.at + done }, ...working };
    }
    case ACT.BACKSPACE: {
      const hidden = { from: act.to - done, to: act.to };
      return { words: unit.shown, edit: { hidden, caret: act.to - done }, ...working };
    }
    case ACT.SELECT: {
      const selection = { from: act.from, to: act.from + done };
      return { words: unit.shown, edit: { selection, caret: act.from + done }, ...working };
    }
    default:
      return { words: unit.shown, edit: undefined, ...working };
  }
}

/**
 * What each unit draws now. The unit an act is partway through draws it;
 * otherwise the caret stands where it last moved, solid while there is still
 * work and, with nothing behind and the plan still `live`, being written on a
 * call, blinking where it waits, the way an editor's cursor waits where the
 * last word went in. Off the call with nothing behind, no caret is drawn.
 */
export function chaseView(state: ChaseState, live: boolean): readonly UnitView[] {
  const behind = chaseBehind(state);
  const { act, caret } = state;
  const drawsAct = act !== undefined && act.kind !== ACT.TRAVEL && act.kind !== ACT.PASTE;
  return state.units.map((unit, index): UnitView => {
    if (drawsAct && act.unit === index) return actView(unit, act, state.progress);
    const still = {
      words: unit.shown,
      edit: undefined,
      writing: false,
      resting: false,
      fresh: unit.fresh,
    };
    if (caret?.unit !== index || drawsAct || (!behind && !live)) return still;
    const edit = { caret: Math.min(caret.at, unit.shown.length) };
    return { ...still, edit, writing: behind, resting: !behind };
  });
}
