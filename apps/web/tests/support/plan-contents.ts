import {
  EMPTY_PLAN_FIELDS,
  NOTE_KIND,
  PLAN_TEXT_FIELDS,
  type PlanContent,
  type PlanNote,
} from "@sidecar/hosted/plan-template";
import { PLAN_FIELD, type PlanField } from "@sidecar/hosted/plan-wire";

/**
 * plan-contents.ts -- synthetic plans in the fixed template, and the notes a notetaker would take to write each.
 *
 * Three plans, each a whole template: an incomplete draft of teammate
 * invitations, a small feature whose inapplicable sections say why in a
 * sentence, and a bulk import whose invalid row settles an all-or-nothing
 * write. They exercise how a plan's data moves through the notes, the store,
 * and the window; neither feature exists anywhere, and nothing here is an
 * evaluation of a model. Every name, path, and commit is invented.
 */

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
  const texts = PLAN_TEXT_FIELDS.flatMap((field) => {
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
 * settled, and every other section unanswered.
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
 * A small feature, settled: every core section answered, the inapplicable
 * ones saying why in a sentence rather than inventing an interface or a
 * decision to fill them, and no optional section.
 */
export const SMALL_FEATURE: PlanContent = {
  fields: {
    ...EMPTY_PLAN_FIELDS,
    context:
      "Developers opening the Plans tab for the first time see an empty list that says nothing about how to start.",
    goal: 'The empty list reads "No plans yet. Start one with New plan."',
    approach:
      "- `src/renderer/planning/planning-parts.tsx`: the new line, following the other " +
      "empty-state lines in that file.\n" +
      "- No consequential decision: the wording was agreed as stated.",
    interfaces: "None: no type, schema, or signature changes.",
    hardParts: "- The line shows only while the account holds no plan.",
    notDoing: "- Any other copy in the panel.",
    testing:
      "The panel's existing layout test proves the tab reads \"No plans yet. Start one with " +
      'New plan." only for an empty list.',
  },
  assumptions: [
    { text: "No interface changes for a one-line copy change." },
    { text: "No decision is worth recording for this change." },
  ],
};

/** What the bulk import's plan agrees. */
export const BULK_IMPORT_AGREED = {
  HARD_PART:
    "- An import writes every row or none: a file with any invalid row leaves the contacts table exactly as it was.",
  APPROACH:
    "- `src/contacts/import.ts`: new, the validation pass and the import, reading the file in " +
    "rows as `src/contacts/export.ts` does.\n" +
    "- `src/contacts/store.ts`: `insertMany` runs in one transaction.\n\n" +
    "Validate every row, then write them in one transaction. Why: a half-imported file leaves " +
    "the developer unable to tell which rows landed.",
  INTERFACE:
    "```ts\nexport function importContacts(file: ContactFile): Effect<ImportResult, InvalidRow>;\n```",
  ALTERNATIVE:
    "- Importing the valid rows and reporting the rest: lost to the all-or-nothing write.",
  ORDER:
    "1. Show that `ContactStore.insertMany` rolls every row back on a failed insert; nothing " +
    "else starts until a test proves it.\n2. Add the validation pass.\n3. Wire the import " +
    "screen to show the first invalid row.",
  TESTING:
    "- When a CSV whose row 12 has no email address is imported, then no contact is added and " +
    "the screen names row 12.\n" +
    "- When a valid CSV of 3 rows is imported, then the 3 contacts are added.\n" +
    "- A store test imports a file whose last row is invalid and asserts the contacts table is " +
    "unchanged.",
} as const;

/** A bulk import that meets an invalid row: its hard part, interface, approach, order, and tests, with its optional sections filled. */
export const BULK_IMPORT: PlanContent = {
  fields: {
    ...EMPTY_PLAN_FIELDS,
    context: "Workspace admins moving from another tool enter contacts one at a time.",
    goal: "An admin imports a CSV of contacts in one step.",
    approach: BULK_IMPORT_AGREED.APPROACH,
    interfaces: BULK_IMPORT_AGREED.INTERFACE,
    alternatives: BULK_IMPORT_AGREED.ALTERNATIVE,
    hardParts: `${BULK_IMPORT_AGREED.HARD_PART}\n- Files up to 50,000 rows.`,
    notDoing: "- Other file formats.\n- Updating contacts that already exist.",
    planOfAttack: BULK_IMPORT_AGREED.ORDER,
    testing: BULK_IMPORT_AGREED.TESTING,
  },
  assumptions: [
    { text: "An import writes every row or none." },
    { text: "One invalid row blocks the whole file." },
    { text: "A 50,000-row file fits in one transaction." },
  ],
};
