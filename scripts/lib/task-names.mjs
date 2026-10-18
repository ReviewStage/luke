import path from "node:path";
import ts from "typescript";

/**
 * task-names.mjs -- the names that call the unit of work a plan, refused.
 *
 * The unit of work is a task, and a plan is the document inside it
 * (`docs/TASKS.md`). The rename from plan to task (LUKE-369) had to be
 * finished twice by hand because new code kept arriving with the old names, so
 * this check refuses a plan-shaped identifier or file name unless the name is
 * the document's, a wire or stored spelling, or a word that is not the concept.
 *
 * A name is plan-shaped when one of its words, split at camelCase,
 * SCREAMING_SNAKE, and kebab boundaries, is in `PLAN_WORDS`. A bare `plan` or
 * `plans` is left alone, since it is as often the document's text or a wire key
 * as a task, and its name cannot say which. Identifiers are read off the AST,
 * so a string's words, a comment, and JSX text never count.
 *
 * In `packages/database/src/schemas` it also refuses a string literal that
 * names a plan-spelled table, column, or index the document does not own,
 * since that is where a new schema would bring the old name back, and no
 * identifier would show it.
 *
 * Every allowance below says why it holds. A clearly document word holds
 * anywhere; a word that could as well name a part of a task holds only in the
 * files that use it for the document.
 */

/** The words that make a name plan-shaped. */
const PLAN_WORDS = new Set(["plan", "plans", "planner", "planners", "planning", "planless"]);

/** The names too often the document's text or a wire key for the name alone to tell. */
const BARE = new Set(["plan", "plans"]);

/**
 * The words that, right after `plan`, say the name is the document's: its
 * text and template, its history and revisions, its pages, pictures, and
 * comments, and its editor. These hold anywhere.
 */
const DOCUMENT_AFTER = new Set([
  "assumption",
  "attachment",
  "attachments",
  "comment",
  "comments",
  "diff",
  "document",
  "documents",
  "draft",
  "drafted",
  "edit",
  "editing",
  "editor",
  "edits",
  "field",
  "heading",
  "history",
  "last",
  "markdown",
  "note",
  "notes",
  "of",
  "page",
  "pages",
  "picture",
  "pictures",
  "revision",
  "revisions",
  "save",
  "scribe",
  "section",
  "sections",
  "snapshot",
  "template",
  "text",
]);

/** The words that, right before `plan`, say the name acts on the document: `edit_plan`, Copy plan, Add to plan, and a bound per plan. */
const DOCUMENT_BEFORE = new Set(["copy", "edit", "per", "to"]);

/** AI Elements' Plan card, which draws the plan an agent is handed, and the two places that draw it. */
const PLAN_CARD_FILES = [
  "apps/desktop/src/renderer/ai-elements/plan.tsx",
  "apps/desktop/src/renderer/tasks/agent-tab.tsx",
  "apps/desktop/src/renderer/tasks/replay-card.tsx",
];

/**
 * Words after `plan` that could as well name a part of a task, each held only
 * in the files, or under the directories, that use it for the document.
 */
const SCOPED_AFTER = {
  body: PLAN_CARD_FILES,
  card: PLAN_CARD_FILES,
  content: PLAN_CARD_FILES,
  header: PLAN_CARD_FILES,
  icon: PLAN_CARD_FILES,
  title: PLAN_CARD_FILES,
  // The line under the plan's title: who started its task and who last edited it.
  byline: ["apps/desktop/src/renderer/tasks/plan-body.tsx"],
  // The Plan tab's row, and the shell's toggle onto the document.
  row: ["apps/desktop/src/renderer/desktop/main-tabs.tsx"],
  toggle: ["apps/desktop/src/renderer/desktop/desktop-shell.tsx"],
  // The New task dialog's Plan switch, in its test.
  switch: ["apps/desktop/src/renderer/tasks/new-task-dialog.test.ts"],
  // Who wrote a revision of the plan, and a save that lost to another or was not made.
  writer: [
    "packages/database/src/models/plan-revisions.ts",
    "packages/service/src/tasks/plan-notes.ts",
    "packages/service/src/tasks/plan-revisions.test.ts",
  ],
  conflict: ["packages/service/src/tasks/plan-notes.ts"],
  not: ["packages/service/src/tasks/plan-notes.ts"],
  // The plan as an agent is handed it, and the budget a mention quotes it under.
  brief: ["packages/service/src/agents/coder-host/start.ts"],
  chars: ["packages/service/src/agents/mentioned-context.ts"],
  // The plan's tools, offered to an agent handed its plan.
  tools: ["apps/dev/host.ts", "apps/dev/tools/edit_plan.ts", "apps/dev/tools/show_page.ts"],
  // The plan editor's own `@`, and the words it shows in an empty plan.
  mentions: ["apps/desktop/src/renderer/plan-editor/"],
  placeholder: ["apps/desktop/src/renderer/plan-editor/"],
  // The document the brain eval saves, and the words it looks for in it.
  saved: ["apps/luke/evals/brain-host.eval.ts"],
  words: ["apps/luke/evals/brain-host.eval.ts"],
  // The migration that named a plan's row a task, the tests that walk it back,
  // and the test of the migration that moved a plan's pin to its reader, by its recorded name.
  to: ["packages/database/src/"],
  pin: ["apps/web/tests/plan-pin-backfill-migration.test.ts"],
};

/**
 * Document names spread too wide to hold by file: the plan's body and its
 * diagrams as the desktop draws them, a mention of the whole plan or one of
 * its sections, an agent's edit as the plan's history records it, and who
 * made a revision.
 */
const DOCUMENT_NAME = new Set([
  "PLAN_ACTOR",
  "PlanActor",
  "PlanAgentEdit",
  "PlanBody",
  "PlanDiagram",
  "PlanMention",
  "planAgentEditSchema",
]);

/** The files of the plan's body and of its diagrams, named for them. */
const DOCUMENT_FILE = /^plan-(body|diagram)(-[a-z]+)?$/;

/**
 * Wire and stored spellings of a task, kept until a version gate retires them,
 * each held only where its value is read or written. `undefined` is
 * everywhere, for the two the wire's readers and writers share across the
 * repository: a task's id, and the start's Plan switch.
 */
const WIRE_NAME = {
  planId: undefined,
  planning: undefined,
  // An automation run's task name (`automation-wire.ts`), and the fixtures that build one.
  planName: [
    "packages/features/src/automation-wire.ts",
    "packages/features/src/automation-client.test.ts",
    "packages/features/src/automation-draft-model.test.ts",
    "packages/features/src/automation-list-model.test.ts",
    "packages/host/src/compose-automations.test.ts",
    "packages/service/src/automations/automations-app.ts",
    "packages/service/src/automations/automations-app.test.ts",
    "apps/desktop/src/renderer/desktop/automations-page.test.ts",
    "apps/desktop/src/renderer/desktop/command-palette.test.ts",
    "apps/desktop/src/renderer/desktop/desktop-agent-page.test.ts",
    "apps/desktop/src/renderer/desktop/desktop-home.test.ts",
    "apps/desktop/src/renderer/desktop/desktop-inbox.test.ts",
    "apps/desktop/src/renderer/desktop/person-page.test.ts",
    "apps/desktop/src/renderer/settings/workspace-page.test.ts",
    "apps/desktop/src/renderer/tasks/agent-automation.test.ts",
    "apps/desktop/src/renderer/tasks/chip-cards.test.ts",
  ],
  // The inbox's agents with no task (`account-inbox-wire.ts`).
  planless: [
    "packages/features/src/account-inbox-wire.ts",
    "packages/host/src/agent-notices.ts",
    "packages/host/src/agent-notices.test.ts",
    "packages/service/src/agents/coder-host/inbox-page.ts",
    "packages/service/src/agents/coder-host/inbox-store.test.ts",
  ],
  // The tasks list's agents with no task (`task-wire.ts`).
  planlessAgents: [
    "packages/features/src/task-wire.ts",
    "packages/host/src/compose-tasks.ts",
    "packages/host/src/compose-tasks.test.ts",
    "packages/service/src/tasks/tasks-app.ts",
    "packages/service/src/agents/coding-agents-app.test.ts",
    "apps/web/tests/tasks-app.test.ts",
  ],
  // The brain's activity on the tasks view and the live frame (`tasks-view.ts`).
  planner: [
    "packages/features/src/tasks-view.ts",
    "packages/host/src/compose-tasks.ts",
    "packages/host/src/compose-tasks.test.ts",
    "packages/service/src/voice/live-exchange.ts",
    "packages/ui/src/tasks-model.ts",
    "packages/ui/src/call-card-model.test.ts",
    "apps/desktop/src/renderer/tasks/task-board.tsx",
    "apps/desktop/src/renderer/tasks/tasks-fixture.ts",
  ],
  // The main tabs' kept choice, under the key it was first stored as.
  planClosed: ["packages/panel/src/tasks/use-main-tabs.ts"],
};

/** The New task dialog's Plan switch: whether Luke writes a plan for the task it starts. */
const PLAN_SWITCH_FILES = [
  "apps/desktop/src/renderer/tasks/new-task-dialog.tsx",
  "packages/panel/src/tasks/new-task-planning.ts",
  "apps/desktop/src/renderer/tasks/use-tasks-tab.test.ts",
];

/** Names that hold a plan word without being the concept: a build's bundle plan, a billing plan, and the preview probe's plan. */
const NOT_THE_CONCEPT = new Set([
  "FunctionBundlePlan",
  "billingPlan",
  "functionBundlePlan",
  "planProbes",
]);

/** Where names are not read: the factory worlds' blueprints, the migrations, and the vendored skills. */
const SKIPPED = [/\/factory-world\//, /^packages\/database\/migrations\//, /^\.agents\//];

/** The schemas, where a plan-spelled SQL name is refused unless the document owns it. */
const SCHEMAS = "packages/database/src/schemas/";

/** A plan-spelled SQL name the document owns: its revisions, pages, pictures, comments, snapshot, and template. */
const DOCUMENT_SQL_NAME =
  /^plan_(attachment|comment|comment_thread|page_version|revision|snapshot|template)(_[a-z0-9_]+)?$/;

/** A plan-spelled SQL name. */
const PLAN_SQL_NAME = /^plan(_[a-z0-9_]*)?$/;

/** The words of a name: camelCase, SCREAMING_SNAKE, and kebab or dotted file names alike. */
function wordsOf(name) {
  return (name.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+/g) ?? []).map((word) =>
    word.toLowerCase(),
  );
}

/** Whether `file` is, or sits under, one of `places`. */
function within(file, places) {
  return places.some((place) => file === place || (place.endsWith("/") && file.startsWith(place)));
}

/** Why the plan word at `at` in `words` may stand in `file`, or undefined where it may not. */
function wordAllowed(words, at, file) {
  if (words[at] === "planning")
    return within(file, PLAN_SWITCH_FILES) ? "the Plan switch" : undefined;
  if (words[at] !== "plan" && words[at] !== "plans") return undefined;
  if (DOCUMENT_BEFORE.has(words[at - 1])) return "document verb";
  const after = words[at + 1];
  if (DOCUMENT_AFTER.has(after)) return "document";
  if (Object.hasOwn(SCOPED_AFTER, after) && within(file, SCOPED_AFTER[after]))
    return "document here";
  return undefined;
}

/**
 * Why `name` may call something a plan in `file`, or undefined where it may
 * not. A name held whole (bare, a wire spelling, a document name) stands as
 * it is; any other stands only where every plan word in it does, so an allowed
 * `planDocument` cannot carry a `planBoard` in behind it.
 */
export function allowed(name, file) {
  const words = wordsOf(name);
  const at = words.flatMap((word, index) => (PLAN_WORDS.has(word) ? [index] : []));
  if (at.length === 0) return "no plan word";
  if (words.length === 1 && BARE.has(words[0])) return "bare";
  if (NOT_THE_CONCEPT.has(name)) return "not the concept";
  if (Object.hasOwn(WIRE_NAME, name)) {
    const places = WIRE_NAME[name];
    return places === undefined || within(file, places) ? "wire" : undefined;
  }
  if (DOCUMENT_NAME.has(name) || DOCUMENT_FILE.test(name)) return "document";
  const why = at.map((index) => wordAllowed(words, index, file));
  return why.includes(undefined) ? undefined : why[0];
}

/** The name a file is read under: its base name without its test and source extensions. */
function fileNameOf(file) {
  return path.basename(file).replace(/(\.test)?\.(tsx?|mts)$/, "");
}

/** Every refused name in one file: its own name, its identifiers, and in a schema its SQL names. */
export function refusedIn(file, text) {
  if (SKIPPED.some((skip) => skip.test(file))) return [];
  const refused = [];
  if (allowed(fileNameOf(file), file) === undefined) {
    refused.push({ file, line: 1, name: path.basename(file) });
  }
  if (!/plan/i.test(text)) return refused;
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const schema = file.startsWith(SCHEMAS) && !file.includes("/__tests__/");
  const seen = new Set();
  const refuse = (node, name) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (!seen.has(`${line}:${name}`)) refused.push({ file, line, name });
    seen.add(`${line}:${name}`);
  };
  const visit = (node) => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      if (allowed(node.text, file) === undefined) refuse(node, node.text);
    } else if (schema && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      if (PLAN_SQL_NAME.test(node.text) && !DOCUMENT_SQL_NAME.test(node.text))
        refuse(node, `"${node.text}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refused;
}

/**
 * The canary: `scripts/fixtures/task-names/invalid.ts`, read as the repository
 * is, and names and SQL names asked of the rules directly, each asserted
 * before the repository's answer is believed, so a check that stopped
 * refusing anything, or started refusing the document, reads as broken
 * rather than clean.
 */
export const CANARY = {
  DIRECTORY: "scripts/fixtures/task-names",
  REFUSED: [
    "scripts/fixtures/task-names/invalid.ts:4:planGroups",
    "scripts/fixtures/task-names/invalid.ts:7:PlanMentions",
    "scripts/fixtures/task-names/invalid.ts:10:ensurePlanChannel",
    "scripts/fixtures/task-names/invalid.ts:13:PLAN_ROW",
    "scripts/fixtures/task-names/invalid.ts:16:planTitle",
    "scripts/fixtures/task-names/invalid.ts:19:runPlannerPost",
    "scripts/fixtures/task-names/invalid.ts:22:planningNote",
    "scripts/fixtures/task-names/invalid.ts:25:openSharedPlan",
    "scripts/fixtures/task-names/invalid.ts:28:planClosed",
    "scripts/fixtures/task-names/invalid.ts:31:planName",
    "scripts/fixtures/task-names/invalid.ts:34:planDocumentPlanBoard",
  ],
  /** Names the rules must let stand, each in the file named beside it. */
  ALLOWED: [
    ["planTemplateRevision", "packages/features/src/anywhere.ts"],
    ["PlanCommentThread", "packages/features/src/anywhere.ts"],
    ["planId", "packages/features/src/anywhere.ts"],
    ["planName", "packages/features/src/automation-wire.ts"],
    ["planlessAgents", "packages/features/src/task-wire.ts"],
    ["EDIT_PLAN_TOOL", "packages/features/src/anywhere.ts"],
    ["MAX_PER_PLAN", "packages/features/src/anywhere.ts"],
    ["planet", "packages/features/src/anywhere.ts"],
    ["PlanTitle", "apps/desktop/src/renderer/ai-elements/plan.tsx"],
    ["PLAN_ROW", "apps/desktop/src/renderer/desktop/main-tabs.tsx"],
    ["planClosed", "packages/panel/src/tasks/use-main-tabs.ts"],
    ["useNewTaskPlanning", "packages/panel/src/tasks/new-task-planning.ts"],
  ],
  /** The SQL names the schema clause must refuse, and those it must let stand. */
  SQL_REFUSED: ["plan", "plan_id", "plan_board", "plan_board2", "plan_pin"],
  SQL_ALLOWED: [
    "plan_revision",
    "plan_comment_thread_seq",
    "plan_revision_v2",
    "plan_snapshot",
    "plan_template",
  ],
};

/** A refusal as `CANARY.REFUSED` writes one. */
export function refusedAt(one) {
  return `${one.file}:${one.line}:${one.name}`;
}
