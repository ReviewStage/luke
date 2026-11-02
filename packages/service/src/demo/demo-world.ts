import { INBOX_ASK, INBOX_FIELD, type InboxAsk } from "@luke/features/inbox-wire";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@luke/features/workspace-wire";

/**
 * demo-world.ts -- the acme world the demo seed writes, as data: its people, its workspace, its tasks and their plans, the comments on them, and its channels.
 *
 * The world is the changelog screenshots' (`.claude/skills/changelog-screenshots/WORLD.md`):
 * acme builds Relay, and Dean Stratakos owns its workspace beside Dana,
 * Jordan, Priya, and Theo. Nothing here is read from an account; every name
 * and address is invented. Every id is fixed, so two seeds of two fresh
 * databases write the same rows, and every time is a distance back from the
 * seed's start, so the world always reads as minutes, hours, and days old.
 * The tasks name no repository, since the demo reaches no GitHub.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What each kind of fixed id begins with, so an id says what it names. */
export const DEMO_ID_KIND = {
  USER: "de300001",
  ORGANIZATION: "de300002",
  MEMBER: "de300003",
  TASK: "de300004",
  CHANNEL: "de300005",
  /** An agent's turn, and the key its opening line is sent under. */
  TURN: "de300006",
  /** A tool call of a turn. */
  TOOL_CALL: "de300008",
  /** The key a member's write is taken under, so it is taken once. */
  CLIENT_KEY: "de300009",
  /** Anything else Better Auth writes for the seed. */
  AUTH_ROW: "de300007",
} as const;

export type DemoIdKind = (typeof DEMO_ID_KIND)[keyof typeof DEMO_ID_KIND];

/** The demo's id of the kind, numbered: shaped as a version 4 UUID, as the wire reads one. */
export function demoId(kind: DemoIdKind, n: number): string {
  return `${kind}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

/* ----- The people ----- */

/** One person of acme: their account and their role in its workspace. */
export interface DemoPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: WorkspaceRole;
}

/** The persona the demo signs in as, who owns acme. */
export const DEMO_DEAN: DemoPerson = {
  id: demoId(DEMO_ID_KIND.USER, 1),
  name: "Dean Stratakos",
  email: "dean@example.com",
  role: WORKSPACE_ROLE.OWNER,
};

const DANA: DemoPerson = {
  id: demoId(DEMO_ID_KIND.USER, 2),
  name: "Dana Moreno",
  email: "dana@acme.dev",
  role: WORKSPACE_ROLE.ADMIN,
};

const JORDAN: DemoPerson = {
  id: demoId(DEMO_ID_KIND.USER, 3),
  name: "Jordan Lee",
  email: "jordan@acme.dev",
  role: WORKSPACE_ROLE.MEMBER,
};

const PRIYA: DemoPerson = {
  id: demoId(DEMO_ID_KIND.USER, 4),
  name: "Priya Raman",
  email: "priya@acme.dev",
  role: WORKSPACE_ROLE.MEMBER,
};

const THEO: DemoPerson = {
  id: demoId(DEMO_ID_KIND.USER, 5),
  name: "Theo Walsh",
  email: "theo@acme.dev",
  role: WORKSPACE_ROLE.MEMBER,
};

/** Everyone in acme, its owner first. */
export const DEMO_PEOPLE: readonly DemoPerson[] = [DEMO_DEAN, DANA, JORDAN, PRIYA, THEO];

/** The workspace everything happens in, which Dean owns. */
export const DEMO_WORKSPACE_NAME = "acme";

/* ----- The tasks ----- */

/** One plan's comment thread: who started it, on which words of the plan, what they said, and who answered. */
export interface DemoComment {
  readonly by: DemoPerson;
  /** The plan's words the thread is on, which must stand in its text once. */
  readonly quote: string;
  readonly words: string;
  readonly replies: readonly { readonly by: DemoPerson; readonly words: string }[];
  readonly ago: number;
}

/** One task of acme's: who made it, where it stands, its plan, and the comments on it. */
export interface DemoTask {
  readonly id: string;
  readonly name: string;
  readonly creator: DemoPerson;
  readonly assignee: DemoPerson;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  /** How long before the seed's start it was made, and its plan last saved. */
  readonly createdAgo: number;
  readonly savedAgo: number;
  /** How long before the seed's start it was moved to its status, for one that is done or canceled; it stands to do until then. */
  readonly settledAgo?: number;
  readonly plan: string;
  readonly comments: readonly DemoComment[];
}

/** A plan's text from its sections, each under its heading, in the order given. */
function planText(sections: Readonly<Record<string, string>>): string {
  return `${Object.entries(sections)
    .map(([heading, text]) => `## ${heading}\n\n${text}`)
    .join("\n\n")}\n`;
}

const INVITATIONS_PLAN = planText({
  Context:
    "Only an admin can add someone to a workspace, by creating their account by hand. " +
    "Members wait on an admin to bring a teammate in, and support gets a ticket a day asking for it.",
  Goal:
    "- A member invites a teammate by email from **Settings › Members**.\n" +
    "- The teammate joins the workspace by opening the link, signing in or signing up on the way.\n" +
    "- An admin sees pending invites beside members, and can withdraw one.",
  Approach:
    "- Model an invite as a `memberships` row with `state = pending` " +
    "(`src/db/schema/memberships.ts`), so removal covers invites and members alike.\n" +
    "- `POST /invites` (`src/members/invite.ts`, new) creates the row and mails a one-time link, " +
    "following `src/members/remove.ts`.\n" +
    "- The accept link (`/invites/:token`) turns the row `active` once the visitor is signed in.",
  Interfaces:
    "`src/members/invite.ts`\n\n" +
    "```ts\n" +
    "export function inviteMember(workspaceId: string, email: string): Promise<Membership>;\n" +
    "export function acceptInvite(token: string, userId: string): Promise<Membership>;\n" +
    "export function withdrawInvite(inviteId: string, by: Member): Promise<void>;\n" +
    "```",
  Alternatives:
    "- A separate `invitations` table: lost because removing a member would then have to " +
    "clear two tables, and the members list would join both.\n" +
    "- Magic-link sign-up with no invite row: lost because an admin could not see or withdraw a pending invite.",
  "Hard parts":
    "- A withdrawn or accepted invite link is opened again: the page reads " +
    '"This invite is no longer valid" and grants nothing.\n' +
    "- The invitee already has an account under another email: the link signs them in and joins that account.",
  "Not doing":
    "- Bulk invites from a CSV: one at a time covers every request so far.\n" +
    "- Invite-only roles: an invitee joins as a member, and an admin promotes them after.",
  "Plan of attack":
    "1. Migration: `memberships.state` with `pending`, backfilled `active`.\n" +
    "2. `POST /invites` and the invite email.\n" +
    "3. The accept page and `acceptInvite`.\n" +
    "4. Pending invites in **Settings › Members**, with Withdraw.",
  Testing:
    "- When a member invites `sam@acme.dev`, then a pending membership exists and one email is sent.\n" +
    "- When the invitee opens the link signed in, then their membership is `active` and the link stops working.\n" +
    '- When an admin withdraws an invite, then its link reads "no longer valid".\n' +
    "- End to end: `pnpm test src/members`, then invite a second account on a preview deploy.",
  "Open questions":
    "- Who can withdraw an invite: the member who sent it, any admin, or both?\n" +
    "- Should an invite expire after 7 days or 14?",
  Assumptions:
    "- Invites reuse memberships with a pending state.\n" +
    "- Members and admins can both invite.\n" +
    "- An invite expires after 7 days.",
});

const BILLING_PLAN = planText({
  Context:
    "Every workspace pays a flat $12 a seat. Teams that run thousands of webhook " +
    "deliveries a day pay the same as teams that run ten, and the largest three " +
    "accounts cost more to serve than they pay.",
  Goal:
    "- A workspace is billed per seat plus per 1,000 deliveries past its plan's allowance.\n" +
    "- An admin sees this month's usage and the projected invoice in **Settings › Billing**.\n" +
    "- Nobody's bill changes without 30 days' notice.",
  Approach:
    "- Count deliveries into a `usage_daily` rollup (`src/usage/rollup.ts`, new), one row " +
    "per workspace per day, from the delivery log the worker already writes.\n" +
    "- Report the month's total to Stripe as a metered price on the existing subscription " +
    "(`src/billing/stripe.ts`), so invoices stay Stripe's.\n" +
    "- The projected invoice reads the rollup, never the raw log.",
  "Open questions": "- Does the allowance roll over when a month runs under it?",
});

const WEBHOOKS_PLAN = planText({
  Context:
    "A webhook delivery that fails is dropped. Customers whose endpoint blips for a minute " +
    "lose every event in that minute, and ask support to replay them by hand.",
  Goal:
    "- A failed delivery is retried 5 times over 24 hours, backing off each time.\n" +
    "- A delivery that still fails is marked dead, and an admin can replay it from **Settings › Webhooks**.",
  Approach:
    "- A `delivery_attempts` table beside `deliveries` (`src/db/schema/webhooks.ts`).\n" +
    "- The worker (`src/webhooks/worker.ts`) schedules the next attempt at 1 minute, 5, 30, 2 hours, and 12.\n" +
    "- Replay re-queues a dead delivery with its attempts reset.",
  Testing:
    "- When an endpoint answers 500 twice and then 200, then the delivery lands on its third attempt.\n" +
    "- When an endpoint never answers, then the delivery is dead after its fifth.",
});

const ONBOARDING_PLAN = planText({
  Context:
    "Half of new workspaces never send a webhook. The ones that do finish three steps in their " +
    "first hour: they invite a teammate, add an endpoint, and send a test event.",
  Goal:
    "- A new workspace's dashboard opens on a checklist of those three steps.\n" +
    "- Each step ticks itself once it is done, and the checklist folds away once all three are.",
  Approach:
    "- The checklist reads what the workspace already has (members, endpoints, deliveries), so nothing new is stored.\n" +
    "- A dismissed checklist stays dismissed, kept on the member's settings.",
  "Open questions": "- Should an admin be able to hide it for the whole workspace?",
});

const AUDIT_PLAN = planText({
  Context:
    "Two enterprise customers ask for an export of who changed what in their workspace, " +
    "for their own compliance reviews.",
  Goal: "- An admin downloads the last 90 days of the audit log as CSV from **Settings › Audit log**.",
  "Not doing": "- A streaming export to a customer's own bucket: no one has asked for it yet.",
});

const DARK_MODE_PLAN = planText({
  Context: "The dashboard is light only, and support hears about it every week.",
  Goal: "- The dashboard follows the system's appearance, with a manual override in **Settings › Profile**.",
  Approach:
    "- Move the dashboard's colours onto the design tokens the marketing site already uses.\n" +
    "- Check every chart against both palettes before it ships.",
});

const SSO_PLAN = planText({
  Context: "One prospect asked for SSO with Okta, then signed with Google sign-in instead.",
  Goal: "- Sign in to a workspace through its own Okta.",
  "Not doing": "- SCIM provisioning.",
});

/** The task everything is about, whose agent finished minutes ago and whose asks wait in Dean's Inbox. */
export const DEMO_INVITATIONS_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 1),
  name: "Teammate invitations",
  creator: DEMO_DEAN,
  assignee: DEMO_DEAN,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
  createdAgo: 2 * DAY,
  savedAgo: 4 * MINUTE,
  plan: INVITATIONS_PLAN,
  comments: [
    {
      by: DANA,
      quote: "Who can withdraw an invite",
      words:
        "The sender or any admin. Settings › Members already lets an admin remove anyone, so an admin withdrawing an invite is the same right.",
      replies: [
        {
          by: DEMO_DEAN,
          words: "Agreed. I'll settle it with the agent and take it out of open questions.",
        },
      ],
      ago: 3 * HOUR,
    },
    {
      by: PRIYA,
      quote: "Should an invite expire after 7 days or 14?",
      words:
        "Support's tickets say 7 is short when someone's invited on a Friday and away the next week. Could Resend cover that instead of 14?",
      replies: [],
      ago: 40 * MINUTE,
    },
  ],
};

export const DEMO_BILLING_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 2),
  name: "Usage-based billing",
  creator: DANA,
  assignee: DANA,
  status: TASK_STATUS.TODO,
  priority: TASK_PRIORITY.MEDIUM,
  createdAgo: 4 * DAY,
  savedAgo: 26 * MINUTE,
  plan: BILLING_PLAN,
  comments: [
    {
      by: DEMO_DEAN,
      quote: "Nobody's bill changes without 30 days' notice.",
      words: "Legal wants the notice in the terms too, not only in the email.",
      replies: [{ by: DANA, words: "Added to the launch checklist." }],
      ago: 1 * DAY,
    },
  ],
};

export const DEMO_WEBHOOKS_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 3),
  name: "Webhook retries",
  creator: DANA,
  assignee: DANA,
  status: TASK_STATUS.DONE,
  priority: TASK_PRIORITY.HIGH,
  createdAgo: 3 * DAY,
  savedAgo: 2 * HOUR,
  settledAgo: 4 * HOUR + 30 * MINUTE,
  plan: WEBHOOKS_PLAN,
  comments: [],
};

export const DEMO_ONBOARDING_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 4),
  name: "Onboarding checklist",
  creator: DANA,
  assignee: JORDAN,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.MEDIUM,
  createdAgo: 2 * DAY,
  savedAgo: 5 * HOUR,
  plan: ONBOARDING_PLAN,
  comments: [
    {
      by: THEO,
      quote: "Should an admin be able to hide it for the whole workspace?",
      words: "Yes, our design partners already asked for it. One switch in Settings › Workspace.",
      replies: [],
      ago: 4 * HOUR,
    },
  ],
};

const AUDIT_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 5),
  name: "Audit log export",
  creator: PRIYA,
  assignee: PRIYA,
  status: TASK_STATUS.BACKLOG,
  priority: TASK_PRIORITY.LOW,
  createdAgo: 6 * DAY,
  savedAgo: 26 * HOUR,
  plan: AUDIT_PLAN,
  comments: [],
};

const DARK_MODE_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 6),
  name: "Dark mode for the dashboard",
  creator: THEO,
  assignee: THEO,
  status: TASK_STATUS.TODO,
  priority: TASK_PRIORITY.LOW,
  createdAgo: 12 * DAY,
  savedAgo: 4 * DAY,
  plan: DARK_MODE_PLAN,
  comments: [],
};

const SSO_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 7),
  name: "SSO with Okta",
  creator: JORDAN,
  assignee: JORDAN,
  status: TASK_STATUS.CANCELED,
  priority: TASK_PRIORITY.NONE,
  createdAgo: 30 * DAY,
  savedAgo: 20 * DAY,
  settledAgo: 18 * DAY,
  plan: SSO_PLAN,
  comments: [],
};

/** acme's tasks, oldest first, so the list reads newest first as the service orders it. */
export const DEMO_TASKS: readonly DemoTask[] = [
  SSO_TASK,
  DARK_MODE_TASK,
  AUDIT_TASK,
  DEMO_BILLING_TASK,
  DEMO_WEBHOOKS_TASK,
  DEMO_ONBOARDING_TASK,
  DEMO_INVITATIONS_TASK,
];

/* ----- The channels ----- */

/** One channel of acme's beside #general, and who made it. */
export interface DemoChannel {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly by: DemoPerson;
}

export const DEMO_PRODUCT_CHANNEL: DemoChannel = {
  id: demoId(DEMO_ID_KIND.CHANNEL, 1),
  name: "product",
  purpose: "What Relay does next, and the decisions behind it",
  by: DEMO_DEAN,
};

export const DEMO_ENGINEERING_CHANNEL: DemoChannel = {
  id: demoId(DEMO_ID_KIND.CHANNEL, 2),
  name: "engineering",
  purpose: "Relay's services, database, deploys, and CI",
  by: DANA,
};

export const DEMO_DESIGN_CHANNEL: DemoChannel = {
  id: demoId(DEMO_ID_KIND.CHANNEL, 3),
  name: "design",
  purpose: "Screens, emails, and design reviews",
  by: THEO,
};

export const DEMO_CHANNELS: readonly DemoChannel[] = [
  DEMO_PRODUCT_CHANNEL,
  DEMO_ENGINEERING_CHANNEL,
  DEMO_DESIGN_CHANNEL,
];

/** When the channels were made, before any task. */
export const DEMO_CHANNELS_AGO = 30 * DAY;

/* ----- The agents ----- */

/** One tool call of a step, as Claude Code names its tools: what it was handed, and what it answered. */
export interface DemoToolCall {
  readonly name: string;
  readonly input: Readonly<Record<string, string>>;
  readonly output: string;
}

/** One step of a turn: what the agent said, then the tool it called, if any. */
export interface DemoStep {
  readonly text: string;
  readonly tool?: DemoToolCall;
}

/** One turn: the line that opened it and who sent it, when it started and how long it ran, and its steps. */
export interface DemoTurn {
  readonly id: string;
  readonly from: DemoPerson;
  readonly line: string;
  readonly startedAgo: number;
  readonly ranFor: number;
  readonly steps: readonly DemoStep[];
  readonly tokens: { readonly input: number; readonly output: number; readonly cached: number };
}

/** One finished coding agent: the task it worked on, who started it, on what, and its turns, oldest first. */
export interface DemoAgent {
  /** The key its Start is taken under, so a second seed of the same database starts no second agent. */
  readonly key: string;
  readonly task: DemoTask;
  readonly title: string;
  readonly model: string;
  readonly effort: string;
  readonly turns: readonly [DemoTurn, ...DemoTurn[]];
}

const OPUS = "anthropic/claude-opus-5.5";
const SONNET = "anthropic/claude-sonnet-5.5";

/** Dean's agent on Teammate invitations, which built the invites and asked him what the plan left open. */
export const DEMO_INVITATIONS_AGENT: DemoAgent = {
  key: "demo-agent-invitations",
  task: DEMO_INVITATIONS_TASK,
  title: "Add teammate invitations",
  model: OPUS,
  effort: "high",
  turns: [
    {
      id: demoId(DEMO_ID_KIND.TURN, 1),
      from: DEMO_DEAN,
      line: "Build the invites as the plan says: the pending membership, `POST /invites`, and the accept link. Ask me about anything the plan leaves open.",
      startedAgo: 3 * HOUR,
      ranFor: 19 * MINUTE,
      steps: [
        {
          text: "I'll start from how a membership is modelled today.",
          tool: {
            name: "Read",
            input: { file_path: "src/db/schema/memberships.ts" },
            output:
              'export const memberships = pgTable("memberships", {\n  id: uuid("id").primaryKey(),\n  workspaceId: uuid("workspace_id").notNull(),\n  userId: uuid("user_id").notNull(),\n  role: text("role").notNull(),\n});',
          },
        },
        {
          text: "Adding the `state` column, backfilled `active`, and an `invite_token` for the link.",
          tool: {
            name: "Bash",
            input: { command: "pnpm drizzle-kit generate --name=membership_invites" },
            output: "[✓] Your SQL migration file ➜ drizzle/0042_membership_invites.sql",
          },
        },
        {
          text: "Writing `inviteMember`, `acceptInvite`, and `withdrawInvite`, following `src/members/remove.ts`.",
          tool: {
            name: "Write",
            input: { file_path: "src/members/invite.ts" },
            output: "File created successfully at: src/members/invite.ts",
          },
        },
        {
          text: "Running the members tests.",
          tool: {
            name: "Bash",
            input: { command: "pnpm test src/members" },
            output:
              " ✓ src/members/invite.test.ts (9 tests)\n ✓ src/members/remove.test.ts (5 tests)\n\n Test Files  2 passed (2)\n      Tests  14 passed (14)",
          },
        },
        {
          text: "The invites work end to end: a pending membership, `POST /invites` mailing a one-time link, and `/invites/:token` turning it active. Two things the plan leaves open are in your Inbox: who may withdraw an invite, and how long a link lasts. I assumed 7 days until you say otherwise.",
        },
      ],
      tokens: { input: 182_400, output: 14_900, cached: 151_000 },
    },
    {
      id: demoId(DEMO_ID_KIND.TURN, 2),
      from: DEMO_DEAN,
      line: "The sender or any admin may withdraw. Make it so, and show pending invites on Settings › Members.",
      startedAgo: 40 * MINUTE,
      ranFor: 11 * MINUTE,
      steps: [
        {
          text: "Checking the sender or an admin in `withdrawInvite`.",
          tool: {
            name: "Edit",
            input: {
              file_path: "src/members/invite.ts",
              old_string: "if (invite.invitedBy !== by.userId) throw new Forbidden();",
              new_string:
                'if (invite.invitedBy !== by.userId && by.role !== "admin") throw new Forbidden();',
            },
            output: "The file src/members/invite.ts has been updated.",
          },
        },
        {
          text: "Listing pending invites beside members, each with Withdraw.",
          tool: {
            name: "Edit",
            input: {
              file_path: "src/routes/settings/members.tsx",
              old_string: "<MembersTable members={members} />",
              new_string: "<MembersTable members={members} pending={invites} />",
            },
            output: "The file src/routes/settings/members.tsx has been updated.",
          },
        },
        {
          text: "Running the tests again.",
          tool: {
            name: "Bash",
            input: { command: "pnpm test src/members" },
            output: " Test Files  2 passed (2)\n      Tests  16 passed (16)",
          },
        },
        {
          text: "Done: the sender or any admin may withdraw an invite, and pending invites show on Settings › Members with Withdraw. I posted a note in #design with what the page looks like now.",
        },
      ],
      tokens: { input: 96_300, output: 6_200, cached: 88_100 },
    },
  ],
};

/** Dana's agent on Webhook retries, finished and merged. */
export const DEMO_WEBHOOKS_AGENT: DemoAgent = {
  key: "demo-agent-webhooks",
  task: DEMO_WEBHOOKS_TASK,
  title: "Retry failed webhook deliveries",
  model: OPUS,
  effort: "high",
  turns: [
    {
      id: demoId(DEMO_ID_KIND.TURN, 3),
      from: DANA,
      line: "Retry failed webhook deliveries as the plan says, with replay for the dead ones.",
      startedAgo: 5 * HOUR,
      ranFor: 24 * MINUTE,
      steps: [
        {
          text: "Reading the delivery worker first.",
          tool: {
            name: "Read",
            input: { file_path: "src/webhooks/worker.ts" },
            output:
              "export async function deliver(delivery: Delivery) {\n  const answer = await post(delivery.endpoint, delivery.body);\n  await markDelivered(delivery.id, answer.status);\n}",
          },
        },
        {
          text: "Scheduling the next attempt at 1 minute, 5, 30, 2 hours, and 12, and marking the delivery dead after the fifth.",
          tool: {
            name: "Edit",
            input: {
              file_path: "src/webhooks/worker.ts",
              old_string: "await markDelivered(delivery.id, answer.status);",
              new_string:
                "if (answer.ok) return markDelivered(delivery.id, answer.status);\n  await scheduleRetry(delivery, RETRY_DELAYS);",
            },
            output: "The file src/webhooks/worker.ts has been updated.",
          },
        },
        {
          text: "Running the webhook tests.",
          tool: {
            name: "Bash",
            input: { command: "pnpm test src/webhooks" },
            output: " Test Files  3 passed (3)\n      Tests  21 passed (21)",
          },
        },
        {
          text: "Failed deliveries now retry 5 times over about 15 hours and are then marked dead; an admin can replay a dead one from Settings › Webhooks.",
        },
      ],
      tokens: { input: 141_000, output: 11_300, cached: 120_500 },
    },
  ],
};

/** Jordan's agent on Onboarding checklist, which asked where the checklist should sit. */
export const DEMO_ONBOARDING_AGENT: DemoAgent = {
  key: "demo-agent-onboarding",
  task: DEMO_ONBOARDING_TASK,
  title: "Build the onboarding checklist",
  model: SONNET,
  effort: "medium",
  turns: [
    {
      id: demoId(DEMO_ID_KIND.TURN, 4),
      from: JORDAN,
      line: "Build the onboarding checklist from the plan. Keep it to what the workspace already stores.",
      startedAgo: 6 * HOUR,
      ranFor: 16 * MINUTE,
      steps: [
        {
          text: "Finding what the dashboard already reads about a workspace.",
          tool: {
            name: "Grep",
            input: { pattern: "useWorkspaceCounts", path: "src" },
            output: "src/dashboard/use-workspace-counts.ts\nsrc/dashboard/overview.tsx",
          },
        },
        {
          text: "Adding the checklist over those counts, folding away once every step is done.",
          tool: {
            name: "Write",
            input: { file_path: "src/dashboard/onboarding-checklist.tsx" },
            output: "File created successfully at: src/dashboard/onboarding-checklist.tsx",
          },
        },
        {
          text: "The checklist ticks each step from the workspace's members, endpoints, and deliveries, and folds away once all three are done. Where it sits on the dashboard is a question for you in #design.",
        },
      ],
      tokens: { input: 64_800, output: 5_400, cached: 51_200 },
    },
  ],
};

/** The finished agents, each started on its task in the order given. */
export const DEMO_AGENTS: readonly DemoAgent[] = [
  DEMO_ONBOARDING_AGENT,
  DEMO_WEBHOOKS_AGENT,
  DEMO_INVITATIONS_AGENT,
];

/* ----- The threads ----- */

/** One answer a member gave an ask: the options picked, or nothing for a reply in words alone. */
export interface DemoAnswer {
  readonly by: DemoPerson;
  readonly choices: readonly string[];
  readonly text: string;
  readonly ago: number;
}

/** One thread an agent posted: its key, where it went, what it says and asks, and what came after. */
export interface DemoThread {
  readonly agent: DemoAgent;
  readonly key: string;
  readonly channel: DemoChannel;
  readonly title: string;
  readonly body: string;
  readonly ask: InboxAsk | undefined;
  readonly needsReply: boolean;
  readonly addressee: DemoPerson | undefined;
  readonly ago: number;
  /** The member's answer to its ask, where the ask stands answered. */
  readonly answer?: DemoAnswer;
  /** The agent's word after the answer. */
  readonly followUp?: { readonly text: string; readonly ago: number };
  /** Members' replies on it, oldest first. */
  readonly replies: readonly {
    readonly by: DemoPerson;
    readonly text: string;
    readonly ago: number;
  }[];
}

/** The threads, oldest first, so each channel lists its newest on top. */
export const DEMO_THREADS: readonly DemoThread[] = [
  {
    agent: DEMO_ONBOARDING_AGENT,
    key: "checklist-placement",
    channel: DEMO_DESIGN_CHANNEL,
    title: "Where should the onboarding checklist sit?",
    body: "The checklist is built and ticks itself from what the workspace already has. It needs a place on the dashboard, and each spot pushes something else down.",
    ask: {
      type: INBOX_ASK.DECIDE,
      options: [
        { label: "Above the usage chart", detail: "Seen first, and it folds away once done." },
        { label: "In the right-hand column", detail: "Out of the way, but easy to miss." },
        { label: "As a banner under the header" },
      ],
      recommended: "Above the usage chart",
    },
    needsReply: true,
    addressee: JORDAN,
    ago: 5 * HOUR + 50 * MINUTE,
    replies: [
      {
        by: THEO,
        text: "Above the chart gets my vote. The chart is empty for a new workspace anyway.",
        ago: 4 * HOUR,
      },
    ],
  },
  {
    agent: DEMO_WEBHOOKS_AGENT,
    key: "retries-shipped",
    channel: DEMO_ENGINEERING_CHANNEL,
    title: "Shipped: webhook retries",
    body: "Failed deliveries now retry 5 times over about 15 hours, then stand dead until an admin replays them from **Settings › Webhooks**. The worker's attempts are in the new `delivery_attempts` table.",
    ask: undefined,
    needsReply: false,
    addressee: undefined,
    ago: 4 * HOUR + 40 * MINUTE,
    replies: [{ by: DEMO_DEAN, text: "Nice. Support can stop replaying by hand.", ago: 3 * HOUR }],
  },
  {
    agent: DEMO_INVITATIONS_AGENT,
    key: "withdraw-invite",
    channel: DEMO_PRODUCT_CHANNEL,
    title: "Who may withdraw a pending invite?",
    body: "The plan leaves this open. `withdrawInvite` in `src/members/invite.ts` checks one rule, and the members list shows Withdraw to whoever it allows.",
    ask: {
      type: INBOX_ASK.DECIDE,
      options: [
        { label: "The sender alone" },
        { label: "The sender or any admin", detail: "Matches how an admin may remove a member." },
        { label: "Any member" },
      ],
      recommended: "The sender or any admin",
    },
    needsReply: true,
    addressee: undefined,
    ago: 2 * HOUR + 50 * MINUTE,
    answer: {
      by: DEMO_DEAN,
      choices: ["The sender or any admin"],
      text: "As Dana said on the plan.",
      ago: 45 * MINUTE,
    },
    followUp: {
      text: "Done: the sender or any admin may withdraw, and Withdraw shows on Settings › Members for both.",
      ago: 30 * MINUTE,
    },
    replies: [],
  },
  {
    agent: DEMO_INVITATIONS_AGENT,
    key: "link-expiry",
    channel: DEMO_PRODUCT_CHANNEL,
    title: "Should invite links last 7 days or 14?",
    body: "The plan assumes 7 days, and `INVITE_TTL_MS` says so for now. An invite sent on a Friday to someone away the next week runs out before they see it; a Resend action on a pending invite would cover that without a longer link.",
    ask: {
      type: INBOX_ASK.DECIDE,
      options: [
        {
          label: "7 days, with Resend",
          detail: "Short-lived links, and a way to send a fresh one.",
        },
        { label: "14 days" },
        { label: "30 days" },
      ],
      recommended: "7 days, with Resend",
    },
    needsReply: true,
    addressee: DEMO_DEAN,
    ago: 2 * HOUR + 48 * MINUTE,
    replies: [],
  },
  {
    agent: DEMO_INVITATIONS_AGENT,
    key: "postmark-token",
    channel: DEMO_ENGINEERING_CHANNEL,
    title: "Add the Postmark token to the preview environment",
    body: "Invite emails send through Postmark, and the preview deploy has no server token, so every invite sent there fails. I can't reach the hosting settings myself.",
    ask: {
      type: INBOX_ASK.DO,
      steps: [
        "Open Relay's project settings, then Environment Variables.",
        "Add `POSTMARK_SERVER_TOKEN` for Preview, from Postmark's Relay server › API Tokens.",
        "Redeploy the latest preview.",
      ],
    },
    needsReply: true,
    addressee: undefined,
    ago: 2 * HOUR + 46 * MINUTE,
    replies: [],
  },
  {
    agent: DEMO_INVITATIONS_AGENT,
    key: "invite-email-copy",
    channel: DEMO_DESIGN_CHANNEL,
    title: "What should the invite email say?",
    body: "The invite email is a placeholder. A few details decide its copy and layout.",
    ask: {
      type: INBOX_ASK.ANSWER,
      fields: [
        { type: INBOX_FIELD.TEXT, label: "Subject line", required: true },
        {
          type: INBOX_FIELD.SELECT,
          label: "Who it comes from",
          options: ["Relay", "The inviter, via Relay", "The workspace, via Relay"],
          recommended: "The inviter, via Relay",
        },
        { type: INBOX_FIELD.BOOLEAN, label: "Show the workspace's logo" },
        { type: INBOX_FIELD.NUMBER, label: "Days the link lasts", required: true },
      ],
    },
    needsReply: true,
    addressee: undefined,
    ago: 2 * HOUR + 44 * MINUTE,
    replies: [],
  },
  {
    agent: DEMO_INVITATIONS_AGENT,
    key: "pending-invites-shown",
    channel: DEMO_DESIGN_CHANNEL,
    title: "Pending invites now show on Settings › Members",
    body: 'Each pending invite has its own row under the members, with the email, who sent it, when it runs out, and **Withdraw**. A withdrawn link reads "This invite is no longer valid".',
    ask: undefined,
    needsReply: false,
    addressee: undefined,
    ago: 31 * MINUTE,
    replies: [],
  },
];

/** A thread a member opened with an agent, rather than one it posted. */
export interface DemoMemberThread {
  readonly by: DemoPerson;
  readonly agent: DemoAgent;
  readonly title: string;
  readonly text: string;
  readonly ago: number;
}

export const DEMO_MEMBER_THREADS: readonly DemoMemberThread[] = [
  {
    by: DANA,
    agent: DEMO_INVITATIONS_AGENT,
    title: "Do invites cover a workspace with SSO?",
    text: "A workspace that signs in through SSO shouldn't mail a password sign-up link. Can the accept page send the invitee to their SSO instead?",
    ago: 90 * MINUTE,
  },
];

/** How long before the seed's start the people joined. */
export const DEMO_JOINED_AGO = 45 * DAY;

export { DAY as DEMO_DAY, HOUR as DEMO_HOUR, MINUTE as DEMO_MINUTE };
