import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import { LIVE_READ } from "@repo/features/live-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import {
  ACCOUNT_ASK_ACT_KIND,
  AGENT_ACT_KIND,
  CHAPTERS_ACT_KIND,
  type PortActKind,
} from "../contract/index.js";
import { hostActPort } from "../testing/host-act-port.js";
import type { ActSender } from "./base.js";
import type { TestActPort } from "./testing.js";

/**
 * A live follow, through the act port as a window holds it, over the host
 * that follows it: only a panel of this build's own renderer holds a
 * followed read or asks it again; any other window, a frame this build does
 * not trust, and a key its schema does not take are refused in the follow's
 * own words before the service is asked. Two panels holding the same read
 * share one follow, the service asked once, and its slice is told to the
 * client whole; Try again asks it once more. The service never answers
 * here, so each slice is told failed, as a window draws one it could not
 * read.
 */

const PANEL: ActSender = { sender: Symbol("panel"), panel: true };
const SECOND_PANEL: ActSender = { sender: Symbol("second panel"), panel: true };
const OTHER_WINDOW: ActSender = { sender: Symbol("takeover"), panel: false };

/** The account the host stands signed in to, so a follow reads. */
const SIGNED_IN = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: "user-dana",
  email: "dana@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
} as const;

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const WORKSPACE_ID = "workspace-1";

/** Each follow as a window holds it: its hold's and Try again's kinds and words, as the window drew them before they were declared, the key it holds by, the service path its read asks, and where its slice holds the key. */
const FOLLOWS = [
  {
    follow: AGENT_ACT_KIND.HOSTS_FOLLOW,
    followRefusal: "Could not follow your hosts on this system.",
    retry: AGENT_ACT_KIND.HOSTS_RETRY,
    retryRefusal: "Could not read your hosts again on this system.",
    key: undefined,
    path: HOSTED_SERVICE_PATH.LIVE_HOSTS,
    slice: LIVE_READ.HOSTS,
    at: [SIGNED_IN.id],
  },
  {
    follow: ACCOUNT_ASK_ACT_KIND.MEMORIES_FOLLOW,
    followRefusal: "Could not follow the workspace's memory on this system.",
    retry: ACCOUNT_ASK_ACT_KIND.MEMORIES_RETRY,
    retryRefusal: "Could not read the workspace's memory again on this system.",
    key: { workspaceId: WORKSPACE_ID },
    path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_MEMORIES,
    slice: LIVE_READ.MEMORIES,
    at: [WORKSPACE_ID],
  },
  {
    follow: AGENT_ACT_KIND.AGENTS_ORIGIN_FOLLOW,
    followRefusal: "Could not follow the run that started the agent on this system.",
    retry: AGENT_ACT_KIND.AGENTS_ORIGIN_RETRY,
    retryRefusal: "Could not read the run that started the agent again on this system.",
    key: { agentId: AGENT_ID },
    path: HOSTED_SERVICE_PATH.LIVE_AGENT_ORIGIN,
    slice: LIVE_READ.AGENT_ORIGINS,
    at: [AGENT_ID],
  },
  {
    follow: CHAPTERS_ACT_KIND.CHAPTERS_FOLLOW,
    followRefusal: "Could not follow the pull request's chapters on this system.",
    retry: CHAPTERS_ACT_KIND.CHAPTERS_RETRY,
    retryRefusal: "Could not read the pull request's chapters again on this system.",
    key: { agentId: AGENT_ID, number: 7 },
    path: HOSTED_SERVICE_PATH.LIVE_PULL_REQUEST_CHAPTERS,
    slice: LIVE_READ.PULL_REQUEST_CHAPTERS,
    at: [AGENT_ID, "7"],
  },
] as const satisfies readonly {
  readonly follow: PortActKind;
  readonly retry: PortActKind;
  readonly key: WireBoundaryInput;
  readonly [field: string]: unknown;
}[];

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** Turns the event loop until `ready` holds, as a page waits on its port. */
async function until(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !ready(); turn += 1) await nextTurn();
}

/** What `held` holds at `at`, the key's path in its slice. */
function readAt(held: unknown, at: readonly string[]): unknown {
  return at.reduce<unknown>(
    (level, id) =>
      typeof level === "object" && level !== null ? Reflect.get(level, id) : undefined,
    held,
  );
}

it.effect(
  "a window that is not a panel, a frame this build does not trust, and a key the follow's schema does not take are refused its hold and its Try again in its own words, and the service is not asked",
  () =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort({ account: SIGNED_IN });
      const refused = [];
      const expected = [];
      for (const each of FOLLOWS) {
        for (const [kind, words] of [
          [each.follow, each.followRefusal],
          [each.retry, each.retryRefusal],
        ] as const) {
          refused.push(yield* port.perform({ kind, payload: each.key }, OTHER_WINDOW));
          refused.push(yield* port.perform({ kind, payload: each.key }, PANEL, { trusted: false }));
          refused.push(yield* port.perform({ kind, payload: { stray: true } }, PANEL));
          expected.push({ refused: words }, { refused: words }, { refused: words });
        }
      }

      assert.deepEqual(refused, expected);
      const paths: readonly string[] = FOLLOWS.map((each) => each.path);
      assert.deepEqual(
        requests.filter((request) => paths.includes(request.pathname)),
        [],
      );
    }),
);

it.effect(
  "two panels holding one followed read share one follow, its slice told to the client at its key, and Try again asks it once more",
  () =>
    Effect.gen(function* () {
      const { port, requests, told } = yield* hostActPort({ account: SIGNED_IN });
      for (const each of FOLLOWS) {
        const asked = () => requests.filter((request) => request.pathname === each.path).length;
        const slice = () => told.filter((changed) => changed.read === each.slice).at(-1)?.held;
        const one = yield* Effect.promise(() => port.as(PANEL)[each.follow](each.key as never));
        const two = yield* Effect.promise(() =>
          port.as(SECOND_PANEL)[each.follow](each.key as never),
        );
        yield* Effect.promise(() => until(() => readAt(slice(), each.at) !== undefined));

        assert.equal(asked(), 1, `${each.follow}: two holds share one follow`);
        assert.deepEqual(readAt(slice(), each.at), { failed: true }, `${each.follow}: told`);

        yield* Effect.promise(() => port.as(PANEL)[each.retry](each.key as never));
        yield* Effect.promise(() => until(() => asked() === 2));
        assert.equal(asked(), 2, `${each.follow}: Try again asks once more`);

        yield* Effect.promise(() => one.return(undefined));
        yield* Effect.promise(() => two.return(undefined));
      }
    }),
);
