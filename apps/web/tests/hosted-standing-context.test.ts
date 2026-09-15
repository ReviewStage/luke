import assert from "node:assert/strict";
import { test } from "vitest";
import {
  type ProviderSessionObservation,
  SESSION_STATUS,
  standingContextText,
  WORKSPACE_TASK_SUPPORT,
  workspaceProjectContextText,
} from "../server/core";
import { hostedStandingContext } from "../server/hosted/brain-host/context";
import { brainRosterOf, hostedRosterFrom } from "../server/hosted/brain-host/roster";
import type { ObservedRoster } from "../server/hosted/observed-roster";

/**
 * The standing context is the roster and the projects, as data, and nothing
 * else: the exchange so far is the eve session's own history and the rotation
 * seed's, and what Luke knows of the developer is USER.md in the prompt.
 * Synthetic roster throughout.
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
  for (const absent of ["Recent conversation", "Developer:", "Luke:", "Durable facts"]) {
    assert.equal(context.includes(absent), false, absent);
  }
});
