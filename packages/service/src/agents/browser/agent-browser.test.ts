import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Duration, Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  agentBrowserTestLayer,
  FAKE_BRIDGE,
  FAKE_SANDBOX,
  type FakeBridge,
  type FakeCdpPeer,
  type FakeSandboxScenario,
  fakeBridgePty,
  fakeCdpPeer,
  fakeSandboxApi,
} from "../../testing/agent-browser-fake.js";
import {
  AgentBrowser,
  agentBrowserOver,
  BROWSER_UNREACHABLE,
  type BrowserUnreachable,
  browserSessionOf,
  CDP_FAILURE,
  type CdpFailure,
} from "./agent-browser.js";
import { BROWSER_START_EXIT } from "./sandbox-browser.js";

/**
 * An agent's browser over a fake sandbox and a fake Chromium behind a fake
 * bridge: the browser is started once and attached to after, a stopped
 * sandbox is resumed and waited for, a worker reaches its parent's sandbox,
 * and a CDP session answers commands, carries events, and lists, opens, and
 * closes pages. Every way the browser cannot be reached says why, and a
 * command fails as refused, timed out, or closed.
 */

const SESSION = "wrun_browser_fixture";

/** The service over a sandbox as the scenario has it and a bridge that comes up as told. */
function browserOver(
  peer: FakeCdpPeer,
  scenario: Partial<FakeSandboxScenario> = {},
  bridge: FakeBridge = FAKE_BRIDGE.READY,
) {
  const sandbox = fakeSandboxApi({ status: "running", sessionId: SESSION, ...scenario });
  return { service: agentBrowserOver(sandbox.api, fakeBridgePty(peer, bridge)), ran: sandbox.ran };
}

/** Why the effect failed, where it failed as unreachable. */
function reasonOf<A>(exit: Exit.Exit<A, BrowserUnreachable>) {
  return Exit.isFailure(exit) ? Exit.findErrorOption(exit) : undefined;
}

it.effect("the browser is started once in the running sandbox and attached to after", () =>
  Effect.gen(function* () {
    const peer = yield* fakeCdpPeer();
    const { service, ran } = browserOver(peer);

    const first = yield* service.ensure(SESSION);
    const second = yield* service.ensure(SESSION);

    assert.deepEqual(first, { sandboxSessionId: FAKE_SANDBOX.RUNNING_SESSION, started: true });
    assert.deepEqual(second, { sandboxSessionId: FAKE_SANDBOX.RUNNING_SESSION, started: false });
    assert.ok(ran.every((run) => run.sandboxSessionId === FAKE_SANDBOX.RUNNING_SESSION));
  }),
);

it.effect("a stopped sandbox is resumed and waited for, and its browser started afresh", () =>
  Effect.gen(function* () {
    const peer = yield* fakeCdpPeer();
    const { service } = browserOver(peer, { status: "stopped", pendingResumes: 2 });

    const ensuring = yield* Effect.forkChild(service.ensure(SESSION));
    yield* TestClock.adjust(Duration.seconds(10));
    const standing = yield* Fiber.join(ensuring);

    assert.deepEqual(standing, { sandboxSessionId: FAKE_SANDBOX.RESUMED_SESSION, started: true });
  }),
);

it.effect("a worker's session reaches the browser in its parent's sandbox", () =>
  Effect.gen(function* () {
    const peer = yield* fakeCdpPeer();
    const worker = { id: "wrun_worker_child", parent: { rootSessionId: SESSION } };

    const pages = yield* Effect.scoped(
      Effect.gen(function* () {
        const browser = yield* AgentBrowser;
        const cdp = yield* browser.connect(browserSessionOf(worker));
        return yield* cdp.pages;
      }),
    ).pipe(Effect.provide(agentBrowserTestLayer(peer, SESSION)));

    assert.deepEqual(pages, [{ targetId: "page-blank", url: "about:blank", title: "" }]);
    assert.equal(browserSessionOf({ id: SESSION }), SESSION);
  }),
);

it.effect("a session lists, opens, and closes pages, and the browser's refusal says why", () =>
  Effect.gen(function* () {
    const peer = yield* fakeCdpPeer();
    const { service } = browserOver(peer);

    const seen = yield* Effect.scoped(
      Effect.gen(function* () {
        const cdp = yield* service.connect(SESSION);
        const opened = yield* cdp.openPage("http://localhost:3000/café");
        const withOpened = yield* cdp.pages;
        yield* cdp.closePage("page-blank");
        const refused = yield* Effect.flip(cdp.closePage("page-blank"));
        const unknown = yield* Effect.flip(cdp.send({ method: "Nope.nothing" }));
        return { opened, withOpened, after: yield* cdp.pages, refused, unknown };
      }),
    );

    assert.equal(seen.opened, "page-1");
    assert.deepEqual(seen.withOpened, [
      { targetId: "page-blank", url: "about:blank", title: "" },
      { targetId: "page-1", url: "http://localhost:3000/café", title: "" },
    ]);
    assert.deepEqual(seen.after, [
      { targetId: "page-1", url: "http://localhost:3000/café", title: "" },
    ]);
    assert.equal(seen.refused.kind, CDP_FAILURE.REFUSED);
    assert.equal(seen.refused.method, "Target.closeTarget");
    assert.equal(seen.unknown.kind, CDP_FAILURE.REFUSED);
    assert.equal(seen.unknown.code, -32601);
  }),
);

it.effect("a command reaches the target session it names and its result comes back", () =>
  Effect.gen(function* () {
    const peer = yield* fakeCdpPeer({
      answer: (command) =>
        command.method === "Runtime.evaluate"
          ? { result: { result: { value: `${command.sessionId}: ${command.params.expression}` } } }
          : undefined,
    });
    const { service } = browserOver(peer);

    const result = yield* Effect.scoped(
      Effect.flatMap(service.connect(SESSION), (cdp) =>
        cdp.send({
          method: "Runtime.evaluate",
          params: { expression: "document.title ☃" },
          sessionId: "session-1",
        }),
      ),
    );

    assert.deepEqual(result, { result: { value: "session-1: document.title ☃" } });
  }),
);

it.effect(
  "events reach a subscriber from the moment it subscribes, and end with the connection",
  () =>
    Effect.gen(function* () {
      const peer = yield* fakeCdpPeer();
      const { service } = browserOver(peer);

      const { events, afterEnd, late } = yield* Effect.scoped(
        Effect.gen(function* () {
          const cdp = yield* service.connect(SESSION);
          yield* peer.emit({ method: "Target.targetCreated", params: { early: true } });
          const collecting = yield* Effect.forkChild(Stream.runCollect(cdp.events));
          yield* Effect.yieldNow;
          yield* peer.emit({
            method: "Page.loadEventFired",
            params: { timestamp: 1 },
            sessionId: "session-1",
          });
          yield* peer.hangUp;
          const events = yield* Fiber.join(collecting);
          const afterEnd = yield* Effect.flip(cdp.send({ method: "Target.getTargets" }));
          const late = yield* Stream.runCollect(cdp.events);
          return { events, afterEnd, late };
        }),
      );

      assert.deepEqual(events, [
        { method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: "session-1" },
      ]);
      assert.equal(afterEnd.kind, CDP_FAILURE.CLOSED);
      assert.deepEqual(late, []);
    }),
);

it.effect(
  "a command with no answer times out, and one waiting as the connection ends fails as closed",
  () =>
    Effect.gen(function* () {
      const peer = yield* fakeCdpPeer({
        answer: (command) => (command.method.startsWith("Page.") ? { silent: true } : undefined),
      });
      const { service } = browserOver(peer);

      const { timedOut, closed } = yield* Effect.scoped(
        Effect.gen(function* () {
          const cdp = yield* service.connect(SESSION);
          const waiting = yield* Effect.forkChild(Effect.flip(cdp.send({ method: "Page.enable" })));
          yield* TestClock.adjust(Duration.seconds(31));
          const timedOut: CdpFailure = yield* Fiber.join(waiting);
          const hanging = yield* Effect.forkChild(Effect.flip(cdp.send({ method: "Page.reload" })));
          yield* Effect.yieldNow;
          yield* peer.hangUp;
          return { timedOut, closed: yield* Fiber.join(hanging) };
        }),
      );

      assert.equal(timedOut.kind, CDP_FAILURE.TIMED_OUT);
      assert.equal(timedOut.method, "Page.enable");
      assert.equal(closed.kind, CDP_FAILURE.CLOSED);
      assert.equal(closed.method, "Page.reload");
    }),
);

it.effect("a stream that subscribes as the connection ends still ends", () =>
  Effect.gen(function* () {
    const peer = yield* fakeCdpPeer();
    const { service } = browserOver(peer);

    const events = yield* Effect.scoped(
      Effect.gen(function* () {
        const cdp = yield* service.connect(SESSION);
        const collecting = yield* Effect.forkChild(Stream.runCollect(cdp.events));
        yield* peer.hangUp;
        return yield* Fiber.join(collecting);
      }),
    );

    assert.deepEqual(events, []);
  }),
);

it.effect("a browser that cannot be reached says why", () =>
  Effect.gen(function* () {
    const peer = yield* fakeCdpPeer();
    const reasons = yield* Effect.forEach(
      [
        browserOver(peer, { status: undefined }),
        browserOver(peer, { unavailable: 503 }),
        browserOver(peer, { startExit: BROWSER_START_EXIT.NO_CHROMIUM }),
        browserOver(peer, { startExit: BROWSER_START_EXIT.NOT_STARTED }),
        browserOver(peer, {}, FAKE_BRIDGE.ERROR),
      ],
      ({ service }) =>
        Effect.map(Effect.exit(Effect.scoped(service.connect(SESSION))), (exit) => {
          const error = reasonOf(exit);
          return error === undefined || error._tag === "None"
            ? undefined
            : { reason: error.value.reason, status: error.value.status };
        }),
    );

    assert.deepEqual(reasons, [
      { reason: BROWSER_UNREACHABLE.NOT_OPENED, status: undefined },
      { reason: BROWSER_UNREACHABLE.SANDBOX_UNAVAILABLE, status: 503 },
      { reason: BROWSER_UNREACHABLE.NO_CHROMIUM, status: undefined },
      { reason: BROWSER_UNREACHABLE.NOT_STARTED, status: undefined },
      { reason: BROWSER_UNREACHABLE.BRIDGE_FAILED, status: undefined },
    ]);
  }),
);

it.effect(
  "a sandbox that never comes up, Vercel refusing every resume, and a bridge that never says it is ready are each given up on, saying why",
  () =>
    Effect.gen(function* () {
      const peer = yield* fakeCdpPeer();
      const stuck = browserOver(peer, {
        status: "stopped",
        pendingResumes: Number.POSITIVE_INFINITY,
      });
      const silent = browserOver(peer, {}, FAKE_BRIDGE.SILENT);

      const refused = browserOver(peer, { status: "stopped", resumeUnavailable: 503 });

      const resuming = yield* Effect.forkChild(Effect.flip(stuck.service.ensure(SESSION)));
      const outage = yield* Effect.forkChild(Effect.flip(refused.service.ensure(SESSION)));
      const bridging = yield* Effect.forkChild(
        Effect.flip(Effect.scoped(silent.service.connect(SESSION))),
      );
      yield* TestClock.adjust(Duration.minutes(2));

      assert.equal((yield* Fiber.join(resuming)).reason, BROWSER_UNREACHABLE.NOT_RESUMED);
      const unavailable = yield* Fiber.join(outage);
      assert.equal(unavailable.reason, BROWSER_UNREACHABLE.SANDBOX_UNAVAILABLE);
      assert.equal(unavailable.status, 503);
      assert.equal((yield* Fiber.join(bridging)).reason, BROWSER_UNREACHABLE.BRIDGE_FAILED);
    }),
);
