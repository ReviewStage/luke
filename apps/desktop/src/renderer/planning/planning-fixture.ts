import type { Plan, PlanSummary } from "@sidecar/hosted/plan-wire";
import { PLANNING_READ, type PlanningView } from "@sidecar/hosted/planning-view";
import { RUN_PROFILE } from "#shared/messages/app-state";

/**
 * planning-fixture.ts -- the synthetic plans a fixture run's planning window draws in place of the service's.
 *
 * A fixture run signs in to nothing and reads no plan, so the planning window
 * would show only its signed-out line. Under the planning profile it draws
 * the reference journey's plan from `docs/PLANNING.md` instead, which is what
 * `scripts/evidence.sh` captures. Every name, repository, and commit here is
 * invented; nothing is read from an account.
 */

const FIXTURE_REPOSITORY = {
  owner: "acme",
  name: "relay",
  branch: "main",
  commit: "4f2c9e1a0b3d5c7e9f1a2b3c4d5e6f708192a3b4",
} as const;

const FIXTURE_BODY = `# Teammate invitations

## Goal
A workspace member invites a teammate by email; the teammate joins the workspace by opening the link.

## Recommendation
Model an invite as a \`memberships\` row with \`state = pending\` rather than a separate invitations table (\`src/db/schema/memberships.ts\`), so accepting is a state change and removal covers invites and members alike.

## Behavior
1. A member enters an email address and sends the invite.
2. The invited person opens the link and signs in or signs up.
3. Accepting moves the membership from \`pending\` to \`active\`.
4. A withdrawn invite's link shows a generic "This invite is no longer valid" page.

## Open questions
- Who can withdraw an invite: the member who sent it, any admin, or both?
`;

const FIXTURE_PLAN: Plan = {
  id: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60",
  name: "Teammate invitations",
  repository: FIXTURE_REPOSITORY,
  createdAt: 1,
  updatedAt: 2,
  openedAt: 3,
  document: {
    body: FIXTURE_BODY,
    assumptions: [
      { text: "Invites reuse memberships with a pending state.", confirmed: true },
      { text: "Members and admins can both invite.", confirmed: true },
      { text: "An invite expires after 7 days.", confirmed: false },
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

const FIXTURE_PLANNING_VIEW: PlanningView = {
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
  activePlanId: FIXTURE_PLAN.id,
  document: { status: PLANNING_READ.READY, plan: FIXTURE_PLAN },
};

/**
 * The plans a fixture run under the planning profile draws, and nothing for
 * any other run: a live run, or a fixture run under another profile, draws
 * what the host read.
 */
export function fixturePlanningView(run: {
  readonly fixtureMode: boolean;
  readonly profile: string;
}): PlanningView | undefined {
  return run.fixtureMode && run.profile === RUN_PROFILE.PLANNING
    ? FIXTURE_PLANNING_VIEW
    : undefined;
}
