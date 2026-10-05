import { describeWire } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Struct } from "effect";
import { PLAN_BOUNDS, planDocumentSchema } from "./plan-wire.js";

/**
 * plan-template.ts -- the one fixed template every feature plan is written in: the typed update the planning model sends, and the canonical Markdown body it becomes.
 *
 * Every plan has the same sections in the same order (`docs/PLANNING.md`,
 * "The fixed template"). The service keeps the plan's fields as they stand,
 * and an `update_plan` call names only what it changes: a key left out keeps
 * its value, `null` clears it, and a list sent is the whole list. A core
 * field reads "Unanswered" while null; an optional field is left out of the
 * body until it holds something. The merged fields are formatted here into
 * the document's Markdown `body`, and the document the window and the model
 * read stays `{ body, assumptions }` (`plan-wire.ts`). No code reads the body
 * back into fields.
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
 * it. The schema guarantees shape only; whether an answer is understood or
 * agreed is the model's judgment.
 */

/** Bounds on the typed update; the formatted body is held to `PLAN_BOUNDS.MAX_BODY_CHARS` after formatting. */
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

/** One field of the template, described to the model in the words of what it must establish. */
function answer(description: string) {
  return describeWire(ANSWER, `${description} Null while unanswered.`);
}

/** One clause of an example, null while unknown. */
function examplePart(description: string) {
  return describeWire(
    EffectSchema.NullOr(trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_EXAMPLE_PART_CHARS)),
    `${description} One line. Null while unknown.`,
  );
}

const exampleSchema = EffectSchema.Struct({
  given: examplePart("The starting situation."),
  when: examplePart("The action."),
  // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
  then: examplePart("The observable result."), // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
});

const ruleSchema = EffectSchema.Struct({
  statement: describeWire(
    trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_RULE_CHARS),
    "The rule as one sentence that holds in every case, failure, cancellation, and retry included.",
  ),
  examples: describeWire(
    EffectSchema.NullOr(nonEmptyList(exampleSchema)),
    "Concrete examples that pin the rule, each exactly given, when, and then; more of them " +
      "where the rule is ambiguous or two implementations could read it differently. Null " +
      "until one is agreed.",
  ),
});

/** Every section and field of the template, in its order: what the service keeps for a plan. */
export const planFieldsSchema = EffectSchema.Struct({
  goal: EffectSchema.Struct({
    problem: answer("The current problem, and who it affects."),
    outcome: answer("The observable improvement once the change ships."),
  }),
  scope: EffectSchema.Struct({
    included: answer("What the change includes."),
    excluded: answer("What is explicitly out of scope."),
    constraints: answer(
      "Limits the change must respect: permissions, privacy, performance, compatibility. " +
        "Only those that apply, cited or agreed, never invented.",
    ),
  }),
  rules: describeWire(
    EffectSchema.NullOr(nonEmptyList(ruleSchema)),
    "The behavioral rules, each with the examples that pin it. Null until one is agreed.",
  ),
  implementation: EffectSchema.Struct({
    changeMap: answer(
      "Each repository-relative path the change touches or adds, and what it gets there.",
    ),
    contracts: answer(
      "New or changed types, schema, and signatures at module boundaries, written as code in " +
        "fenced blocks against the plan's commit. Signatures only, never function bodies.",
    ),
    patterns: answer("Existing code to follow, by path, and what to copy from it."),
    order: answer(
      "Only where one step must land before another: the steps in order and why. Left out of " +
        "the document while null.",
    ),
  }),
  decisions: answer("Each consequential choice: the decision, why, and the alternative rejected."),
  verification: answer(
    "The end-to-end check that proves the change works, beyond the examples passing.",
  ),
  leftToAgent: answer(
    "Exactly which choices the implementing agent may make itself; everything else is fixed.",
  ),
  openQuestions: describeWire(
    EffectSchema.Array(trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS)).check(
      EffectSchema.isMaxLength(PLAN_TEMPLATE_BOUNDS.MAX_ITEMS),
    ),
    "Unresolved questions, contradictions, or facts no source could settle; empty when none.",
  ),
  dataAndMigration: answer(
    "Only when stored data changes: what is stored, how existing data moves, and how the " +
      "change is undone. Left out of the document while null.",
  ),
});

/** A section whose every field may be left out, and which may itself be left out. */
function partialSection<Fields extends EffectSchema.Struct.Fields>(
  section: EffectSchema.Struct<Fields>,
) {
  return EffectSchema.optionalKey(section.mapFields(Struct.map(EffectSchema.optionalKey)));
}

/**
 * The whole of an `update_plan` call: any section, any field within it, and
 * the assumptions, each left out to keep what stands. A key the template does
 * not name is refused at every level.
 */
export const planUpdateSchema = EffectSchema.Struct({
  goal: partialSection(planFieldsSchema.fields.goal),
  scope: partialSection(planFieldsSchema.fields.scope),
  rules: EffectSchema.optionalKey(planFieldsSchema.fields.rules),
  implementation: partialSection(planFieldsSchema.fields.implementation),
  decisions: EffectSchema.optionalKey(planFieldsSchema.fields.decisions),
  verification: EffectSchema.optionalKey(planFieldsSchema.fields.verification),
  leftToAgent: EffectSchema.optionalKey(planFieldsSchema.fields.leftToAgent),
  openQuestions: EffectSchema.optionalKey(planFieldsSchema.fields.openQuestions),
  dataAndMigration: EffectSchema.optionalKey(planFieldsSchema.fields.dataAndMigration),
  assumptions: EffectSchema.optionalKey(
    describeWire(
      planDocumentSchema.fields.assumptions,
      "Every assumption the plan holds, in order, each its text. Sent whole when any changes.",
    ),
  ),
});

export type PlanFields = typeof planFieldsSchema.Type;
export type PlanUpdate = typeof planUpdateSchema.Type;
type Rule = typeof ruleSchema.Type;
type Example = typeof exampleSchema.Type;

/** What the document's header names: the plan, the service's and never the model's. */
export interface PlanHeader {
  readonly name: string;
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

/** An update that names every field and the assumptions: the whole template at once. */
export type FullPlanUpdate = PlanFields & Required<Pick<PlanUpdate, "assumptions">>;

/** The whole template as one update, every field unanswered and no assumptions. */
export const EMPTY_PLAN_UPDATE: FullPlanUpdate = { ...EMPTY_PLAN_FIELDS, assumptions: [] };

/**
 * The fields an update leaves standing: each section's fields merged over
 * what stood, and a top-level field or list replaced where it was sent.
 */
export function mergePlanFields(stored: PlanFields, update: PlanUpdate): PlanFields {
  const { goal, scope, implementation, assumptions: _assumptions, ...whole } = update;
  return {
    ...stored,
    ...whole,
    goal: { ...stored.goal, ...goal },
    scope: { ...stored.scope, ...scope },
    implementation: { ...stored.implementation, ...implementation },
  };
}

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
