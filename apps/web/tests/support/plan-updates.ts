import { EMPTY_PLAN_UPDATE, type PlanUpdate } from "@sidecar/hosted/plan-template";

/**
 * plan-updates.ts -- synthetic `update_plan` arguments for the fixed template, as a planning model would send them.
 *
 * Three plans, each a whole template: an incomplete draft of teammate
 * invitations, a small feature whose inapplicable fields say why in a
 * sentence, and a bulk import whose invalid row settles an all-or-nothing
 * write. They exercise how a plan's data moves through the tool, the store,
 * and the window; neither feature exists anywhere, and nothing here is an
 * evaluation of a model. Every name, path, and commit is invented.
 */

/**
 * The headings every plan's body carries after its title, in order: the
 * fixed template's sections and fields, which no answer may add to.
 */
export const TEMPLATE_HEADINGS = [
  "## Purpose and users",
  "### Problem",
  "### Users",
  "### Outcome",
  "## Scope",
  "### Included",
  "### Excluded",
  "### Constraints",
  "## Existing system",
  "### Current behavior",
  "### Relevant code",
  "### Terminology",
  "## Behavior",
  "### Rules",
  "### Invariants",
  "### Scenarios",
  "## Data and interfaces",
  "### Data rules",
  "### Interfaces",
  "## Quality requirements",
  "### Permissions and privacy",
  "### Usability and accessibility",
  "### Performance and reliability",
  "## Implementation guidance",
  "### Approach",
  "### Decisions",
  "### Steps and dependencies",
  "### Risks and mitigations",
  "### Compatibility and migration",
  "### Rollout and recovery",
  "### Delegated choices",
  "## Acceptance",
  "### Examples",
  "### Verification",
  "## Open questions",
  "## Handoff prompt",
] as const;

/** How many ordinary answers and collections the template holds; each reads "Unanswered" while null. */
export const TEMPLATE_UNANSWERED_FIELDS = 26;

/** The section and field headings a body carries, in order, leaving out its title and any scenario or example heading. */
export function templateHeadingsOf(body: string): readonly string[] {
  return body.split("\n").filter((line) => /^#{2,3} /u.test(line));
}

/** Every line of a body that Markdown reads as a heading at the start of a line. */
export function headingLinesOf(body: string): readonly string[] {
  return body.split("\n").filter((line) => /^ {0,3}#{1,6}(?:\s|$)/u.test(line));
}

/**
 * Teammate invitations, mid-conversation: the purpose and one rule settled,
 * a scenario whose steps are not yet known, an example with no outcome yet,
 * and everything else unanswered.
 */
export const INVITATIONS_DRAFT: PlanUpdate = {
  ...EMPTY_PLAN_UPDATE,
  purpose: {
    problem: "A workspace member cannot bring a teammate in without an admin creating the account.",
    users: "Workspace members, and the teammates they invite.",
    outcome: null,
  },
  behavior: {
    rules: "Any member may invite by email.",
    invariants: null,
    scenarios: [
      {
        name: "A teammate accepts an invite",
        actor: "The invited teammate",
        startingState: "The teammate holds an unopened invite link.",
        trigger: "The teammate opens the link.",
        steps: null,
        expectedOutcome: null,
        alternativesAndFailures: null,
      },
    ],
  },
  acceptance: {
    examples: [
      {
        given: "A member sends an invite",
        when: "the teammate opens it",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the acceptance example's key in the fixed template's contract, and an example is data that is never awaited.
        then: null, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
      },
    ],
    verification: null,
  },
  openQuestions: ["Who can withdraw an invite: the member who sent it, any admin, or both?"],
  assumptions: [
    { text: "Invites reuse `memberships` with a `pending` state." },
    { text: "Only admins can invite teammates." },
  ],
};

/**
 * A small feature, settled: the inapplicable fields answer why in a sentence,
 * and the four fields a small change could leave empty say so explicitly
 * rather than inventing a risk or an alternative to fill them.
 */
export const SMALL_FEATURE: PlanUpdate = {
  purpose: {
    problem: "The empty plan list says nothing about how to start.",
    users: "Developers opening the Plans tab for the first time.",
    outcome: 'The empty list reads "No plans yet. Start one with New plan."',
  },
  scope: {
    included: "The empty-list line in the Plans tab.",
    excluded: "Any other copy in the panel.",
    constraints: "Not applicable: a copy change has no material limits beyond the line itself.",
  },
  context: {
    currentBehavior: 'Fact: the empty list reads "No plans yet."',
    relevantCode:
      "Inspected at the plan's commit: `src/renderer/planning/planning-parts.tsx` draws the line.",
    terminology: "Not applicable: no term here is ambiguous.",
  },
  behavior: {
    rules: "The line shows only while the account holds no plan.",
    invariants: "No additional invariant beyond the stated rule: the change is one string.",
    scenarios: [
      {
        name: "First visit",
        actor: "A developer with no plans",
        startingState: "The account holds no plan.",
        trigger: "The developer opens the Plans tab.",
        steps: ["The tab reads the plan list.", "The list comes back empty."],
        expectedOutcome: "The new line shows under New plan.",
        alternativesAndFailures: "A failed read shows the existing failure note instead.",
      },
    ],
  },
  dataAndInterfaces: {
    dataRules: "Not applicable: no data changes; the feature only reads the list.",
    interfaces: "Not applicable: no contract changes.",
  },
  quality: {
    permissionsAndPrivacy: "Not applicable: the line names nothing of the account.",
    usabilityAndAccessibility: "The line stays plain text a screen reader reads in place.",
    performanceAndReliability: "Not applicable: no new work is done.",
  },
  delivery: {
    approach: "Change the one string.",
    decisions: "No consequential decision: the wording was agreed as stated.",
    stepsAndDependencies: "One step, with no prerequisite: change the string and its test.",
    risksAndMitigations: "No material risk identified: the change is one string.",
    compatibilityAndMigration: "Not applicable: nothing is stored.",
    rolloutAndRecovery: "Ships with the next release; reverting the commit restores the old line.",
    delegatedChoices: "The implementing agent may choose the test's name.",
  },
  acceptance: {
    examples: [
      {
        given: "An account with no plans",
        when: "the developer opens the Plans tab",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the acceptance example's key in the fixed template's contract, and an example is data that is never awaited.
        then: 'the tab reads "No plans yet. Start one with New plan."', // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
      },
    ],
    verification: "The panel's existing layout test proves the line shows only for an empty list.",
  },
  openQuestions: [],
  handoffPrompt: null,
  assumptions: [
    { text: "Constraints do not apply to a one-line copy change." },
    { text: "No risk is worth recording for this change." },
  ],
};

/** What the bulk import's plan agrees, carried again, unchanged, into its handoff prompt. */
export const BULK_IMPORT_AGREED = {
  INVARIANT:
    "An import writes every row or none: a file with any invalid row leaves the contacts table exactly as it was.",
  DECISION:
    "Decision: validate every row, then write them in one transaction. Rationale: a half-imported file " +
    "leaves the developer unable to tell which rows landed. Alternative: import the valid rows and " +
    "report the rest. Accepted cost: one bad row blocks the whole file until it is fixed.",
  PREREQUISITE:
    "1. Establish that `ContactStore.insertMany` can run inside one transaction; nothing else starts " +
    "until a test shows a failed insert rolls every row back.\n2. Add the validation pass.\n" +
    "3. Wire the import screen to show the first invalid row.",
  RISK:
    "Hypothesis, unverified: a 50,000-row file fits in one transaction. Mitigation: a bounded " +
    "investigation loads a synthetic 50,000-row file before step 3; if it does not fit, the file size " +
    "limit is lowered and the developer decides again. Accepted: large files may be refused.",
  VERIFICATION:
    "A store test imports a file whose last row is invalid and asserts the contacts table is " +
    "unchanged, which proves the all-or-nothing invariant.",
  EVIDENCE:
    "Fact, inspected at the plan's commit: `src/contacts/store.ts` writes rows one at a time. " +
    "Hypothesis: the database driver supports nested transactions.",
} as const;

/** A bulk import that meets an invalid row: the agreed invariant, its decision, prerequisite, risk, and check, and the handoff that carries them. */
export const BULK_IMPORT: PlanUpdate = {
  ...EMPTY_PLAN_UPDATE,
  purpose: {
    problem: "Contacts are entered one at a time.",
    users: "Workspace admins moving contacts from another tool.",
    outcome: "An admin imports a CSV of contacts in one step.",
  },
  context: {
    currentBehavior: "Each contact is created through the single-contact form.",
    relevantCode: BULK_IMPORT_AGREED.EVIDENCE,
    terminology: "A row is one line of the CSV after its header.",
  },
  behavior: {
    rules: "Every row must carry a name and a valid email address.",
    invariants: BULK_IMPORT_AGREED.INVARIANT,
    scenarios: [
      {
        name: "A file with one invalid row",
        actor: "A workspace admin",
        startingState: "The contacts table holds the workspace's existing contacts.",
        trigger: "The admin uploads a CSV whose row 12 has no email address.",
        steps: ["The service validates every row.", "Row 12 fails validation."],
        expectedOutcome: "Nothing is imported, and the screen names row 12 and its missing email.",
        alternativesAndFailures:
          "Cancelling during validation imports nothing; retrying the fixed file imports every row once.",
      },
    ],
  },
  delivery: {
    ...EMPTY_PLAN_UPDATE.delivery,
    approach: "Validate the whole file first, then write it in one transaction.",
    decisions: BULK_IMPORT_AGREED.DECISION,
    stepsAndDependencies: BULK_IMPORT_AGREED.PREREQUISITE,
    risksAndMitigations: BULK_IMPORT_AGREED.RISK,
  },
  acceptance: {
    examples: [
      {
        given: "A CSV whose row 12 has no email address",
        when: "the admin imports it",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the acceptance example's key in the fixed template's contract, and an example is data that is never awaited.
        then: "no contact is added and the screen names row 12", // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
      },
    ],
    verification: BULK_IMPORT_AGREED.VERIFICATION,
  },
  handoffPrompt: [
    "**Objective:** let a workspace admin import a CSV of contacts in one step.",
    `**Invariant:** ${BULK_IMPORT_AGREED.INVARIANT}`,
    `**Why:** ${BULK_IMPORT_AGREED.DECISION}`,
    `**Steps:**\n\n${BULK_IMPORT_AGREED.PREREQUISITE}`,
    `**Accepted risk:** ${BULK_IMPORT_AGREED.RISK}`,
    `**Verification:** ${BULK_IMPORT_AGREED.VERIFICATION}`,
    `**Source:** ${BULK_IMPORT_AGREED.EVIDENCE}`,
    "If anything here conflicts with the agreed behavior, surface the conflict before overriding it.",
  ].join("\n\n"),
  assumptions: [
    { text: BULK_IMPORT_AGREED.INVARIANT },
    { text: "One invalid row blocks the whole file." },
    { text: "A 50,000-row file fits in one transaction." },
  ],
};
