import assert from "node:assert/strict";
import { it } from "@effect/vitest";
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
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "../acts.js";
import { factoryActRows } from "./factory-acts.js";
import { type ActRows, type ActSender, createActRouter } from "./router.js";

/**
 * The Factory page's world act: a panel hears the world the host answered
 * when the kind's guard admits it, a workspace with agents and one without
 * alike; the voice and call windows are refused in the kind's own words
 * before the host is asked; and an answer the guard does not admit is
 * refused rather than handed to the page. Synthetic ids and names.
 */

// The platform's handle on the window that asked, which no row here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

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

function fixture() {
  const asked: string[] = [];
  const rows = factoryActRows({
    host: {
      factoryWorld: ({ workspaceId }) =>
        Effect.sync(() => {
          asked.push(workspaceId);
          if (workspaceId === BUSY_WORKSPACE) return BUSY;
          if (workspaceId === QUIET_WORKSPACE) return QUIET;
          // An answer no service sends, a zone of negative bytes, which the kind's guard refuses.
          return {
            world: {
              ...QUIET_WORLD,
              zones: [{ path: ".", label: "", files: 1, bytes: -1, dependsOn: [] }],
            },
          };
        }),
    },
  });
  // SAFETY: the router dispatches on the kind alone; the row under test is the only one reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked };
}

it.effect(
  "a panel hears the world of a workspace with agents and of one without, as the host answered them",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const ask = (workspaceId: string) =>
        router.performAct({ kind: ACT_KIND.FACTORY_WORLD, payload: { workspaceId } }, PANEL);

      assert.deepEqual(yield* ask(BUSY_WORKSPACE), {
        status: ACT_OUTCOME_STATUS.DONE,
        value: BUSY,
      });
      assert.deepEqual(yield* ask(QUIET_WORKSPACE), {
        status: ACT_OUTCOME_STATUS.DONE,
        value: QUIET,
      });
      assert.deepEqual(asked, [BUSY_WORKSPACE, QUIET_WORKSPACE]);
    }),
);

it.effect(
  "the voice and call windows are refused in the kind's own words, and the host is not asked",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      for (const sender of [VOICE, CALL]) {
        assert.deepEqual(
          yield* router.performAct(
            { kind: ACT_KIND.FACTORY_WORLD, payload: { workspaceId: BUSY_WORKSPACE } },
            sender,
          ),
          { status: ACT_OUTCOME_STATUS.REFUSED, reason: ACT[ACT_KIND.FACTORY_WORLD].refusal },
        );
      }
      assert.deepEqual(asked, []);
    }),
);

it.effect("an answer the kind's guard does not admit is refused, and a failure word is not", () =>
  Effect.gen(function* () {
    const { router } = fixture();
    const unanswered = createActRouter(
      // SAFETY: the router dispatches on the kind alone; the row under test is the only one reached.
      factoryActRows({
        host: {
          factoryWorld: () => Effect.succeed({ failure: FACTORY_WORLD_CALL_FAILURE.NOT_FOUND }),
        },
      }) as ActRows,
    );

    assert.deepEqual(
      yield* router.performAct(
        { kind: ACT_KIND.FACTORY_WORLD, payload: { workspaceId: BROKEN_WORKSPACE } },
        PANEL,
      ),
      { status: ACT_OUTCOME_STATUS.REFUSED, reason: ACT[ACT_KIND.FACTORY_WORLD].refusal },
    );
    assert.deepEqual(
      yield* unanswered.performAct(
        { kind: ACT_KIND.FACTORY_WORLD, payload: { workspaceId: BROKEN_WORKSPACE } },
        PANEL,
      ),
      { status: ACT_OUTCOME_STATUS.DONE, value: { failure: FACTORY_WORLD_CALL_FAILURE.NOT_FOUND } },
    );
  }),
);
