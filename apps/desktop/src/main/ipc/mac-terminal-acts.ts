/**
 * mac-terminal-acts.ts -- the act rows that open a coding agent's branch on this Mac: each repository's local clone and command read, set, and its folder chosen; and a terminal of this Mac opened on the branch for the asking panel, and closed with its tab.
 *
 * An open reads the repository's clone and command from this Mac's
 * settings, refuses with where to fill them in where either is missing, and
 * starts the terminal (`@luke/host/mac-terminal`), whose script brings the
 * branch into a worktree of the clone and runs the command there
 * (`@luke/host/open-on-mac`). Its output goes out on a port posted to the
 * asking panel alone, and what the panel types and its size come back on
 * it. The terminal keeps running while its tab is out of sight: a tab drawn
 * again opens afresh, gets a new port, and is shown the terminal's latest
 * output first, which is held in memory here up to a bound and nowhere
 * else, never logged or written to app state. A terminal that ended is
 * started anew by the next open. A closed tab closes its terminal, and a
 * panel whose page is gone has every terminal it opened closed. Only a panel draws a terminal, so the rows refuse the voice and
 * call windows.
 */

import {
  MAC_TERMINAL_PORT_MESSAGE,
  type MacTerminalOpenParams,
  type MacTerminalPortOutbound,
  macTerminalPortInboundSchema,
} from "@luke/features/mac-repository-wire";
import { ACT, ACT_KIND } from "@luke/host/acts";
import type { HostOperator } from "@luke/host/host-operator";
import type { MacTerminal, startMacTerminal } from "@luke/host/mac-terminal";
import { openOnMacScript, worktreeFolder } from "@luke/host/open-on-mac";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type { WebContents } from "electron";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

type MacTerminalActKind =
  | typeof ACT_KIND.MAC_REPOSITORIES
  | typeof ACT_KIND.MAC_REPOSITORY_SET
  | typeof ACT_KIND.MAC_REPOSITORY_CHOOSE_FOLDER
  | typeof ACT_KIND.MAC_TERMINAL_OPEN
  | typeof ACT_KIND.MAC_TERMINAL_CLOSE;

/** Main's end of one terminal's channel. */
interface MainMacTerminalPort {
  post(message: MacTerminalPortOutbound): void;
  /** Hears each message the panel sends, unread. */
  onMessage(listener: (message: WireBoundaryInput) => void): void;
  close(): void;
}

export interface MacTerminalActsDependencies {
  host: Pick<HostOperator, "macRepositories" | "setMacRepository">;
  /** Where Luke keeps its application data, which every worktree lives under. */
  stateRoot: string;
  ports: {
    /** A fresh channel: main's end, with the other end already posted to the panel under the agent's id. */
    open(sender: WebContents, ticket: { agentId: string }): MainMacTerminalPort;
    /** Calls `then` once, when the panel's page is gone. */
    whenGone(sender: WebContents, then: () => void): void;
  };
  /** The system's folder picker over the asking window; the folder chosen, or null. */
  chooseFolder: (sender: WebContents) => Promise<string | null>;
  /** Starts a terminal; the host's own, or a test's. */
  start: typeof startMacTerminal;
}

/** How much of a terminal's latest output is kept for its tab drawn again: about a screenful of scrollback many times over. */
const KEPT_OUTPUT_BYTES = 256 * 1024;

/** One terminal a panel opened: the terminal, main's end of the channel its tab now draws it on, if any, and its latest output. */
interface Drawn {
  readonly terminal: MacTerminal;
  port: MainMacTerminalPort | undefined;
  readonly kept: Uint8Array[];
  keptBytes: number;
  exited: boolean;
}

const readInbound = readEither(macTerminalPortInboundSchema);

function refuseUnlessPanel(kind: MacTerminalActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function macTerminalActRows(
  dependencies: MacTerminalActsDependencies,
): Pick<ActRows, MacTerminalActKind> {
  const { host, stateRoot, ports, chooseFolder, start } = dependencies;
  /** Each panel's terminals, by the agent whose branch each opened. */
  const panels = new Map<WebContents, Map<string, Drawn>>();

  const closed = (drawn: Drawn) => {
    drawn.terminal.close();
    drawn.port?.close();
    drawn.port = undefined;
  };

  /** A fresh port for the drawn terminal, its latest output replayed on it first, in place of any earlier. */
  const attached = (sender: WebContents, agentId: string, drawn: Drawn) => {
    drawn.port?.close();
    const port = ports.open(sender, { agentId });
    for (const data of drawn.kept) port.post({ type: MAC_TERMINAL_PORT_MESSAGE.OUTPUT, data });
    port.onMessage((message) => {
      const read = readInbound(unparsedWire(message));
      if (Result.isFailure(read) || drawn.port !== port) return;
      if (read.success.type === MAC_TERMINAL_PORT_MESSAGE.INPUT)
        drawn.terminal.write(read.success.data);
      else drawn.terminal.resize(read.success.cols, read.success.rows);
    });
    drawn.port = port;
  };

  /** The panel's terminals, its page's end watched the first time it opens one. */
  const drawnOf = (sender: WebContents) => {
    const held = panels.get(sender);
    if (held !== undefined) return held;
    const fresh = new Map<string, Drawn>();
    panels.set(sender, fresh);
    ports.whenGone(sender, () => {
      panels.delete(sender);
      for (const drawn of fresh.values()) closed(drawn);
    });
    return fresh;
  };

  /**
   * The terminal for the agent drawn on a fresh port: the one standing,
   * where it has not ended, its latest output replayed, or else a new one
   * started on the branch, its port posted before its script starts.
   */
  const opened = (
    sender: WebContents,
    params: MacTerminalOpenParams,
    clone: string,
    command: string,
  ) => {
    const terminals = drawnOf(sender);
    const standing = terminals.get(params.agentId);
    if (standing !== undefined && !standing.exited) {
      attached(sender, params.agentId, standing);
      standing.terminal.resize(params.cols, params.rows);
      return;
    }
    // Note that output the script prints before its port is posted is kept, and replayed as the port is posted.
    const drawn: Drawn = {
      port: undefined,
      kept: [],
      keptBytes: 0,
      exited: false,
      terminal: start({
        build: (ttyFile) =>
          openOnMacScript({
            clone,
            worktree: worktreeFolder(stateRoot, params.repository, params.branch),
            branch: params.branch,
            command,
            ttyFile,
            size: { cols: params.cols, rows: params.rows },
          }),
        onOutput: (data) => {
          drawn.kept.push(data);
          drawn.keptBytes += data.length;
          while (drawn.keptBytes > KEPT_OUTPUT_BYTES && drawn.kept.length > 1) {
            drawn.keptBytes -= drawn.kept.shift()?.length ?? 0;
          }
          drawn.port?.post({ type: MAC_TERMINAL_PORT_MESSAGE.OUTPUT, data });
        },
        onExit: (code) => {
          drawn.exited = true;
          drawn.port?.post({ type: MAC_TERMINAL_PORT_MESSAGE.EXIT, code });
        },
      }),
    };
    terminals.set(params.agentId, drawn);
    attached(sender, params.agentId, drawn);
  };

  return {
    [ACT_KIND.MAC_REPOSITORIES]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.MAC_REPOSITORIES, sender);
      return Effect.flatMap(host.macRepositories(), (answer) =>
        answer === undefined
          ? Effect.fail(new ActRefused({ message: ACT[ACT_KIND.MAC_REPOSITORIES].refusal }))
          : Effect.succeed(answer),
      );
    },
    [ACT_KIND.MAC_REPOSITORY_SET]: (entry, sender) => {
      refuseUnlessPanel(ACT_KIND.MAC_REPOSITORY_SET, sender);
      return Effect.flatMap(host.setMacRepository(entry), (answer) =>
        answer === undefined
          ? Effect.fail(new ActRefused({ message: ACT[ACT_KIND.MAC_REPOSITORY_SET].refusal }))
          : Effect.void,
      );
    },
    [ACT_KIND.MAC_REPOSITORY_CHOOSE_FOLDER]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.MAC_REPOSITORY_CHOOSE_FOLDER, sender);
      return chooseFolder(sender.sender);
    },
    [ACT_KIND.MAC_TERMINAL_OPEN]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.MAC_TERMINAL_OPEN, sender);
      return Effect.gen(function* () {
        const answer = yield* host.macRepositories();
        const key = params.repository.toLowerCase();
        const entry = answer?.repositories.find((each) => each.repository.toLowerCase() === key);
        if (entry?.folder == null || entry.command == null) {
          return yield* Effect.fail(
            new ActRefused({
              message: `Set where ${params.repository} is cloned on this Mac, and its run command, under Settings › Workspace › Repositories.`,
            }),
          );
        }
        opened(sender.sender, params, entry.folder, entry.command);
      });
    },
    [ACT_KIND.MAC_TERMINAL_CLOSE]: ({ agentId }, sender) => {
      refuseUnlessPanel(ACT_KIND.MAC_TERMINAL_CLOSE, sender);
      const terminals = panels.get(sender.sender);
      const drawn = terminals?.get(agentId);
      if (drawn === undefined) return;
      terminals?.delete(agentId);
      closed(drawn);
    },
  };
}
