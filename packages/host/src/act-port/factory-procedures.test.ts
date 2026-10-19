import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  FACTORY_WORLD_CALL_FAILURE,
  type FactoryWorldView,
} from "@luke/features/factory-world-view";
import { Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import { FACTORY_ACT_KIND } from "../contract/index.js";
import {
  CALL,
  closeWindowPorts,
  openWindowPort,
  PANEL,
  settled,
  UNREACHED_DEPENDENCIES,
  VOICE,
} from "./testing.js";

/**
 * The Factory page's world act, through the act port as a window calls it:
 * a panel hears the world the host answered when the kind's schema admits
 * it, a workspace with agents and one without alike; the voice and call
 * windows, and a frame this build does not trust, are refused in the kind's
 * own words before the host is asked; and an answer the schema does not
 * admit is refused rather than handed to the page. Synthetic ids and names.
 */

const REFUSAL = "Could not read the workspace's world on this system.";

const BUSY_WORKSPACE = "workspace-busy";
const QUIET_WORKSPACE = "workspace-quiet";
const BROKEN_WORKSPACE = "workspace-broken";
const AGENT_ID = "6b1f3c2e-9d4a-4f1b-8c7d-2e3f4a5b6c7d";

const REPOSITORY = { fullName: "acme/relay", defaultBranch: "main" } as const;

/** A world with an agent at work on an open pull request. */
const BUSY: FactoryWorldView = {
  world: {
    snapshotAt: 1_000,
    shippedSince: 0,
    repository: REPOSITORY,
    zones: [
      { path: ".", label: "relay", files: 2, bytes: 150, dependsOn: [] },
      { path: "packages/api", label: "@relay/api", files: 4, bytes: 900, dependsOn: ["."] },
    ],
    agents: [
      {
        id: AGENT_ID,
        title: "Invite expiry",
        status: CODING_AGENT_STATUS.RUNNING,
        taskId: null,
        activityAt: 900,
        pullRequest: {
          number: 11,
          title: "Expire invitations",
          url: "https://github.com/acme/relay/pull/11",
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.PASSING,
          additions: 20,
          deletions: 2,
          changedFiles: 3,
          areas: [{ path: "packages/api", additions: 20, deletions: 2 }],
        },
      },
    ],
    shipped: [],
    planned: [],
    defects: [],
  },
};

/** A world with no agent, nothing shipped, and nothing planned: its zones alone. */
const QUIET_WORLD = {
  snapshotAt: 1_000,
  shippedSince: 0,
  repository: REPOSITORY,
  zones: [{ path: ".", label: "acme/relay", files: 1, bytes: 10, dependsOn: [] }],
  agents: [],
  shipped: [],
  planned: [],
  defects: [],
};

const QUIET: FactoryWorldView = { world: QUIET_WORLD };

afterEach(closeWindowPorts);

/** A window's act port over a host answering each workspace's world, and the workspaces it was asked for. */
function windowPort(
  actor: ActSender,
  options: { trusted?: boolean; answer?: (workspaceId: string) => unknown } = {},
) {
  const asked: string[] = [];
  const answer =
    options.answer ??
    ((workspaceId: string) => {
      if (workspaceId === BUSY_WORKSPACE) return BUSY;
      if (workspaceId === QUIET_WORKSPACE) return QUIET;
      // An answer no service sends, a zone of negative bytes, which the kind's schema refuses.
      return {
        world: {
          ...QUIET_WORLD,
          zones: [{ path: ".", label: "", files: 1, bytes: -1, dependsOn: [] }],
        },
      };
    });
  const client = openWindowPort(
    {
      ...UNREACHED_DEPENDENCIES,
      factory: {
        host: {
          factoryWorld: ({ workspaceId }) =>
            Effect.sync(() => {
              asked.push(workspaceId);
              // SAFETY: a fake answering what its test hands it; the port's output schema checks it.
              return answer(workspaceId) as FactoryWorldView;
            }),
        },
      },
    },
    actor,
    options.trusted ?? true,
  );
  const world = (workspaceId: string) =>
    settled(() => client[FACTORY_ACT_KIND.FACTORY_WORLD]({ workspaceId }));
  return { world, asked };
}

it("a panel hears the world of a workspace with agents and of one without, as the host answered them", async () => {
  const { world, asked } = windowPort(PANEL);

  assert.deepEqual(await world(BUSY_WORKSPACE), { answer: BUSY });
  assert.deepEqual(await world(QUIET_WORKSPACE), { answer: QUIET });
  assert.deepEqual(asked, [BUSY_WORKSPACE, QUIET_WORKSPACE]);
});

it("the voice and call windows, and a frame this build does not trust, are refused in the kind's own words, and the host is not asked", async () => {
  for (const { actor, trusted } of [
    { actor: VOICE, trusted: true },
    { actor: CALL, trusted: true },
    { actor: PANEL, trusted: false },
  ]) {
    const { world, asked } = windowPort(actor, { trusted });
    assert.deepEqual(await world(BUSY_WORKSPACE), { refused: REFUSAL });
    assert.deepEqual(asked, []);
  }
});

it("an answer the kind's schema does not admit is refused, and a failure word is not", async () => {
  const { world } = windowPort(PANEL);
  const unanswered = windowPort(PANEL, {
    answer: () => ({ failure: FACTORY_WORLD_CALL_FAILURE.NOT_FOUND }),
  });

  assert.deepEqual(await world(BROKEN_WORKSPACE), { refused: REFUSAL });
  assert.deepEqual(await unanswered.world(BROKEN_WORKSPACE), {
    answer: { failure: FACTORY_WORLD_CALL_FAILURE.NOT_FOUND },
  });
});
