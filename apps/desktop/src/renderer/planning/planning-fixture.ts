import { EMPTY_PLAN_UPDATE, type FullPlanUpdate, planBody } from "@sidecar/hosted/plan-template";
import type { Plan, PlanSummary } from "@sidecar/hosted/plan-wire";
import { PLANNING_READ, type PlanningView } from "@sidecar/hosted/planning-view";
import { RUN_PROFILE } from "#shared/messages/app-state";

/**
 * planning-fixture.ts -- the synthetic plans a fixture run's Plans tab draws in place of the service's.
 *
 * A fixture run signs in to nothing and reads no plan, so the Plans tab
 * would show only its signed-out line. It draws the synthetic list instead,
 * which is what the expanded capture in `scripts/evidence.sh` shows now that
 * the panel opens on Plans, and under the planning profile it also opens the
 * reference journey's plan from `docs/PLANNING.md`, a draft of the fixed
 * template partway through, which is what the planning capture shows. Every name, repository, and commit here is
 * invented; nothing is read from an account.
 */

const FIXTURE_REPOSITORY = {
  owner: "acme",
  name: "relay",
  branch: "main",
  commit: "4f2c9e1a0b3d5c7e9f1a2b3c4d5e6f708192a3b4",
} as const;

/**
 * The reference journey's plan partway through its conversation: the purpose,
 * the existing system, a rule and an invariant, and a scenario settled, an
 * acceptance example still without its outcome, and everything else
 * unanswered, as the fixed template shows a draft.
 */
const FIXTURE_UPDATE: FullPlanUpdate = {
  ...EMPTY_PLAN_UPDATE,
  purpose: {
    problem: "Only an admin can add someone to a workspace, by creating their account by hand.",
    users: "Workspace members, and the teammates they invite.",
    outcome: "A member invites a teammate by email; the teammate joins by opening the link.",
  },
  context: {
    currentBehavior: "Fact: accounts are created by an admin in the settings page.",
    relevantCode:
      "Inspected at the plan's commit: `src/db/schema/memberships.ts` holds a `state` column. " +
      "Hypothesis: nothing else writes to `memberships` outside `src/members/`.",
    terminology: "An invite is a membership whose state is `pending`.",
  },
  behavior: {
    rules:
      "Any member may invite by email. Accepting moves the membership from `pending` to `active`.",
    invariants: "A withdrawn or accepted invite link never grants access again.",
    scenarios: [
      {
        name: "A teammate accepts an invite",
        actor: "The invited teammate",
        startingState: "A pending membership exists for the teammate's email address.",
        trigger: "The teammate opens the invite link.",
        steps: [
          "The teammate signs in or signs up.",
          "The service moves the membership to `active`.",
        ],
        expectedOutcome: "The teammate lands in the workspace.",
        alternativesAndFailures:
          'A withdrawn invite\'s link shows a generic "This invite is no longer valid" page.',
      },
    ],
  },
  delivery: {
    ...EMPTY_PLAN_UPDATE.delivery,
    decisions:
      "Model an invite as a `memberships` row with `state = pending` rather than a separate " +
      "invitations table, so removal covers invites and members alike. Alternative: an " +
      "`invitations` table. Accepted cost: pending rows appear in membership queries.",
  },
  acceptance: {
    examples: [
      {
        given: "A member invites dana@example.com",
        when: "Dana opens the link",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the acceptance example's key in the fixed template's contract, and an example is data that is never awaited.
        then: null, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
      },
    ],
    verification: null,
  },
  openQuestions: ["Who can withdraw an invite: the member who sent it, any admin, or both?"],
};

const FIXTURE_PLAN: Plan = {
  id: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60",
  name: "Teammate invitations",
  repository: FIXTURE_REPOSITORY,
  createdAt: 1,
  updatedAt: 2,
  openedAt: 3,
  document: {
    body: planBody(
      { name: "Teammate invitations", repository: FIXTURE_REPOSITORY },
      FIXTURE_UPDATE,
    ),
    assumptions: [
      { text: "Invites reuse memberships with a pending state." },
      { text: "Members and admins can both invite." },
      { text: "An invite expires after 7 days." },
    ],
  },
};

const FIXTURE_OTHER_PLANS: readonly PlanSummary[] = [
  {
    id: "1a7b3d5f-9c2e-4f40-8b68-2d3e4f5a6b71",
    name: "Billing export",
    repository: { ...FIXTURE_REPOSITORY, name: "ledger" },
    createdAt: 1,
    updatedAt: 1,
    openedAt: 2,
  },
];

const FIXTURE_PLAN_LIST: PlanningView = {
  plans: [
    {
      id: FIXTURE_PLAN.id,
      name: FIXTURE_PLAN.name,
      repository: FIXTURE_PLAN.repository,
      createdAt: FIXTURE_PLAN.createdAt,
      updatedAt: FIXTURE_PLAN.updatedAt,
      openedAt: FIXTURE_PLAN.openedAt,
    },
    ...FIXTURE_OTHER_PLANS,
  ],
  listStatus: PLANNING_READ.READY,
  document: { status: PLANNING_READ.IDLE },
};

const FIXTURE_OPEN_PLAN: PlanningView = {
  ...FIXTURE_PLAN_LIST,
  activePlanId: FIXTURE_PLAN.id,
  document: { status: PLANNING_READ.READY, plan: FIXTURE_PLAN },
};

/**
 * The plans a fixture run draws: the list with its first plan open under the
 * planning profile, the list alone under any other, and nothing for a live
 * run, which draws what the host read.
 */
export function fixturePlanningView(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): PlanningView | undefined {
  if (!run.fixtureMode) return undefined;
  return run.profile === RUN_PROFILE.PLANNING ? FIXTURE_OPEN_PLAN : FIXTURE_PLAN_LIST;
}
