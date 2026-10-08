import { diffArrays } from "diff";
import type { MarkdownEdit } from "../markdown-message";
import { diffHunks, type Hunk, isPlaceholder } from "./plan-diff";

/**
 * plan-reveal.ts -- how the open plan writes itself in: one caret taking each note down where it lands, as a person taking notes on a call would.
 *
 * The notetaker changes the plan one note at a time, and the service sends
 * the document after each (`notesInProgress` in `@sidecar/hosted/plan-template`):
 * a point growing at the end of a field, a phrase corrected, or a line
 * struck. Every document is final or still growing at its end, so nothing
 * here guesses at what the stream means; it plays the difference.
 *
 * The body is cut into units at every section and field heading, which the
 * formatter alone writes. A unit is known from one document to the next by
 * its heading, and a rule by its statement, never by position, so a rule or
 * an optional field joining the document moves no other unit's words. A
 * unit the document no longer holds is erased where it stands before it
 * goes. One caret works through the differences an act at a time: it
 * travels to the next change, sweeps a selection over words to erase,
 * backspaces a few letters, and types, pausing where a hand would. Each act
 * is read from a fresh diff of what is shown against what is aimed at, so a
 * newer document arriving mid-act is simply the next diff. The average pace
 * is a streaming model's, sped up when far behind. Everything here is pure;
 * the frame clock is the hook's.
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
  /** How long a finished selection stands before it is erased. */
  SELECT_HOLD_MS: 160,
  SENTENCE_PAUSE_MS: 180,
  CLAUSE_PAUSE_MS: 80,
  LINE_PAUSE_MS: 120,
  /** The work left, in time at the pace above, past which the whole pace speeds up to keep up with the notetaker. */
  CATCH_UP_LAG_MS: 2_500,
} as const;

/** A line the formatter opens a section or a field with. */
const UNIT_HEADING = /^#{2,3} /u;

/** A rule's heading: its number, then its statement. */
const RULE_HEADING = /^### Rule \d+: /u;

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
} as const;

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
      readonly kind: typeof ACT.BACKSPACE | typeof ACT.SELECT;
      readonly unit: number;
      readonly from: number;
      readonly to: number;
    };

/** What a unit is known by from one document to the next: its heading, and which of the units bearing it it is. */
interface UnitKey {
  readonly heading: string;
  readonly occurrence: number;
}

/** One unit: who it is, its newest words, the words shown, and whether it is lit. */
interface ChaseUnit {
  /** Minted when the unit first appears and kept while it stands, so a view can key it. */
  readonly id: number;
  readonly key: UnitKey;
  readonly target: string;
  readonly shown: string;
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
  /** How many times the caret has jumped, so a view can tell a jump from typing. */
  readonly jumps: number;
  /** The id the next unit to appear is given. */
  readonly nextId: number;
}

/** What one unit draws: its words, the edit they are drawn partway through, and how it is marked. */
export interface UnitView {
  /** The unit's identity while it stands, for a view to key it by. */
  readonly id: number;
  readonly words: string;
  /** Absent while the unit is drawn whole with no caret in it. */
  readonly edit: MarkdownEdit | undefined;
  readonly writing: boolean;
  /** Whether the caret stands still waiting, which blinks where a working caret holds solid. */
  readonly resting: boolean;
  readonly fresh: boolean;
}

/** How a newer document lands: shown at once under reduced motion. */
export interface ChaseAim {
  readonly reduced: boolean;
}

/** Whether a fence line closes the fence standing: the same character, at least as long. */
function closesFence(marker: string, fence: string): boolean {
  return marker[0] === fence[0] && marker.length >= fence.length;
}

/** A unit's heading as it is known: the line itself, or for a rule its statement with spaces collapsed, since its number moves with the rules before it. */
function headingOf(words: string): string {
  const end = words.indexOf("\n");
  const line = end === -1 ? words : words.slice(0, end);
  if (!UNIT_HEADING.test(line)) return "";
  return RULE_HEADING.test(line)
    ? line.replace(RULE_HEADING, "### Rule ").replace(/\s+/gu, " ")
    : line;
}

/** Each unit's key, a heading borne twice told apart by which of them it is. */
function keysOf(units: readonly string[]): readonly UnitKey[] {
  const seen = new Map<string, number>();
  return units.map((words) => {
    const heading = headingOf(words);
    const occurrence = seen.get(heading) ?? 0;
    seen.set(heading, occurrence + 1);
    return { heading, occurrence };
  });
}

function sameKey(left: UnitKey, right: UnitKey): boolean {
  return left.heading === right.heading && left.occurrence === right.occurrence;
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

/** The act that works on one change, given where the caret stands in the change's unit. */
function actFor(unit: number, shown: string, hunk: Hunk, here: number | undefined): Act {
  const travel = (to: number): Act => ({ kind: ACT.TRAVEL, unit, to });
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
  if (erased.length > 0) return { kind: ACT.SELECT, unit, from: hunk.from, to: hunk.to };
  return { kind: ACT.TYPE, unit, at: hunk.from, words: hunk.insert };
}

/**
 * The caret's next act: its own unit worked from where it stands forward,
 * then every other unit in document order from there, wrapping, so the caret
 * never bounces back and forth. Within a unit the next change is the first
 * ending at or after the caret. Nothing to do answers nothing.
 */
function nextAct(state: ChaseState): Act | undefined {
  const { units, caret } = state;
  const start = caret?.unit ?? 0;
  for (let step = 0; step < units.length; step += 1) {
    const index = (start + step) % units.length;
    const unit = units[index];
    if (unit === undefined) continue;
    const hunks = diffHunks(unit.shown, unit.target);
    const here = caret?.unit === index ? caret.at : undefined;
    const hunk = hunks.find((candidate) => candidate.to >= (here ?? 0)) ?? hunks[0];
    if (hunk !== undefined) return actFor(index, unit.shown, hunk, here);
  }
  return undefined;
}

/**
 * The state with one unit's shown words changed by a finished act, lit if
 * that caught it up, and gone if it was leaving and is now erased, the caret
 * then standing at the end of the unit before it.
 */
function edited(state: ChaseState, index: number, shown: string, caret: Caret): ChaseState {
  const unit = state.units[index];
  if (unit === undefined) return state;
  if (shown === "" && unit.target === "") {
    const units = state.units.filter((_, at) => at !== index);
    const before = units[index - 1];
    const placed = before === undefined ? undefined : { unit: index - 1, at: before.shown.length };
    return { ...state, units, caret: placed, act: undefined, progress: 0 };
  }
  const units = state.units.map((standing, at) =>
    at === index ? { ...standing, shown, fresh: shown === standing.target } : standing,
  );
  return { ...state, units, caret, act: undefined, progress: 0 };
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
    case ACT.TRAVEL: {
      const caret = { unit: act.unit, at: act.to };
      return [{ ...state, act: undefined, progress: 0, caret, jumps: state.jumps + 1 }, 0];
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
      const typed = spliced(shown, act.at, act.at, act.words);
      const caret = { unit: act.unit, at: act.at + act.words.length };
      return [{ ...edited(state, act.unit, typed, caret), waitMs: pause }, step.usedMs];
    }
    case ACT.BACKSPACE: {
      const length = act.to - act.from;
      const step = spent(state.progress, length, CHASE_PACE.BACKSPACE_CHARS_PER_SECOND, budgetMs);
      if (step.progress < length) return [{ ...state, progress: step.progress }, step.usedMs];
      const erased = spliced(shown, act.from, act.to, "");
      return [edited(state, act.unit, erased, { unit: act.unit, at: act.from }), step.usedMs];
    }
    case ACT.SELECT: {
      const length = act.to - act.from;
      // A selection swept whole stands for a beat, and the next play erases it.
      if (state.progress >= length) {
        const erased = spliced(shown, act.from, act.to, "");
        return [edited(state, act.unit, erased, { unit: act.unit, at: act.from }), 0];
      }
      const step = spent(state.progress, length, CHASE_PACE.SELECT_CHARS_PER_SECOND, budgetMs);
      const waitMs = step.progress >= length ? CHASE_PACE.SELECT_HOLD_MS : 0;
      return [{ ...state, progress: step.progress, waitMs }, step.usedMs];
    }
  }
}

/**
 * The act standing folded into the shown words where it can stop partway:
 * the letters typed stay typed, the letters erased stay gone. A travel or a
 * selection is left standing, since each is short.
 */
function folded(state: ChaseState): ChaseState {
  const { act } = state;
  if (act === undefined) return state;
  const unit = state.units[act.unit];
  if (unit === undefined) return state;
  const done = Math.floor(state.progress);
  if (act.kind === ACT.TYPE) {
    const typed = spliced(unit.shown, act.at, act.at, act.words.slice(0, done));
    return edited(state, act.unit, typed, { unit: act.unit, at: act.at + done });
  }
  if (act.kind === ACT.BACKSPACE) {
    const erased = spliced(unit.shown, act.to - done, act.to, "");
    return edited(state, act.unit, erased, { unit: act.unit, at: act.to - done });
  }
  return state;
}

/** Whether a selection begun against older words still sweeps words the newer ones erase. */
function stillErased(act: Act, unit: ChaseUnit): boolean {
  if (act.kind === ACT.TRAVEL) return true;
  if (act.kind !== ACT.SELECT) return false;
  return diffHunks(unit.shown, unit.target).some(
    (hunk) => hunk.from <= act.from && act.to <= hunk.to,
  );
}

/** The caret carried to where its unit now stands, held within the unit's words, or nothing where its unit went. */
function movedCaret(
  caret: Caret | undefined,
  movedTo: ReadonlyMap<number, number>,
  units: readonly ChaseUnit[],
): Caret | undefined {
  const unit = caret === undefined ? undefined : movedTo.get(caret.unit);
  const words = unit === undefined ? undefined : units[unit];
  if (caret === undefined || unit === undefined || words === undefined) return undefined;
  return { unit, at: Math.min(caret.at, words.shown.length) };
}

/** The act standing carried to where its unit now stands, while the newer words still want it. */
function movedAct(
  act: Act | undefined,
  movedTo: ReadonlyMap<number, number>,
  units: readonly ChaseUnit[],
): Act | undefined {
  const unit = act === undefined ? undefined : movedTo.get(act.unit);
  const words = unit === undefined ? undefined : units[unit];
  if (act === undefined || unit === undefined || words === undefined) return undefined;
  const moved = { ...act, unit };
  return stillErased(moved, words) ? moved : undefined;
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
 * Where each newer unit stood before, and which older units are leaving.
 * Units are paired by key in document order. A run of older units the newer
 * document dropped, beside a run it added in the same place, is the same
 * units renamed, as when a rule's statement is corrected, and pairs one for
 * one; what is left over on the older side is leaving, and stays where it
 * stood until it is erased.
 */
/** A place in the newer document's order: a newer unit by index, or an older one leaving. */
type Place = { readonly next: number } | { readonly leaving: number };

/** How a newer document's units line up with the older: every place in the newer order, and where each newer unit stood before. */
interface UnitPairing {
  readonly order: readonly Place[];
  readonly from: ReadonlyMap<number, number>;
}

function pairedUnits(previous: readonly ChaseUnit[], keys: readonly UnitKey[]): UnitPairing {
  const changes = diffArrays(
    previous.map((unit) => unit.key),
    [...keys],
    { comparator: sameKey },
  );
  const order: Place[] = [];
  const from = new Map<number, number>();
  let before = 0;
  let after = 0;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (change === undefined) continue;
    const count = change.value.length;
    if (!change.added && !change.removed) {
      for (let at = 0; at < count; at += 1) {
        from.set(after, before);
        order.push({ next: after });
        before += 1;
        after += 1;
      }
    } else if (change.removed) {
      // A renamed unit is placed where its newer self stands, when the addition beside it is walked.
      const beside = changes[index + 1];
      const renamed = beside?.added === true ? Math.min(count, beside.value.length) : 0;
      for (let at = 0; at < count; at += 1) {
        if (at < renamed) from.set(after + at, before);
        else order.push({ leaving: before });
        before += 1;
      }
    } else {
      for (let at = 0; at < count; at += 1) {
        order.push({ next: after });
        after += 1;
      }
    }
  }
  return { order, from };
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
  const targets = planUnits(body);
  const keys = keysOf(targets);
  const units = targets.map((words, index) => ({
    id: index,
    key: keys[index] ?? { heading: "", occurrence: index },
    target: words,
    shown: words,
    fresh: false,
  }));
  return {
    units,
    freshAssumptions: new Set(),
    caret: undefined,
    act: undefined,
    progress: 0,
    waitMs: 0,
    jumps: 0,
    nextId: units.length,
  };
}

/**
 * The same plan's newer document as the next target. What is shown stays,
 * the act standing folded into it, and the caret works toward the newer
 * words from there. A unit the newer document added starts empty where it
 * stands; a unit it dropped stays, aimed at nothing, until it is erased. A
 * selection the newer words no longer erase is dropped rather than finished.
 * Under reduced motion every change is shown at once and lit, the caret left
 * at the end of the last.
 */
export function chaseRetargeted(
  state: ChaseState,
  body: string,
  added: { readonly before: readonly string[]; readonly after: readonly string[] },
  aim: ChaseAim,
): ChaseState {
  const held = folded(state);
  const targets = planUnits(body);
  const keys = keysOf(targets);
  const { order, from } = pairedUnits(held.units, keys);
  let nextId = held.nextId;
  const movedTo = new Map<number, number>();
  const units: ChaseUnit[] = [];
  let changed: number | undefined;
  for (const place of order) {
    if ("leaving" in place) {
      const leaving = held.units[place.leaving];
      if (leaving === undefined || leaving.shown === "" || aim.reduced) continue;
      movedTo.set(place.leaving, units.length);
      units.push({ ...leaving, target: "" });
      continue;
    }
    const target = targets[place.next] ?? "";
    const key = keys[place.next] ?? { heading: "", occurrence: 0 };
    const before = from.get(place.next);
    const previous = before === undefined ? undefined : held.units[before];
    if (before !== undefined) movedTo.set(before, units.length);
    if (previous?.target !== target) changed = units.length;
    if (previous === undefined) {
      const shown = aim.reduced ? target : "";
      units.push({ id: nextId, key, target, shown, fresh: aim.reduced });
      nextId += 1;
    } else if (aim.reduced && previous.shown !== target) {
      units.push({ ...previous, key, target, shown: target, fresh: true });
    } else {
      units.push({ ...previous, key, target });
    }
  }
  const before = new Set(added.before);
  const freshAssumptions = new Set<number>();
  added.after.forEach((text, index) => {
    if (!before.has(text)) freshAssumptions.add(index);
  });
  const caret =
    aim.reduced && changed !== undefined
      ? { unit: changed, at: units[changed]?.shown.length ?? 0 }
      : movedCaret(held.caret, movedTo, units);
  const act = aim.reduced || caret === undefined ? undefined : movedAct(held.act, movedTo, units);
  return {
    ...held,
    units,
    freshAssumptions,
    caret,
    act,
    progress: act === undefined ? 0 : held.progress,
    nextId,
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
 * One frame of `elapsedMs`: the caret spends the time on pauses and acts.
 * Far behind the notetaker, the whole pace speeds up in proportion, pauses
 * included, so the document never trails the call by more than a few
 * seconds of work.
 */
export function chaseStepped(state: ChaseState, elapsedMs: number): ChaseState {
  if (!chaseBehind(state)) return state;
  let next = state;
  let budget =
    Math.max(0, elapsedMs) * Math.max(1, backlogMs(state.units) / CHASE_PACE.CATCH_UP_LAG_MS);
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
      // Starting an act unlights its unit and owes the pause before a jump.
      const unlit = next.units.map((unit, at) =>
        at === act.unit ? { ...unit, fresh: false } : unit,
      );
      const waitMs = act.kind === ACT.TRAVEL ? CHASE_PACE.TRAVEL_MS : 0;
      next = { ...next, units: unlit, act, progress: 0, waitMs };
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
  const working = { id: unit.id, writing: true, resting: false, fresh: false };
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
    case ACT.TRAVEL:
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
  const drawsAct = act !== undefined && act.kind !== ACT.TRAVEL;
  return state.units.map((unit, index): UnitView => {
    if (drawsAct && act.unit === index) return actView(unit, act, state.progress);
    const still = {
      id: unit.id,
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
