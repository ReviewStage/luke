/**
 * who.ts -- shot "Who did what": the "Teammate invitations" plan's header and first sections, every writer on their own face, with the plan's ⋯ menu held open.
 *
 * Throwaway (`README.md`). See `.context/shots/SPEC.md` row 3. The plan
 * opens on its document, the sidebar open and the side panel closed. Every
 * actor is drawn by the release's own `ActorRef` (`actor-ref.tsx`), read
 * through `edit-ref.tsx` against acme's members (`member-directory.tsx`):
 *
 * - the crumb, "acme › acme/relay" and "5 can edit" over the first four
 *   members' faces, acme's tile its two-peak mark;
 * - "Edited by Dana Moreno · 4m ago" on her face (the plan's `lastEdit`);
 * - each section's byline, drawn without the pointer (`layout.bylines`):
 *   Context by Dana, Goal by Luke during your call (his blue square),
 *   Approach by the coding agent "Add teammate invitations" (its harness on
 *   its square, found among the plan's agents), Interfaces by Jordan Lee;
 * - the toolbar's ⋯ menu, pressed open by a step, whose foot says "Created
 *   by you · 2d ago" on Dean's photo and "Last edited by Dana Moreno · 4m ago".
 *
 * Dean reads the plan as himself (`readerId`), so his own edits and his call
 * say "you". His member row carries his photo; his teammates carry generated
 * initial pictures on WORLD.md's pastels, never anyone's photo. acme has five
 * members, so the crumb says "5 can edit"; the members read is asked once per
 * drawing of a place that names a person, never in a loop, so it is answered
 * every time.
 */

import { PLAN_ACTOR, type PlanSectionEdit } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { ago, daysAgo, hoursAgo } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import { DEAN_AVATAR_DATA_URL } from "./dean-avatar";
import { shotOwnerPicture } from "./owner-pictures";
import {
  AGENT_TITLE,
  PLAN_REPOSITORY,
  SHOT_ID,
  shotPlan,
  shotTasksView,
  shotTaskSummary,
  shotOtherPlans,
  shotWorkspaces,
} from "./plan-document";
import type { ShotSpec, ShotStep } from "./shot-spec";

/** acme's members by id, as `workspaces.ts` names them, so the two shots agree. */
export const MEMBER = {
  DEAN: { userId: "usr_dean8Kf3Qz1", name: "Dean Stratakos" },
  DANA: { userId: "usr_dana2Wm7Hx4", name: "Dana Moreno" },
  JORDAN: { userId: "usr_jord5Np2Lc8", name: "Jordan Lee" },
  PRIYA: { userId: "usr_priy9Tb6Rv3", name: "Priya Raman" },
  THEO: { userId: "usr_theo3Gs1Yk7", name: "Theo Walsh" },
} as const;

type MemberRef = (typeof MEMBER)[keyof typeof MEMBER];

/**
 * A teammate's picture: their first initial on a soft pastel, as a
 * full-bleed square the app rounds into its circle, drawn here so nobody's
 * real photo stands in for an invented teammate. One letter, as the app's own
 * letter is, since two do not read at a byline's size. The ink is a deep
 * shade of the ground.
 */
export function initialPicture(initial: string, ground: string, ink: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${ground}"/>` +
    `<text x="32" y="34" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" ` +
    `font-size="34" font-weight="600" fill="${ink}">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** acme's members, as the service orders them: owners, then admins, then members, each by name. */
export function acmeMembers(): WorkspaceMember[] {
  return [
    {
      ...MEMBER.DEAN,
      email: "dean@example.com",
      role: WORKSPACE_ROLE.OWNER,
      pictureUrl: DEAN_AVATAR_DATA_URL,
    },
    {
      ...MEMBER.DANA,
      email: "dana@acme.dev",
      role: WORKSPACE_ROLE.ADMIN,
      pictureUrl: initialPicture("D", "#f2b880", "#6b3a12"),
    },
    {
      ...MEMBER.JORDAN,
      email: "jordan@acme.dev",
      role: WORKSPACE_ROLE.MEMBER,
      pictureUrl: initialPicture("J", "#9fd8b4", "#1f5135"),
    },
    {
      ...MEMBER.PRIYA,
      email: "priya@acme.dev",
      role: WORKSPACE_ROLE.MEMBER,
      pictureUrl: initialPicture("P", "#c7b4f5", "#3d2a78"),
    },
    {
      ...MEMBER.THEO,
      email: "theo@acme.dev",
      role: WORKSPACE_ROLE.MEMBER,
      pictureUrl: initialPicture("T", "#a9d3f5", "#1d4566"),
    },
  ];
}

/** Dean's workspaces, acme with its five members and its mark as its tile. */
export function whoWorkspaces(memberCount: number): Workspace[] {
  return shotWorkspaces().map((workspace) =>
    workspace.id === SHOT_ID.WORKSPACE
      ? { ...workspace, memberCount, pictureUrl: shotOwnerPicture(PLAN_REPOSITORY) }
      : workspace,
  );
}

/** A section last changed by a member, off any call. */
function byMember(section: string, member: MemberRef, at: number): PlanSectionEdit {
  return { section, actor: PLAN_ACTOR.DEVELOPER, by: member, at, duringCall: false };
}

/** A section Luke last wrote on Dean's call. */
function byLuke(section: string, at: number): PlanSectionEdit {
  return { section, actor: PLAN_ACTOR.NOTETAKER, by: MEMBER.DEAN, at, duringCall: true };
}

/** A section the finished coding agent last changed. */
function byAgent(section: string, at: number): PlanSectionEdit {
  return {
    section,
    actor: PLAN_ACTOR.AGENT,
    label: AGENT_TITLE,
    agentId: SHOT_ID.AGENT,
    at,
    duringCall: false,
  };
}

/**
 * Who last changed each section, a different writer on each of the first
 * four: Dana this morning's last edit, Luke on Dean's call, the coding agent,
 * and Jordan; the rest mixed among them, Priya, and Dean.
 */
function whoSectionEdits(): PlanSectionEdit[] {
  return [
    byMember("Context", MEMBER.DANA, ago(4)),
    byLuke("Goal", ago(38)),
    byAgent("Approach", ago(12)),
    byMember("Interfaces", MEMBER.JORDAN, ago(26)),
    byLuke("Alternatives", ago(38)),
    byMember("Hard parts", MEMBER.PRIYA, hoursAgo(1)),
    byMember("Not doing", MEMBER.DEAN, hoursAgo(2)),
    byAgent("Plan of attack", ago(12)),
    byAgent("Testing", ago(12)),
    byMember("Open questions", MEMBER.DANA, ago(4)),
    byLuke("Assumptions", ago(38)),
  ];
}

/** The toolbar's ⋯ over the open plan, once the document under it is drawn whole: its crumb's faces and its sections' writers. */
function planActionsButton(): HTMLButtonElement | undefined {
  if (document.querySelector(".plan-crumb .actor-stack") === null) return undefined;
  if (document.querySelector('.plan-unit-byline .actor-ref[data-kind="agent"]') === null)
    return undefined;
  return (
    document.querySelector<HTMLButtonElement>(
      '.toolbar-tab-actions button[aria-label="Task actions"]',
    ) ?? undefined
  );
}

/** How long the window is left to settle once drawn before the press, so the menu is placed against the toolbar as it stands. */
const SETTLE_MS = 1_200;

/** How many times the press is made at most, should a resize or a lost focus take the menu down. */
const MOST_PRESSES = 5;

/**
 * Presses the plan's ⋯ once the document is drawn whole, and again should
 * the menu close (it closes on a resize or the window losing focus), up to
 * {@link MOST_PRESSES} times. Note that the press is a click, never a
 * hover, so the button's tooltip never shows over the menu; and that the
 * focus the menu puts on its first item is let go, as a pointer's press
 * shows no item lit.
 */
const OPEN_PLAN_MENU: ShotStep = {
  key: "who-open-plan-menu",
  ready: () => true,
  run: () => {
    let presses = 0;
    let waiting = false;
    const check = () => {
      if (waiting || presses >= MOST_PRESSES) return;
      const button = planActionsButton();
      if (button === undefined || button.getAttribute("aria-expanded") === "true") return;
      waiting = true;
      window.setTimeout(() => {
        waiting = false;
        const settled = planActionsButton();
        if (settled === undefined || settled.getAttribute("aria-expanded") === "true") return;
        presses += 1;
        settled.click();
        window.setTimeout(() => {
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && focused.closest('[role="menu"]') !== null)
            focused.blur();
        }, 300);
      }, SETTLE_MS);
    };
    new MutationObserver(check).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded"],
    });
    check();
  },
};

export function whoShot(): ShotSpec {
  const members = acmeMembers();
  const plan = shotPlan({
    ownerId: MEMBER.DEAN.userId,
    createdBy: MEMBER.DEAN,
    createdAt: daysAgo(2),
    updatedAt: ago(4),
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, by: MEMBER.DANA, at: ago(4), duringCall: false },
    sectionEdits: whoSectionEdits(),
  });
  const summary = shotTaskSummary({ ownerId: MEMBER.DEAN.userId, createdBy: MEMBER.DEAN });
  return {
    planning: shotTasksView({
      plan,
      plans: [summary, ...shotOtherPlans()],
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
    },
    layout: { sidebarCollapsed: true, bylines: true },
    // Note that the task's ⋯ menu stays closed, as Dean asked for 0.14.0's picture; OPEN_PLAN_MENU holds it open where a redo wants it.
    steps: [],
  };
}
