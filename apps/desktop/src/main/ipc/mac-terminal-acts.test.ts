import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import type { ActSender } from "@repo/host/act-port";
import { type TestActPort, testActPort } from "@repo/host/act-port/testing";
import { ACT_KIND } from "@repo/host/acts";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { macTerminalProcedures } from "./mac-terminal-acts";

/**
 * A local agent's Terminal as main carries it, over a file system that
 * answers from a set: it opens the agent's worktree in the Mac's own
 * Terminal once the host made it, refuses before then, and answers only a
 * panel. Synthetic names throughout.
 */

/** Every act port a fixture opened, closed once its test is done. */
const ports: TestActPort<WebContents>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

// SAFETY: the rows read a sender by identity alone; one inert object is one window.
const panelOf = (): ActSender<WebContents> => ({
  sender: {} as WebContents,
  panel: true,
});

function fixture(standing: ReadonlySet<string> = new Set()) {
  const terminalOpenedIn: string[] = [];
  const actPort = testActPort(
    macTerminalProcedures({
      home: "/home",
      openInTerminal: (folder) => void terminalOpenedIn.push(folder),
      exists: (folder) => standing.has(folder),
    }),
  );
  ports.push(actPort);
  return { actPort, terminalOpenedIn };
}

it.effect(
  "a local agent's Terminal opens its worktree under ~/.vespin/agents, refuses before it is made, and answers only a panel",
  () =>
    Effect.gen(function* () {
      const worktree = `/home/.vespin/agents/${AGENT_ID}/repository`;
      const local = { kind: ACT_KIND.MAC_TERMINAL_LOCAL_AGENT, payload: { agentId: AGENT_ID } };
      const unmade = fixture();
      const refused = yield* unmade.actPort.perform(local, panelOf());
      assert.ok("refused" in refused);

      const made = fixture(new Set([worktree]));
      const other = yield* made.actPort.perform(local, { ...panelOf(), panel: false });
      assert.ok("refused" in other);
      yield* made.actPort.perform(local, panelOf());

      assert.deepEqual(unmade.terminalOpenedIn, []);
      assert.deepEqual(made.terminalOpenedIn, [worktree]);
    }),
);
