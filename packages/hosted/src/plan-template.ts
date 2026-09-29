import { describeWire } from "@sidecar/wire/effect";
import { Schema as EffectSchema } from "effect";
import { PLAN_BOUNDS, type PlanRepository, planDocumentSchema } from "./plan-wire.js";

/**
 * plan-template.ts -- the one fixed template every feature plan is written in: the typed update the planning model sends, and the canonical Markdown body it becomes.
 *
 * Every plan has the same sections in the same order, and every named field
 * is required on every `update_plan` call, drafts included (`docs/PLANNING.md`,
 * "The fixed template"). An unanswered field is `null`, never an omitted key
 * or an empty string, and it renders as "Unanswered", so a field cannot be
 * skipped by choosing another layout. The typed update is an input format and
 * nothing more: it is formatted here into the document's Markdown `body`, and
 * the saved document stays `{ body, assumptions }` (`plan-wire.ts`). No code
 * reads the body back into fields; the model reads the canonical Markdown on
 * its next turn.
 *
 * The formatter owns every heading and its order. Field text is Markdown the
 * model wrote, contained where it stands: a line that would open a heading or
 * an HTML block is escaped, and a code fence left open is closed at the end of
 * its field, so no answer can impersonate a section or swallow the ones after
 * it. The schema guarantees shape only; whether an answer is understood or
 * agreed is the model's judgment, recorded in the assumption flags.
 */

/** Bounds on the typed update; the formatted body is held to `PLAN_BOUNDS.MAX_BODY_CHARS` after formatting. */
const PLAN_TEMPLATE_BOUNDS = {
  /** One answer may be at most the whole body; the formatted total is what is held to the body bound. */
  MAX_ANSWER_CHARS: PLAN_BOUNDS.MAX_BODY_CHARS,
  /** A scenario's name is a heading, so it is a short line. */
  MAX_SCENARIO_NAME_CHARS: 200,
  /** The most scenarios, acceptance examples, steps of one scenario, or open questions. */
  MAX_ITEMS: 200,
} as const;

/** Every heading the formatter writes, section and field alike, in the words the developer reads. */
export const PLAN_HEADING = {
  PURPOSE: "Purpose and users",
  PROBLEM: "Problem",
  USERS: "Users",
  OUTCOME: "Outcome",
  SCOPE: "Scope",
  INCLUDED: "Included",
  EXCLUDED: "Excluded",
  CONSTRAINTS: "Constraints",
  CONTEXT: "Existing system",
  CURRENT_BEHAVIOR: "Current behavior",
  RELEVANT_CODE: "Relevant code",
  TERMINOLOGY: "Terminology",
  BEHAVIOR: "Behavior",
  RULES: "Rules",
  INVARIANTS: "Invariants",
  SCENARIOS: "Scenarios",
  DATA_AND_INTERFACES: "Data and interfaces",
  DATA_RULES: "Data rules",
  INTERFACES: "Interfaces",
  QUALITY: "Quality requirements",
  PERMISSIONS_AND_PRIVACY: "Permissions and privacy",
  USABILITY_AND_ACCESSIBILITY: "Usability and accessibility",
  PERFORMANCE_AND_RELIABILITY: "Performance and reliability",
  DELIVERY: "Implementation guidance",
  APPROACH: "Approach",
  DECISIONS: "Decisions",
  STEPS_AND_DEPENDENCIES: "Steps and dependencies",
  RISKS_AND_MITIGATIONS: "Risks and mitigations",
  COMPATIBILITY_AND_MIGRATION: "Compatibility and migration",
  ROLLOUT_AND_RECOVERY: "Rollout and recovery",
  DELEGATED_CHOICES: "Delegated choices",
  ACCEPTANCE: "Acceptance",
  EXAMPLES: "Examples",
  VERIFICATION: "Verification",
  OPEN_QUESTIONS: "Open questions",
  HANDOFF_PROMPT: "Handoff prompt",
  ASSUMPTIONS: "Assumptions",
} as const;

/** The labels inside one scenario or acceptance example. */
const PLAN_LABEL = {
  SCENARIO: "Scenario",
  ACTOR: "Actor",
  STARTING_STATE: "Starting state",
  TRIGGER: "Trigger",
  STEPS: "Steps",
  EXPECTED_OUTCOME: "Expected outcome",
  ALTERNATIVES_AND_FAILURES: "Alternatives and failures",
  EXAMPLE: "Example",
  GIVEN: "Given",
  WHEN: "When",
  THEN: "Then",
} as const;

/** What stands in a field's place while it holds nothing; each is the only rendering of its empty state. */
export const PLAN_EMPTY_TEXT = {
  UNANSWERED: "_Unanswered_",
  NO_QUESTIONS: "_No additional questions recorded_",
  NOT_PREPARED: "_Not prepared_",
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

const scenarioSchema = EffectSchema.Struct({
  name: trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_SCENARIO_NAME_CHARS),
  actor: answer("Who acts: a person, an API caller, or a background process."),
  startingState: answer("What stands before the trigger."),
  trigger: answer("What starts the scenario."),
  steps: describeWire(
    EffectSchema.NullOr(nonEmptyList(trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS))),
    "The ordered steps, each nonblank. Null while unanswered.",
  ),
  expectedOutcome: answer("What the actor observes at the end."),
  alternativesAndFailures: answer(
    "What happens on the alternative, failure, cancellation, and retry paths that apply.",
  ),
});

const acceptanceExampleSchema = EffectSchema.Struct({
  given: answer("The starting situation."),
  when: answer("The action."),
  // biome-ignore lint/suspicious/noThenProperty: `then` is the acceptance example's key in the fixed template's contract, and an example is data that is never awaited.
  then: answer("The observable result."), // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
});

/**
 * The whole of an `update_plan` call: every section, every field, in the
 * template's order. A key it does not name is refused at every level, and so
 * is a missing one.
 */
export const planUpdateSchema = EffectSchema.Struct({
  purpose: EffectSchema.Struct({
    problem: answer("The current problem."),
    users: answer("The people or callers affected."),
    outcome: answer("The observable improvement."),
  }),
  scope: EffectSchema.Struct({
    included: answer("The capabilities included."),
    excluded: answer("What is explicitly excluded."),
    constraints: answer("Material limits on this change."),
  }),
  context: EffectSchema.Struct({
    currentBehavior: answer("What happens today."),
    relevantCode: answer(
      "Paths inspected at the plan's commit, or other cited evidence, with facts kept apart " +
        "from hypotheses and proposed changes.",
    ),
    terminology: answer("Terms whose meaning matters."),
  }),
  behavior: EffectSchema.Struct({
    rules: answer("The behavioral rules."),
    invariants: answer(
      "What must stay true across every scenario, including failure, cancellation, and retry " +
        "paths, and any preserved data, permission, or interface guarantee.",
    ),
    scenarios: describeWire(
      EffectSchema.NullOr(nonEmptyList(scenarioSchema)),
      "Concrete rehearsals, each exactly its name, actor, starting state, trigger, steps, " +
        "expected outcome, and alternatives and failures. Null until one is identified.",
    ),
  }),
  dataAndInterfaces: EffectSchema.Struct({
    dataRules: answer("Data ownership, validation, and lifecycle changes."),
    interfaces: answer("Affected internal or external contracts and their failure behavior."),
  }),
  quality: EffectSchema.Struct({
    permissionsAndPrivacy: answer("Applicable permission and privacy expectations."),
    usabilityAndAccessibility: answer("Applicable usability and accessibility expectations."),
    performanceAndReliability: answer(
      "Applicable performance and reliability bounds, cited or agreed, never invented.",
    ),
  }),
  delivery: EffectSchema.Struct({
    approach: answer("The overall design."),
    decisions: answer(
      "Each consequential choice: the decision, its rationale, a relevant alternative, and its " +
        "accepted cost.",
    ),
    stepsAndDependencies: answer(
      "The ordered implementation sequence, each step's prerequisites, and the observable " +
        "result that lets dependent work proceed.",
    ),
    risksAndMitigations: answer(
      "Material uncertainties, how they are investigated or bounded, and the risk accepted.",
    ),
    compatibilityAndMigration: answer("Compatibility and migration needs."),
    rolloutAndRecovery: answer("How the change is delivered and recovered from."),
    delegatedChoices: answer("The precise freedom left to the implementing agent."),
  }),
  acceptance: EffectSchema.Struct({
    examples: describeWire(
      EffectSchema.NullOr(nonEmptyList(acceptanceExampleSchema)),
      "Concrete acceptance examples, each exactly given, when, and then. Null until one is identified.",
    ),
    verification: answer(
      "The checks that establish the important rules and invariants, and what each proves.",
    ),
  }),
  openQuestions: describeWire(
    EffectSchema.Array(trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS)).check(
      EffectSchema.isMaxLength(PLAN_TEMPLATE_BOUNDS.MAX_ITEMS),
    ),
    "Unresolved questions, contradictions, or facts no source could settle; empty when none.",
  ),
  handoffPrompt: describeWire(
    EffectSchema.NullOr(trimmedText(PLAN_TEMPLATE_BOUNDS.MAX_ANSWER_CHARS)),
    "The self-contained Markdown prompt for a coding agent, written only after the spoken " +
      "review. Null until prepared.",
  ),
  assumptions: describeWire(
    planDocumentSchema.fields.assumptions,
    "Every assumption the plan holds, in order, each its text and whether the developer " +
      "confirmed it.",
  ),
});

export type PlanUpdate = typeof planUpdateSchema.Type;
type Scenario = typeof scenarioSchema.Type;
type AcceptanceExample = typeof acceptanceExampleSchema.Type;

/** What the document's header names: the plan and the source it was read at, the service's and never the model's. */
export interface PlanHeader {
  readonly name: string;
  readonly repository: PlanRepository;
}

/** A new plan's update: every answer unanswered, no questions, no handoff, no assumptions. */
export const EMPTY_PLAN_UPDATE: PlanUpdate = {
  purpose: { problem: null, users: null, outcome: null },
  scope: { included: null, excluded: null, constraints: null },
  context: { currentBehavior: null, relevantCode: null, terminology: null },
  behavior: { rules: null, invariants: null, scenarios: null },
  dataAndInterfaces: { dataRules: null, interfaces: null },
  quality: {
    permissionsAndPrivacy: null,
    usabilityAndAccessibility: null,
    performanceAndReliability: null,
  },
  delivery: {
    approach: null,
    decisions: null,
    stepsAndDependencies: null,
    risksAndMitigations: null,
    compatibilityAndMigration: null,
    rolloutAndRecovery: null,
    delegatedChoices: null,
  },
  acceptance: { examples: null, verification: null },
  openQuestions: [],
  handoffPrompt: null,
  assumptions: [],
};

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

function labelled(label: string, block: string): string {
  return `**${label}**\n\n${block}`;
}

/** One list item, its later lines indented under the marker so a multi-line entry stays one item. */
function listItem(marker: string, text: string): string {
  const [first, ...rest] = contained(text).split("\n");
  const indent = " ".repeat(marker.length);
  const continued = rest.map((line) => (line.length === 0 ? line : `${indent}${line}`));
  return [`${marker}${first ?? ""}`, ...continued].join("\n");
}

function orderedList(items: readonly string[]): string {
  return items.map((item, index) => listItem(`${index + 1}. `, item)).join("\n");
}

function scenarioBlock(scenario: Scenario, index: number): string {
  return [
    `#### ${PLAN_LABEL.SCENARIO} ${index + 1}: ${oneLine(scenario.name)}`,
    labelled(PLAN_LABEL.ACTOR, answerBlock(scenario.actor)),
    labelled(PLAN_LABEL.STARTING_STATE, answerBlock(scenario.startingState)),
    labelled(PLAN_LABEL.TRIGGER, answerBlock(scenario.trigger)),
    labelled(
      PLAN_LABEL.STEPS,
      scenario.steps === null ? PLAN_EMPTY_TEXT.UNANSWERED : orderedList(scenario.steps),
    ),
    labelled(PLAN_LABEL.EXPECTED_OUTCOME, answerBlock(scenario.expectedOutcome)),
    labelled(PLAN_LABEL.ALTERNATIVES_AND_FAILURES, answerBlock(scenario.alternativesAndFailures)),
  ].join("\n\n");
}

function exampleBlock(example: AcceptanceExample, index: number): string {
  return [
    `#### ${PLAN_LABEL.EXAMPLE} ${index + 1}`,
    labelled(PLAN_LABEL.GIVEN, answerBlock(example.given)),
    labelled(PLAN_LABEL.WHEN, answerBlock(example.when)),
    labelled(PLAN_LABEL.THEN, answerBlock(example.then)),
  ].join("\n\n");
}

function collection<Item>(
  items: readonly Item[] | null,
  block: (item: Item, index: number) => string,
): string {
  return items === null ? PLAN_EMPTY_TEXT.UNANSWERED : items.map(block).join("\n\n");
}

function headerBlock(header: PlanHeader): string {
  const { repository } = header;
  return [
    `# ${oneLine(header.name)}`,
    `Repository: ${repository.owner}/${repository.name}, branch ${repository.branch} at commit ${repository.commit}`,
  ].join("\n\n");
}

/**
 * The canonical Markdown body of a plan: the header the service supplies,
 * then every section and field in the template's order, whatever order the
 * update's keys arrived in. The assumptions are not part of the body; they
 * are the document's own list, drawn after it as the template's last section.
 */
export function planBody(header: PlanHeader, update: PlanUpdate): string {
  const { purpose, scope, context, behavior, dataAndInterfaces, quality, delivery } = update;
  const { acceptance, openQuestions, handoffPrompt } = update;
  const blocks = [
    headerBlock(header),
    section(PLAN_HEADING.PURPOSE, [
      field(PLAN_HEADING.PROBLEM, answerBlock(purpose.problem)),
      field(PLAN_HEADING.USERS, answerBlock(purpose.users)),
      field(PLAN_HEADING.OUTCOME, answerBlock(purpose.outcome)),
    ]),
    section(PLAN_HEADING.SCOPE, [
      field(PLAN_HEADING.INCLUDED, answerBlock(scope.included)),
      field(PLAN_HEADING.EXCLUDED, answerBlock(scope.excluded)),
      field(PLAN_HEADING.CONSTRAINTS, answerBlock(scope.constraints)),
    ]),
    section(PLAN_HEADING.CONTEXT, [
      field(PLAN_HEADING.CURRENT_BEHAVIOR, answerBlock(context.currentBehavior)),
      field(PLAN_HEADING.RELEVANT_CODE, answerBlock(context.relevantCode)),
      field(PLAN_HEADING.TERMINOLOGY, answerBlock(context.terminology)),
    ]),
    section(PLAN_HEADING.BEHAVIOR, [
      field(PLAN_HEADING.RULES, answerBlock(behavior.rules)),
      field(PLAN_HEADING.INVARIANTS, answerBlock(behavior.invariants)),
      field(PLAN_HEADING.SCENARIOS, collection(behavior.scenarios, scenarioBlock)),
    ]),
    section(PLAN_HEADING.DATA_AND_INTERFACES, [
      field(PLAN_HEADING.DATA_RULES, answerBlock(dataAndInterfaces.dataRules)),
      field(PLAN_HEADING.INTERFACES, answerBlock(dataAndInterfaces.interfaces)),
    ]),
    section(PLAN_HEADING.QUALITY, [
      field(PLAN_HEADING.PERMISSIONS_AND_PRIVACY, answerBlock(quality.permissionsAndPrivacy)),
      field(
        PLAN_HEADING.USABILITY_AND_ACCESSIBILITY,
        answerBlock(quality.usabilityAndAccessibility),
      ),
      field(
        PLAN_HEADING.PERFORMANCE_AND_RELIABILITY,
        answerBlock(quality.performanceAndReliability),
      ),
    ]),
    section(PLAN_HEADING.DELIVERY, [
      field(PLAN_HEADING.APPROACH, answerBlock(delivery.approach)),
      field(PLAN_HEADING.DECISIONS, answerBlock(delivery.decisions)),
      field(PLAN_HEADING.STEPS_AND_DEPENDENCIES, answerBlock(delivery.stepsAndDependencies)),
      field(PLAN_HEADING.RISKS_AND_MITIGATIONS, answerBlock(delivery.risksAndMitigations)),
      field(
        PLAN_HEADING.COMPATIBILITY_AND_MIGRATION,
        answerBlock(delivery.compatibilityAndMigration),
      ),
      field(PLAN_HEADING.ROLLOUT_AND_RECOVERY, answerBlock(delivery.rolloutAndRecovery)),
      field(PLAN_HEADING.DELEGATED_CHOICES, answerBlock(delivery.delegatedChoices)),
    ]),
    section(PLAN_HEADING.ACCEPTANCE, [
      field(PLAN_HEADING.EXAMPLES, collection(acceptance.examples, exampleBlock)),
      field(PLAN_HEADING.VERIFICATION, answerBlock(acceptance.verification)),
    ]),
    section(PLAN_HEADING.OPEN_QUESTIONS, [
      openQuestions.length === 0
        ? PLAN_EMPTY_TEXT.NO_QUESTIONS
        : openQuestions.map((question) => listItem("- ", question)).join("\n"),
    ]),
    section(PLAN_HEADING.HANDOFF_PROMPT, [
      handoffPrompt === null ? PLAN_EMPTY_TEXT.NOT_PREPARED : contained(handoffPrompt),
    ]),
  ];
  return `${blocks.join("\n\n")}\n`;
}
