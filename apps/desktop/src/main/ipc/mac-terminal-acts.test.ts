import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import {
  MAC_TERMINAL_PORT_MESSAGE,
  type MacRepository,
  type MacTerminalPortOutbound,
} from "@luke/features/mac-terminal-wire";
import { type TestActPort, testActPort } from "@luke/host/act-port/testing";
import type { ActSender } from "@luke/host/act-router";
import { ACT_KIND } from "@luke/host/acts";
import type { WireBoundaryInput } from "@luke/wire";
import { Deferred, Effect, Fiber } from "effect";
import type { WebContents } from "electron";
import { macTerminalProcedures } from "./mac-terminal-acts";

/**
 * Open on this Mac's acts as main carries them, over settings, ports, and
 * terminals that answer from a script: an open asks nothing first, and
 * with no command set starts a terminal on Luke's own clone and a shell
 * alone; with one, its script runs the command in the branch's worktree,
 * its output
 * on the panel's port and the panel's typing and size back on it; the same
 * tab drawn again gets a fresh port with the output so far, the terminal
 * running on; a closed tab and a gone page close their terminals; and only
 * a panel is answered. Synthetic names and bytes throughout.
 */

/** Every act port a fixture opened, closed once its test is done. */
const ports: TestActPort<WebContents>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [ACT_KIND.MAC_REPOSITORIES]: "Could not read the run commands set on this Mac.",
  [ACT_KIND.MAC_TERMINAL_OPEN]: "Could not open a terminal on this Mac.",
} as const;

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OPEN = {
  agentId: AGENT_ID,
  repository: "acme/app",
  branch: "luke/add-thing",
  cols: 100,
  rows: 30,
};
const SET: MacRepository = { repository: "acme/app", command: "pnpm dev" };

// SAFETY: the rows read a sender by identity alone; one inert object is one window.
const panelOf = (): ActSender<WebContents> => ({
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

function fixture(
  repositories: readonly MacRepository[] | undefined,
  read: Effect.Effect<void> = Effect.void,
) {
  const opened: ScriptedPort[] = [];
  const started: ScriptedTerminal[] = [];
  const gone = new Map<WebContents, () => void>();
  const actPort = testActPort(
    macTerminalProcedures({
      host: {
        macRepositories: () =>
          Effect.as(read, repositories === undefined ? undefined : { repositories }),
        setMacRepository: () =>
          Effect.succeed(repositories === undefined ? undefined : { repositories }),
      },
      worktreesRoot: "/home/.luke",
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
    }),
  );
  ports.push(actPort);
  return { actPort, opened, started, pageGone: (sender: WebContents) => gone.get(sender)?.() };
}

const outputText = (posted: readonly MacTerminalPortOutbound[]) =>
  posted.flatMap((each) =>
    each.type === MAC_TERMINAL_PORT_MESSAGE.OUTPUT ? [new TextDecoder().decode(each.data)] : [],
  );

it.effect(
  "an open asks nothing first: with no command set it opens on Luke's own clone and a shell alone",
  () =>
    Effect.gen(function* () {
      const { actPort, started, opened } = fixture([]);
      const answer = yield* actPort.perform(
        { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN },
        panelOf(),
      );

      assert.ok("answer" in answer);
      assert.equal(opened.length, 1);
      const script = started[0]?.script ?? "";
      assert.match(script, /'\/home\/\.luke\/clones\/acme\/app'/u);
      assert.match(script, /'https:\/\/github\.com\/acme\/app\.git'/u);
      assert.doesNotMatch(script, /Running/u);
    }),
);

it.effect("an open runs the branch's script, its output out on the port and typing back", () =>
  Effect.gen(function* () {
    const { actPort, started, opened } = fixture([SET]);
    const answer = yield* actPort.perform(
      { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN },
      panelOf(),
    );
    assert.ok("answer" in answer);
    const [terminal] = started;
    const [port] = opened;
    assert.ok(terminal !== undefined && port !== undefined);
    assert.match(terminal.script, /clone='\/home\/\.luke\/clones\/acme\/app'/u);
    assert.match(terminal.script, /'luke\/add-thing'/u);
    assert.match(
      terminal.script,
      /worktree='\/home\/\.luke\/worktrees\/acme\/app\/luke\+2Fadd-thing'/u,
    );
    // Note that the worktrees an earlier Luke kept under its application data are named, to be pointed to.
    assert.match(terminal.script, /earlier_worktrees='\/state\/worktrees\/acme\/app'/u);
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
      const { actPort, started, opened } = fixture([SET]);
      const panel = panelOf();
      yield* actPort.perform({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
      started[0]?.output("one ");
      started[0]?.output("two");

      yield* actPort.perform({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);

      assert.equal(started.length, 1);
      assert.equal(opened[0]?.closed, true);
      assert.deepEqual(outputText(opened[1]?.posted ?? []), ["one ", "two"]);
      // Only the newest port is heard.
      opened[0]?.send({ type: MAC_TERMINAL_PORT_MESSAGE.INPUT, data: "old" });
      opened[1]?.send({ type: MAC_TERMINAL_PORT_MESSAGE.INPUT, data: "new" });
      assert.deepEqual(started[0]?.written, ["new"]);

      // A terminal that ended is started anew.
      started[0]?.exit(1);
      yield* actPort.perform({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
      assert.equal(started.length, 2);
    }),
);

it.effect("a closed tab and a gone page close their terminals; only a panel is answered", () =>
  Effect.gen(function* () {
    const { actPort, started, opened, pageGone } = fixture([SET]);
    const panel = panelOf();
    yield* actPort.perform({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
    yield* actPort.perform(
      { kind: ACT_KIND.MAC_TERMINAL_CLOSE, payload: { agentId: AGENT_ID } },
      panel,
    );
    assert.equal(started[0]?.closed, true);
    assert.equal(opened[0]?.closed, true);

    yield* actPort.perform({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
    pageGone(panel.sender);
    assert.equal(started[1]?.closed, true);

    const voice: ActSender<WebContents> = { ...panelOf(), panel: false, voice: true };
    const refused = yield* actPort.perform(
      { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN },
      voice,
    );
    assert.deepEqual(refused, { refused: REFUSAL[ACT_KIND.MAC_TERMINAL_OPEN] });
    assert.equal(started.length, 2);
  }),
);

it.effect("a tab closed, or its page gone, while the settings are read starts nothing", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    const bothReading = yield* Deferred.make<void>();
    let reading = 0;
    // Each open, once it reaches main across its port, reads the settings, held until the gate opens.
    const read = Effect.suspend(() => {
      reading += 1;
      return Effect.andThen(
        reading === 2 ? Deferred.succeed(bothReading, undefined) : Effect.void,
        Deferred.await(gate),
      );
    });
    const { actPort, started, pageGone } = fixture([SET], read);
    const panel = panelOf();
    const other = panelOf();

    const closing = yield* Effect.forkChild(
      actPort.perform({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel),
    );
    const leaving = yield* Effect.forkChild(
      actPort.perform({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, other),
    );
    yield* Deferred.await(bothReading);
    yield* actPort.perform(
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
      const { actPort, started, opened } = fixture([SET]);
      const panel = panelOf();
      yield* actPort.perform({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
      yield* actPort.perform(
        { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: { ...OPEN, branch: "luke/next-thing" } },
        panel,
      );

      assert.equal(started.length, 2);
      assert.equal(started[0]?.closed, true);
      assert.equal(opened[0]?.closed, true);
      assert.match(started[1]?.script ?? "", /'luke\/next-thing'/u);
    }),
);

it.effect("an open whose read of the run commands failed says so and starts nothing", () =>
  Effect.gen(function* () {
    const { actPort, started, opened } = fixture(undefined);
    const answer = yield* actPort.perform(
      { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN },
      panelOf(),
    );

    assert.deepEqual(answer, { refused: REFUSAL[ACT_KIND.MAC_REPOSITORIES] });
    assert.equal(started.length, 0);
    assert.equal(opened.length, 0);
  }),
);

it.effect(
  "a tab drawn again over its running terminal is shown it, though the run commands cannot be read",
  () =>
    Effect.gen(function* () {
      let readable = true;
      const { actPort, started, opened } = fixture(
        [SET],
        Effect.suspend(() => (readable ? Effect.void : Effect.die("unreadable"))),
      );
      const panel = panelOf();
      yield* actPort.perform({ kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN }, panel);
      started[0]?.output("ready");
      readable = false;

      const again = yield* actPort.perform(
        { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN },
        panel,
      );

      assert.ok("answer" in again);
      assert.equal(started.length, 1);
      assert.deepEqual(outputText(opened[1]?.posted ?? []), ["ready"]);
    }),
);

it.effect("a frame this build does not trust is refused, even as a panel, and starts nothing", () =>
  Effect.gen(function* () {
    const { actPort, started, opened } = fixture([SET]);

    const refused = yield* actPort.perform(
      { kind: ACT_KIND.MAC_TERMINAL_OPEN, payload: OPEN },
      panelOf(),
      { trusted: false },
    );

    assert.deepEqual(refused, { refused: REFUSAL[ACT_KIND.MAC_TERMINAL_OPEN] });
    assert.equal(started.length, 0);
    assert.equal(opened.length, 0);
  }),
);
