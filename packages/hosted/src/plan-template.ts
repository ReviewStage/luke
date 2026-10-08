import {
  EXCESS_KEYS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  unparsedWire,
} from "@sidecar/wire";
import { describeWire, readEither } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import { PLAN_BOUNDS, type PlanAssumption } from "./plan-wire.js";

/**
 * plan-template.ts -- the one fixed template every feature plan is written in: the notes the notetaker takes, the fields they land in, and the canonical Markdown body those become.
 *
 * Every plan has the same sections in the same order (`docs/PLANNING.md`,
 * "The fixed template"). The service keeps the plan's fields as they stand,
 * and the notetaker changes them only by taking notes: a point added under a
 * field, an example added to a rule, a phrase corrected, or a line struck.
 * Each note lands in one place and touches nothing else, so a plan is written
 * the way a person takes notes on a call, and a draft drawn while the notes
 * stream differs from the one before only where the newest note lands
 * (`notesInProgress`). A note naming a phrase the field does not hold is
 * passed over rather than guessed into another. A core field reads
 * "Unanswered" while it holds nothing; an optional field is left out of the
 * body until it holds something. The fields are formatted here into the
 * document's Markdown `body`, and the document the window and the model read
 * stays `{ body, assumptions }` (`plan-wire.ts`). No code reads the body back
 * into fields.
 *
 * The template holds what a coding agent cannot read from the repository:
 * what was decided, the rules and their examples, and the contracts the
 * change must meet. The agent explores the code itself, so the plan carries
 * pointers into it rather than a description of it.
 *
 * The formatter owns every heading and its order. Field text is Markdown the
 * model wrote, contained where it stands: a line that would open a heading or
 * an HTML block is escaped, and a code fence left open is closed at the end of
 * its field, so no answer can impersonate a section or swallow the ones after
 * it. The schema guarantees shape only; whether a note is understood or
 * agreed is the model's judgment.
 */

/** Bounds on the fields and the notes; the formatted body is held to `PLAN_BOUNDS.MAX_BODY_CHARS` after formatting. */
const PLAN_TEMPLATE_BOUNDS = {
  /** One answer may be at most the whole body; the formatted total is what is held to the body bound. */
  MAX_ANSWER_CHARS: PLAN_BOUNDS.MAX_BODY_CHARS,
  /** A rule's statement is its heading, so it is one sentence. */
  MAX_RULE_CHARS: 500,
  /** One part of an example is a clause drawn on one line. */
  MAX_EXAMPLE_PART_CHARS: 1_000,
  /** The most rules, examples of one rule, or open questions. */
  MAX_ITEMS: 200,
} as const;

/** Every heading the formatter writes, section and field alike, in the words the developer reads. */
export const PLAN_HEADING = {
  GOAL: "Goal",
  PROBLEM: "Problem",
  OUTCOME: "Outcome",
  SCOPE: "Scope",
  INCLUDED: "Included",
  EXCLUDED: "Excluded",
  CONSTRAINTS: "Constraints",
  RULES: "Rules",
  IMPLEMENTATION: "Implementation",
  CHANGE_MAP: "Change map",
  CONTRACTS: "Contracts",
  PATTERNS: "Patterns to follow",
  ORDER: "Order",
  DECISIONS: "Decisions",
  VERIFICATION: "Verification",
  LEFT_TO_AGENT: "Left to the agent",
  OPEN_QUESTIONS: "Open questions",
  DATA_AND_MIGRATION: "Data and migration",
  ASSUMPTIONS: "Assumptions",
} as const;

/** The labels inside one rule. */
const PLAN_LABEL = {
  RULE: "Rule",
  GIVEN: "Given",
  WHEN: "When",
  THEN: "Then",
} as const;

/** What stands in a field's place while it holds nothing; each is the only rendering of its empty state. */
export const PLAN_EMPTY_TEXT = {
  UNANSWERED: "_Unanswered_",
  NO_EXAMPLES: "_No examples yet_",
  NO_QUESTIONS: "_No additional questions recorded_",
  NO_ASSUMPTIONS: "_None recorded_",
} as const;

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

/** A list that is present only once it holds something. */
function nonEmptyList<S extends EffectSchema.Top>(item: S) {
  return EffectSchema.Array(item).check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(PLAN_TEMPLATE_BOUNDS.MAX_ITEMS),
  );
}

/** An ordinary answer: null while unanswered, otherwise nonblank text. */
const ANSWER = EffectSchema.NullOr(trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS));

/** One clause of an example, null while unknown. */
const EXAMPLE_PART = EffectSchema.NullOr(trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_EXAMPLE_PART_CHARS));

const exampleSchema = EffectSchema.Struct({
  given: EXAMPLE_PART,
  when: EXAMPLE_PART,
  // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
  then: EXAMPLE_PART, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
});

const ruleSchema = EffectSchema.Struct({
  statement: trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_RULE_CHARS),
  examples: EffectSchema.NullOr(nonEmptyList(exampleSchema)),
});

/** Every section and field of the template, in its order: what the service keeps for a plan. */
export const planFieldsSchema = EffectSchema.Struct({
  goal: EffectSchema.Struct({ problem: ANSWER, outcome: ANSWER }),
  scope: EffectSchema.Struct({ included: ANSWER, excluded: ANSWER, constraints: ANSWER }),
  rules: EffectSchema.NullOr(nonEmptyList(ruleSchema)),
  implementation: EffectSchema.Struct({
    changeMap: ANSWER,
    contracts: ANSWER,
    patterns: ANSWER,
    order: ANSWER,
  }),
  decisions: ANSWER,
  verification: ANSWER,
  leftToAgent: ANSWER,
  openQuestions: EffectSchema.Array(trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS)).check(
    EffectSchema.isMaxLength(PLAN_TEMPLATE_BOUNDS.MAX_ITEMS),
  ),
  dataAndMigration: ANSWER,
});

export type PlanFields = typeof planFieldsSchema.Type;
type Rule = typeof ruleSchema.Type;
type Example = typeof exampleSchema.Type;

/** What the document's header names: the plan, the service's and never the model's. */
export interface PlanHeader {
  readonly name: string;
}

/** A plan's whole content as the notetaker writes it: the template's fields and the assumptions beside them. */
export interface PlanContent {
  readonly fields: PlanFields;
  readonly assumptions: readonly PlanAssumption[];
}

/** A new plan's fields: every answer unanswered and no questions. */
export const EMPTY_PLAN_FIELDS: PlanFields = {
  goal: { problem: null, outcome: null },
  scope: { included: null, excluded: null, constraints: null },
  rules: null,
  implementation: { changeMap: null, contracts: null, patterns: null, order: null },
  decisions: null,
  verification: null,
  leftToAgent: null,
  openQuestions: [],
  dataAndMigration: null,
};

/** A new plan's content: every answer unanswered, no questions, and no assumptions. */
export const EMPTY_PLAN_CONTENT: PlanContent = { fields: EMPTY_PLAN_FIELDS, assumptions: [] };

/** A code fence's opening or closing line: up to three spaces, then three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/**
 * A line that would open an ATX heading, behind any blockquote or list
 * markers; the first group is everything before the hashes.
 */
const HEADING_LINE = /^( {0,3}(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*)(?=#{1,6}(?:[ \t]|$))/u;

/** A line that would underline the paragraph above it into a setext heading. */
const SETEXT_LINE = /^( {0,3}(?:>[ \t]*)*)(?=(?:=+|-+)[ \t]*$)/u;

/** A line that would open an HTML block, which the panel draws as nothing and which runs past its field. */
const HTML_LINE = /^( {0,3})(?=<)/u;

/** The one fence a field has open, which its closing line must match. */
interface OpenFence {
  readonly marker: string;
}

/** Whether a line opens a fence, and with which marker; a backtick fence's info string may hold no backtick. */
function fenceOpened(line: string): OpenFence | undefined {
  const match = FENCE_LINE.exec(line);
  const marker = match?.[1];
  if (marker === undefined) return undefined;
  if (marker.startsWith("`") && (match?.[2] ?? "").includes("`")) return undefined;
  return { marker };
}

/** Whether a line closes the fence standing: the same character, at least as long, and nothing after it. */
function fenceCloses(line: string, fence: OpenFence): boolean {
  const match = FENCE_LINE.exec(line);
  const marker = match?.[1];
  if (marker === undefined) return false;
  const sameCharacter = marker[0] === fence.marker[0];
  return sameCharacter && marker.length >= fence.marker.length && (match?.[2] ?? "").trim() === "";
}

/** One line outside a fence, with a backslash before whatever would open a heading or an HTML block. */
function escapedLine(line: string, afterText: boolean): string {
  const heading = HEADING_LINE.exec(line) ?? (afterText ? SETEXT_LINE.exec(line) : null);
  const opener = heading ?? HTML_LINE.exec(line);
  if (opener === null) return line;
  const at = opener[1]?.length ?? 0;
  return `${line.slice(0, at)}\\${line.slice(at)}`;
}

/**
 * Field text as Markdown that stays inside its field. Note that we leave a
 * fence's own lines as written, because a `#` inside code is code, and that
 * we close a fence the text left open, because an open fence would turn
 * every heading after it into code.
 */
function contained(text: string): string {
  const lines: string[] = [];
  let fence: OpenFence | undefined;
  let afterText = false;
  for (const line of text.replace(/\r\n?/gu, "\n").split("\n")) {
    if (fence !== undefined) {
      if (fenceCloses(line, fence)) fence = undefined;
      lines.push(line);
      afterText = false;
      continue;
    }
    fence = fenceOpened(line);
    lines.push(fence === undefined ? escapedLine(line, afterText) : line);
    afterText = fence === undefined && line.trim().length > 0;
  }
  if (fence !== undefined) lines.push(fence.marker);
  return lines.join("\n");
}

/** Text a heading carries on its one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function answerBlock(value: string | null): string {
  return value === null ? PLAN_EMPTY_TEXT.UNANSWERED : contained(value);
}

function field(heading: string, block: string): string {
  return `### ${heading}\n\n${block}`;
}

function section(heading: string, blocks: readonly string[]): string {
  return [`## ${heading}`, ...blocks].join("\n\n");
}

/** One list item, its later lines indented under the marker so a multi-line entry stays one item. */
function listItem(marker: string, text: string): string {
  const [first, ...rest] = contained(text).split("\n");
  const indent = " ".repeat(marker.length);
  const continued = rest.map((line) => (line.length === 0 ? line : `${indent}${line}`));
  return [`${marker}${first ?? ""}`, ...continued].join("\n");
}

/** One clause of an example on its one line, or the unanswered mark. */
function clause(value: string | null): string {
  return value === null ? PLAN_EMPTY_TEXT.UNANSWERED : oneLine(value);
}

/**
 * One example as one list item, its clauses on their own lines. Note that we
 * draw each clause on one line, because a clause that broke onto a new line
 * could open a fence or a heading behind the label.
 */
function exampleItem(example: Example): string {
  return [
    `- **${PLAN_LABEL.GIVEN}** ${clause(example.given)}`,
    `  **${PLAN_LABEL.WHEN}** ${clause(example.when)}`,
    `  **${PLAN_LABEL.THEN}** ${clause(example.then)}`,
  ].join("\n");
}

function ruleBlock(rule: Rule, index: number): string {
  const examples =
    rule.examples === null
      ? PLAN_EMPTY_TEXT.NO_EXAMPLES
      : rule.examples.map(exampleItem).join("\n");
  return [`### ${PLAN_LABEL.RULE} ${index + 1}: ${oneLine(rule.statement)}`, examples].join("\n\n");
}

function rulesBlocks(rules: readonly Rule[] | null): readonly string[] {
  return rules === null ? [PLAN_EMPTY_TEXT.UNANSWERED] : rules.map(ruleBlock);
}

function headerBlock(header: PlanHeader): string {
  return `# ${oneLine(header.name)}`;
}

/** An optional field: its heading and answer once it holds something, nothing while null. */
function optionalField(heading: string, value: string | null): readonly string[] {
  return value === null ? [] : [field(heading, contained(value))];
}

/** An optional section, on the same terms as an optional field. */
function optionalSection(heading: string, value: string | null): readonly string[] {
  return value === null ? [] : [section(heading, [contained(value)])];
}

/**
 * The canonical Markdown body of a plan: the header the service supplies,
 * then every section and field in the template's order, whatever order the
 * fields' keys arrived in. The assumptions are not part of the body; they
 * are the document's own list, drawn after it as the template's last section.
 */
export function planBody(header: PlanHeader, fields: PlanFields): string {
  const { goal, scope, rules, implementation, openQuestions } = fields;
  const blocks = [
    headerBlock(header),
    section(PLAN_HEADING.GOAL, [
      field(PLAN_HEADING.PROBLEM, answerBlock(goal.problem)),
      field(PLAN_HEADING.OUTCOME, answerBlock(goal.outcome)),
    ]),
    section(PLAN_HEADING.SCOPE, [
      field(PLAN_HEADING.INCLUDED, answerBlock(scope.included)),
      field(PLAN_HEADING.EXCLUDED, answerBlock(scope.excluded)),
      field(PLAN_HEADING.CONSTRAINTS, answerBlock(scope.constraints)),
    ]),
    section(PLAN_HEADING.RULES, rulesBlocks(rules)),
    section(PLAN_HEADING.IMPLEMENTATION, [
      field(PLAN_HEADING.CHANGE_MAP, answerBlock(implementation.changeMap)),
      field(PLAN_HEADING.CONTRACTS, answerBlock(implementation.contracts)),
      field(PLAN_HEADING.PATTERNS, answerBlock(implementation.patterns)),
      ...optionalField(PLAN_HEADING.ORDER, implementation.order),
    ]),
    section(PLAN_HEADING.DECISIONS, [answerBlock(fields.decisions)]),
    section(PLAN_HEADING.VERIFICATION, [answerBlock(fields.verification)]),
    section(PLAN_HEADING.LEFT_TO_AGENT, [answerBlock(fields.leftToAgent)]),
    section(PLAN_HEADING.OPEN_QUESTIONS, [
      openQuestions.length === 0
        ? PLAN_EMPTY_TEXT.NO_QUESTIONS
        : openQuestions.map((question) => listItem("- ", question)).join("\n"),
    ]),
    ...optionalSection(PLAN_HEADING.DATA_AND_MIGRATION, fields.dataAndMigration),
  ];
  return `${blocks.join("\n\n")}\n`;
}

/** Every field a note may be taken under, in the template's order. */
export const PLAN_FIELD = {
  PROBLEM: "problem",
  OUTCOME: "outcome",
  INCLUDED: "included",
  EXCLUDED: "excluded",
  CONSTRAINTS: "constraints",
  RULES: "rules",
  CHANGE_MAP: "changeMap",
  CONTRACTS: "contracts",
  PATTERNS: "patterns",
  ORDER: "order",
  DECISIONS: "decisions",
  VERIFICATION: "verification",
  LEFT_TO_AGENT: "leftToAgent",
  OPEN_QUESTIONS: "openQuestions",
  DATA_AND_MIGRATION: "dataAndMigration",
  ASSUMPTIONS: "assumptions",
} as const;

export type PlanField = (typeof PLAN_FIELD)[keyof typeof PLAN_FIELD];

/** The fields that hold one Markdown answer, as against the rules and the two lists. */
type TextField = Exclude<
  PlanField,
  typeof PLAN_FIELD.RULES | typeof PLAN_FIELD.OPEN_QUESTIONS | typeof PLAN_FIELD.ASSUMPTIONS
>;

/** What each field holds, in the words the notetaker is told. */
export const PLAN_FIELD_PURPOSE = {
  problem: "The current problem, and who it affects.",
  outcome: "The observable improvement once the change ships.",
  included: "What the change includes.",
  excluded: "What is explicitly out of scope.",
  constraints:
    "Limits the change must respect: permissions, privacy, performance, compatibility. Only " +
    "those that apply, cited or agreed, never invented.",
  rules:
    "The behavioral rules, each one sentence that holds in every case, failure, cancellation, " +
    "and retry included, with concrete examples that pin it.",
  changeMap: "Each repository-relative path the change touches or adds, and what it gets there.",
  contracts:
    "New or changed types, schema, and signatures at module boundaries, written as code in " +
    "fenced blocks. Signatures only, never function bodies.",
  patterns: "Existing code to follow, by path, and what to copy from it.",
  order: "Only where one step must land before another: the steps in order and why.",
  decisions: "Each consequential choice: the decision, why, and the alternative rejected.",
  verification: "The end-to-end check that proves the change works, beyond the examples passing.",
  leftToAgent:
    "Exactly which choices the implementing agent may make itself; everything else is fixed.",
  openQuestions:
    "Unresolved questions, contradictions, or facts no source could settle, one per note.",
  dataAndMigration:
    "Only when stored data changes: what is stored, how existing data moves, and how the " +
    "change is undone.",
  assumptions: "What the plan assumes without the developer having said it, one per note.",
} as const satisfies Record<PlanField, string>;

/** The kinds of note the notetaker takes. */
export const NOTE_KIND = {
  ADD: "add",
  ADD_EXAMPLE: "addExample",
  REPLACE: "replace",
  REMOVE: "remove",
} as const;

/** The most notes one answer may take. */
const MAX_NOTES = 40;

/** The longest phrase a note may name to correct or strike. */
const MAX_FIND_CHARS = 500;

const NOTE_FIELD = describeWire(
  EffectSchema.Literals(Object.values(PLAN_FIELD)),
  "The field the note is taken under.",
);

const FIND = describeWire(
  trimmedText(MAX_FIND_CHARS),
  "A phrase copied exactly from the field's saved text, long enough to name one place.",
);

const addNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.ADD),
  field: NOTE_FIELD,
  text: describeWire(
    trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS),
    "The new point, added after what the field holds: a Markdown bullet in a text field, " +
      "one item in a list, one rule's statement in the rules.",
  ),
});

const addExampleNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.ADD_EXAMPLE),
  rule: describeWire(
    EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
    "The rule's number as the document shows it.",
  ),
  given: describeWire(EXAMPLE_PART, "The starting situation. One line. Null while unknown."),
  when: describeWire(EXAMPLE_PART, "The action. One line. Null while unknown."),
  // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
  then: describeWire(EXAMPLE_PART, "The observable result. One line. Null while unknown."), // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
});

const replaceNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REPLACE),
  field: NOTE_FIELD,
  find: FIND,
  text: describeWire(
    trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS),
    "What the phrase becomes.",
  ),
});

const removeNoteSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(NOTE_KIND.REMOVE),
  field: NOTE_FIELD,
  find: describeWire(
    trimmedText(MAX_FIND_CHARS),
    "A phrase copied exactly from the line, item, rule, or example to strike.",
  ),
});

const planNoteSchema = EffectSchema.Union([
  addNoteSchema,
  addExampleNoteSchema,
  replaceNoteSchema,
  removeNoteSchema,
]);

/** One note: a point added, an example added to a rule, a phrase corrected, or a line struck. */
export type PlanNote = typeof planNoteSchema.Type;

/** What the notetaker answers each run with: the notes the latest lines call for, in the order taken. */
export const planNotesSchema = EffectSchema.Struct({
  notes: describeWire(
    EffectSchema.Array(planNoteSchema).check(EffectSchema.isMaxLength(MAX_NOTES)),
    "The notes the latest lines call for, in order; empty when nothing new was said.",
  ),
});

/** How one text field is read from the fields and written back. */
interface TextFieldLens {
  readonly read: (fields: PlanFields) => string | null;
  readonly write: (fields: PlanFields, value: string | null) => PlanFields;
}

/** Every field holding one Markdown answer, read and written in place. */
const TEXT_FIELD = {
  problem: {
    read: (fields) => fields.goal.problem,
    write: (fields, problem) => ({ ...fields, goal: { ...fields.goal, problem } }),
  },
  outcome: {
    read: (fields) => fields.goal.outcome,
    write: (fields, outcome) => ({ ...fields, goal: { ...fields.goal, outcome } }),
  },
  included: {
    read: (fields) => fields.scope.included,
    write: (fields, included) => ({ ...fields, scope: { ...fields.scope, included } }),
  },
  excluded: {
    read: (fields) => fields.scope.excluded,
    write: (fields, excluded) => ({ ...fields, scope: { ...fields.scope, excluded } }),
  },
  constraints: {
    read: (fields) => fields.scope.constraints,
    write: (fields, constraints) => ({ ...fields, scope: { ...fields.scope, constraints } }),
  },
  changeMap: {
    read: (fields) => fields.implementation.changeMap,
    write: (fields, changeMap) => ({
      ...fields,
      implementation: { ...fields.implementation, changeMap },
    }),
  },
  contracts: {
    read: (fields) => fields.implementation.contracts,
    write: (fields, contracts) => ({
      ...fields,
      implementation: { ...fields.implementation, contracts },
    }),
  },
  patterns: {
    read: (fields) => fields.implementation.patterns,
    write: (fields, patterns) => ({
      ...fields,
      implementation: { ...fields.implementation, patterns },
    }),
  },
  order: {
    read: (fields) => fields.implementation.order,
    write: (fields, order) => ({ ...fields, implementation: { ...fields.implementation, order } }),
  },
  decisions: {
    read: (fields) => fields.decisions,
    write: (fields, decisions) => ({ ...fields, decisions }),
  },
  verification: {
    read: (fields) => fields.verification,
    write: (fields, verification) => ({ ...fields, verification }),
  },
  leftToAgent: {
    read: (fields) => fields.leftToAgent,
    write: (fields, leftToAgent) => ({ ...fields, leftToAgent }),
  },
  dataAndMigration: {
    read: (fields) => fields.dataAndMigration,
    write: (fields, dataAndMigration) => ({ ...fields, dataAndMigration }),
  },
} as const satisfies Record<TextField, TextFieldLens>;

/** A line that opens a Markdown list item. */
const LIST_ITEM_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s/u;

/** A trailing line still being written that holds nothing but Markdown markers, whose escaping would change as it grows. */
const MARKER_ONLY_LINE = /^[\s#>*+=`~<\-\d.)]+$/u;

function isTextField(field: PlanField): field is TextField {
  return Object.hasOwn(TEXT_FIELD, field);
}

function escapedPattern(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Where a phrase stands in a text: exactly, or failing that with any run of
 * whitespace standing for any other, since the model copies a phrase that
 * wrapped as one that did not.
 */
function located(text: string, find: string): { from: number; to: number } | undefined {
  const exact = text.indexOf(find);
  if (exact !== -1) return { from: exact, to: exact + find.length };
  const words = find.split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) return undefined;
  const match = new RegExp(words.map(escapedPattern).join("\\s+"), "u").exec(text);
  return match === null ? undefined : { from: match.index, to: match.index + match[0].length };
}

/** A field's text with nothing left in it read as unanswered. */
function answered(text: string): string | null {
  const trimmed = text.replace(/\n{3,}/gu, "\n\n").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Text added after a field's answer: on the next line within a list, and as a new paragraph otherwise. */
function appended(current: string | null, text: string): string {
  if (current === null) return text;
  const lastLine = current.slice(current.lastIndexOf("\n") + 1);
  const joiner = LIST_ITEM_LINE.test(lastLine) && LIST_ITEM_LINE.test(text) ? "\n" : "\n\n";
  return `${current}${joiner}${text}`;
}

/** The text with every line the phrase touches struck out. */
function struck(text: string, at: { from: number; to: number }): string {
  const start = text.lastIndexOf("\n", at.from - 1) + 1;
  const newline = text.indexOf("\n", at.to);
  const end = newline === -1 ? text.length : newline + 1;
  return text.slice(0, start) + text.slice(end);
}

/** The text with the phrase replaced, or nothing where the phrase is not in it. */
function replacedIn(text: string, find: string, replacement: string): string | undefined {
  const at = located(text, find);
  return at === undefined ? undefined : text.slice(0, at.from) + replacement + text.slice(at.to);
}

/** A list with its first item holding the phrase changed, or nothing where none holds it. */
function replacedItem<Item>(
  items: readonly Item[],
  textOf: (item: Item) => string,
  change: (item: Item, text: string) => Item | undefined,
  find: string,
): readonly Item[] | undefined {
  const index = items.findIndex((item) => located(textOf(item), find) !== undefined);
  const item = items[index];
  if (item === undefined) return undefined;
  const changed = change(item, textOf(item));
  if (changed === undefined) return undefined;
  return items.map((standing, at) => (at === index ? changed : standing));
}

/** One example's clauses, in the order the document draws them. */
function clausesOf(example: Example): readonly (string | null)[] {
  return [example.given, example.when, example.then];
}

/** A rule with the phrase replaced in its statement or in one of its examples' clauses. */
function correctedRule(rule: Rule, find: string, text: string): Rule | undefined {
  const statement = replacedIn(rule.statement, find, text);
  if (statement !== undefined) {
    return statement.length > PLAN_TEMPLATE_BOUNDS.MAX_RULE_CHARS
      ? undefined
      : { ...rule, statement };
  }
  const examples = rule.examples;
  if (examples === null) return undefined;
  for (const [index, example] of examples.entries()) {
    const [given = null, when = null, then = null] = clausesOf(example).map((clause) =>
      clause === null ? null : (replacedIn(clause, find, text) ?? clause),
    );
    const corrected = { given, when, then }; // oxlint-disable-line unicorn/no-thenable -- `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
    if (clausesOf(corrected).some((clause, at) => clause !== clausesOf(example)[at])) {
      return {
        ...rule,
        examples: examples.map((standing, at) => (at === index ? corrected : standing)),
      };
    }
  }
  return undefined;
}

/** The rules with the one the phrase names struck: the rule where its statement holds it, else the example holding it. */
function rulesStruck(rules: readonly Rule[], find: string): readonly Rule[] | undefined {
  const ruleAt = rules.findIndex((rule) => located(rule.statement, find) !== undefined);
  if (ruleAt !== -1) return rules.filter((_, at) => at !== ruleAt);
  for (const [index, rule] of rules.entries()) {
    const examples = rule.examples ?? [];
    const exampleAt = examples.findIndex((example) =>
      clausesOf(example).some((clause) => clause !== null && located(clause, find) !== undefined),
    );
    if (exampleAt === -1) continue;
    const kept = examples.filter((_, at) => at !== exampleAt);
    const struckRule = { ...rule, examples: kept.length === 0 ? null : kept };
    return rules.map((standing, at) => (at === index ? struckRule : standing));
  }
  return undefined;
}

/** The rules with a note applied, or nothing where the note names no rule or no phrase in them. */
function rulesNoted(rules: readonly Rule[], note: PlanNote): readonly Rule[] | undefined {
  switch (note.kind) {
    case NOTE_KIND.ADD:
      if (note.text.length > PLAN_TEMPLATE_BOUNDS.MAX_RULE_CHARS) return undefined;
      return [...rules, { statement: note.text, examples: null }];
    case NOTE_KIND.ADD_EXAMPLE: {
      const rule = rules[note.rule - 1];
      if (rule === undefined) return undefined;
      // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
      const example = { given: note.given, when: note.when, then: note.then }; // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
      const examples = [...(rule.examples ?? []), example];
      return rules.map((standing, at) => (at === note.rule - 1 ? { ...rule, examples } : standing));
    }
    case NOTE_KIND.REPLACE:
      return replacedItem(
        rules,
        (rule) => [rule.statement, ...(rule.examples ?? []).flatMap(clausesOf)].join("\n"),
        (rule) => correctedRule(rule, note.find, note.text),
        note.find,
      );
    case NOTE_KIND.REMOVE:
      return rulesStruck(rules, note.find);
  }
}

/** A list of plain items with a note applied, or nothing where the note names no item. */
function itemsNoted<Item>(
  items: readonly Item[],
  note: PlanNote,
  textOf: (item: Item) => string,
  itemOf: (text: string) => Item,
): readonly Item[] | undefined {
  switch (note.kind) {
    case NOTE_KIND.ADD:
      return [...items, itemOf(note.text)];
    case NOTE_KIND.REPLACE:
      return replacedItem(
        items,
        textOf,
        (_, text) => {
          const changed = replacedIn(text, note.find, note.text);
          return changed === undefined ? undefined : itemOf(changed.trim());
        },
        note.find,
      );
    case NOTE_KIND.REMOVE: {
      const index = items.findIndex((item) => located(textOf(item), note.find) !== undefined);
      return index === -1 ? undefined : items.filter((_, at) => at !== index);
    }
    case NOTE_KIND.ADD_EXAMPLE:
      return undefined;
  }
}

function mapDefined<A, B>(value: A | undefined, map: (value: A) => B): B | undefined {
  return value === undefined ? undefined : map(value);
}

/** One text field with a note applied, or nothing where the note names no phrase in it. */
function textNoted(current: string | null, note: PlanNote): string | null | undefined {
  switch (note.kind) {
    case NOTE_KIND.ADD:
      return appended(current, note.text);
    case NOTE_KIND.REPLACE:
      return current === null
        ? undefined
        : mapDefined(replacedIn(current, note.find, note.text), answered);
    case NOTE_KIND.REMOVE: {
      const at = current === null ? undefined : located(current, note.find);
      return current === null || at === undefined ? undefined : answered(struck(current, at));
    }
    case NOTE_KIND.ADD_EXAMPLE:
      return undefined;
  }
}

/** Whether a list is still within the template's bound on items. */
function withinItems(items: readonly unknown[]): boolean {
  return items.length <= PLAN_TEMPLATE_BOUNDS.MAX_ITEMS;
}

/**
 * The content with one note taken, or nothing where the note cannot be: a
 * phrase it names that the field does not hold, a rule number the plan does
 * not have, or a list grown past its bound. Note that a note that cannot be
 * taken is never guessed into another, because an append standing in for a
 * correction would write the point twice.
 */
export function applyNote(content: PlanContent, note: PlanNote): PlanContent | undefined {
  const { fields, assumptions } = content;
  const field = note.kind === NOTE_KIND.ADD_EXAMPLE ? PLAN_FIELD.RULES : note.field;
  if (field === PLAN_FIELD.RULES) {
    const rules = rulesNoted(fields.rules ?? [], note);
    if (rules === undefined || !withinItems(rules)) return undefined;
    return { fields: { ...fields, rules: rules.length === 0 ? null : rules }, assumptions };
  }
  if (field === PLAN_FIELD.OPEN_QUESTIONS) {
    const questions = itemsNoted(
      fields.openQuestions,
      note,
      (text) => text,
      (text) => text,
    );
    if (questions === undefined || !withinItems(questions)) return undefined;
    return { fields: { ...fields, openQuestions: questions }, assumptions };
  }
  if (field === PLAN_FIELD.ASSUMPTIONS) {
    const noted = itemsNoted(
      assumptions,
      note,
      (item) => item.text,
      (text) => ({ text }),
    );
    if (noted === undefined || !withinItems(noted)) return undefined;
    return { fields, assumptions: noted };
  }
  if (!isTextField(field)) return undefined;
  const lens = TEXT_FIELD[field];
  const text = textNoted(lens.read(fields), note);
  return text === undefined ? undefined : { fields: lens.write(fields, text), assumptions };
}

/** Notes taken over a plan's content: the content after, and the notes that could not be taken. */
export interface NotesTaken {
  readonly content: PlanContent;
  readonly missed: readonly PlanNote[];
}

/** Every note taken in order, and the notes that could not be. */
export function applyNotes(content: PlanContent, notes: readonly PlanNote[]): NotesTaken {
  let taken = content;
  const missed: PlanNote[] = [];
  for (const note of notes) {
    const next = applyNote(taken, note);
    if (next === undefined) missed.push(note);
    else taken = next;
  }
  return { content: taken, missed };
}

const readNote = readEither(planNoteSchema, { excess: EXCESS_KEYS.DROP });

/** Text still being written, cut back to its last line that cannot change how it is escaped. */
function settledText(text: string): string {
  const lastBreak = text.lastIndexOf("\n");
  const lastLine = text.slice(lastBreak + 1);
  return MARKER_ONLY_LINE.test(lastLine) ? text.slice(0, Math.max(0, lastBreak)) : text;
}

/** The note still being written, read as an addition whose text so far can be shown, or nothing. */
function growingAddition(value: UnparsedWireValue): PlanNote | undefined {
  if (!isRecord(value) || value.kind !== NOTE_KIND.ADD || !isWireString(value.text)) {
    return undefined;
  }
  const text = settledText(value.text).trim();
  if (text.length === 0) return undefined;
  const read = readNote(unparsedWire({ ...value, text }));
  return Result.isSuccess(read) ? read.success : undefined;
}

/** An answer's notes as read, and how many of its notes did not read. */
export interface NotesRead {
  readonly notes: readonly PlanNote[];
  readonly unread: number;
}

/**
 * The notes of an answer, each read on its own so a note that does not read
 * is passed over alone rather than costing the rest, and how many were.
 */
export function readNotes(answer: UnparsedWireValue): NotesRead {
  const values = isRecord(answer) && Array.isArray(answer.notes) ? answer.notes : [];
  const notes = values.flatMap((value: UnparsedWireValue) => {
    const read = readNote(value);
    return Result.isSuccess(read) ? [read.success] : [];
  });
  return { notes: notes.slice(0, MAX_NOTES), unread: values.length - notes.length };
}

/**
 * The content as the notetaker's answer so far leaves it, for a draft drawn
 * while the answer streams. The answer arrives as the JSON emitted so far,
 * so every note before the last is whole, and each is taken in order; one
 * that does not read or cannot be taken is passed over alone. The last note
 * may be cut off partway, so it is drawn only when it adds a point, as the
 * text written so far, held back at a trailing line of nothing but Markdown
 * markers. Each draft therefore differs from the one before only where the
 * newest note lands, and nothing a draft showed is taken back until the
 * answer is saved.
 */
export function notesInProgress(content: PlanContent, partial: UnparsedWireValue): PlanContent {
  const values = isRecord(partial) && Array.isArray(partial.notes) ? partial.notes : [];
  const { notes: whole } = readNotes(unparsedWire({ notes: values.slice(0, -1) }));
  const growing = growingAddition(values.at(-1));
  return applyNotes(content, growing === undefined ? whole : [...whole, growing]).content;
}
