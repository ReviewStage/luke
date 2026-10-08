import {
  EMPTY_PLAN_FIELDS,
  NOTE_KIND,
  PLAN_FIELD,
  type PlanContent,
  type PlanField,
  type PlanFields,
  type PlanNote,
} from "@sidecar/hosted/plan-template";

/**
 * plan-contents.ts -- synthetic plans in the fixed template, and the notes a notetaker would take to write each.
 *
 * Three plans, each a whole template: an incomplete draft of teammate
 * invitations, a small feature whose inapplicable fields say why in a
 * sentence, and a bulk import whose invalid row settles an all-or-nothing
 * write. They exercise how a plan's data moves through the notes, the store,
 * and the window; neither feature exists anywhere, and nothing here is an
 * evaluation of a model. Every name, path, and commit is invented.
 */

/** Every field holding one Markdown answer, in the template's order, with where a plan's fields keep it. */
const TEXT_FIELDS: readonly (readonly [PlanField, (fields: PlanFields) => string | null])[] = [
  [PLAN_FIELD.PROBLEM, (fields) => fields.goal.problem],
  [PLAN_FIELD.OUTCOME, (fields) => fields.goal.outcome],
  [PLAN_FIELD.INCLUDED, (fields) => fields.scope.included],
  [PLAN_FIELD.EXCLUDED, (fields) => fields.scope.excluded],
  [PLAN_FIELD.CONSTRAINTS, (fields) => fields.scope.constraints],
  [PLAN_FIELD.CHANGE_MAP, (fields) => fields.implementation.changeMap],
  [PLAN_FIELD.CONTRACTS, (fields) => fields.implementation.contracts],
  [PLAN_FIELD.PATTERNS, (fields) => fields.implementation.patterns],
  [PLAN_FIELD.ORDER, (fields) => fields.implementation.order],
  [PLAN_FIELD.DECISIONS, (fields) => fields.decisions],
  [PLAN_FIELD.VERIFICATION, (fields) => fields.verification],
  [PLAN_FIELD.LEFT_TO_AGENT, (fields) => fields.leftToAgent],
  [PLAN_FIELD.DATA_AND_MIGRATION, (fields) => fields.dataAndMigration],
];

/** A note adding one point under a field. */
export function added(field: PlanField, text: string): PlanNote {
  return { kind: NOTE_KIND.ADD, field, text };
}

/**
 * A whole plan as the notes a notetaker would take to write it into an empty
 * one: each answered text field added whole, each rule added and then each
 * of its examples by the rule's number, and each open question and
 * assumption added as its own point.
 */
export function notesFor(content: PlanContent): readonly PlanNote[] {
  const { fields, assumptions } = content;
  const texts = TEXT_FIELDS.flatMap(([field, read]) => {
    const text = read(fields);
    return text === null ? [] : [added(field, text)];
  });
  const rules = (fields.rules ?? []).flatMap((rule, index): PlanNote[] => [
    added(PLAN_FIELD.RULES, rule.statement),
    ...(rule.examples ?? []).map(
      (example): PlanNote => ({ kind: NOTE_KIND.ADD_EXAMPLE, rule: index + 1, ...example }),
    ),
  ]);
  return [
    ...texts,
    ...rules,
    ...fields.openQuestions.map((question) => added(PLAN_FIELD.OPEN_QUESTIONS, question)),
    ...assumptions.map((assumption) => added(PLAN_FIELD.ASSUMPTIONS, assumption.text)),
  ];
}

/**
 * The headings every plan's body carries after its title, in order: the
 * fixed template's core sections and fields, which no answer may add to.
 */
export const TEMPLATE_HEADINGS = [
  "## Goal",
  "### Problem",
  "### Outcome",
  "## Scope",
  "### Included",
  "### Excluded",
  "### Constraints",
  "## Rules",
  "## Implementation",
  "### Change map",
  "### Contracts",
  "### Patterns to follow",
  "## Decisions",
  "## Verification",
  "## Left to the agent",
  "## Open questions",
] as const;

/** How many core answers the template holds, the rules among them; each reads "Unanswered" while null. */
export const TEMPLATE_UNANSWERED_FIELDS = 12;

/** The section and field headings a body carries, in order, leaving out its title and each rule's heading. */
export function templateHeadingsOf(body: string): readonly string[] {
  return body.split("\n").filter((line) => /^#{2,3} (?!Rule \d)/u.test(line));
}

/** Every line of a body that Markdown reads as a heading at the start of a line. */
export function headingLinesOf(body: string): readonly string[] {
  return body.split("\n").filter((line) => /^ {0,3}#{1,6}(?:\s|$)/u.test(line));
}

/**
 * Teammate invitations, mid-conversation: the problem and one rule settled,
 * an example with no outcome yet, and everything else unanswered.
 */
export const INVITATIONS_DRAFT: PlanContent = {
  fields: {
    ...EMPTY_PLAN_FIELDS,
    goal: {
      problem:
        "A workspace member cannot bring a teammate in without an admin creating the account.",
      outcome: null,
    },
    rules: [
      {
        statement: "Any member may invite by email.",
        examples: [
          {
            given: "A member sends an invite",
            when: "the teammate opens it",
            // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
            then: null, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
          },
        ],
      },
      { statement: "A withdrawn invite's link never grants access.", examples: null },
    ],
    openQuestions: ["Who can withdraw an invite: the member who sent it, any admin, or both?"],
  },
  assumptions: [
    { text: "Invites reuse `memberships` with a `pending` state." },
    { text: "Only admins can invite teammates." },
  ],
};

/**
 * A small feature, settled: every core field answered, the inapplicable ones
 * saying why in a sentence rather than inventing a contract or a decision to
 * fill them, and no optional field.
 */
export const SMALL_FEATURE: PlanContent = {
  fields: {
    ...EMPTY_PLAN_FIELDS,
    goal: {
      problem:
        "Developers opening the Plans tab for the first time see an empty list that says nothing about how to start.",
      outcome: 'The empty list reads "No plans yet. Start one with New plan."',
    },
    scope: {
      included: "The empty-list line in the Plans tab.",
      excluded: "Any other copy in the panel.",
      constraints: "Not applicable: a copy change has no material limits beyond the line itself.",
    },
    rules: [
      {
        statement: "The line shows only while the account holds no plan.",
        examples: [
          {
            given: "An account with no plans",
            when: "the developer opens the Plans tab",
            // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
            then: 'the tab reads "No plans yet. Start one with New plan."', // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
          },
        ],
      },
    ],
    implementation: {
      changeMap: "- `src/renderer/planning/planning-parts.tsx`: the new line.",
      contracts: "Not applicable: no type, schema, or signature changes.",
      patterns: "Follow the other empty-state lines in `src/renderer/planning/planning-parts.tsx`.",
      order: null,
    },
    decisions: "No consequential decision: the wording was agreed as stated.",
    verification: "The panel's existing layout test proves the line shows only for an empty list.",
    leftToAgent: "The test's name.",
  },
  assumptions: [
    { text: "Constraints do not apply to a one-line copy change." },
    { text: "No decision is worth recording for this change." },
  ],
};

/** What the bulk import's plan agrees. */
export const BULK_IMPORT_AGREED = {
  RULE: "An import writes every row or none: a file with any invalid row leaves the contacts table exactly as it was.",
  DECISION:
    "Validate every row, then write them in one transaction. Why: a half-imported file leaves " +
    "the developer unable to tell which rows landed. Rejected: importing the valid rows and " +
    "reporting the rest.",
  CONTRACT:
    "```ts\nexport function importContacts(file: ContactFile): Effect<ImportResult, InvalidRow>;\n```",
  ORDER:
    "1. Show that `ContactStore.insertMany` rolls every row back on a failed insert; nothing " +
    "else starts until a test proves it.\n2. Add the validation pass.\n3. Wire the import " +
    "screen to show the first invalid row.",
  VERIFICATION:
    "A store test imports a file whose last row is invalid and asserts the contacts table is " +
    "unchanged, which proves the all-or-nothing rule.",
  DATA: "No column changes; the import writes existing `contacts` rows.",
} as const;

/** A bulk import that meets an invalid row: its rule, contract, decision, order, and check, with its optional sections filled. */
export const BULK_IMPORT: PlanContent = {
  fields: {
    ...EMPTY_PLAN_FIELDS,
    goal: {
      problem: "Workspace admins moving from another tool enter contacts one at a time.",
      outcome: "An admin imports a CSV of contacts in one step.",
    },
    scope: {
      included: "CSV import of contacts from the contacts screen.",
      excluded: "Other file formats, and updating contacts that already exist.",
      constraints: "Files up to 50,000 rows.",
    },
    rules: [
      {
        statement: BULK_IMPORT_AGREED.RULE,
        examples: [
          {
            given: "A CSV whose row 12 has no email address",
            when: "the admin imports it",
            // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
            then: "no contact is added and the screen names row 12", // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
          },
          {
            given: "A valid CSV of 3 rows",
            when: "the admin imports it",
            // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
            then: "the 3 contacts are added", // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
          },
        ],
      },
    ],
    implementation: {
      changeMap:
        "- `src/contacts/import.ts`: new, the validation pass and the import.\n" +
        "- `src/contacts/store.ts`: `insertMany` runs in one transaction.",
      contracts: BULK_IMPORT_AGREED.CONTRACT,
      patterns: "Follow `src/contacts/export.ts` for reading a file in rows.",
      order: BULK_IMPORT_AGREED.ORDER,
    },
    decisions: BULK_IMPORT_AGREED.DECISION,
    verification: BULK_IMPORT_AGREED.VERIFICATION,
    leftToAgent: "The wording of the invalid-row message, and internal helper names.",
    dataAndMigration: BULK_IMPORT_AGREED.DATA,
  },
  assumptions: [
    { text: BULK_IMPORT_AGREED.RULE },
    { text: "One invalid row blocks the whole file." },
    { text: "A 50,000-row file fits in one transaction." },
  ],
};
