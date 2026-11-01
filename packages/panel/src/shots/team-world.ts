/**
 * team-world.ts -- acme's tasks as its five members share them: who created each, who started each agent, and what each agent published, for the shots about people and the work in flight (a person's page, the Factory).
 *
 * Throwaway (`README.md`). Dean created Teammate invitations and started its
 * finished agent; Dana started its running "Invite emails" and created
 * Usage-based billing, Webhook retries, and Onboarding checklist, each with
 * an agent of hers. Jordan, Priya, and Theo created the rest. Every agent id
 * is a UUID and every model one the release's catalog lists.
 */

import type {
  TaskAgentLine,
  TaskAgentsSummary,
  TaskPullRequestLine,
  TaskSummary,
} from "@luke/features/task-wire";
import { ago, hoursAgo } from "./clock";
import { MODEL } from "./coding-agent";
import { AGENT_2_TITLE, AGENT_TITLE, SHOT_ID, shotOtherPlans, shotTaskSummary } from "./plan-document";
import { MEMBER } from "./who";

/** The other tasks' agents, one each, by id. */
export const TEAM_AGENT = {
  METER: "ad4c2e03-8fb0-4cd9-9ef1-b0c1d2e3f40a",
  WEBHOOKS: "be5d3f14-9ac1-4dea-8f02-c1d2e3f4a51b",
  ONBOARDING: "cf6e4a25-abd2-4efb-9a13-d2e3f4a5b62c",
  AUDIT: "d07f5b36-bce3-4f0c-8b24-e3f4a5b6c73d",
  DARK_MODE: "e18a6c47-cdf4-4a1d-9c35-f4a5b6c7d84e",
  INVOICE: "f29b7d58-de05-4b2e-8d46-a5b6c7d8e95f",
  WITHDRAW: "0a3c8e69-ef16-4c3f-9e57-b6c7d8e9fa60",
  USAGE_LINE: "1b4d9f7a-f027-4d40-8f68-c7d8e9fa0b71",
  ILLUSTRATIONS: "2c5ea08b-0138-4e51-9a79-d8e9fa0b1c82",
} as const;

/** Who created each task, by its id. */
const CREATOR: Readonly<Record<string, (typeof MEMBER)[keyof typeof MEMBER]>> = {
  [SHOT_ID.PLAN]: MEMBER.DEAN,
  [SHOT_ID.BILLING]: MEMBER.DANA,
  [SHOT_ID.WEBHOOKS]: MEMBER.DANA,
  [SHOT_ID.ONBOARDING]: MEMBER.DANA,
  [SHOT_ID.AUDIT]: MEMBER.JORDAN,
  [SHOT_ID.RATE_LIMITS]: MEMBER.PRIYA,
  [SHOT_ID.DARK_MODE]: MEMBER.THEO,
};

/** One task's agents and pull requests, counted. */
function summary(agents: TaskAgentLine[], pullRequests: TaskPullRequestLine[]): TaskAgentsSummary {
  return {
    total: agents.length,
    working: agents.filter((agent) => agent.status === "running" || agent.status === "starting")
      .length,
    agents,
    pullRequestTotal: pullRequests.length,
    pullRequests,
  };
}

/** One agent line. */
function line(
  id: string,
  title: string,
  model: string,
  effort: string,
  status: TaskAgentLine["status"],
  at: number,
  startedBy: (typeof MEMBER)[keyof typeof MEMBER],
): TaskAgentLine {
  return { id, title, model, effort, status, at, startedBy };
}

/** One pull request line. */
function pr(
  repository: string,
  number: number,
  title: string,
  state: TaskPullRequestLine["state"],
  checks: TaskPullRequestLine["checks"],
  additions: number,
  deletions: number,
): TaskPullRequestLine {
  return {
    number,
    title,
    state,
    checks,
    additions,
    deletions,
    url: `https://github.com/${repository}/pull/${String(number)}`,
  };
}

/** Each task's agents, by its id. */
function agentsOf(planId: string): TaskAgentsSummary | undefined {
  switch (planId) {
    case SHOT_ID.PLAN:
      return summary(
        [
          line(SHOT_ID.AGENT_2, AGENT_2_TITLE, MODEL.SOL, "high", "running", ago(6), MEMBER.DANA),
          line(TEAM_AGENT.WITHDRAW, "Withdraw invites from Members", MODEL.SONNET, "high", "running", ago(11), MEMBER.JORDAN),
          line(SHOT_ID.AGENT, AGENT_TITLE, MODEL.OPUS, "high", "completed", ago(12), MEMBER.DEAN),
        ],
        [
          pr("acme/relay", 214, "Add teammate invitations", "open", "passing", 412, 38),
          pr("acme/relay", 216, "Send invite emails through Postmark", "draft", "pending", 96, 4),
          pr("acme/relay", 217, "Expire invite links after 7 days", "open", "passing", 41, 6),
        ],
      );
    case SHOT_ID.BILLING:
      return summary(
        [
          line(
            TEAM_AGENT.METER,
            "Meter API calls per workspace",
            MODEL.SONNET,
            "medium",
            "running",
            ago(9),
            MEMBER.DANA,
          ),
          line(TEAM_AGENT.USAGE_LINE, "Show usage on the invoice", MODEL.OPUS, "medium", "running", ago(21), MEMBER.PRIYA),
        ],
        [pr("acme/ledger", 88, "Record usage events per workspace", "draft", "pending", 203, 12)],
      );
    case SHOT_ID.WEBHOOKS:
      return summary(
        [
          line(
            TEAM_AGENT.WEBHOOKS,
            "Retry failed webhook deliveries",
            MODEL.OPUS,
            "high",
            "completed",
            hoursAgo(2.1),
            MEMBER.DANA,
          ),
        ],
        [
          pr("acme/relay", 209, "Retry failed webhook deliveries with backoff", "merged", "passing", 238, 17),
          pr("acme/relay", 207, "Record each webhook delivery attempt", "merged", "passing", 121, 6),
        ],
      );
    case SHOT_ID.ONBOARDING:
      return summary(
        [
          line(
            TEAM_AGENT.ONBOARDING,
            "Build the onboarding checklist",
            MODEL.SOL,
            "high",
            "completed",
            hoursAgo(4.3),
            MEMBER.DANA,
          ),
          line(TEAM_AGENT.ILLUSTRATIONS, "Wire in the step illustrations", MODEL.SONNET, "medium", "running", ago(3), MEMBER.THEO),
        ],
        [
          pr("acme/web", 131, "Add the onboarding checklist to the dashboard", "open", "passing", 187, 9),
          pr("acme/web", 129, "Track checklist steps per workspace", "merged", "passing", 96, 3),
        ],
      );
    case SHOT_ID.AUDIT:
      return summary(
        [
          line(
            TEAM_AGENT.AUDIT,
            "Export the audit log as CSV",
            MODEL.OPUS,
            "medium",
            "running",
            ago(2),
            MEMBER.JORDAN,
          ),
        ],
        [],
      );
    case SHOT_ID.DARK_MODE:
      return summary(
        [
          line(
            TEAM_AGENT.DARK_MODE,
            "Dark palette for charts",
            MODEL.SONNET,
            "high",
            "running",
            ago(14),
            MEMBER.THEO,
          ),
        ],
        [pr("acme/web", 135, "Theme the usage charts for dark mode", "draft", "pending", 64, 21)],
      );
    case SHOT_ID.RATE_LIMITS:
      return summary(
        [
          line(
            TEAM_AGENT.INVOICE,
            "Redesign the invoice PDF header",
            MODEL.SOL,
            "medium",
            "completed",
            hoursAgo(5.2),
            MEMBER.PRIYA,
          ),
        ],
        [
          pr("acme/ledger", 91, "Redesign the invoice PDF header", "merged", "passing", 142, 88),
          pr("acme/ledger", 90, "Embed the invoice fonts", "merged", "passing", 38, 5),
        ],
      );
    default:
      return undefined;
  }
}

/** acme's tasks, each with its creator and its agents. */
export function teamPlans(): TaskSummary[] {
  return [shotTaskSummary(), ...shotOtherPlans()].map((plan) => {
    const agents = agentsOf(plan.id);
    const createdBy = CREATOR[plan.id];
    return {
      ...plan,
      ...(createdBy === undefined ? undefined : { createdBy, ownerId: createdBy.userId }),
      ...(agents === undefined ? undefined : { agents }),
    };
  });
}
