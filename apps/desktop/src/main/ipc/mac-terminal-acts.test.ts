import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  MAC_TERMINAL_PORT_MESSAGE,
  type MacRepository,
  type MacTerminalPortOutbound,
} from "@luke/features/mac-repository-wire";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import type { WireBoundaryInput } from "@luke/wire";
import { Deferred, Effect, Fiber } from "effect";
import type { WebContents } from "electron";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { macTerminalActRows } from "./mac-terminal-acts";

/**
 * Open on this Mac's acts as main carries them, over settings, ports, and
 * terminals that answer from a script: an open with the repository's clone
 * or command missing refuses, naming where to set them, and starts
 * nothing; an open with both starts one terminal on a script fetching the
 * branch into a worktree of the clone and running the command, its output
 * on the panel's port and the panel's typing and size back on it; the same
 * tab drawn again gets a fresh port with the output so far, the terminal
 * running on; a closed tab and a gone page close their terminals; and only
 * a panel is answered. Synthetic names and bytes throughout.
 */

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OPEN = {
  agentId: AGENT_ID,
  repository: "acme/app",
  branch: "luke/add-thing",
  cols: 100,
  rows: 30,
};
const SET: MacRepository = {
  repository: "acme/app",
  folder: "/Users/dev/app",
  command: "pnpm dev",
};

// SAFETY: the rows read a sender by identity alone; one inert object is one window.
const panelOf = (): ActSender => ({
  sender: {} as WebContents,
  panel: true,
  voice: false,
  call: false,
});

interface ScriptedPort {
  readonly posted: MacTerminalPortOutbound[];
  closed: boolean;
  send(message: WireBoundaryInput): void;
}

interface ScriptedTerminal {
  readonly script: string;
  readonly written: string[];
  readonly sizes: string[];
  closed: boolean;
  output(text: string): void;
  exit(code: number): void;
}

function fixture(repositories: readonly MacRepository[], read: Effect.Effect<void> = Effect.void) {
  const opened: ScriptedPort[] = [];
  const started: ScriptedTerminal[] = [];
  const gone = new Map<WebContents, () => void>();
  const rows = macTerminalActRows({
    host: {
      macRepositories: () => Effect.as(read, { repositories }),
      setMacRepository: () => Effect.succeed({ repositories }),
    },
    stateRoot: "/state",
    ports: {
      open: () => {
        let heard: ((message: WireBoundaryInput) => void) | undefined;
        const port: ScriptedPort = {
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
    chooseFolder: () => Promise.resolve("/Users/dev/app"),
    start: ({ build, onOutput, onExit }) => {
      const terminal: ScriptedTerminal = {
        script: build("/tmp/tty"),
        written: [],
        sizes: [],
        closed: false,
        output: (text) => onOutput(new TextEncoder().encode(text)),
        exit: onExit,
      };
      started.push(terminal);
      return {
        write: (data) => void terminal.written.push(data),
        resize: (cols, rows) => void terminal.sizes.push(`${cols}x${rows}`),
        close: () => {
          terminal.closed = true;
        },
      };
    },
  });
  // SAFETY: the router dispatches only the kinds these tests send.
  const router = createActRouter(rows as ActRows);
  return { router, opened, started, pageGone: (sender: WebContents) => gone.get(sender)?.() };
}

const outputText = (posted: readonly MacTerminalPortOutbound[]) =>
  posted.flatMap((each) =>
    each.type === MAC_TERMINAL_PORT_MESSAGE.OUTPUT ? [new TextDecoder().decode(each.data)] : [],
  );

it.effect("an open with the clone or the command unset refuses, naming where to set them", () =>
  Effect.gen(function* () {
    for (const set of [[], [{ ...SET, folder: null }], [{ ...SET, command: null }]]) {
      const { router, started, opened } = fixture(set);
      const answer = yield* router.performAct(
        { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN },
        panelOf(),
      );
      assert.equal(answer.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.match(
        "reason" in answer ? answer.reason : "",
        /acme\/app.*Settings › Workspace › Repositories/u,
      );
      assert.equal(started.length, 0);
      assert.equal(opened.length, 0);
    }
  }),
);

it.effect("an open runs the branch's script, its output out on the port and typing back", () =>
  Effect.gen(function* () {
    const { router, started, opened } = fixture([SET]);
    const answer = yield* router.performAct(
      { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN },
      panelOf(),
    );
    assert.equal(answer.status, ACT_OUTCOME_STATUS.DONE);
    const [terminal] = started;
    const [port] = opened;
    assert.ok(terminal !== undefined && port !== undefined);
    assert.match(terminal.script, /'\/Users\/dev\/app'/u);
    assert.match(terminal.script, /'luke\/add-thing'/u);
    assert.match(terminal.script, /'\/state\/worktrees\/acme\/app\/luke%2Fadd-thing'/u);
    assert.match(terminal.script, /pnpm dev/u);

    terminal.output("ready");
    port.send({ type: MAC_TERMINAL_PORT_MESSAGE.INPUT, data: "q" });
    port.send({ type: MAC_TERMINAL_PORT_MESSAGE.RESIZE, cols: 80, rows: 24 });
    port.send({ type: "something else" });
    terminal.exit(0);

    assert.deepEqual(outputText(port.posted), ["ready"]);
    assert.deepEqual(port.posted.at(-1), { type: MAC_TERMINAL_PORT_MESSAGE.EXIT, code: 0 });
    assert.deepEqual(terminal.written, ["q"]);
    assert.deepEqual(terminal.sizes, ["80x24"]);
  }),
);

it.effect(
  "the tab drawn again gets a fresh port with the output so far, the terminal running on",
  () =>
    Effect.gen(function* () {
      const { router, started, opened } = fixture([SET]);
      const panel = panelOf();
      yield* router.performAct({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
      started[0]?.output("one ");
      started[0]?.output("two");

      yield* router.performAct({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);

      assert.equal(started.length, 1);
      assert.equal(opened[0]?.closed, true);
      assert.deepEqual(outputText(opened[1]?.posted ?? []), ["one ", "two"]);
      // Only the newest port is heard.
      opened[0]?.send({ type: MAC_TERMINAL_PORT_MESSAGE.INPUT, data: "old" });
      opened[1]?.send({ type: MAC_TERMINAL_PORT_MESSAGE.INPUT, data: "new" });
      assert.deepEqual(started[0]?.written, ["new"]);

      // A terminal that ended is started anew.
      started[0]?.exit(1);
      yield* router.performAct({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
      assert.equal(started.length, 2);
    }),
);

it.effect("a closed tab and a gone page close their terminals; only a panel is answered", () =>
  Effect.gen(function* () {
    const { router, started, opened, pageGone } = fixture([SET]);
    const panel = panelOf();
    yield* router.performAct({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
    yield* router.performAct(
      { kind: ACT_KIND.MAC_TERMINAL_CLOSE, payload: { agentId: AGENT_ID } },
      panel,
    );
    assert.equal(started[0]?.closed, true);
    assert.equal(opened[0]?.closed, true);

    yield* router.performAct({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
    pageGone(panel.sender);
    assert.equal(started[1]?.closed, true);

    const voice: ActSender = { ...panelOf(), panel: false, voice: true };
    const refused = yield* router.performAct(
      { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN },
      voice,
    );
    assert.deepEqual(refused, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.MAC_TERMINAL_OPEN].refusal,
    });
    assert.equal(started.length, 2);
  }),
);

it.effect("a tab closed, or its page gone, while the settings are read starts nothing", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    const { router, started, pageGone } = fixture([SET], Deferred.await(gate));
    const panel = panelOf();
    const other = panelOf();

    const closing = yield* Effect.forkChild(
      router.performAct({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel),
    );
    const leaving = yield* Effect.forkChild(
      router.performAct({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, other),
    );
    yield* Effect.yieldNow;
    yield* router.performAct(
      { kind: ACT_KIND.MAC_TERMINAL_CLOSE, payload: { agentId: AGENT_ID } },
      panel,
    );
    pageGone(other.sender);
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(closing);
    yield* Fiber.join(leaving);

    assert.equal(started.length, 0);
  }),
);

it.effect(
  "an open of another branch the agent pushed closes the old terminal and starts on the new branch",
  () =>
    Effect.gen(function* () {
      const { router, started, opened } = fixture([SET]);
      const panel = panelOf();
      yield* router.performAct({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
      yield* router.performAct(
        { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: { ...OPEN, branch: "luke/next-thing" } },
        panel,
      );

      assert.equal(started.length, 2);
      assert.equal(started[0]?.closed, true);
      assert.equal(opened[0]?.closed, true);
      assert.match(started[1]?.script ?? "", /'luke\/next-thing'/u);
    }),
);
