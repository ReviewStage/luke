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
 * invitations, a small feature whose inapplicable field says why in a
 * sentence, and a bulk import whose invalid row settles an all-or-nothing
 * write. They exercise how a plan's data moves through the notes, the store,
 * and the window; neither feature exists anywhere, and nothing here is an
 * evaluation of a model. Every name, path, and commit is invented.
 */

/** Every field holding one Markdown answer, in the template's order. */
const TEXT_FIELDS = [
  PLAN_FIELD.CONTEXT,
  PLAN_FIELD.GOAL,
  PLAN_FIELD.APPROACH,
  PLAN_FIELD.INTERFACES,
  PLAN_FIELD.ALTERNATIVES,
  PLAN_FIELD.HARD_PARTS,
  PLAN_FIELD.NOT_DOING,
  PLAN_FIELD.PLAN_OF_ATTACK,
  PLAN_FIELD.TESTING,
] as const satisfies readonly (PlanField & keyof PlanFields)[];

/** A note adding one point under a field. */
export function added(field: PlanField, text: string): PlanNote {
  return { kind: NOTE_KIND.ADD, field, text };
}

/**
 * A whole plan as the notes a notetaker would take to write it into an empty
 * one: each answered text field added whole, and each open question and
 * assumption added as its own point.
 */
export function notesFor(content: PlanContent): readonly PlanNote[] {
  const { fields, assumptions } = content;
  const texts = TEXT_FIELDS.flatMap((field) => {
    const text = fields[field];
    return text === null ? [] : [added(field, text)];
  });
  return [
    ...texts,
    ...fields.openQuestions.map((question) => added(PLAN_FIELD.OPEN_QUESTIONS, question)),
    ...assumptions.map((assumption) => added(PLAN_FIELD.ASSUMPTIONS, assumption.text)),
  ];
}

/**
 * The headings every plan's body carries after its title, in order: the
 * fixed template's core sections, which no answer may add to.
 */
export const TEMPLATE_HEADINGS = [
  "## Context",
  "## Goal",
  "## Approach",
  "## Interfaces",
  "## Hard parts",
  "## Not doing",
  "## Testing",
  "## Open questions",
] as const;

/** How many core answers the template holds; each reads "Unanswered" while null. */
export const TEMPLATE_UNANSWERED_FIELDS = 7;

/** The section headings a body carries, in order, leaving out its title. */
export function templateHeadingsOf(body: string): readonly string[] {
  return body.split("\n").filter((line) => line.startsWith("## "));
}

/** Every line of a body that Markdown reads as a heading at the start of a line. */
export function headingLinesOf(body: string): readonly string[] {
  return body.split("\n").filter((line) => /^ {0,3}#{1,6}(?:\s|$)/u.test(line));
}

/**
 * Teammate invitations, mid-conversation: the context and two hard parts
 * settled, an open question, and everything else unanswered.
 */
export const INVITATIONS_DRAFT: PlanContent = {
  fields: {
    ...EMPTY_PLAN_FIELDS,
    context: "A workspace member cannot bring a teammate in without an admin creating the account.",
    hardParts:
      "- Any member may invite by email.\n- A withdrawn invite's link never grants access.",
    openQuestions: ["Who can withdraw an invite: the member who sent it, any admin, or both?"],
  },
  assumptions: [
    { text: "Invites reuse `memberships` with a `pending` state." },
    { text: "Only admins can invite teammates." },
  ],
};

/**
 * A small feature, settled: every core field answered, the inapplicable ones
 * saying why in a sentence rather than inventing a hard part to fill it, and
 * no optional field.
 */
export const SMALL_FEATURE: PlanContent = {
  fields: {
    ...EMPTY_PLAN_FIELDS,
    context:
      "Developers opening the Plans tab for the first time see an empty list that says nothing about how to start.",
    goal: 'The empty list reads "No plans yet. Start one with New plan."',
    approach:
      "- `src/renderer/planning/planning-parts.tsx`: the new line, following the other " +
      "empty-state lines there.",
    interfaces: "None: a copy change touches no type, schema, or signature.",
    hardParts: "Not applicable: a copy change has no edge case beyond the line itself.",
    notDoing: "Any other copy in the panel.",
    testing:
      "The panel's existing layout test proves the line shows only for an empty list: an " +
      'account with no plans reads "No plans yet. Start one with New plan."',
  },
  assumptions: [
    { text: "Hard parts do not apply to a one-line copy change." },
    { text: "No alternative is worth recording for this change." },
  ],
};

/** What the bulk import's plan agrees. */
export const BULK_IMPORT_AGREED = {
  RULE: "An import writes every row or none: a file with any invalid row leaves the contacts table exactly as it was.",
  DECISION:
    "Validate every row, then write them in one transaction, because a half-imported file " +
    "leaves the developer unable to tell which rows landed.",
  CONTRACT:
    "```ts\nexport function importContacts(file: ContactFile): Effect<ImportResult, InvalidRow>;\n```",
  ALTERNATIVE:
    "Importing the valid rows and reporting the rest: the developer could not tell which rows landed.",
  ORDER:
    "1. Show that `ContactStore.insertMany` rolls every row back on a failed insert; nothing " +
    "else starts until a test proves it.\n2. Add the validation pass.\n3. Wire the import " +
    "screen to show the first invalid row.",
  TESTING:
    "A store test imports a file whose last row is invalid and asserts the contacts table is " +
    "unchanged, which proves the all-or-nothing rule.",
} as const;

/** A bulk import that meets an invalid row: its rule, contract, decision, order, and check, with its optional sections filled. */
export const BULK_IMPORT: PlanContent = {
  fields: {
    ...EMPTY_PLAN_FIELDS,
    context: "Workspace admins moving from another tool enter contacts one at a time.",
    goal: "An admin imports a CSV of contacts in one step.",
    approach:
      `${BULK_IMPORT_AGREED.DECISION}\n\n` +
      "- `src/contacts/import.ts`: new, the validation pass and the import.\n" +
      "- `src/contacts/store.ts`: `insertMany` runs in one transaction.\n" +
      "- Follow `src/contacts/export.ts` for reading a file in rows.",
    interfaces: `\`src/contacts/import.ts\`:\n\n${BULK_IMPORT_AGREED.CONTRACT}`,
    alternatives: BULK_IMPORT_AGREED.ALTERNATIVE,
    hardParts:
      `- ${BULK_IMPORT_AGREED.RULE} A CSV whose row 12 has no email address adds no contact ` +
      "and the screen names row 12.\n- Files up to 50,000 rows.",
    notDoing: "Other file formats, and updating contacts that already exist.",
    planOfAttack: BULK_IMPORT_AGREED.ORDER,
    testing: BULK_IMPORT_AGREED.TESTING,
  },
  assumptions: [
    { text: BULK_IMPORT_AGREED.RULE },
    { text: "One invalid row blocks the whole file." },
    { text: "A 50,000-row file fits in one transaction." },
  ],
};
