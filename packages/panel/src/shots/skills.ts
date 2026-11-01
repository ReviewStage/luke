/**
 * skills.ts -- 0.20.0 shot "Installed skills": the finished agent's message box with `/` typed, its picker listing the repository's skills beside acme's and Dean's installed ones, each with its Repo, Workspace, or Personal badge.
 *
 * Throwaway (`README.md`). The plan's column on "Add teammate invitations",
 * its transcript above the box; one step focuses the box and types `/`,
 * which the editor's own trigger turns into the picker. The skills come in
 * the service's order: the repository's, then the workspace's, then Dean's.
 */

import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { ago } from "./clock";
import { bash, codingAgentAnswers, MODEL, shotAgentMessages, TEST_OUTPUT } from "./coding-agent";
import { onceDrawn } from "./dom-steps";
import { PLAN_REPOSITORY, SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec, ShotStep } from "./shot-spec";
import { standingPlan, standingPlans } from "./board";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

const SKILLS = [
  { name: "db-migration", description: "Migrations", source: "repository", path: ".agents/skills/db-migration/SKILL.md" },
  { name: "members-tests", description: "Test suite", source: "repository", path: ".agents/skills/members-tests/SKILL.md" },
  { name: "acme-style", description: "Conventions", source: "workspace" },
  { name: "postmortem", description: "Incidents", source: "workspace" },
  { name: "email-preview", description: "Postmark", source: "workspace" },
  { name: "pr-description", description: "Write-ups", source: "personal" },
] as const;

/** The finished agent's transcript with a typed follow-up after #214: expired invites now resend. */
function followUpMessages(): CodingAgentMessage[] {
  return [
    ...shotAgentMessages(),
    {
      id: "m-follow-ask",
      role: "user",
      sentAt: ago(9),
      parts: [{ type: "text", text: "Let an admin resend an invite that expired, on the same pending row." }],
    },
    {
      id: "m-turn-2",
      role: "assistant",
      startedAt: ago(8.8),
      finishedAt: ago(6),
      model: MODEL.OPUS,
      effort: "high",
      parts: [
        { type: "step-start" },
        bash("call_f1", 'grep -rn "inviteToken" src/members', "src/members/invite.ts:6\nsrc/members/accept.ts:11"),
        bash("call_f2", "pnpm test src/members", TEST_OUTPUT, "Run the members tests"),
        bash("call_f3", "git push", "To github.com:acme/relay.git\n   4c1e9a2..b7d03f5  luke/teammate-invitations -> luke/teammate-invitations"),
        {
          type: "text",
          text:
            "Pushed to #214: `resendInvite` mints a fresh token on the same pending membership, moves its expiry out seven days, " +
            "and mails the link again. Only an admin may resend, as only an admin may withdraw. The members tests pass.",
        },
      ],
    },
  ];
}

/** Focuses the agent's message box once it is drawn and types `/` into it, as a press would. */
function slashStep(delayMs: number): ShotStep {
  return {
    key: "slash",
    ready: ({ plans }) => plans.agents.agentIds?.includes(SHOT_ID.AGENT) ?? false,
    run: () => {
      window.setTimeout(
        () =>
          onceDrawn('.agent-composer .composer-editor[contenteditable="true"]', (box) => {
            box.focus();
            document.execCommand("insertText", false, "/");
          }),
        delayMs,
      );
    },
  };
}

export function skillsShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({ plan: standingPlan(), plans: standingPlans(), extra: { workspaces: whoWorkspaces(members.length) } }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(followUpMessages),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
      [ACT_KIND.TASKS_SKILLS]: () => ({
        skills: { repository: PLAN_REPOSITORY, branch: "main", skills: [...SKILLS] },
      }),
    },
    layout: { mainTab: { agent: SHOT_ID.AGENT } },
    steps: [slashStep(2500)],
  };
}
