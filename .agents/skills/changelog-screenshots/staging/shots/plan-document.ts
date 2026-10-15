/**
 * plan-document.ts -- the shots' plans: the "Teammate invitations" plan written through every heading of the default template, its siblings across three repositories, and builders for the planning view.
 *
 * Throwaway (`README.md`). Every name, repository, and line here is
 * invented; nothing is read from an account. Every timestamp is counted back
 * from launch (`clock.ts`), so nothing reads "Dec 31, 1969".
 */

import {
  PLAN_ACTOR,
  type Plan,
  type TaskAgentsSummary,
  type PlanSectionEdit,
  type TaskSummary,
} from "@luke/features/plan-wire";
import { TASKS_READ, type TasksView } from "@luke/features/planning-view";
import { ago, daysAgo, hoursAgo } from "./clock";

/** The ids the shots share, so a shot's plan, agent, and revisions agree with one another. */
export const SHOT_ID = {
  TASK: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60",
  BILLING: "1a7b3d5f-9c2e-4f40-8b68-2d3e4f5a6b71",
  WEBHOOKS: "2b8c4e6a-0d3f-4a51-9c79-3e4f5a6b7c82",
  AUDIT: "3c9d5f7b-1e4a-4b62-8d8a-4f5a6b7c8d93",
  ONBOARDING: "4dae6a8c-2f5b-4c73-9e9b-5a6b7c8d9ea4",
  DARK_MODE: "5ebf7b9d-3a6c-4d84-8fac-6b7c8d9eafb5",
  RATE_LIMITS: "6fc08cae-4b7d-4e95-9abd-7c8d9eafb0c6",
  ARCHIVED: "7ad19dbf-5c8e-4fa6-8bce-8d9eafb0c1d7",
  /** The finished coding agent of the plan (`coding-agent.ts`). */
  AGENT: "8b2a0ec1-6d9f-4ab7-9cdf-9eafb0c1d2e8",
  /** A second agent, still at work, which the hover card lists. */
  AGENT_2: "9c3b1fd2-7eaf-4bc8-8de0-afb0c1d2e3f9",
  /** The plan's earlier call, as the transcript names it. */
  CALL: "3c5e7a9b-1d2f-4a6c-8e0b-2d4f6a8c0e1a",
} as const;

/** The plan everything is about. */
export const TASK_NAME = "Teammate invitations";
export const TASK_REPOSITORY = "acme/relay";

/** The finished coding agent's title, as its tab, its bylines, and its revisions name it. */
export const AGENT_TITLE = "Add teammate invitations";
export const AGENT_2_TITLE = "Invite emails";

/** The template's headings, in its order, as the shots' documents lay their sections out. */
export const SHOT_HEADINGS = [
  "Context",
  "Goal",
  "Approach",
  "Interfaces",
  "Alternatives",
  "Hard parts",
  "Not doing",
  "Plan of attack",
  "Testing",
  "Open questions",
  "Assumptions",
] as const;

export type ShotHeading = (typeof SHOT_HEADINGS)[number];

/** A document's sections by heading; a heading it does not hold is left out. */
export type ShotSections = Partial<Record<ShotHeading, string>>;

/** A document's text from its sections, in the template's order. */
export function documentText(sections: ShotSections): string {
  return SHOT_HEADINGS.flatMap((heading) => {
    const text = sections[heading];
    return text === undefined ? [] : [`## ${heading}`, text];
  }).join("\n\n");
}

/**
 * The plan written through every heading of the default template: what a
 * plan reads like once the call about it and its first agent are done.
 */
export const SHOT_SECTIONS: Required<ShotSections> = {
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
};

/** The finished document's text. */
export const SHOT_DOCUMENT_TEXT = documentText(SHOT_SECTIONS);

/** One section's last save, by heading. */
function sectionEdit(
  section: string,
  actor: (typeof PLAN_ACTOR)[keyof typeof PLAN_ACTOR],
  at: number,
  duringCall = false,
): PlanSectionEdit {
  return {
    section,
    actor,
    ...(actor === PLAN_ACTOR.AGENT ? { label: AGENT_TITLE } : undefined),
    at,
    duringCall,
  };
}

/** Who last changed each section: Luke on the call, the coding agent, and the developer, minutes to hours ago. */
export function shotSectionEdits(): PlanSectionEdit[] {
  return [
    sectionEdit("Context", PLAN_ACTOR.DEVELOPER, hoursAgo(1)),
    sectionEdit("Goal", PLAN_ACTOR.NOTETAKER, ago(4)),
    sectionEdit("Approach", PLAN_ACTOR.AGENT, ago(12)),
    sectionEdit("Interfaces", PLAN_ACTOR.AGENT, ago(12)),
    sectionEdit("Alternatives", PLAN_ACTOR.NOTETAKER, ago(38)),
    sectionEdit("Hard parts", PLAN_ACTOR.NOTETAKER, ago(4)),
    sectionEdit("Not doing", PLAN_ACTOR.DEVELOPER, hoursAgo(1)),
    sectionEdit("Plan of attack", PLAN_ACTOR.AGENT, ago(12)),
    sectionEdit("Testing", PLAN_ACTOR.AGENT, ago(12)),
    sectionEdit("Open questions", PLAN_ACTOR.NOTETAKER, ago(4)),
    sectionEdit("Assumptions", PLAN_ACTOR.NOTETAKER, ago(38)),
  ];
}

/** The open plan, written through, its bylines mixed. */
export function shotTask(overrides: Partial<Plan> = {}): Plan {
  return {
    id: SHOT_ID.TASK,
    name: TASK_NAME,
    createdAt: daysAgo(2),
    updatedAt: ago(4),
    repository: TASK_REPOSITORY,
    document: { body: `${SHOT_DOCUMENT_TEXT}\n`, assumptions: [] },
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: ago(4), duringCall: true },
    sectionEdits: shotSectionEdits(),
    agentEdits: [{ agentId: SHOT_ID.AGENT, label: AGENT_TITLE, at: ago(12) }],
    ...overrides,
  };
}

/** What the plan's two agents are doing, as its row and hover card name them. */
export function shotTaskAgents(): TaskAgentsSummary {
  return {
    total: 2,
    working: 1,
    agents: [
      {
        id: SHOT_ID.AGENT_2,
        title: AGENT_2_TITLE,
        model: "openai/gpt-6.1-sol",
        effort: "high",
        status: "running",
        at: ago(6),
      },
      {
        id: SHOT_ID.AGENT,
        title: AGENT_TITLE,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: "completed",
        at: ago(12),
      },
    ],
    pullRequestTotal: 2,
    pullRequests: [
      {
        number: 214,
        title: "Add teammate invitations",
        state: "open",
        checks: "passing",
        additions: 412,
        deletions: 38,
        url: "https://github.com/acme/relay/pull/214",
      },
      {
        number: 216,
        title: "Send invite emails through Postmark",
        state: "draft",
        checks: "pending",
        additions: 96,
        deletions: 4,
        url: "https://github.com/acme/relay/pull/216",
      },
    ],
  };
}

/** The open plan as its list row. */
export function shotTaskSummary(overrides: Partial<TaskSummary> = {}): TaskSummary {
  const {
    document: _document,
    lastEdit: _lastEdit,
    sectionEdits: _edits,
    agentEdits: _agentEdits,
    ...row
  } = shotTask();
  return { ...row, agents: shotTaskAgents(), ...overrides };
}

/** The plan's siblings, across three repositories, updated minutes to days ago. */
export function shotOtherTasks(): TaskSummary[] {
  return [
    {
      id: SHOT_ID.WEBHOOKS,
      name: "Webhook retries",
      createdAt: daysAgo(3),
      updatedAt: hoursAgo(2),
      repository: "acme/relay",
    },
    {
      id: SHOT_ID.AUDIT,
      name: "Audit log export",
      createdAt: daysAgo(6),
      updatedAt: daysAgo(1.1),
      repository: "acme/relay",
    },
    {
      id: SHOT_ID.BILLING,
      name: "Usage-based billing",
      createdAt: daysAgo(4),
      updatedAt: ago(26),
      repository: "acme/ledger",
    },
    {
      id: SHOT_ID.RATE_LIMITS,
      name: "Invoice PDF redesign",
      createdAt: daysAgo(9),
      updatedAt: daysAgo(3),
      repository: "acme/ledger",
    },
    {
      id: SHOT_ID.ONBOARDING,
      name: "Onboarding checklist",
      createdAt: daysAgo(2),
      updatedAt: hoursAgo(5),
      repository: "acme/web",
    },
    {
      id: SHOT_ID.DARK_MODE,
      name: "Dark mode for the dashboard",
      createdAt: daysAgo(12),
      updatedAt: daysAgo(4),
      repository: "acme/web",
    },
  ];
}

/** A plan long done, under Archived. */
export function shotArchivedTask(): TaskSummary {
  return {
    id: SHOT_ID.ARCHIVED,
    name: "SSO with Okta",
    createdAt: daysAgo(30),
    updatedAt: daysAgo(18),
    repository: "acme/relay",
    archivedAt: daysAgo(14),
  };
}

/**
 * The planning view with the plan open on its document, nothing on a call:
 * the list, the plan, and an empty transcript and work, so no tab waits on a
 * read that never comes.
 */
export function shotTasksView(input: {
  readonly task?: Plan;
  readonly tasks?: readonly TaskSummary[];
  readonly extra?: Partial<TasksView>;
}): TasksView {
  const task = input.task ?? shotTask();
  return {
    tasks: input.tasks ?? [shotTaskSummary(), ...shotOtherTasks()],
    listStatus: TASKS_READ.READY,
    activeTaskId: task.id,
    document: { status: TASKS_READ.READY, task },
    transcript: { status: TASKS_READ.READY, transcript: { calls: [], earlierOmitted: false } },
    work: [],
    shownCode: [],
    ...input.extra,
  };
}
