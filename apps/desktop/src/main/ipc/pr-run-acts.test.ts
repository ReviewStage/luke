import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  PR_RUN_PHASE,
  PR_RUN_PORT_MESSAGE,
  type PrRunOutcome,
  type PrRunPortOutbound,
  type PrRunPullRequest,
} from "@luke/features/pr-run-view";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import type { HostOperator } from "@luke/host/host-operator";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { type MainPrRunPort, type PrRunActsDependencies, prRunActRows } from "./pr-run-acts";

/**
 * The pull-request run's acts as main carries them, over a host and ports
 * that answer from a script: a start posts a port to the asking panel alone
 * before the host is asked to run, and what the host says of that
 * connection reaches that port and no other; an ack on the port reaches the
 * host by connection; a closed tab and the page's end let the connection
 * go, which is a stop at the host; the host's refusal is the panel's to
 * read in its words; a reveal opens Finder only on a checkout that stands;
 * and only a panel is answered. Synthetic ids and bytes throughout.
 */

const PULL_REQUEST: PrRunPullRequest = {
  workspaceId: "ws_fixture",
  repository: "octocat/relay",
  number: 7,
};

// SAFETY: the rows read a sender by identity alone; one inert object is one window.
const panelOf = (): ActSender => ({
  sender: {} as WebContents,
  panel: true,
  voice: false,
  call: false,
});

interface ScriptedPort {
  readonly sender: WebContents;
  readonly posted: PrRunPortOutbound[];
  closed: boolean;
  send(message: WireBoundaryInput): void;
}

function fixture(options: { start?: PrRunOutcome; location?: string | null } = {}) {
  const asked: string[] = [];
  const opened: ScriptedPort[] = [];
  const revealed: string[] = [];
  const gone = new Map<WebContents, () => void>();
  const pending: Effect.Effect<unknown>[] = [];
  let outputListener: Parameters<HostOperator["onPrRunOutput"]>[0] | undefined;
  let stateListener: Parameters<HostOperator["onPrRunState"]>[0] | undefined;
  let ids = 0;
  const host: PrRunActsDependencies["host"] = {
    prRunCommands: () => Effect.succeed({ runs: [] }),
    prRunSetCommand: () => Effect.succeed({ done: true }),
    prRunStart: ({ connectionId }) =>
      Effect.sync(() => {
        asked.push(`start:${connectionId}:ports=${opened.length}`);
        return options.start ?? { done: true };
      }),
    prRunAttach: ({ connectionId }) => Effect.sync(() => void asked.push(`attach:${connectionId}`)),
    prRunDetach: ({ connectionId }) => Effect.sync(() => void asked.push(`detach:${connectionId}`)),
    prRunStop: () => Effect.sync(() => void asked.push("stop")),
    prRunAck: ({ connectionId, bytes }) =>
      Effect.sync(() => void asked.push(`ack:${connectionId}:${bytes}`)),
    prRunRelease: ({ connectionId }) =>
      Effect.sync(() => void asked.push(`release:${connectionId}`)),
    prRunLocate: () =>
      Effect.succeed({ path: options.location === undefined ? "/state/pr-7" : options.location }),
    prRunDelete: () =>
      Effect.succeed({ refused: "Stop the run before deleting its local checkout." }),
    onPrRunOutput: (listener) => {
      outputListener = listener;
      return () => undefined;
    },
    onPrRunState: (listener) => {
      stateListener = listener;
      return () => undefined;
    },
  };
  const rows = prRunActRows({
    host,
    ports: {
      open: (sender): MainPrRunPort => {
        let heard: ((message: WireBoundaryInput) => void) | undefined;
        const port: ScriptedPort = {
          sender,
          posted: [],
          closed: false,
          send: (message) => heard?.(message),
        };
        opened.push(port);
        return {
          post: (message) => void port.posted.push(message),
          onMessage: (listener) => {
            heard = listener;
          },
          close: () => {
            port.closed = true;
          },
        };
      },
      whenGone: (sender, then) => void gone.set(sender, then),
    },
    showInFinder: (folder) => void revealed.push(folder),
    createId: () => `connection-${++ids}`,
    run: <A>(effect: Effect.Effect<A>) => {
      pending.push(effect);
      return new Promise<A>(() => undefined);
    },
  });
  // SAFETY: the router dispatches only the pull-request run kinds these tests send.
  const router = createActRouter(rows as ActRows);
  return {
    router,
    asked,
    opened,
    revealed,
    hostSays: {
      output: (connectionId: string, text: string) =>
        outputListener?.({ connectionId, data: new TextEncoder().encode(text) }),
      state: (connectionId: string) =>
        stateListener?.({ connectionId, phase: PR_RUN_PHASE.SUCCESS, exitCode: 0 }),
    },
    pageGone: (sender: WebContents) => gone.get(sender)?.(),
    drain: Effect.suspend(() => Effect.all(pending.splice(0), { discard: true })),
  };
}

it.effect(
  "a start posts a port to the asking panel before the run, and what the host says reaches that port alone",
  () =>
    Effect.gen(function* () {
      const { router, asked, opened, hostSays, drain } = fixture();
      const one = panelOf();
      const other = panelOf();

      const started = yield* router.performAct(
        { kind: ACT_KIND.PR_RUN_START, payload: PULL_REQUEST },
        one,
      );
      yield* router.performAct({ kind: ACT_KIND.PR_RUN_START, payload: PULL_REQUEST }, other);
      hostSays.output("connection-1", "listening on 3000\n");
      hostSays.state("connection-1");
      opened[0]?.send({ type: PR_RUN_PORT_MESSAGE.ACK, bytes: 18 });
      opened[0]?.send({ type: "input", data: "rm -rf /" });
      yield* drain;

      assert.deepEqual(started, { status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      assert.deepEqual(asked, [
        "start:connection-1:ports=1",
        "start:connection-2:ports=2",
        "ack:connection-1:18",
      ]);
      assert.equal(opened[0]?.sender, one.sender);
      assert.deepEqual(opened[0]?.posted, [
        { type: PR_RUN_PORT_MESSAGE.OUTPUT, data: new TextEncoder().encode("listening on 3000\n") },
        { type: PR_RUN_PORT_MESSAGE.STATE, state: { phase: PR_RUN_PHASE.SUCCESS, exitCode: 0 } },
      ]);
      assert.deepEqual(opened[1]?.posted, []);
    }),
);

it.effect(
  "a closed tab and the page's end let the connection go, and the host's refusal is read in its words",
  () =>
    Effect.gen(function* () {
      const { router, asked, opened, pageGone, drain } = fixture();
      const panel = panelOf();

      yield* router.performAct({ kind: ACT_KIND.PR_RUN_START, payload: PULL_REQUEST }, panel);
      yield* router.performAct({ kind: ACT_KIND.PR_RUN_CLOSE, payload: PULL_REQUEST }, panel);
      yield* router.performAct(
        { kind: ACT_KIND.PR_RUN_START, payload: { ...PULL_REQUEST, number: 8 } },
        panel,
      );
      pageGone(panel.sender);
      yield* drain;
      const deleted = yield* router.performAct(
        { kind: ACT_KIND.PR_RUN_DELETE_CHECKOUT, payload: PULL_REQUEST },
        panel,
      );

      assert.deepEqual(asked, [
        "start:connection-1:ports=1",
        "release:connection-1",
        "start:connection-2:ports=2",
        "release:connection-2",
      ]);
      assert.ok(opened.every((port) => port.closed));
      assert.deepEqual(deleted, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: "Stop the run before deleting its local checkout.",
      });
    }),
);

it.effect(
  "a tab drawn again attaches without starting, and one out of sight detaches without stopping",
  () =>
    Effect.gen(function* () {
      const { router, asked, opened } = fixture();
      const panel = panelOf();

      yield* router.performAct({ kind: ACT_KIND.PR_RUN_START, payload: PULL_REQUEST }, panel);
      yield* router.performAct({ kind: ACT_KIND.PR_RUN_DETACH, payload: PULL_REQUEST }, panel);
      yield* router.performAct({ kind: ACT_KIND.PR_RUN_ATTACH, payload: PULL_REQUEST }, panel);

      assert.deepEqual(asked, [
        "start:connection-1:ports=1",
        "detach:connection-1",
        "attach:connection-2",
      ]);
      assert.deepEqual(
        opened.map((port) => port.closed),
        [true, false],
      );
    }),
);

it.effect("a run the host refuses closes its port and says why", () =>
  Effect.gen(function* () {
    const refusal =
      "Set a run command for octocat/relay in Settings, under Workspace › Repositories, then run it again.";
    const { router, asked, opened } = fixture({ start: { refused: refusal } });

    const started = yield* router.performAct(
      { kind: ACT_KIND.PR_RUN_START, payload: PULL_REQUEST },
      panelOf(),
    );

    assert.deepEqual(started, { status: ACT_OUTCOME_STATUS.REFUSED, reason: refusal });
    assert.deepEqual(asked, ["start:connection-1:ports=1", "release:connection-1"]);
    assert.equal(opened[0]?.closed, true);
  }),
);

it.effect("Show in Finder reveals a checkout that stands, and refuses where there is none", () =>
  Effect.gen(function* () {
    const standing = fixture();
    const missing = fixture({ location: null });

    yield* standing.router.performAct(
      { kind: ACT_KIND.PR_RUN_SHOW_IN_FINDER, payload: PULL_REQUEST },
      panelOf(),
    );
    const refused = yield* missing.router.performAct(
      { kind: ACT_KIND.PR_RUN_SHOW_IN_FINDER, payload: PULL_REQUEST },
      panelOf(),
    );

    assert.deepEqual(standing.revealed, ["/state/pr-7"]);
    assert.deepEqual(missing.revealed, []);
    assert.deepEqual(refused, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.PR_RUN_SHOW_IN_FINDER].refusal,
    });
  }),
);

it.effect("only a panel is answered", () =>
  Effect.gen(function* () {
    const { router, asked, opened } = fixture();
    const voice: ActSender = { ...panelOf(), panel: false, voice: true };

    const started = yield* router.performAct(
      { kind: ACT_KIND.PR_RUN_START, payload: PULL_REQUEST },
      voice,
    );

    assert.deepEqual(started, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.PR_RUN_START].refusal,
    });
    assert.deepEqual(asked, []);
    assert.deepEqual(opened, []);
  }),
);
