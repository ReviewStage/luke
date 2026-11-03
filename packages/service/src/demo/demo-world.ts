import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_KIND, type AgentKind } from "@repo/features/agent-wire";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { INBOX_ASK, INBOX_FIELD, type InboxAsk } from "@repo/features/inbox-wire";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@repo/features/task-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
import { ACTION_RESULT_STATUS, type WireRecord, type WireValue } from "@repo/wire";

/**
 * demo-world.ts -- the acme world the demo seed writes, as data: its people, its workspace, its tasks and their plans, the comments on them, its agents' transcripts, and the threads they and its members posted.
 *
 * The world is the changelog screenshots' (`.claude/skills/changelog-screenshots/WORLD.md`):
 * acme builds Relay, and Dean Stratakos owns its workspace beside seven
 * teammates. Its last two weeks are here: Teammate invitations and the
 * Postmark work around it, Usage-based billing broken into sub-tasks by a
 * pilot, webhook secret rotation, and a crash fixed this morning. Nothing
 * here is read from an account; every name and address is invented. Every
 * id is fixed, so two seeds of two fresh databases write the same rows, and
 * every time is a distance back from the seed's start, so the world always
 * reads as minutes, hours, and days old. The tasks name no repository,
 * since the demo reaches no GitHub, and the people have no photo, since an
 * app draws a picture from Google's or GitHub's hosts alone
 * (`account-picture.ts`), so each is drawn by their initial.
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
  /** An agent's turn, and the key its opening line is sent under. */
  TURN: "de300006",
  /** A tool call of a turn. */
  TOOL_CALL: "de300008",
  /** The key a member's write is taken under, so it is taken once. */
  CLIENT_KEY: "de300009",
  /** The host the run starts on this Mac for Dean's agents. */
  DEVICE: "de30000a",
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

/** acme's engineering lead, who keeps Relay's webhooks and mail running. */
const NOOR: DemoPerson = {
  id: demoId(DEMO_ID_KIND.USER, 6),
  name: "Noor Haddad",
  email: "noor@acme.dev",
  role: WORKSPACE_ROLE.ADMIN,
};

/** acme's designer. */
const MAYA: DemoPerson = {
  id: demoId(DEMO_ID_KIND.USER, 7),
  name: "Maya Chen",
  email: "maya@acme.dev",
  role: WORKSPACE_ROLE.MEMBER,
};

/** acme's support engineer, who hears about every crash first. */
const LUIS: DemoPerson = {
  id: demoId(DEMO_ID_KIND.USER, 8),
  name: "Luis Ortega",
  email: "luis@acme.dev",
  role: WORKSPACE_ROLE.MEMBER,
};

/** Everyone in acme, its owner first. */
export const DEMO_PEOPLE: readonly DemoPerson[] = [
  DEMO_DEAN,
  DANA,
  JORDAN,
  PRIYA,
  THEO,
  NOOR,
  MAYA,
  LUIS,
];

/** The workspace everything happens in, which Dean owns. */
export const DEMO_WORKSPACE_NAME = "acme";

/* ----- The host ----- */

/**
 * The host `run.sh --demo` starts on this Mac for the length of a run, as
 * Dean's own, on which every task runs its agents. Its name stands only
 * until the host's first register renames it for the Mac's Computer Name.
 */
export const DEMO_HOST = {
  id: demoId(DEMO_ID_KIND.DEVICE, 1),
  name: "This Mac",
  platform: DEVICE_PLATFORM.DARWIN,
  arch: DEVICE_ARCH.ARM64,
} as const;

/* ----- The tasks ----- */

/** A comment of a plan's thread after its first: who wrote it, and what. */
export interface DemoCommentReply {
  readonly by: DemoPerson;
  readonly words: string;
}

/**
 * One plan's comment thread: on which words of the plan, what its first
 * comment said, who answered, and who resolved it, where it stands
 * resolved. The replies follow a minute apart.
 */
export interface DemoCommentWords {
  /** The plan's words the thread is on, which must stand in its text once. */
  readonly quote: string;
  readonly words: string;
  readonly replies: readonly DemoCommentReply[];
  readonly ago: number;
  readonly resolved?: { readonly by: DemoPerson; readonly ago: number };
}

/** A comment thread a member started on a plan. */
export interface DemoComment extends DemoCommentWords {
  readonly by: DemoPerson;
}

/** One task of acme's: who made it, where it stands, the task it is a child of, its plan, and the comments on it. */
export interface DemoTask {
  readonly id: string;
  readonly name: string;
  readonly creator: DemoPerson;
  readonly assignee: DemoPerson;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  /** The task it is a child of, which comes before it; none for a task at the top. */
  readonly parent?: DemoTask;
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
    "- An invite expires after 7 days.\n" +
    "- The sender or any admin may withdraw an invite (Dean, in the Inbox).",
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
  Breakdown:
    "- Record usage events per workspace\n" +
    "- Daily usage rollup\n" +
    "- Report usage to Stripe, after the rollup\n" +
    "- Usage on Settings › Billing, after the rollup",
  Decisions:
    "- An unused allowance does not roll over to the next month (Dean, in the Inbox).\n" +
    "- Every Stripe write checks `billing.metered` for its workspace, so the design partners go first (Noor).",
  "Open questions":
    "- What does a workspace on the old flat plan see on Settings › Billing before its renewal?",
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

const USAGE_EVENTS_PLAN = planText({
  Problem:
    "Nothing counts what a workspace uses. The delivery log holds every delivery, but it is " +
    "pruned after 30 days and is not keyed for billing.",
  "Acceptance criteria":
    "- Every webhook delivery that lands writes one `usage_events` row: its workspace, its kind, and when.\n" +
    "- A redelivery of the same event writes none.\n" +
    "- `pnpm test src/usage` covers both.",
  Decisions:
    "- The event is written in the worker's own transaction (`src/webhooks/worker.ts`), so a delivery and its count never disagree.\n" +
    "- Test events do not count (Dana, in the Inbox).",
});

const ROLLUP_PLAN = planText({
  Problem:
    "Summing `usage_events` on every request is too slow for **Settings › Billing** and for Stripe's daily report.",
  "Acceptance criteria":
    "- One `usage_daily` row per workspace per day, written by a job at 00:15.\n" +
    "- The job is idempotent: running it twice for a day writes the same rows.\n" +
    "- A backfill fills the days since usage events started, a day at a time.",
  Decisions: "- A day is a UTC day, as Stripe's invoice period is (Jordan, in the Inbox).",
  "Open questions": "- How far back should the backfill go?",
});

const STRIPE_PLAN = planText({
  Problem: "Stripe invoices only the usage it is told about, and today it is told nothing.",
  "Acceptance criteria":
    "- Each day's total per workspace is reported to the subscription's metered price once.\n" +
    "- A report that fails is retried on the next run and never counted twice, under a Stripe " +
    "idempotency key per workspace per day.",
  Decisions: "- Report from `usage_daily`, never from raw events.",
  "Open questions":
    "- Does a workspace on the old flat plan get a metered price at all, or stay flat until renewal?",
});

const BILLING_PAGE_PLAN = planText({
  Problem: "An admin cannot see what their workspace used until the invoice arrives.",
  "Acceptance criteria":
    "- **Settings › Billing** shows this month's deliveries by day and the projected invoice.\n" +
    '- The projection reads "as of yesterday", since the rollup runs once a day.\n' +
    "- A month with no deliveries shows the allowance, not an empty chart.",
  "Open questions": "- Show the projection to every member, or to admins alone?",
});

const VERIFY_POSTMARK_PLAN = planText({
  Problem:
    "Postmark sends from `acme.relay.dev` alone. Mail from `acme.dev` lands in spam, so invite " +
    "emails cannot ship until the domain is verified.",
  "Acceptance criteria":
    "- The DKIM and Return-Path records for `acme.dev` verify in Postmark.\n" +
    "- A test invite from the preview lands in a Gmail inbox, not in spam.",
  Decisions:
    "- The Return-Path is `pm-bounces.acme.dev`, where Handle Postmark bounces reads them.",
});

const INVITE_EMAILS_PLAN = planText({
  Problem: "`POST /invites` writes the invite email to the console. Invitees get nothing.",
  "Acceptance criteria":
    "- The invite email sends through Postmark's `invites` stream, from the React Email template " +
    "in `src/mail/templates/invite.tsx`.\n" +
    "- It carries a plain-text part beside the HTML.\n" +
    "- A send Postmark refuses is logged with the invite's id.",
  "Open questions":
    "- The card with acme's mark, or the plain email?\n" +
    "- Who does it come from: Relay, or the inviter via Relay?",
});

const RESEND_PLAN = planText({
  Problem:
    "An expired invite can only be withdrawn and sent again, which mails a second link and " +
    "leaves the first row behind.",
  "Acceptance criteria":
    "- A pending or expired invite has **Resend** on Settings › Members.\n" +
    '- Resend mints a new token, moves the expiry 7 days on, and mails the new link; the old link reads "no longer valid".',
  "Open questions": "- Should Resend be limited to a few times a day per invite?",
});

const BOUNCES_PLAN = planText({
  Problem:
    "An invite to a mistyped address bounces silently, and the inviter waits for someone who never got it.",
  "Acceptance criteria":
    "- Postmark's bounce webhook (`POST /webhooks/postmark`) marks the invite bounced.\n" +
    '- Settings › Members shows "Bounced" on that invite, with **Edit email**.',
  Decisions: "- Hard bounces alone; Postmark retries soft ones itself.",
});

const ROTATE_PLAN = planText({
  Problem:
    "An endpoint's signing secret is set once, as the endpoint is made. A customer who leaks it " +
    "has to delete the endpoint and lose its delivery history.",
  "Acceptance criteria":
    "- An admin rotates an endpoint's secret from **Settings › Webhooks**.\n" +
    "- For an overlap after, deliveries carry both signatures, so a receiver can switch over without dropping events.\n" +
    "- The old secret stops signing at the end of the overlap, and the endpoint keeps its history.",
  Decisions:
    "- Both signatures go in one `Relay-Signature` header, comma-separated, as Stripe does.\n" +
    "- The overlap is 72 hours (Priya, in the Inbox).",
  "Open questions": "- Should rotating from the API come with this, or after?",
});

const RETRY_429_PLAN = planText({
  Problem: "Postmark answers 429 past 50 sends a second, and the mailer drops the email.",
  "Acceptance criteria":
    "- A 429 is retried up to 5 times, waiting as long as its `Retry-After` says.\n" +
    "- A send still refused after that is logged with its message id.",
});

const INVOICE_PDF_PLAN = planText({
  Problem:
    "The invoice PDF is Stripe's default: no logo, no usage breakdown, and acme's old legal name.",
  "Acceptance criteria":
    "- acme's mark and legal name on every invoice.\n" +
    "- Usage lines show the month's deliveries past the allowance.",
  "Open questions":
    "- Render our own PDF, or style Stripe's through its invoice template settings?",
});

const CHART_CRASH_PLAN = planText({
  Problem:
    'Opening the dashboard of a workspace made today throws "RangeError: Invalid array length", ' +
    "and the whole page goes blank. Three support tickets since yesterday.",
  "Acceptance criteria":
    "- A workspace with no deliveries shows the empty chart, not an error.\n" +
    "- A test opens the chart over a range of zero days.",
});

const EMPTY_STATE_PLAN = planText({
  Problem: "A workspace with its owner alone shows an empty table on **Settings › Members**.",
  "Acceptance criteria":
    '- An owner alone sees "Invite your team" with the invite button.\n' +
    "- The table returns as soon as anyone joins.",
});

const EXPIRE_PLAN = planText({
  Problem: "Invite links never expire, so one forwarded months later still joins the workspace.",
  "Acceptance criteria":
    '- A link opened after its expiry reads "This invite has expired" and grants nothing.\n' +
    "- `INVITE_TTL_MS` is the one place the expiry is set.",
  "Open questions": "- 7 days with Resend, or 14? (Dean, in the Inbox.)",
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

/** Dana's task, which Dean's pilot broke into four sub-tasks. */
export const DEMO_BILLING_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 2),
  name: "Usage-based billing",
  creator: DANA,
  assignee: DANA,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
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
    {
      by: JORDAN,
      quote: "The projected invoice reads the rollup, never the raw log.",
      words:
        "The rollup runs once a day, so the projection is always a day behind. Is that fine on the Billing page?",
      replies: [{ by: DANA, words: 'Yes. Label it "as of yesterday" and nobody will mind.' }],
      ago: 2 * DAY + 5 * HOUR,
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
  comments: [
    {
      by: PRIYA,
      quote: "2 hours, and 12",
      words:
        "The goal says 24 hours, but these waits add up to about 15. Should the last one be longer?",
      replies: [
        {
          by: DANA,
          words:
            "15 is fine for now: every ticket support has is an outage under an hour. I'll fix the goal's wording.",
        },
      ],
      ago: 2 * DAY + 20 * HOUR,
      resolved: { by: PRIYA, ago: 2 * DAY + 19 * HOUR },
    },
  ],
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

/** The pilot's first sub-task of Usage-based billing, finished and merged. */
const USAGE_EVENTS_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 8),
  name: "Record usage events per workspace",
  creator: DEMO_DEAN,
  assignee: DANA,
  status: TASK_STATUS.DONE,
  priority: TASK_PRIORITY.HIGH,
  parent: DEMO_BILLING_TASK,
  createdAgo: 3 * DAY + HOUR + 56 * MINUTE,
  savedAgo: 2 * DAY + 8 * HOUR,
  settledAgo: 2 * DAY + 6 * HOUR,
  plan: USAGE_EVENTS_PLAN,
  comments: [],
};

const DEMO_ROLLUP_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 9),
  name: "Daily usage rollup",
  creator: DEMO_DEAN,
  assignee: JORDAN,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
  parent: DEMO_BILLING_TASK,
  createdAgo: 3 * DAY + HOUR + 55 * MINUTE,
  savedAgo: 1 * DAY + 22 * HOUR,
  plan: ROLLUP_PLAN,
  comments: [],
};

const STRIPE_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 10),
  name: "Report usage to Stripe",
  creator: DEMO_DEAN,
  assignee: DANA,
  status: TASK_STATUS.TODO,
  priority: TASK_PRIORITY.MEDIUM,
  parent: DEMO_BILLING_TASK,
  createdAgo: 3 * DAY + HOUR + 54 * MINUTE,
  savedAgo: 3 * DAY + HOUR + 54 * MINUTE,
  plan: STRIPE_PLAN,
  comments: [],
};

const BILLING_PAGE_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 11),
  name: "Usage on Settings › Billing",
  creator: DEMO_DEAN,
  assignee: MAYA,
  status: TASK_STATUS.TODO,
  priority: TASK_PRIORITY.MEDIUM,
  parent: DEMO_BILLING_TASK,
  createdAgo: 3 * DAY + HOUR + 53 * MINUTE,
  savedAgo: 2 * DAY + 2 * HOUR,
  plan: BILLING_PAGE_PLAN,
  comments: [],
};

const VERIFY_POSTMARK_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 12),
  name: "Verify acme.dev with Postmark",
  creator: DANA,
  assignee: DANA,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.URGENT,
  createdAgo: 3 * DAY + 6 * HOUR,
  savedAgo: 1 * DAY + 4 * HOUR,
  plan: VERIFY_POSTMARK_PLAN,
  comments: [
    {
      by: NOOR,
      quote: "Return-Path records",
      words:
        "Use `pm-bounces.acme.dev` for the Return-Path, so Handle Postmark bounces reads every bounce from one place.",
      replies: [{ by: DANA, words: "Done: the CNAME is in, and the plan says so." }],
      ago: 2 * DAY + 3 * HOUR,
      resolved: { by: NOOR, ago: 1 * DAY + 4 * HOUR },
    },
  ],
};

const INVITE_EMAILS_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 13),
  name: "Invite emails through Postmark",
  creator: DEMO_DEAN,
  assignee: DEMO_DEAN,
  status: TASK_STATUS.TODO,
  priority: TASK_PRIORITY.HIGH,
  createdAgo: 1 * DAY + 23 * HOUR,
  savedAgo: 1 * DAY + 20 * HOUR,
  plan: INVITE_EMAILS_PLAN,
  comments: [],
};

const RESEND_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 14),
  name: "Resend an expired invite",
  creator: PRIYA,
  assignee: LUIS,
  status: TASK_STATUS.BACKLOG,
  priority: TASK_PRIORITY.MEDIUM,
  createdAgo: 30 * MINUTE,
  savedAgo: 28 * MINUTE,
  plan: RESEND_PLAN,
  comments: [],
};

const BOUNCES_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 15),
  name: "Handle Postmark bounces",
  creator: NOOR,
  assignee: THEO,
  status: TASK_STATUS.TODO,
  priority: TASK_PRIORITY.MEDIUM,
  createdAgo: 1 * DAY + 18 * HOUR,
  savedAgo: 1 * DAY + 17 * HOUR,
  plan: BOUNCES_PLAN,
  comments: [],
};

const ROTATE_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 16),
  name: "Rotate webhook signing secrets",
  creator: NOOR,
  assignee: PRIYA,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
  createdAgo: 8 * DAY,
  savedAgo: 1 * DAY + 2 * HOUR,
  plan: ROTATE_PLAN,
  comments: [
    {
      by: THEO,
      quote: "comma-separated, as Stripe does",
      words:
        "Our Go SDK splits the header on spaces. Commas are fine, but the SDK needs a release before customers can verify both.",
      replies: [],
      ago: 1 * DAY + 50 * MINUTE,
    },
  ],
};

const RETRY_429_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 17),
  name: "Retry Postmark sends on a 429",
  creator: THEO,
  assignee: THEO,
  status: TASK_STATUS.DONE,
  priority: TASK_PRIORITY.HIGH,
  createdAgo: 10 * DAY,
  savedAgo: 9 * DAY,
  settledAgo: 7 * DAY,
  plan: RETRY_429_PLAN,
  comments: [],
};

const INVOICE_PDF_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 18),
  name: "Invoice PDF redesign",
  creator: DANA,
  assignee: MAYA,
  status: TASK_STATUS.BACKLOG,
  priority: TASK_PRIORITY.LOW,
  createdAgo: 13 * DAY,
  savedAgo: 13 * DAY,
  plan: INVOICE_PDF_PLAN,
  comments: [],
};

const CHART_CRASH_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 19),
  name: "Fix the usage chart crash on a new workspace",
  creator: LUIS,
  assignee: JORDAN,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.URGENT,
  createdAgo: 5 * HOUR,
  savedAgo: 2 * HOUR + 20 * MINUTE,
  plan: CHART_CRASH_PLAN,
  comments: [
    {
      by: LUIS,
      quote: "Three support tickets since yesterday.",
      words: "Four now: Harbor Labs hit it on their trial this morning.",
      replies: [],
      ago: 2 * HOUR + 15 * MINUTE,
    },
  ],
};

const EMPTY_STATE_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 20),
  name: "Members page empty state",
  creator: MAYA,
  assignee: MAYA,
  status: TASK_STATUS.DONE,
  priority: TASK_PRIORITY.LOW,
  createdAgo: 14 * DAY,
  savedAgo: 12 * DAY,
  settledAgo: 11 * DAY,
  plan: EMPTY_STATE_PLAN,
  comments: [
    {
      by: DEMO_DEAN,
      quote: '"Invite your team"',
      words: "Could it say what a teammate sees once they join? Owners ask before they invite.",
      replies: [
        { by: MAYA, words: 'Added a line under it: "Members see every endpoint and delivery."' },
      ],
      ago: 13 * DAY,
      resolved: { by: DEMO_DEAN, ago: 12 * DAY + 20 * HOUR },
    },
  ],
};

const EXPIRE_TASK: DemoTask = {
  id: demoId(DEMO_ID_KIND.TASK, 21),
  name: "Expire invite links after 7 days",
  creator: DEMO_DEAN,
  assignee: DEMO_DEAN,
  status: TASK_STATUS.TODO,
  priority: TASK_PRIORITY.NONE,
  createdAgo: 2 * HOUR + 40 * MINUTE,
  savedAgo: 2 * HOUR + 38 * MINUTE,
  plan: EXPIRE_PLAN,
  comments: [],
};

/**
 * acme's tasks, oldest first, so the list reads newest first as the service
 * orders it. The pilot's four sub-tasks are among them, made as its
 * transcript makes them (`DemoCall`'s `creates`).
 */
export const DEMO_TASKS: readonly DemoTask[] = [
  SSO_TASK,
  EMPTY_STATE_TASK,
  INVOICE_PDF_TASK,
  DARK_MODE_TASK,
  RETRY_429_TASK,
  ROTATE_TASK,
  AUDIT_TASK,
  DEMO_BILLING_TASK,
  VERIFY_POSTMARK_TASK,
  USAGE_EVENTS_TASK,
  DEMO_ROLLUP_TASK,
  STRIPE_TASK,
  BILLING_PAGE_TASK,
  DEMO_WEBHOOKS_TASK,
  DEMO_ONBOARDING_TASK,
  DEMO_INVITATIONS_TASK,
  INVITE_EMAILS_TASK,
  BOUNCES_TASK,
  CHART_CRASH_TASK,
  EXPIRE_TASK,
  RESEND_TASK,
];

/** One task waiting on another: the blocker, the task it blocks, who said so, and when. */
export interface DemoBlock {
  readonly blocker: DemoTask;
  readonly blocked: DemoTask;
  readonly by: DemoPerson;
  readonly ago: number;
}

/** The blocks between acme's tasks, as WORLD.md has them, and the rollup holding up the two sub-tasks after it. */
export const DEMO_BLOCKS: readonly DemoBlock[] = [
  {
    blocker: DEMO_ROLLUP_TASK,
    blocked: STRIPE_TASK,
    by: DEMO_DEAN,
    ago: 3 * DAY + HOUR + 50 * MINUTE,
  },
  {
    blocker: DEMO_ROLLUP_TASK,
    blocked: BILLING_PAGE_TASK,
    by: DEMO_DEAN,
    ago: 3 * DAY + HOUR + 50 * MINUTE,
  },
  {
    blocker: VERIFY_POSTMARK_TASK,
    blocked: INVITE_EMAILS_TASK,
    by: DEMO_DEAN,
    ago: 1 * DAY + 22 * HOUR,
  },
  { blocker: DEMO_INVITATIONS_TASK, blocked: BOUNCES_TASK, by: NOOR, ago: 1 * DAY + 17 * HOUR },
  { blocker: DEMO_INVITATIONS_TASK, blocked: RESEND_TASK, by: PRIYA, ago: 27 * MINUTE },
];

/* ----- The agents ----- */

/** One tool call of a step, as a Claude Code transcript stores it: by the CLI's own name, or our tool's for a call to our MCP server (`claudeCodeWorkspaceTool`); what it was handed, and what it answered. */
export interface DemoToolCall {
  readonly name: string;
  readonly input: WireRecord;
  readonly output: WireValue;
}

/** A page an agent showed on its task: its title, the file it was read from, and its HTML. */
export interface DemoPage {
  readonly title: string;
  readonly path: string;
  readonly html: string;
}

/** What one thread's first post says: its key, title, words, ask, and the member it is addressed to, if any. */
export interface DemoPost {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly ask: InboxAsk | undefined;
  readonly addressee: DemoPerson | undefined;
}

/**
 * The call a step made: a tool call as it was answered, or one of our
 * workspace tools that writes what the world holds elsewhere, whose call the
 * seed draws from what it wrote: a sub-task it made, an agent it started, a
 * page it showed, or a thread it posted.
 */
export type DemoCall =
  | DemoToolCall
  | { readonly creates: DemoTask }
  | { readonly starts: DemoAgent }
  | { readonly page: DemoPage }
  | { readonly posts: DemoPost };

/** One step of a turn: what the agent said, if anything, then the call it made, if any. */
export interface DemoStep {
  readonly text: string;
  readonly call?: DemoCall;
}

/**
 * One turn: the line that opened it and the member who sent it, when it
 * started and how long it ran, and its steps. The first line of an agent
 * another started is sent by its starter, for the member named.
 */
export interface DemoTurn {
  readonly id: string;
  readonly from: DemoPerson;
  readonly line: string;
  readonly startedAgo: number;
  readonly ranFor: number;
  readonly steps: readonly DemoStep[];
  readonly tokens: { readonly input: number; readonly output: number; readonly cached: number };
}

/**
 * One finished coding agent: the task it worked on, its kind, who started
 * it, on what, its turns, oldest first, and the comment threads it started
 * on its task's plan. An agent another started with `start_agent` names
 * its starter alone in that agent's steps (`DemoCall`'s `starts`), its
 * first line sent by it.
 */
export interface DemoAgent {
  /** The key its Start is taken under, so a second seed of the same database starts no second agent. */
  readonly key: string;
  readonly task: DemoTask;
  readonly kind?: AgentKind;
  readonly title: string;
  readonly model: string;
  readonly effort: string;
  readonly turns: readonly [DemoTurn, ...DemoTurn[]];
  readonly comments?: readonly DemoCommentWords[];
}

const OPUS = "anthropic/claude-opus-5.5";
const SONNET = "anthropic/claude-sonnet-5.5";

/** A page in acme's own palette (WORLD.md): a warm canvas, white cards, and teal as its one accent. */
function relayPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; padding: 24px; background: #f3f1ec; color: #1b1d21; font: 15px/1.5 -apple-system, system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0 0 16px; color: #55585e; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .card { background: #fff; border: 1px solid #e2e0da; border-radius: 12px; padding: 16px; }
  .card h2 { font-size: 15px; margin: 0 0 12px; }
  .box { border-radius: 8px; background: #f3f1ec; height: 28px; margin-bottom: 8px; }
  .accent { background: #ccebe7; border: 1px solid #0f766e; }
  .tag { display: inline-block; margin-top: 8px; padding: 2px 8px; border-radius: 999px; background: #0f766e; color: #fff; font-size: 12px; }
  .chart { overflow-x: auto; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

const CHECKLIST_PLACEMENTS_PAGE: DemoPage = {
  title: "Checklist placements",
  path: "/tmp/shared/checklist-placements.html",
  html: relayPage(
    "Checklist placements",
    `<h1>Where the onboarding checklist could sit</h1>
<p>Each card is the dashboard of a workspace made today. The checklist is in teal.</p>
<div class="grid">
  <div class="card"><h2>Above the usage chart</h2><div class="box"></div><div class="box accent" style="height:64px"></div><div class="box" style="height:96px"></div><span class="tag">Recommended</span></div>
  <div class="card"><h2>In the right-hand column</h2><div class="box"></div><div style="display:flex;gap:8px"><div class="box" style="flex:2;height:160px"></div><div class="box accent" style="flex:1;height:96px"></div></div></div>
  <div class="card"><h2>As a banner under the header</h2><div class="box"></div><div class="box accent" style="height:20px"></div><div class="box" style="height:136px"></div></div>
</div>`,
  ),
};

/** The days of acme's own usage the rollup page draws, oldest first: deliveries in thousands. */
const USAGE_BY_DAY = [18, 21, 20, 9, 7, 23, 26, 25, 27, 24, 11, 8, 29, 31];

const USAGE_BY_DAY_PAGE: DemoPage = {
  title: "Usage by day",
  path: "/tmp/shared/usage-by-day.html",
  html: relayPage(
    "Usage by day",
    `<h1>acme's deliveries by UTC day, last 14 days</h1>
<p>From <code>usage_daily</code> after the backfill: ${USAGE_BY_DAY.reduce((sum, day) => sum + day, 0)}k deliveries, the weekends low.</p>
<div class="card chart"><svg viewBox="0 0 448 180" width="100%" role="img" aria-label="Deliveries by day">
${USAGE_BY_DAY.map(
  (day, index) =>
    `<rect x="${index * 32 + 4}" y="${160 - day * 4.5}" width="24" height="${day * 4.5}" rx="4" fill="#0f766e"/>`,
).join("\n")}
<line x1="0" y1="160" x2="448" y2="160" stroke="#e2e0da"/>
</svg></div>`,
  ),
};

/* ----- What the agents posted ----- */

const CHECKLIST_PLACEMENT_POST: DemoPost = {
  key: "checklist-placement",
  title: "Where should the onboarding checklist sit?",
  body: "The checklist is built and ticks itself from what the workspace already has. It needs a place on the dashboard, and each spot pushes something else down. The three are drawn side by side on the task's **Checklist placements** page.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [
      { label: "Above the usage chart", detail: "Seen first, and it folds away once done." },
      { label: "In the right-hand column", detail: "Out of the way, but easy to miss." },
      { label: "As a banner under the header" },
    ],
    recommended: "Above the usage chart",
  },
  addressee: JORDAN,
};

const CHECKLIST_HIDE_POST: DemoPost = {
  key: "checklist-hide",
  title: "Who may hide the checklist for the whole workspace?",
  body: "Each member can already dismiss it for themselves. Theo's comment on the plan asks for one switch that hides it for everyone, which design partners asked for.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [
      { label: "Admins alone", detail: "One switch in Settings › Workspace." },
      { label: "Any member" },
      { label: "No one: each member dismisses their own" },
    ],
    recommended: "Admins alone",
  },
  addressee: DEMO_DEAN,
};

const RETRIES_SHIPPED_POST: DemoPost = {
  key: "retries-shipped",
  title: "Shipped: webhook retries",
  body: "Failed deliveries now retry 5 times over about 15 hours, then stand dead until an admin replays them from **Settings › Webhooks**. The worker's attempts are in the new `delivery_attempts` table.",
  ask: undefined,
  addressee: undefined,
};

const REPLAY_DEAD_POST: DemoPost = {
  key: "replay-dead-deliveries",
  title: "Replay the 312 deliveries that died before retries?",
  body: "Between Oct 20 and Oct 28, 312 deliveries failed once and were dropped, across 41 workspaces. They can be replayed now, but some customers may have rebuilt the data by hand since.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [
      { label: "Replay them, oldest first" },
      { label: "Replay only for workspaces that ask" },
      { label: "Leave them dead" },
    ],
    recommended: "Replay them, oldest first",
  },
  addressee: DANA,
};

const WITHDRAW_POST: DemoPost = {
  key: "withdraw-invite",
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
  addressee: undefined,
};

const LINK_EXPIRY_POST: DemoPost = {
  key: "link-expiry",
  title: "Should invite links last 7 days or 14?",
  body: "The plan assumes 7 days, and `INVITE_TTL_MS` says so for now. An invite sent on a Friday to someone away the next week runs out before they see it; a Resend action on a pending invite would cover that without a longer link.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [
      { label: "7 days, with Resend", detail: "Short-lived links, and a way to send a fresh one." },
      { label: "14 days" },
      { label: "30 days" },
    ],
    recommended: "7 days, with Resend",
  },
  addressee: DEMO_DEAN,
};

const POSTMARK_TOKEN_POST: DemoPost = {
  key: "postmark-token",
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
  addressee: undefined,
};

const INVITE_EMAIL_COPY_POST: DemoPost = {
  key: "invite-email-copy",
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
  addressee: undefined,
};

const PENDING_INVITES_POST: DemoPost = {
  key: "pending-invites-shown",
  title: "Pending invites now show on Settings › Members",
  body: 'Each pending invite has its own row under the members, with the email, who sent it, when it runs out, and **Withdraw**. A withdrawn link reads "This invite is no longer valid".',
  ask: undefined,
  addressee: undefined,
};

const USAGE_BREAKDOWN_POST: DemoPost = {
  key: "usage-breakdown",
  title: "Usage-based billing is four sub-tasks",
  body: [
    "I broke Usage-based billing into four sub-tasks, in the order they can land:",
    "",
    "1. **Record usage events per workspace**: started now, on Sonnet.",
    "2. **Daily usage rollup**: starts once events land.",
    "3. **Report usage to Stripe**: waits on the rollup.",
    "4. **Usage on Settings › Billing**: waits on the rollup; Maya has it.",
    "",
    "Dana stays the parent's owner. I'll write here as each one lands.",
  ].join("\n"),
  ask: undefined,
  addressee: DEMO_DEAN,
};

const ALLOWANCE_POST: DemoPost = {
  key: "allowance-rollover",
  title: "Does an unused allowance roll over?",
  body: "The plan's open question. A workspace that sends 40,000 deliveries on a 50,000 allowance either carries 10,000 into next month or starts again at zero. Rollover is kinder, but makes the projected invoice harder to read.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [
      { label: "No, it resets each month", detail: "The invoice reads the same every month." },
      { label: "Yes, for one month" },
      { label: "Yes, with no limit" },
    ],
    recommended: "No, it resets each month",
  },
  addressee: DEMO_DEAN,
};

const STRIPE_KEYS_POST: DemoPost = {
  key: "stripe-test-keys",
  title: "Add Stripe's test keys to the preview",
  body: "Report usage to Stripe can't run end to end on the preview: it has no Stripe keys, and its metered price doesn't exist in test mode yet.",
  ask: {
    type: INBOX_ASK.DO,
    steps: [
      "In Stripe's dashboard, switch to test mode and open Developers › API keys.",
      "Add `STRIPE_SECRET_KEY` for Preview in Relay's project settings.",
      "Create the metered price `deliveries_per_1000` on the Relay product, in test mode.",
      "Add its id as `STRIPE_METERED_PRICE` for Preview, and redeploy.",
    ],
  },
  addressee: DEMO_DEAN,
};

const USAGE_PROGRESS_POST: DemoPost = {
  key: "usage-progress",
  title: "Where usage-based billing stands",
  body: [
    "Two of four sub-tasks are moving:",
    "",
    "- **Record usage events per workspace**: merged two days ago. Every delivery that lands writes one `usage_events` row, test events left out, as Dana chose.",
    "- **Daily usage rollup**: built and tested. Jordan settled the day as UTC. It waits on your answer about how far back to backfill before it merges.",
    "- **Report usage to Stripe**: not started. It needs the preview's test keys first (the other thread), then the rollup.",
    "- **Usage on Settings › Billing**: not started. Maya has the designs; it starts after the rollup.",
    "",
    "Noor asked that every Stripe write check `billing.metered` per workspace, so the design partners go first. It is in the plan's Decisions. At this pace the four land in about a week, and Legal's 30 days' notice starts when Dana sends the email.",
  ].join("\n"),
  ask: undefined,
  addressee: DEMO_DEAN,
};

const COUNT_TEST_EVENTS_POST: DemoPost = {
  key: "count-test-events",
  title: "Should test events count toward usage?",
  body: "**Send test event** on Settings › Webhooks goes through the same worker as a real delivery. Counted, a customer debugging an endpoint pays for it.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [
      { label: "Leave test events out" },
      { label: "Count them", detail: "Simplest, and test events are rare." },
    ],
    recommended: "Leave test events out",
  },
  addressee: DANA,
};

const USAGE_EVENTS_SHIPPED_POST: DemoPost = {
  key: "usage-events-shipped",
  title: "Shipped: usage events per workspace",
  body: "Every delivery that lands now writes one `usage_events` row in the worker's own transaction, keyed by its event so a redelivery writes none, and test events are left out. The rollup can read from it.",
  ask: undefined,
  addressee: undefined,
};

const DAY_BOUNDARY_POST: DemoPost = {
  key: "rollup-day-boundary",
  title: "Where does a usage day end?",
  body: "`usage_daily` keeps one row per workspace per day, so something has to say when a day ends. Stripe's invoice periods are UTC; a workspace in Sydney would see its Monday split across two rows.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [
      { label: "At UTC midnight", detail: "One job, and the days match Stripe's." },
      { label: "At the workspace's own midnight", detail: "A job per time zone." },
    ],
    recommended: "At UTC midnight",
  },
  addressee: undefined,
};

const BACKFILL_POST: DemoPost = {
  key: "rollup-backfill",
  title: "How far back should the rollup backfill?",
  body: "Usage events go back 30 days, and the delivery log 90 before it is pruned. The backfill reads a day at a time, about a minute a day.",
  ask: {
    type: INBOX_ASK.ANSWER,
    fields: [
      { type: INBOX_FIELD.NUMBER, label: "Days to backfill", required: true },
      {
        type: INBOX_FIELD.SELECT,
        label: "Read the days before usage events from",
        options: ["The delivery log", "Nowhere: start at the first usage event"],
        recommended: "The delivery log",
      },
      { type: INBOX_FIELD.BOOLEAN, label: "Run it outside business hours" },
    ],
  },
  addressee: DEMO_DEAN,
};

const OVERLAP_POST: DemoPost = {
  key: "rotation-overlap",
  title: "How long should the old secret keep signing?",
  body: "After a rotation, deliveries carry both signatures until the overlap ends. Too short and a customer's deploy misses it; too long and a leaked secret stays useful.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [
      { label: "24 hours" },
      { label: "72 hours", detail: "Covers a weekend." },
      { label: "Until an admin revokes it" },
    ],
    recommended: "72 hours",
  },
  addressee: PRIYA,
};

const CUSTOMER_EMAIL_POST: DemoPost = {
  key: "rotation-customer-email",
  title: "What should the rotation email tell customers?",
  body: "Every admin of a workspace gets an email when one of its endpoints' secrets is rotated. A few details decide what it says.",
  ask: {
    type: INBOX_ASK.ANSWER,
    fields: [
      { type: INBOX_FIELD.TEXT, label: "Subject line", required: true },
      { type: INBOX_FIELD.BOOLEAN, label: "Name who rotated it" },
      {
        type: INBOX_FIELD.SELECT,
        label: "Link to",
        options: ["The endpoint's settings", "The signing docs", "Both"],
        recommended: "Both",
      },
    ],
  },
  addressee: DEMO_DEAN,
};

const ROTATION_PREVIEW_POST: DemoPost = {
  key: "rotation-preview",
  title: "Rotation works on the preview",
  body: [
    "To try it on the preview:",
    "",
    "1. Open **Settings › Webhooks** on the acme workspace and pick the `orders` endpoint.",
    "2. Press **Rotate secret** and copy the new one.",
    "3. Send a test event: its `Relay-Signature` header carries `v1=…,v1=…`, the old secret's and the new one's.",
    "4. Verify with either secret; both pass until the overlap ends, 72 hours on.",
    "",
    "The endpoint keeps its delivery history throughout.",
  ].join("\n"),
  ask: undefined,
  addressee: undefined,
};

const CHART_CAUSE_POST: DemoPost = {
  key: "chart-crash-cause",
  title: "Found it: the usage chart on a workspace's first day",
  body: [
    "A workspace made today has a range of zero days, and `src/dashboard/usage-chart.tsx` asked for one bucket fewer than that:",
    "",
    "```ts",
    "const buckets = new Array(days - 1).fill(0);",
    "```",
    "",
    "`new Array(-1)` throws `RangeError: Invalid array length`, and nothing caught it, so the whole dashboard went blank. It now draws at least one empty bucket, and a test opens the chart over zero days. Every workspace made since Monday's chart change hit it.",
  ].join("\n"),
  ask: undefined,
  addressee: undefined,
};

const HOTFIX_POST: DemoPost = {
  key: "chart-hotfix",
  title: "Promote the chart hotfix to production",
  body: "The fix is on its preview and its checks pass. Promoting it is a production deploy, which is yours.",
  ask: {
    type: INBOX_ASK.DO,
    steps: [
      "Open the hotfix preview and load the dashboard of a workspace made today.",
      "Check the chart draws empty rather than blanking the page.",
      "Promote the preview to production.",
    ],
  },
  addressee: DEMO_DEAN,
};

/* ----- The agents' transcripts ----- */

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
          call: {
            name: "Read",
            input: { file_path: "src/db/schema/memberships.ts" },
            output:
              'export const memberships = pgTable("memberships", {\n  id: uuid("id").primaryKey(),\n  workspaceId: uuid("workspace_id").notNull(),\n  userId: uuid("user_id").notNull(),\n  role: text("role").notNull(),\n});',
          },
        },
        {
          text: "Adding the `state` column, backfilled `active`, and an `invite_token` for the link.",
          call: {
            name: "Bash",
            input: { command: "pnpm drizzle-kit generate --name=membership_invites" },
            output: "[✓] Your SQL migration file ➜ drizzle/0042_membership_invites.sql",
          },
        },
        {
          text: "Writing `inviteMember`, `acceptInvite`, and `withdrawInvite`, following `src/members/remove.ts`.",
          call: {
            name: "Write",
            input: { file_path: "src/members/invite.ts" },
            output: "File created successfully at: src/members/invite.ts",
          },
        },
        {
          text: "Running the members tests.",
          call: {
            name: "Bash",
            input: { command: "pnpm test src/members" },
            output:
              " ✓ src/members/invite.test.ts (9 tests)\n ✓ src/members/remove.test.ts (5 tests)\n\n Test Files  2 passed (2)\n      Tests  14 passed (14)",
          },
        },
        {
          text: "The plan leaves two things open. Asking who may withdraw.",
          call: { posts: WITHDRAW_POST },
        },
        { text: "And how long a link lasts.", call: { posts: LINK_EXPIRY_POST } },
        { text: "The preview can't send mail yet.", call: { posts: POSTMARK_TOKEN_POST } },
        { text: "The email's copy is a placeholder.", call: { posts: INVITE_EMAIL_COPY_POST } },
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
          call: {
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
          call: {
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
          call: {
            name: "Bash",
            input: { command: "pnpm test src/members" },
            output: " Test Files  2 passed (2)\n      Tests  16 passed (16)",
          },
        },
        {
          text: "Writing the answer into the plan's assumptions.",
          call: {
            name: AGENT_TOOL.EDIT_PLAN,
            input: {
              taskId: DEMO_INVITATIONS_TASK.id,
              notes: [
                {
                  kind: "add",
                  section: "Assumptions",
                  text: "- The sender or any admin may withdraw an invite (Dean, in the Inbox).",
                },
              ],
            },
            output: { status: ACTION_RESULT_STATUS.ACCEPTED },
          },
        },
        { text: "Showing you what the page reads now.", call: { posts: PENDING_INVITES_POST } },
        {
          text: "Done: the sender or any admin may withdraw an invite, and pending invites show on Settings › Members with Withdraw. The note in your Inbox says what the page shows now.",
        },
      ],
      tokens: { input: 96_300, output: 6_200, cached: 88_100 },
    },
  ],
};

/** Dean's agent on Dana's Webhook retries, finished and merged. */
export const DEMO_WEBHOOKS_AGENT: DemoAgent = {
  key: "demo-agent-webhooks",
  task: DEMO_WEBHOOKS_TASK,
  title: "Retry failed webhook deliveries",
  model: OPUS,
  effort: "high",
  turns: [
    {
      id: demoId(DEMO_ID_KIND.TURN, 3),
      from: DEMO_DEAN,
      line: "Retry failed webhook deliveries as the plan says, with replay for the dead ones.",
      startedAgo: 5 * HOUR,
      ranFor: 24 * MINUTE,
      steps: [
        {
          text: "Reading the delivery worker first.",
          call: {
            name: "Read",
            input: { file_path: "src/webhooks/worker.ts" },
            output:
              "export async function deliver(delivery: Delivery) {\n  const answer = await post(delivery.endpoint, delivery.body);\n  await markDelivered(delivery.id, answer.status);\n}",
          },
        },
        {
          text: "Scheduling the next attempt at 1 minute, 5, 30, 2 hours, and 12, and marking the delivery dead after the fifth.",
          call: {
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
          call: {
            name: "Bash",
            input: { command: "pnpm test src/webhooks" },
            output: " Test Files  3 passed (3)\n      Tests  21 passed (21)",
          },
        },
        { text: "Telling Dana it shipped.", call: { posts: RETRIES_SHIPPED_POST } },
        {
          text: "312 deliveries died before retries existed. Asking Dana whether to replay them.",
          call: { posts: REPLAY_DEAD_POST },
        },
        {
          text: "Failed deliveries now retry 5 times over about 15 hours and are then marked dead; an admin can replay a dead one from Settings › Webhooks.",
        },
      ],
      tokens: { input: 141_000, output: 11_300, cached: 120_500 },
    },
    {
      id: demoId(DEMO_ID_KIND.TURN, 14),
      from: DEMO_DEAN,
      line: "Dana says replay them, oldest first. Go ahead.",
      startedAgo: 4 * HOUR,
      ranFor: 4 * MINUTE,
      steps: [
        {
          text: "Replaying the dead deliveries, oldest first.",
          call: {
            name: "Bash",
            input: { command: "pnpm webhooks:replay --dead --before=2026-10-28 --order=oldest" },
            output: "Replayed 312 deliveries: 309 delivered, 3 refused (410 Gone).",
          },
        },
        {
          text: "309 of the 312 landed. The other three endpoints answer 410 Gone, so they were deleted on purpose; I left them dead.",
        },
      ],
      tokens: { input: 38_200, output: 1_900, cached: 33_400 },
    },
  ],
};

/** Dean's agent on Jordan's Onboarding checklist, which asked Jordan where the checklist should sit. */
export const DEMO_ONBOARDING_AGENT: DemoAgent = {
  key: "demo-agent-onboarding",
  task: DEMO_ONBOARDING_TASK,
  title: "Build the onboarding checklist",
  model: SONNET,
  effort: "medium",
  turns: [
    {
      id: demoId(DEMO_ID_KIND.TURN, 4),
      from: DEMO_DEAN,
      line: "Build the onboarding checklist from the plan. Keep it to what the workspace already stores.",
      startedAgo: 6 * HOUR,
      ranFor: 16 * MINUTE,
      steps: [
        {
          text: "Finding what the dashboard already reads about a workspace.",
          call: {
            name: "Grep",
            input: { pattern: "useWorkspaceCounts", path: "src" },
            output: "src/dashboard/use-workspace-counts.ts\nsrc/dashboard/overview.tsx",
          },
        },
        {
          text: "Adding the checklist over those counts, folding away once every step is done.",
          call: {
            name: "Write",
            input: { file_path: "src/dashboard/onboarding-checklist.tsx" },
            output: "File created successfully at: src/dashboard/onboarding-checklist.tsx",
          },
        },
        {
          text: "Drawing the three places it could sit, so the choice is easy to see.",
          call: { page: CHECKLIST_PLACEMENTS_PAGE },
        },
        { text: "Asking Jordan where it should sit.", call: { posts: CHECKLIST_PLACEMENT_POST } },
        {
          text: "And you, whether an admin may hide it for everyone.",
          call: { posts: CHECKLIST_HIDE_POST },
        },
        {
          text: "The checklist ticks each step from the workspace's members, endpoints, and deliveries, and folds away once all three are done. Where it sits is with Jordan, beside a page of the three placements, and who may hide it for everyone is with you.",
        },
      ],
      tokens: { input: 64_800, output: 5_400, cached: 51_200 },
    },
  ],
};

/** The pilot's agent on Record usage events per workspace, started by it, finished and merged. */
const METER_AGENT: DemoAgent = {
  key: "demo-agent-meter",
  task: USAGE_EVENTS_TASK,
  title: "Meter API calls per workspace",
  model: SONNET,
  effort: "high",
  turns: [
    {
      id: demoId(DEMO_ID_KIND.TURN, 5),
      from: DEMO_DEAN,
      line: "Record one `usage_events` row per webhook delivery, keyed by workspace, as Record usage events per workspace's plan says. Ask Dana anything about billing.",
      startedAgo: 3 * DAY + HOUR + 52 * MINUTE,
      ranFor: 22 * MINUTE,
      steps: [
        {
          text: "Reading the worker, where a delivery lands.",
          call: {
            name: "Read",
            input: { file_path: "src/webhooks/worker.ts" },
            output:
              "export async function deliver(delivery: Delivery) {\n  const answer = await post(delivery.endpoint, delivery.body);\n  if (answer.ok) return markDelivered(delivery.id, answer.status);\n  await scheduleRetry(delivery, RETRY_DELAYS);\n}",
          },
        },
        {
          text: "Adding the table.",
          call: {
            name: "Bash",
            input: { command: "pnpm drizzle-kit generate --name=usage_events" },
            output: "[✓] Your SQL migration file ➜ drizzle/0043_usage_events.sql",
          },
        },
        {
          text: "Writing `recordUsage`, keyed by the delivery's event id so a redelivery writes nothing.",
          call: {
            name: "Write",
            input: { file_path: "src/usage/events.ts" },
            output: "File created successfully at: src/usage/events.ts",
          },
        },
        {
          text: "Recording it in the worker's own transaction.",
          call: {
            name: "Edit",
            input: {
              file_path: "src/webhooks/worker.ts",
              old_string: "if (answer.ok) return markDelivered(delivery.id, answer.status);",
              new_string:
                "if (answer.ok) {\n    await recordUsage(tx, delivery);\n    return markDelivered(delivery.id, answer.status);\n  }",
            },
            output: "The file src/webhooks/worker.ts has been updated.",
          },
        },
        {
          text: "Running the usage and webhook tests.",
          call: {
            name: "Bash",
            input: { command: "pnpm test src/usage src/webhooks" },
            output: " Test Files  4 passed (4)\n      Tests  29 passed (29)",
          },
        },
        {
          text: "Test events go through the same worker. Asking Dana whether they count.",
          call: { posts: COUNT_TEST_EVENTS_POST },
        },
        {
          text: "Each delivery that lands now writes one usage event, in the worker's own transaction, and a redelivery writes none. Whether test events count is with Dana.",
        },
      ],
      tokens: { input: 118_600, output: 9_700, cached: 97_300 },
    },
    {
      id: demoId(DEMO_ID_KIND.TURN, 6),
      from: DEMO_DEAN,
      line: "Dana says leave test events out. Finish it.",
      startedAgo: 2 * DAY + 8 * HOUR,
      ranFor: 9 * MINUTE,
      steps: [
        {
          text: "Skipping test events in `recordUsage`.",
          call: {
            name: "Edit",
            input: {
              file_path: "src/usage/events.ts",
              old_string: "export async function recordUsage(tx: Tx, delivery: Delivery) {",
              new_string:
                "export async function recordUsage(tx: Tx, delivery: Delivery) {\n  if (delivery.test) return;",
            },
            output: "The file src/usage/events.ts has been updated.",
          },
        },
        {
          text: "Running the tests.",
          call: {
            name: "Bash",
            input: { command: "pnpm test src/usage" },
            output: " Test Files  2 passed (2)\n      Tests  12 passed (12)",
          },
        },
        { text: "Telling Dana it's done.", call: { posts: USAGE_EVENTS_SHIPPED_POST } },
        {
          text: "Test events are left out, and every other delivery writes its usage event. The rollup can read from `usage_events` now.",
        },
      ],
      tokens: { input: 52_900, output: 3_100, cached: 47_800 },
    },
  ],
};

/** The pilot's agent on Daily usage rollup, which asked Jordan where a day ends and Dean how far back to fill. */
const ROLLUP_AGENT: DemoAgent = {
  key: "demo-agent-rollup",
  task: DEMO_ROLLUP_TASK,
  title: "Roll usage up by day",
  model: OPUS,
  effort: "high",
  turns: [
    {
      id: demoId(DEMO_ID_KIND.TURN, 7),
      from: DEMO_DEAN,
      line: "Roll `usage_events` up into one `usage_daily` row per workspace per day, as Daily usage rollup's plan says, with a backfill. Ask Jordan where a day ends.",
      startedAgo: 2 * DAY + 3 * HOUR + 57 * MINUTE,
      ranFor: 26 * MINUTE,
      steps: [
        {
          text: "Reading what the usage events hold.",
          call: {
            name: "Read",
            input: { file_path: "src/usage/events.ts" },
            output:
              'export const usageEvents = pgTable("usage_events", {\n  eventId: uuid("event_id").primaryKey(),\n  workspaceId: uuid("workspace_id").notNull(),\n  kind: text("kind").notNull(),\n  at: timestamp("at").notNull(),\n});',
          },
        },
        {
          text: "Adding `usage_daily`, keyed by workspace and day, so a second run of a day writes over the first.",
          call: {
            name: "Bash",
            input: { command: "pnpm drizzle-kit generate --name=usage_daily" },
            output: "[✓] Your SQL migration file ➜ drizzle/0044_usage_daily.sql",
          },
        },
        {
          text: "Writing the job and the backfill, a day at a time.",
          call: {
            name: "Write",
            input: { file_path: "src/usage/rollup.ts" },
            output: "File created successfully at: src/usage/rollup.ts",
          },
        },
        {
          text: "Running the usage tests, the rerun of one day among them.",
          call: {
            name: "Bash",
            input: { command: "pnpm test src/usage" },
            output:
              " ✓ src/usage/rollup.test.ts (7 tests)\n\n Test Files  3 passed (3)\n      Tests  19 passed (19)",
          },
        },
        {
          text: "Where a day ends decides every row. Asking Jordan.",
          call: { posts: DAY_BOUNDARY_POST },
        },
        {
          text: "Drawing acme's own last two weeks from the rollup, so its shape is easy to check.",
          call: { page: USAGE_BY_DAY_PAGE },
        },
        { text: "How far back to fill is yours to say.", call: { posts: BACKFILL_POST } },
        {
          text: "The rollup writes one row per workspace per day, and a rerun of a day writes the same rows. Where a day ends is with Jordan and how far back to fill is with you; the chart of acme's last two weeks is on the task.",
        },
      ],
      tokens: { input: 204_700, output: 17_800, cached: 176_900 },
    },
  ],
  comments: [
    {
      quote: "How far back should the backfill go?",
      words:
        "I've asked Dean in the Inbox, and assumed 90 days until he answers: that covers every invoice still open.",
      replies: [
        {
          by: DANA,
          words:
            "90 is right for invoices. Finance may want the whole year for the board deck, but that can be a one-off.",
        },
      ],
      ago: 2 * DAY + 3 * HOUR + 34 * MINUTE,
    },
  ],
};

/**
 * Dean's pilot on Dana's Usage-based billing: it broke the task into four
 * sub-tasks, started an agent on each one that was ready, and kept him
 * told. Its sub-tasks and agents are made and started as its steps say.
 */
const DEMO_PILOT_AGENT: DemoAgent = {
  key: "demo-agent-billing-pilot",
  task: DEMO_BILLING_TASK,
  kind: AGENT_KIND.PILOT,
  title: "Roll out usage-based billing",
  model: OPUS,
  effort: "high",
  turns: [
    {
      id: demoId(DEMO_ID_KIND.TURN, 8),
      from: DEMO_DEAN,
      line: "Roll out Usage-based billing: break it into sub-tasks, start an agent on each one that's ready, and ask me whatever the plan leaves open.",
      startedAgo: 3 * DAY + 2 * HOUR,
      ranFor: 14 * MINUTE,
      steps: [
        {
          text: "Reading the plan.",
          call: {
            name: AGENT_TOOL.READ_TASK,
            input: { taskId: DEMO_BILLING_TASK.id },
            output: {
              task: {
                id: DEMO_BILLING_TASK.id,
                name: DEMO_BILLING_TASK.name,
                status: TASK_STATUS.TODO,
              },
            },
          },
        },
        {
          text: "It splits into four: count usage, roll it up by day, report it to Stripe, and show it on the Billing page. The last two wait on the rollup.",
          call: {
            name: AGENT_TOOL.EDIT_PLAN,
            input: {
              taskId: DEMO_BILLING_TASK.id,
              notes: [
                {
                  kind: "add",
                  section: "Breakdown",
                  text: "- Record usage events per workspace\n- Daily usage rollup\n- Report usage to Stripe, after the rollup\n- Usage on Settings › Billing, after the rollup",
                },
              ],
            },
            output: { status: ACTION_RESULT_STATUS.ACCEPTED },
          },
        },
        { text: "Making the sub-tasks.", call: { creates: USAGE_EVENTS_TASK } },
        { text: "", call: { creates: DEMO_ROLLUP_TASK } },
        { text: "", call: { creates: STRIPE_TASK } },
        { text: "", call: { creates: BILLING_PAGE_TASK } },
        {
          text: "Marking Stripe and the Billing page as waiting on the rollup.",
          call: {
            name: AGENT_TOOL.UPDATE_TASK,
            input: {
              taskId: DEMO_ROLLUP_TASK.id,
              blocks: { add: [STRIPE_TASK.id, BILLING_PAGE_TASK.id] },
            },
            output: {
              status: ACTION_RESULT_STATUS.ACCEPTED,
              task: { id: DEMO_ROLLUP_TASK.id, name: DEMO_ROLLUP_TASK.name },
            },
          },
        },
        {
          text: "Usage events need nothing first, so they start now, on Sonnet.",
          call: { starts: METER_AGENT },
        },
        { text: "Telling you how it's split.", call: { posts: USAGE_BREAKDOWN_POST } },
        {
          text: "The plan doesn't say whether an unused allowance rolls over.",
          call: { posts: ALLOWANCE_POST },
        },
        {
          text: "Usage-based billing is four sub-tasks now. Record usage events per workspace has an agent on it; the rollup starts once events land, and Stripe and the Billing page wait on the rollup. One question for you in the Inbox: whether an unused allowance rolls over.",
        },
      ],
      tokens: { input: 156_200, output: 12_400, cached: 131_800 },
    },
    {
      id: demoId(DEMO_ID_KIND.TURN, 9),
      from: DEMO_DEAN,
      line: "Usage events merged. Start the rollup.",
      startedAgo: 2 * DAY + 4 * HOUR,
      ranFor: 6 * MINUTE,
      steps: [
        {
          text: "Writing your rollover answer into the plan.",
          call: {
            name: AGENT_TOOL.EDIT_PLAN,
            input: {
              taskId: DEMO_BILLING_TASK.id,
              notes: [
                {
                  kind: "add",
                  section: "Decisions",
                  text: "- An unused allowance does not roll over to the next month (Dean, in the Inbox).",
                },
              ],
            },
            output: { status: ACTION_RESULT_STATUS.ACCEPTED },
          },
        },
        {
          text: "Starting the rollup on Opus, since the backfill and the day boundary need care.",
          call: { starts: ROLLUP_AGENT },
        },
        {
          text: "The rollup has an agent. I'll start Stripe and the Billing page once it lands.",
        },
      ],
      tokens: { input: 61_400, output: 2_800, cached: 57_200 },
    },
    {
      id: demoId(DEMO_ID_KIND.TURN, 10),
      from: DEMO_DEAN,
      line: "Where does it stand?",
      startedAgo: 21 * HOUR,
      ranFor: 7 * MINUTE,
      steps: [
        {
          text: "Reading the rollup's task.",
          call: {
            name: AGENT_TOOL.READ_TASK,
            input: { taskId: DEMO_ROLLUP_TASK.id },
            output: {
              task: {
                id: DEMO_ROLLUP_TASK.id,
                name: DEMO_ROLLUP_TASK.name,
                status: TASK_STATUS.IN_PROGRESS,
              },
            },
          },
        },
        {
          text: "Stripe's agent needs test keys on the preview before it can run end to end.",
          call: { posts: STRIPE_KEYS_POST },
        },
        { text: "Writing down where each piece stands.", call: { posts: USAGE_PROGRESS_POST } },
        {
          text: "Events are merged, and the rollup is built and waits on your answer about the backfill. Stripe and the Billing page start after it, once the preview has Stripe's test keys; the steps are in your Inbox.",
        },
      ],
      tokens: { input: 88_900, output: 4_600, cached: 80_100 },
    },
  ],
};

/** Dean's agent on Priya's Rotate webhook signing secrets, which asked Priya how long the old secret signs. */
const ROTATION_AGENT: DemoAgent = {
  key: "demo-agent-rotation",
  task: ROTATE_TASK,
  title: "Rotate webhook signing secrets",
  model: OPUS,
  effort: "high",
  turns: [
    {
      id: demoId(DEMO_ID_KIND.TURN, 11),
      from: DEMO_DEAN,
      line: "Build secret rotation for webhook endpoints from the plan. Priya owns the task, so put the questions to her.",
      startedAgo: 2 * DAY + 2 * HOUR,
      ranFor: 31 * MINUTE,
      steps: [
        {
          text: "Reading how an endpoint keeps its secret.",
          call: {
            name: "Read",
            input: { file_path: "src/db/schema/webhooks.ts" },
            output:
              'export const endpoints = pgTable("endpoints", {\n  id: uuid("id").primaryKey(),\n  workspaceId: uuid("workspace_id").notNull(),\n  url: text("url").notNull(),\n  signingSecret: text("signing_secret").notNull(),\n});',
          },
        },
        {
          text: "Keeping the previous secret beside the new one, with when it stops signing.",
          call: {
            name: "Edit",
            input: {
              file_path: "src/db/schema/webhooks.ts",
              old_string: 'signingSecret: text("signing_secret").notNull(),',
              new_string:
                'signingSecret: text("signing_secret").notNull(),\n  previousSecret: text("previous_secret"),\n  previousSecretUntil: timestamp("previous_secret_until"),',
            },
            output: "The file src/db/schema/webhooks.ts has been updated.",
          },
        },
        {
          text: "Writing `rotateSecret`.",
          call: {
            name: "Write",
            input: { file_path: "src/webhooks/rotate.ts" },
            output: "File created successfully at: src/webhooks/rotate.ts",
          },
        },
        {
          text: "Signing with both secrets during the overlap, in one `Relay-Signature` header.",
          call: {
            name: "Edit",
            input: {
              file_path: "src/webhooks/sign.ts",
              old_string: "return signatureOf(endpoint.signingSecret, body);",
              new_string:
                'return secretsOf(endpoint, now).map((secret) => signatureOf(secret, body)).join(",");',
            },
            output: "The file src/webhooks/sign.ts has been updated.",
          },
        },
        {
          text: "Running the webhook tests.",
          call: {
            name: "Bash",
            input: { command: "pnpm test src/webhooks" },
            output: " Test Files  5 passed (5)\n      Tests  34 passed (34)",
          },
        },
        { text: "Asking Priya how long the overlap lasts.", call: { posts: OVERLAP_POST } },
        {
          text: "Rotation keeps the old secret beside the new one and signs with both. How long the overlap lasts is with Priya; it is 24 hours until she says.",
        },
      ],
      tokens: { input: 211_300, output: 16_200, cached: 183_900 },
    },
    {
      id: demoId(DEMO_ID_KIND.TURN, 12),
      from: DEMO_DEAN,
      line: "Priya picked 72 hours. Build the button on Settings › Webhooks, and draft the email customers get.",
      startedAgo: 1 * DAY + 3 * HOUR,
      ranFor: 17 * MINUTE,
      steps: [
        {
          text: "Setting the overlap to 72 hours.",
          call: {
            name: "Edit",
            input: {
              file_path: "src/webhooks/rotate.ts",
              old_string: "export const ROTATION_OVERLAP_MS = 24 * HOUR;",
              new_string: "export const ROTATION_OVERLAP_MS = 72 * HOUR;",
            },
            output: "The file src/webhooks/rotate.ts has been updated.",
          },
        },
        {
          text: "Adding **Rotate secret** to each endpoint.",
          call: {
            name: "Edit",
            input: {
              file_path: "src/routes/settings/webhooks.tsx",
              old_string: "<EndpointActions endpoint={endpoint} />",
              new_string:
                "<EndpointActions endpoint={endpoint}>\n  <RotateSecretButton endpoint={endpoint} />\n</EndpointActions>",
            },
            output: "The file src/routes/settings/webhooks.tsx has been updated.",
          },
        },
        {
          text: "Running the tests.",
          call: {
            name: "Bash",
            input: { command: "pnpm test src/webhooks src/routes/settings" },
            output: " Test Files  7 passed (7)\n      Tests  41 passed (41)",
          },
        },
        {
          text: "Writing Priya's answer into the plan.",
          call: {
            name: AGENT_TOOL.EDIT_PLAN,
            input: {
              taskId: ROTATE_TASK.id,
              notes: [
                {
                  kind: "add",
                  section: "Decisions",
                  text: "- The overlap is 72 hours (Priya, in the Inbox).",
                },
              ],
            },
            output: { status: ACTION_RESULT_STATUS.ACCEPTED },
          },
        },
        { text: "The customer email needs its copy.", call: { posts: CUSTOMER_EMAIL_POST } },
        { text: "Telling Priya how to try it.", call: { posts: ROTATION_PREVIEW_POST } },
        {
          text: "Rotation works end to end on the preview, with a 72-hour overlap. The customer email's copy is with you, and Priya has the steps to try it.",
        },
      ],
      tokens: { input: 132_700, output: 8_900, cached: 119_400 },
    },
  ],
};

/** Dean's agent on the usage chart crash Luis filed this morning. */
const CHART_CRASH_AGENT: DemoAgent = {
  key: "demo-agent-chart-crash",
  task: CHART_CRASH_TASK,
  title: "Fix the usage chart crash",
  model: SONNET,
  effort: "medium",
  turns: [
    {
      id: demoId(DEMO_ID_KIND.TURN, 13),
      from: DEMO_DEAN,
      line: "The usage chart crashes on a workspace made today. Find out why and fix it.",
      startedAgo: 2 * HOUR + 10 * MINUTE,
      ranFor: 9 * MINUTE,
      steps: [
        {
          text: "Looking for the array the error names.",
          call: {
            name: "Grep",
            input: { pattern: "new Array\\(", path: "src/dashboard" },
            output:
              "src/dashboard/usage-chart.tsx:41:  const buckets = new Array(days - 1).fill(0);",
          },
        },
        {
          text: "A workspace made today has a range of zero days, so the chart asks for an array of length -1.",
          call: {
            name: "Edit",
            input: {
              file_path: "src/dashboard/usage-chart.tsx",
              old_string: "const buckets = new Array(days - 1).fill(0);",
              new_string: "const buckets = new Array(Math.max(days, 1)).fill(0);",
            },
            output: "The file src/dashboard/usage-chart.tsx has been updated.",
          },
        },
        {
          text: "Running the dashboard tests, with one for a zero-day range.",
          call: {
            name: "Bash",
            input: { command: "pnpm test src/dashboard" },
            output:
              " ✓ src/dashboard/usage-chart.test.ts (4 tests)\n\n Test Files  2 passed (2)\n      Tests  9 passed (9)",
          },
        },
        { text: "Telling Jordan what it was.", call: { posts: CHART_CAUSE_POST } },
        { text: "The hotfix needs someone to promote it.", call: { posts: HOTFIX_POST } },
        {
          text: "Fixed: a workspace's first day draws the empty chart instead of throwing. The hotfix is on its preview and waits on you to promote it.",
        },
      ],
      tokens: { input: 47_300, output: 3_800, cached: 39_600 },
    },
  ],
};

/**
 * The finished agents, each started on its task in the order given, every
 * one by Dean: they run on his host (`DEMO_HOST`), which runs its owner's
 * agents alone, so he can follow up on any of them, those his pilot
 * started among them. A pilot comes before the agents it starts and the
 * sub-tasks it makes. His teammates stand in the tasks they made and are
 * assigned, the comments, and the threads.
 */
export const DEMO_AGENTS: readonly DemoAgent[] = [
  DEMO_PILOT_AGENT,
  METER_AGENT,
  ROTATION_AGENT,
  ROLLUP_AGENT,
  DEMO_ONBOARDING_AGENT,
  DEMO_WEBHOOKS_AGENT,
  DEMO_INVITATIONS_AGENT,
  CHART_CRASH_AGENT,
];

/* ----- The threads ----- */

/** One answer a member gave an ask: the options picked, or nothing for a reply in words alone. */
export interface DemoAnswer {
  readonly by: DemoPerson;
  readonly choices: readonly string[];
  readonly text: string;
  readonly ago: number;
}

/** One thread an agent posted: its first post, when, and what came after. */
export interface DemoThread extends DemoPost {
  readonly agent: DemoAgent;
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
  /** The member who nodded a notice away with Got it, after every reply, where it stands settled. */
  readonly acknowledged?: { readonly by: DemoPerson; readonly ago: number };
}

/**
 * The threads the agents posted, oldest first, so the Inbox lists the
 * newest on top. Ten wait on Dean, others on the teammate whose task they
 * are on or who was asked, and some stand settled.
 */
export const DEMO_THREADS: readonly DemoThread[] = [
  {
    ...USAGE_BREAKDOWN_POST,
    agent: DEMO_PILOT_AGENT,
    ago: 3 * DAY + HOUR + 50 * MINUTE,
    replies: [],
    acknowledged: { by: DEMO_DEAN, ago: 3 * DAY + HOUR },
  },
  {
    ...ALLOWANCE_POST,
    agent: DEMO_PILOT_AGENT,
    ago: 3 * DAY + HOUR + 48 * MINUTE,
    answer: {
      by: DEMO_DEAN,
      choices: ["No, it resets each month"],
      text: "An allowance is per month. Dana agrees.",
      ago: 2 * DAY + 4 * HOUR + 10 * MINUTE,
    },
    followUp: { text: "Written into the plan's Decisions.", ago: 2 * DAY + 3 * HOUR + 58 * MINUTE },
    replies: [],
  },
  {
    ...COUNT_TEST_EVENTS_POST,
    agent: METER_AGENT,
    ago: 3 * DAY + HOUR + 34 * MINUTE,
    answer: {
      by: DANA,
      choices: ["Leave test events out"],
      text: "Nobody should pay to debug their endpoint.",
      ago: 3 * DAY + 30 * MINUTE,
    },
    replies: [],
  },
  {
    ...USAGE_EVENTS_SHIPPED_POST,
    agent: METER_AGENT,
    ago: 2 * DAY + 7 * HOUR + 53 * MINUTE,
    replies: [
      {
        by: JORDAN,
        text: "The rollup will read straight from `usage_events`, then.",
        ago: 2 * DAY + 7 * HOUR,
      },
    ],
    acknowledged: { by: DANA, ago: 2 * DAY + 6 * HOUR + 30 * MINUTE },
  },
  {
    ...DAY_BOUNDARY_POST,
    agent: ROLLUP_AGENT,
    ago: 2 * DAY + 3 * HOUR + 40 * MINUTE,
    answer: {
      by: JORDAN,
      choices: ["At UTC midnight"],
      text: "Stripe's periods are UTC, and one job beats one per time zone.",
      ago: 1 * DAY + 23 * HOUR,
    },
    replies: [
      {
        by: DANA,
        text: "Agreed. The Billing page should say the days are UTC.",
        ago: 1 * DAY + 22 * HOUR,
      },
      { by: MAYA, text: "I'll label the chart's axis.", ago: 1 * DAY + 21 * HOUR },
      {
        by: PRIYA,
        text: "Audit log export will want the same days, so I'll reuse the rollup's.",
        ago: 1 * DAY + 20 * HOUR,
      },
    ],
  },
  {
    ...BACKFILL_POST,
    agent: ROLLUP_AGENT,
    ago: 2 * DAY + 3 * HOUR + 35 * MINUTE,
    replies: [],
  },
  {
    ...OVERLAP_POST,
    agent: ROTATION_AGENT,
    ago: 2 * DAY + HOUR + 33 * MINUTE,
    answer: {
      by: PRIYA,
      choices: ["72 hours"],
      text: "A rotation on a Friday afternoon has to survive the weekend.",
      ago: 1 * DAY + 6 * HOUR,
    },
    replies: [
      {
        by: NOOR,
        text: "72 matches what we tell customers for API keys, too.",
        ago: 1 * DAY + 5 * HOUR,
      },
    ],
  },
  {
    ...CUSTOMER_EMAIL_POST,
    agent: ROTATION_AGENT,
    ago: 1 * DAY + 2 * HOUR + 48 * MINUTE,
    replies: [],
  },
  {
    ...ROTATION_PREVIEW_POST,
    agent: ROTATION_AGENT,
    ago: 1 * DAY + 2 * HOUR + 45 * MINUTE,
    replies: [
      {
        by: PRIYA,
        text: "Tried it on the preview: both signatures verify with the Node SDK.",
        ago: 1 * DAY + HOUR + 30 * MINUTE,
      },
      {
        by: THEO,
        text: "And with the Go SDK once it splits on commas. I'll release it tomorrow.",
        ago: 1 * DAY + HOUR,
      },
    ],
  },
  {
    ...STRIPE_KEYS_POST,
    agent: DEMO_PILOT_AGENT,
    ago: 20 * HOUR + 57 * MINUTE,
    replies: [],
  },
  {
    ...USAGE_PROGRESS_POST,
    agent: DEMO_PILOT_AGENT,
    ago: 20 * HOUR + 55 * MINUTE,
    replies: [],
  },
  {
    ...CHECKLIST_PLACEMENT_POST,
    agent: DEMO_ONBOARDING_AGENT,
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
    ...CHECKLIST_HIDE_POST,
    agent: DEMO_ONBOARDING_AGENT,
    ago: 5 * HOUR + 48 * MINUTE,
    replies: [],
  },
  {
    ...RETRIES_SHIPPED_POST,
    agent: DEMO_WEBHOOKS_AGENT,
    ago: 4 * HOUR + 40 * MINUTE,
    replies: [{ by: DEMO_DEAN, text: "Nice. Support can stop replaying by hand.", ago: 3 * HOUR }],
  },
  {
    ...REPLAY_DEAD_POST,
    agent: DEMO_WEBHOOKS_AGENT,
    ago: 4 * HOUR + 38 * MINUTE,
    answer: {
      by: DANA,
      choices: ["Replay them, oldest first"],
      text: "Customers asked for exactly this. Oldest first, so their order holds.",
      ago: 4 * HOUR + 10 * MINUTE,
    },
    followUp: {
      text: "Replayed: 309 of the 312 landed. The three left answer 410 Gone, so they were deleted on purpose.",
      ago: 3 * HOUR + 57 * MINUTE,
    },
    replies: [],
  },
  {
    ...WITHDRAW_POST,
    agent: DEMO_INVITATIONS_AGENT,
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
    replies: [
      {
        by: DANA,
        text: "Thanks. Can an admin see who sent an invite before withdrawing it?",
        ago: 26 * MINUTE,
      },
    ],
  },
  {
    ...LINK_EXPIRY_POST,
    agent: DEMO_INVITATIONS_AGENT,
    ago: 2 * HOUR + 48 * MINUTE,
    replies: [],
  },
  {
    ...POSTMARK_TOKEN_POST,
    agent: DEMO_INVITATIONS_AGENT,
    ago: 2 * HOUR + 46 * MINUTE,
    replies: [],
  },
  {
    ...INVITE_EMAIL_COPY_POST,
    agent: DEMO_INVITATIONS_AGENT,
    ago: 2 * HOUR + 44 * MINUTE,
    replies: [],
  },
  {
    ...CHART_CAUSE_POST,
    agent: CHART_CRASH_AGENT,
    ago: 2 * HOUR + 3 * MINUTE,
    replies: [
      {
        by: LUIS,
        text: "That matches all four tickets. I'll tell Harbor Labs once it's live.",
        ago: HOUR + 50 * MINUTE,
      },
    ],
  },
  {
    ...HOTFIX_POST,
    agent: CHART_CRASH_AGENT,
    ago: 2 * HOUR + 2 * MINUTE,
    replies: [],
  },
  {
    ...PENDING_INVITES_POST,
    agent: DEMO_INVITATIONS_AGENT,
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

/** The threads members opened with Dean's agents, oldest first. */
export const DEMO_MEMBER_THREADS: readonly DemoMemberThread[] = [
  {
    by: JORDAN,
    agent: ROLLUP_AGENT,
    title: "Will the backfill hold up the worker?",
    text: "The backfill reads weeks of `usage_events` while the worker writes to it. Can it read a day per transaction, so deliveries never wait on it?",
    ago: 1 * DAY + 20 * HOUR,
  },
  {
    by: NOOR,
    agent: DEMO_PILOT_AGENT,
    title: "Keep Stripe writes behind the billing flag",
    text: "Before Report usage to Stripe starts: every Stripe write should check `billing.metered` for its workspace, so we turn it on for the design partners first.",
    ago: 1 * DAY + 6 * HOUR,
  },
  {
    by: PRIYA,
    agent: ROTATION_AGENT,
    title: "Can rotation run from the API too?",
    text: "Two customers manage every endpoint from Terraform. Could `POST /endpoints/:id/rotate` do what the button does?",
    ago: 1 * DAY + HOUR,
  },
  {
    by: DANA,
    agent: DEMO_INVITATIONS_AGENT,
    title: "Do invites cover a workspace with SSO?",
    text: "A workspace that signs in through SSO shouldn't mail a password sign-up link. Can the accept page send the invitee to their SSO instead?",
    ago: 90 * MINUTE,
  },
  {
    by: LUIS,
    agent: CHART_CRASH_AGENT,
    title: "Can the chart fix ship today?",
    text: "Harbor Labs is on a trial that ends Friday, and their dashboard is blank. Can the fix go out today?",
    ago: HOUR + 40 * MINUTE,
  },
];

/** How long before the seed's start the people joined. */
export const DEMO_JOINED_AGO = 45 * DAY;

export { DAY as DEMO_DAY, HOUR as DEMO_HOUR, MINUTE as DEMO_MINUTE };
