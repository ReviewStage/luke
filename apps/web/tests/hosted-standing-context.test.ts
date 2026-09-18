import assert from "node:assert/strict";
import { test } from "vitest";
import {
  type ProviderSessionObservation,
  type RecentBriefing,
  recentBriefingsContextText,
  SESSION_STATUS,
  standingContextText,
  WORKSPACE_TASK_SUPPORT,
  workspaceProjectContextText,
} from "../server/core";
import { hostedStandingContext } from "../server/hosted/brain-host/context";
import { brainRosterOf, hostedRosterFrom } from "../server/hosted/brain-host/roster";
import type { ObservedRoster } from "../server/hosted/observed-roster";

/**
 * The standing context is the roster, the projects, and, where the host hands
 * them, the briefings main's observed conversations gave, as data, and
 * nothing else: the exchange so far is the eve session's own history and the
 * rotation seed's, and what Luke knows of the developer is USER.md in the
 * prompt. Synthetic roster throughout.
 */

const NOW = 1_800_000_000_000;
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";

function observation(id: string): ProviderSessionObservation {
  return {
    providerSessionId: id,
    title: `Chat ${id}`,
    status: SESSION_STATUS.WORKING,
    lastActivityAt: NOW,
    workspace: { providerWorkspaceId: "workspace-a", name: "workspace-a-name" },
    detail: { repository: "repo", link: `https://conductor.test/sessions/${id}` },
    advertises: [{ kind: "message" }],
  };
}

const ROSTER: ObservedRoster = {
  version: 1,
  providers: [
    {
      providerId: "conductor",
      keyFingerprint: "f",
      observations: [observation(SESSION_UUID)],
      projects: [
        {
          providerProjectId: "project-1",
          repository: "repo",
          taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
        },
      ],
    },
  ],
};

test("main's standing context recalls the briefings its observed conversations gave, after the projects, and a turn handed none says nothing of them", () => {
  const roster = hostedRosterFrom(ROSTER, NOW);
  const rosterText = brainRosterOf(roster, NOW).text;
  const defaults = { defaultProviderId: "conductor" };
  const briefings: RecentBriefing[] = [
    {
      announcedAt: NOW - 60_000,
      session: { providerId: "conductor", providerSessionId: SESSION_UUID },
      title: `Chat ${SESSION_UUID}`,
      words: "Checkout's agent is stuck on a failing test in auth.spec.",
    },
  ];
  const context = hostedStandingContext({ roster, rosterText, defaults, briefings, now: NOW });

  const projects = workspaceProjectContextText(roster.projects, defaults.defaultProviderId);
  const section = recentBriefingsContextText(briefings, NOW);
  assert.ok(section);
  assert.equal(context, standingContextText(rosterText, `${projects}\n\n${section}`, NOW));
  assert.ok(context.indexOf(projects) < context.indexOf(section));
  assert.ok(context.includes(`provider_session_id=${SESSION_UUID}`));
  assert.ok(context.includes("stuck on a failing test"));

  const without = hostedStandingContext({ roster, rosterText, defaults, briefings: [], now: NOW });
  assert.equal(without.includes("Briefings you gave"), false);
  assert.equal(without, hostedStandingContext({ roster, rosterText, defaults, now: NOW }));
});

test("the standing context carries the roster and the projects alone: no recent exchange and no remembered facts", () => {
  const roster = hostedRosterFrom(ROSTER, NOW);
  const rosterText = brainRosterOf(roster, NOW).text;
  const defaults = { defaultProviderId: "conductor" };
  const context = hostedStandingContext({ roster, rosterText, defaults, now: NOW });

  assert.ok(context.includes(rosterText));
  assert.ok(context.includes("project-1"));
  assert.equal(
    context,
    standingContextText(
      rosterText,
      workspaceProjectContextText(roster.projects, defaults.defaultProviderId),
      NOW,
    ),
  );
  for (const absent of [
    "Recent conversation",
    "Developer:",
    "Luke:",
    "Durable facts",
    "Briefings you gave",
  ]) {
    assert.equal(context.includes(absent), false, absent);
  }
});
