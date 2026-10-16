/**
 * skills.ts -- shot F, "Skills": a `/` typed in the running agent's box, the skill picker open over the repository's skills, a sent message's skill chip above it, and that skill's SKILL.md in a File tab.
 *
 * Throwaway (`README.md`). Sidebar folded; the plan's column on the running
 * "Invite emails" agent (GPT-6.1 Sol). Its transcript: the task card, a
 * first turn that found Postmark and the existing templates, then the
 * developer's follow up `/email-templates …` (drawn as a chip, since the
 * repository keeps that skill), then the turn at work, which loaded the
 * skill ("Loaded skill" row) and is reading the templates. The box below
 * holds a `/` with the picker listing the six skills of acme/relay's
 * `.agents/skills`. The side panel stands at 640 on a File tab of
 * `.agents/skills/email-templates/SKILL.md`, its tree hidden so the file
 * has the panel's width. The `/` is typed by a staging step
 * (`typeSlash`), which sets the box's value the way a keystroke would
 * (an `input` event React hears as `onChange`), so no shared file changes.
 */

import type { CodingAgentMessagesAnswerView } from "@luke/features/coding-agent-view";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import type { TaskSkillsAnswer } from "@luke/features/plan-wire";
import type {
  CodeLines,
  CodeToken,
  TasksFileAnswer,
  TasksTreeAnswer,
} from "@luke/features/planning-view";
import type { WireRecord, WireValue } from "@luke/wire";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { ago } from "./clock";
import { codingAgentAnswers, MODEL, shotAgents } from "./coding-agent";
import { AGENT_2_TITLE, TASK_REPOSITORY, SHOT_ID, shotTasksView } from "./plan-document";
import { NEVER, type ShotAnswers, type ShotSpec, type ShotStep } from "./shot-spec";

/** The skill the developer named, whose SKILL.md the File tab shows. */
const SKILL = "email-templates";

/** The SKILL.md the File tab shows. */
export const SKILL_PATH = `.agents/skills/${SKILL}/SKILL.md`;

/** The branch every read of the repository is on. */
const BRANCH = "main";

/** The cursor a reader starts from, and the one the page ends on. */
const START = "0:0";
const READ_THROUGH = "1:0";

/** When the running agent started, and when its turn at work did. */
const STARTED_MINUTES = 18;
const TURN_MINUTES = 4;

/** acme/relay's skills, in name order as the service lists them. */
const SKILLS = [
  {
    name: "api-routes",
    description:
      "HTTP routes under src/routes: validation, auth guard, error shape, and the route test.",
  },
  {
    name: "db-migrations",
    description:
      "Schema changes, rolled out safely: the migration, batched backfills, concurrent indexes.",
  },
  {
    name: "drizzle",
    description: "Drizzle schemas and queries: tables, relations, joins, and the select builder.",
  },
  {
    name: SKILL,
    description: "Transactional email: a React Email template, its plain-text part, and a preview.",
  },
  {
    name: "release",
    description:
      "Cut a release: bump the version, write the changelog, tag it, and watch the deploy.",
  },
  {
    name: "testing",
    description:
      "Vitest tests for a change: the smallest layer that catches it, fakes at the edges.",
  },
].map((skill) => ({ ...skill, path: `.agents/skills/${skill.name}/SKILL.md` }));

/** The SKILL.md, as acme/relay keeps it. */
const SKILL_MD = [
  "---",
  `name: ${SKILL}`,
  "description: Transactional email: a React Email template, its plain-text part, and a preview. Use when an email is added, reworded, or sent from somewhere new.",
  "---",
  "",
  "# Email templates",
  "",
  "Every email Relay sends is a React Email component under",
  "`src/mail/templates/`, sent through Postmark by `src/mail/client.ts`.",
  "",
  "## Adding a template",
  "",
  "1. Create `src/mail/templates/<name>-email.tsx`, exporting the component",
  "   and a `subject(props)`. A subject names the workspace:",
  "   `Join ${workspace.name} on Relay`.",
  "2. Wrap the body in `<Layout>` from `./layout.tsx`. Never set colours or",
  "   fonts inline; the layout's theme carries them.",
  "3. Export a `text(props)` part beside it. Postmark sends both, and spam",
  "   filters mark down a message without one.",
  "4. Add the preview's props to `src/mail/previews/<name>.ts`.",
  "5. Register the template in `src/mail/templates/index.ts`.",
  "",
  "## Sending",
  "",
  "- Call `mail.send(template, props, { to })`, never the Postmark client.",
  "- Transactional mail goes on the `outbound` stream; `broadcast` is the",
  "  newsletter's and needs an unsubscribe link.",
  "- Build every link with `appUrl()`, so previews and staging point at",
  "  their own host.",
  "",
  "## Checking it",
  "",
  "```sh",
  "pnpm mail:preview    # every template at localhost:3001",
  "pnpm test src/mail   # the HTML and text snapshots",
  "```",
  "",
  "Update a snapshot only when the change to the email is the point.",
];

/** GitHub's dark and light colours, as main colours markdown. */
const COLOUR = {
  HEADING: { color: "#79c0ff", lightColor: "#0550ae" },
  KEY: { color: "#7ee787", lightColor: "#116329" },
  CODE: { color: "#a5d6ff", lightColor: "#0a3069" },
  MARKER: { color: "#ffa657", lightColor: "#953800" },
  MUTED: { color: "#8b949e", lightColor: "#6e7781" },
  COMMAND: { color: "#d2a8ff", lightColor: "#8250df" },
} as const;

type Colour = (typeof COLOUR)[keyof typeof COLOUR];

/** One run of a line, coloured or in the theme's own foreground. */
function run(text: string, colour?: Colour): CodeToken {
  return colour === undefined ? { text } : { text, ...colour };
}

/** A line's prose, its `code` spans coloured. */
function prose(text: string): CodeToken[] {
  return text
    .split(/(`[^`]*`)/u)
    .filter((piece) => piece !== "")
    .map((piece) => (piece.startsWith("`") ? run(piece, COLOUR.CODE) : run(piece)));
}

/** One line of the SKILL.md coloured as markdown, knowing whether it stands in the frontmatter or a fence. */
function colourLine(line: string, place: { front: boolean; fence: boolean }): CodeToken[] {
  if (line === "") return [];
  if (line === "---" || line.startsWith("```")) return [run(line, COLOUR.MUTED)];
  if (place.front) {
    const colon = line.indexOf(":");
    return [
      run(line.slice(0, colon), COLOUR.KEY),
      run(line.slice(colon, colon + 2)),
      run(line.slice(colon + 2), COLOUR.CODE),
    ];
  }
  if (place.fence) {
    const hash = line.indexOf("#");
    const [command = "", ...rest] = line.slice(0, hash).split(" ");
    return [
      run(command, COLOUR.COMMAND),
      run(` ${rest.join(" ")}`),
      run(line.slice(hash), COLOUR.MUTED),
    ];
  }
  if (line.startsWith("#")) return [run(line, COLOUR.HEADING)];
  const marker = /^(\d+\.|-) /u.exec(line)?.[0];
  if (marker !== undefined)
    return [run(marker, COLOUR.MARKER), ...prose(line.slice(marker.length))];
  return prose(line);
}

/** The SKILL.md's lines, coloured. */
function skillLines(): CodeLines {
  const place = { front: false, fence: false };
  return SKILL_MD.map((line, index) => {
    if (line === "---") place.front = index === 0;
    const tokens = colourLine(line, place);
    if (line.startsWith("```")) place.fence = !place.fence;
    return tokens;
  });
}

/** The File tab's read of the SKILL.md: the window asked for, or its whole text raw. */
function skillFile(
  firstLine: number,
  lastLine: number,
  raw: boolean | undefined,
): TasksFileAnswer {
  if (raw === true) {
    return {
      text: {
        path: SKILL_PATH,
        repository: TASK_REPOSITORY,
        branch: BRANCH,
        text: `${SKILL_MD.join("\n")}\n`,
      },
    };
  }
  const lines = skillLines();
  const first = Math.min(firstLine, lines.length);
  return {
    file: {
      path: SKILL_PATH,
      repository: TASK_REPOSITORY,
      branch: BRANCH,
      firstLine: first,
      lineCount: lines.length,
      lines: lines.slice(first - 1, Math.max(first, lastLine)),
    },
  };
}

/** acme/relay's files, as the tree and the palette list them. */
const FILES = [
  "AGENTS.md",
  "README.md",
  "package.json",
  ...SKILLS.map((skill) => skill.path),
  "src/mail/client.ts",
  "src/mail/layout.tsx",
  "src/mail/templates/index.ts",
  "src/mail/templates/reset-password-email.tsx",
  "src/mail/templates/welcome-email.tsx",
  "src/mail/previews/welcome.ts",
  "src/members/invite.ts",
  "src/routes/invites.ts",
];

/** One folder of the repository, its entries read off {@link FILES}; the whole repository where recursive. */
function folder(path: string, recursive: boolean | undefined): TasksTreeAnswer {
  const prefix = path === "" ? "" : `${path}/`;
  const under = FILES.filter((file) => file.startsWith(prefix)).map((file) =>
    file.slice(prefix.length),
  );
  const entries =
    recursive === true
      ? under.map((name) => ({ name, kind: "file" as const }))
      : [...new Set(under.map((rest) => rest.split("/")[0] ?? rest))].map((name) => ({
          name,
          kind: under.includes(name) ? ("file" as const) : ("folder" as const),
        }));
  return {
    folder: { path, repository: TASK_REPOSITORY, branch: BRANCH, entries, truncated: false },
  };
}

/** One finished tool call, as the SDK stores its part. */
function toolPart(
  tool: string,
  toolCallId: string,
  input: WireRecord,
  output: WireValue,
): WireRecord {
  return { type: `tool-${tool}`, toolCallId, state: "output-available", input, output };
}

/** The running agent's transcript: its task, the turn that looked around, the follow up naming the skill, and the turn at work. */
function runningMessages(): CodingAgentMessage[] {
  return [
    {
      id: "r-task",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Send the invite email through Postmark, with the workspace's name in the subject.",
        },
      ],
    },
    {
      id: "r-turn-1",
      role: "assistant",
      startedAt: ago(STARTED_MINUTES),
      finishedAt: ago(14),
      model: MODEL.SOL,
      effort: "high",
      parts: [
        { type: "step-start" },
        toolPart(
          "bash",
          "call_r1",
          { command: 'grep -rln "postmark" src' },
          {
            status: "completed",
            exitCode: 0,
            stdout: "src/mail/client.ts\nsrc/mail/send.ts",
            stderr: "",
            truncated: false,
          },
        ),
        toolPart(
          "glob",
          "call_r2",
          { pattern: "src/mail/templates/*.tsx" },
          {
            content:
              "src/mail/templates/reset-password-email.tsx\nsrc/mail/templates/welcome-email.tsx",
          },
        ),
        { type: "step-start" },
        {
          type: "text",
          text:
            "Postmark is set up in `src/mail/client.ts`, and the welcome and password reset emails are React Email templates under `src/mail/templates/`. " +
            "I'd add the invite as a third template there and send it from `inviteMember`. Want it done the same way?",
        },
      ],
    },
    {
      id: "r-follow-up",
      role: "user",
      parts: [
        {
          type: "text",
          text: '/email-templates Yes, the same way, with a plain-text part and a preview. Subject: "Join Acme on Relay".',
        },
      ],
    },
    {
      id: "r-turn-2",
      role: "assistant",
      startedAt: ago(TURN_MINUTES),
      model: MODEL.SOL,
      effort: "high",
      parts: [
        { type: "step-start" },
        toolPart("load_skill", "call_r3", { skill: SKILL }, SKILL_MD.slice(4).join("\n")),
        {
          type: "reasoning",
          text: "The skill wants a subject(props), a text(props) part, a preview fixture, and the template registered in index.ts. Read the welcome email to match its shape.",
        },
        toolPart(
          "read_file",
          "call_r4",
          { filePath: "/workspace/repository/src/mail/templates/welcome-email.tsx" },
          {
            content:
              "export const subject = ({ workspace }: Props) => `Welcome to ${workspace.name}`;\n\nexport default function WelcomeEmail({ workspace, user }: Props) {\n  return <Layout preview={subject({ workspace })}>…</Layout>;\n}\n",
          },
        ),
        toolPart(
          "read_file",
          "call_r5",
          { filePath: "/workspace/repository/src/mail/templates/index.ts" },
          {
            content:
              "export * as welcome from './welcome-email';\nexport * as resetPassword from './reset-password-email';\n",
          },
        ),
        toolPart(
          "read_file",
          "call_r5b",
          { filePath: "/workspace/repository/src/mail/layout.tsx" },
          { content: "export function Layout({ preview, children }: LayoutProps) { … }\n" },
        ),
        toolPart(
          "read_file",
          "call_r5c",
          { filePath: "/workspace/repository/src/mail/previews/welcome-email.ts" },
          { content: "export default { workspace: { name: 'Acme' }, user: { name: 'Dana' } };\n" },
        ),
        toolPart(
          "apply_patch",
          "call_r6",
          { root: "/workspace/repository", patchText: "*** Begin Patch\n*** Add File: src/mail/templates/invite-email.tsx\n*** End Patch" },
          {
            files: [
              { operation: "add", path: "src/mail/templates/invite-email.tsx" },
              { operation: "add", path: "src/mail/previews/invite-email.ts" },
              { operation: "update", path: "src/mail/templates/index.ts" },
            ],
          },
        ),
        toolPart(
          "bash",
          "call_r7",
          { command: "pnpm test src/mail" },
          {
            status: "completed",
            exitCode: 0,
            stdout: " ✓ src/mail/templates.test.ts (6 tests)\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)",
            stderr: "",
            truncated: false,
          },
        ),
      ],
    },
  ];
}

/** The running agent's transcript page: everything at the start, then held open, as a running agent's is. */
function runningPage(after: string): CodingAgentMessagesAnswerView | typeof NEVER {
  if (after !== START) return NEVER;
  return {
    messages: runningMessages(),
    cursor: READ_THROUGH,
    status: "running",
    runStartedAt: ago(TURN_MINUTES),
    title: AGENT_2_TITLE,
  };
}

/** The agents' answers with the running agent's transcript and timing this shot's own. */
function answers(): ShotAnswers {
  const shared = codingAgentAnswers();
  const agents = shotAgents().map((agent) =>
    agent.id === SHOT_ID.AGENT_2
      ? { ...agent, createdAt: ago(STARTED_MINUTES), runStartedAt: ago(TURN_MINUTES) }
      : agent,
  );
  const skills: TaskSkillsAnswer = {
    skills: { repository: TASK_REPOSITORY, branch: BRANCH, skills: SKILLS },
  };
  return {
    ...shared,
    [ACT_KIND.CODING_AGENTS_LIST]: (payload) =>
      payload.taskId === SHOT_ID.TASK ? { agents } : { agents: [] },
    [ACT_KIND.CODING_AGENTS_MESSAGES]: (payload) =>
      payload.agentId === SHOT_ID.AGENT_2 && payload.callId === undefined
        ? runningPage(payload.after)
        : shared[ACT_KIND.CODING_AGENTS_MESSAGES]?.(payload),
    [ACT_KIND.TASKS_SKILLS]: () => skills,
    [ACT_KIND.TASKS_FILE]: (payload) =>
      payload.path === SKILL_PATH
        ? skillFile(payload.firstLine, payload.lastLine, payload.raw)
        : undefined,
    [ACT_KIND.TASKS_TREE]: (payload) => folder(payload.path, payload.recursive),
  };
}

/** How often the step looks at the window, and how long it keeps the picker standing before it lets go. */
const TICK_MS = 100;
const GIVE_UP_TICKS = 300;
const STEADY_TICKS = 30;

/** Writes the words into the box as a keystroke would, so React hears an `onChange` with the caret at their end. */
function typeInto(field: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(field, text);
  field.setSelectionRange(text.length, text.length);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * One look at the window: hides the File tab's tree once, then, once the
 * transcript's chip is drawn (so the skills are read), types `/` into the
 * agent's box, focused, until the picker lists every skill. Says whether
 * the picker stands open.
 */
function stageOnce(state: { treeHidden: boolean }): boolean {
  const toggle = document.querySelector<HTMLButtonElement>(
    '.file-tree-toggle[aria-expanded="true"]',
  );
  if (!state.treeHidden && toggle !== null) {
    state.treeHidden = true;
    toggle.click();
  }
  const field = document.querySelector<HTMLTextAreaElement>(".agent-composer-input");
  const chip = document.querySelector("button.skill-chip");
  if (field === null || field.disabled || chip === null) return false;
  const rows = document.querySelectorAll('.skill-menu [role="option"]').length;
  if (rows >= SKILLS.length && document.activeElement === field) return true;
  field.focus();
  // Note that the box is emptied first, so a `/` already in it is heard again and the caret re-read.
  typeInto(field, "");
  typeInto(field, "/");
  return false;
}

/** The step that opens the picker: a loop on the window's own timer, since the box and the chip are drawn under the agent's tab, not the App. */
const typeSlash: ShotStep = {
  key: "skill-picker",
  ready: ({ tasks }) => tasks.agents.agentIds?.includes(SHOT_ID.AGENT_2) ?? false,
  run: () => {
    const state = { treeHidden: false };
    let ticks = 0;
    let steady = 0;
    const tick = () => {
      ticks += 1;
      steady = stageOnce(state) ? steady + 1 : 0;
      if (steady < STEADY_TICKS && ticks < GIVE_UP_TICKS) window.setTimeout(tick, TICK_MS);
    };
    window.setTimeout(tick, TICK_MS);
  },
};

export function skillsShot(): ShotSpec {
  return {
    tasks: shotTasksView({}),
    sidePanel: { ...FIXTURE_CLOSED_PANEL, width: 640 },
    answers: answers(),
    layout: {
      sidebarCollapsed: true,
      mainTab: { agent: SHOT_ID.AGENT_2 },
      sidePanelFile: SKILL_PATH,
    },
    steps: [typeSlash],
  };
}
