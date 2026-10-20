/**
 * mac-terminal-acts.ts -- the acts that run a coding agent's branch on this Mac, answered on the act port: each repository's run command read and set; a run of the branch started for the asking panel, stopped with Stop, and closed with its tab; and its worktree opened in the Mac's own Terminal.
 *
 * An open asks nothing of the developer first. It reads the repository's
 * run command from this Mac's settings, where it has one, and starts the
 * terminal (`startMacTerminal` in `@luke/host/node`), whose script clones the repository
 * into Luke's own folder the first time, brings the branch into a worktree
 * of that clone, and runs the command there (`openOnMacScript`, beside it).
 * Stop ends the run and keeps its port, so the tab hears it end; Open in
 * Terminal opens the Mac's own Terminal in the branch's worktree. A run's
 * output goes out on a port posted to the asking panel alone, and the
 * panel's size comes back on it. The terminal keeps running while its tab is out of sight: a tab drawn
 * again opens afresh, gets a new port, and is shown the terminal's latest
 * output first, which is held in memory here up to a bound and nowhere
 * else, never logged or written to app state. A run that ended is
 * shown again as it ended, and started anew only by a Run press. A closed tab closes its terminal, and a
 * panel whose page is gone has every terminal it opened closed. Only a panel draws a terminal, so the procedures refuse the voice and
 * call windows.
 */

import path from "node:path";
import {
  MAC_TERMINAL_PORT_MESSAGE,
  type MacTerminalOpenParams,
  type MacTerminalPortOutbound,
  macTerminalPortInboundSchema,
} from "@luke/features/mac-terminal-wire";
import type { ActSender } from "@luke/host/act-port";
import { actPortFor, type PlatformActProcedures } from "@luke/host/act-port";
import { MAC_REPOSITORIES_REFUSAL, MAC_TERMINAL_ACT_KIND } from "@luke/host/contract";
import type { HostOperator } from "@luke/host/host-operator";
import {
  cloneFolder,
  type MacTerminal,
  openOnMacScript,
  type startMacTerminal,
  worktreeFolder,
} from "@luke/host/node";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type { WebContents } from "electron";

type MacTerminalActKind = (typeof MAC_TERMINAL_ACT_KIND)[keyof typeof MAC_TERMINAL_ACT_KIND];

/** Main's end of one terminal's channel. */
interface MainMacTerminalPort {
  post(message: MacTerminalPortOutbound): void;
  /** Hears each message the panel sends, unread. */
  onMessage(listener: (message: WireBoundaryInput) => void): void;
  close(): void;
}

export interface MacTerminalActsDependencies {
  host: Pick<HostOperator, "macRepositories" | "setMacRepository">;
  /** Where every Luke install keeps its clones and worktrees (`worktreesRoot`). */
  worktreesRoot: string;
  /** Where Luke keeps its application data, which an earlier Luke kept its clones and worktrees under. */
  stateRoot: string;
  ports: {
    /** A fresh channel: main's end, with the other end already posted to the panel under the agent's id. */
    open(sender: WebContents, ticket: { agentId: string }): MainMacTerminalPort;
    /** Calls `then` once, when the panel's page is gone. */
    whenGone(sender: WebContents, then: () => void): void;
  };
  /** Starts a terminal; the host's own, or a test's. */
  start: typeof startMacTerminal;
  /** Opens the Mac's own Terminal in a folder; the host's own, or a test's. */
  openInTerminal: (folder: string) => void;
  /** Whether a folder stands on this Mac; the file system's own, or a test's. */
  exists: (folder: string) => boolean;
}

/** How much of a terminal's latest output is kept for its tab drawn again: about a screenful of scrollback many times over. */
const KEPT_OUTPUT_BYTES = 256 * 1024;

/** One terminal a panel opened: the terminal, main's end of the channel its tab now draws it on, if any, and its latest output. */
interface Drawn {
  readonly terminal: MacTerminal;
  /** The repository and branch it opened, which an open of another branch for the agent replaces. */
  readonly repository: string;
  readonly branch: string;
  port: MainMacTerminalPort | undefined;
  readonly kept: Uint8Array[];
  keptBytes: number;
  exited: boolean;
  /** How the run ended, which a tab drawn again over it is told. */
  code: number | null;
}

/** One panel's terminals by agent, and the open asked last for each agent still reading the settings. */
interface Panel {
  readonly terminals: Map<string, Drawn>;
  readonly asking: Map<string, number>;
}

const readInbound = readEither(macTerminalPortInboundSchema);

const macTerminalPort = actPortFor<WebContents>();

/** The refusal a window that draws no terminal hears, in its kind's own words, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function macTerminalProcedures(
  dependencies: MacTerminalActsDependencies,
): Pick<PlatformActProcedures<WebContents>, MacTerminalActKind> {
  const { host, worktreesRoot, stateRoot, ports, start, openInTerminal, exists } = dependencies;
  /**
   * Each panel's terminals, by the agent whose branch each opened, and the
   * newest open asked for each agent while it reads the settings, which a
   * close or the page's end cancels.
   */
  const panels = new Map<WebContents, Panel>();
  let asks = 0;

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
    if (drawn.exited) port.post({ type: MAC_TERMINAL_PORT_MESSAGE.EXIT, code: drawn.code });
    port.onMessage((message) => {
      const read = readInbound(unparsedWire(message));
      if (Result.isFailure(read) || drawn.port !== port) return;
      drawn.terminal.resize(read.success.cols, read.success.rows);
    });
    drawn.port = port;
  };

  /** The panel's terminals, its page's end watched the first time it opens one. */
  const panelOf = (sender: WebContents): Panel => {
    const held = panels.get(sender);
    if (held !== undefined) return held;
    const fresh: Panel = { terminals: new Map(), asking: new Map() };
    panels.set(sender, fresh);
    ports.whenGone(sender, () => {
      panels.delete(sender);
      fresh.asking.clear();
      for (const drawn of fresh.terminals.values()) closed(drawn);
    });
    return fresh;
  };

  /**
   * The terminal for the agent drawn on a fresh port: the one standing,
   * where it has not ended, its latest output replayed, or else a new one
   * started on the branch, its port posted before its script starts.
   */
  /** The agent's run on the same branch handed a fresh port, the settings unread, unless it ended and Run was pressed; whether there was one. */
  const reattached = (sender: WebContents, params: MacTerminalOpenParams): boolean => {
    const standing = panelOf(sender).terminals.get(params.agentId);
    const same = standing?.repository === params.repository && standing.branch === params.branch;
    // Note that an ended run is shown again as it ended, and started anew only by a Run press.
    if (standing === undefined || !same || (standing.exited && params.again === true)) return false;
    attached(sender, params.agentId, standing);
    standing.terminal.resize(params.cols, params.rows);
    return true;
  };

  const opened = (sender: WebContents, params: MacTerminalOpenParams, command: string | null) => {
    const { terminals } = panelOf(sender);
    if (reattached(sender, params)) return;
    const standing = terminals.get(params.agentId);
    // An agent's terminal on another branch it pushed earlier is closed before the new one starts.
    if (standing !== undefined) closed(standing);
    // Note that output the script prints before its port is posted is kept, and replayed as the port is posted.
    const drawn: Drawn = {
      repository: params.repository,
      branch: params.branch,
      port: undefined,
      kept: [],
      keptBytes: 0,
      exited: false,
      code: null,
      terminal: start({
        build: (ttyFile) =>
          openOnMacScript({
            repository: params.repository,
            clone: cloneFolder(worktreesRoot, params.repository),
            worktree: worktreeFolder(worktreesRoot, params.repository, params.branch),
            earlier: {
              worktrees: path.dirname(worktreeFolder(stateRoot, params.repository, params.branch)),
              clone: cloneFolder(stateRoot, params.repository),
            },
            trash: path.join(worktreesRoot, "trash"),
            branch: params.branch,
            pullRequest: params.pullRequest,
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
          drawn.code = code;
          drawn.port?.post({ type: MAC_TERMINAL_PORT_MESSAGE.EXIT, code });
        },
      }),
    };
    terminals.set(params.agentId, drawn);
    attached(sender, params.agentId, drawn);
  };

  return {
    [MAC_TERMINAL_ACT_KIND.MAC_REPOSITORIES]: macTerminalPort[
      MAC_TERMINAL_ACT_KIND.MAC_REPOSITORIES
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.macRepositories();
      if (answer === undefined) return yield* Effect.fail(errors.REFUSED());
      return answer;
    }),
    [MAC_TERMINAL_ACT_KIND.MAC_REPOSITORY_SET]: macTerminalPort[
      MAC_TERMINAL_ACT_KIND.MAC_REPOSITORY_SET
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.setMacRepository(input);
      if (answer === undefined) return yield* Effect.fail(errors.REFUSED());
    }),
    [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_OPEN]: macTerminalPort[
      MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_OPEN
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const sender = context.actor.sender;
      // A tab drawn again over its running terminal needs nothing read.
      if (reattached(sender, input)) {
        // An earlier open of another branch still reading the settings is let go.
        panelOf(sender).asking.delete(input.agentId);
        return;
      }
      const panel = panelOf(sender);
      const ask = ++asks;
      panel.asking.set(input.agentId, ask);
      const answer = yield* host.macRepositories();
      // A tab closed, or a page gone, while the settings were read starts nothing.
      if (panel.asking.get(input.agentId) !== ask) return;
      panel.asking.delete(input.agentId);
      // A read that failed is said, in the read's own words, rather than taken for a repository with no command.
      if (answer === undefined) {
        return yield* Effect.fail(errors.REFUSED({ message: MAC_REPOSITORIES_REFUSAL }));
      }
      const key = input.repository.toLowerCase();
      const entry = answer.repositories.find((each) => each.repository.toLowerCase() === key);
      opened(sender, input, entry?.command ?? null);
    }),
    [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_STOP]: macTerminalPort[
      MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_STOP
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that a stop keeps the port, so the tab hears the run end and draws it stopped.
      panels.get(context.actor.sender)?.terminals.get(input.agentId)?.terminal.close();
    }),
    [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_REVEAL]: macTerminalPort[
      MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_REVEAL
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const drawn = panels.get(context.actor.sender)?.terminals.get(input.agentId);
      if (drawn === undefined) return yield* Effect.fail(errors.REFUSED());
      // Note that a branch that could not be brought in opens Terminal in the clone, where its worktree is not made.
      const folder = [
        worktreeFolder(worktreesRoot, drawn.repository, drawn.branch),
        cloneFolder(worktreesRoot, drawn.repository),
      ].find(exists);
      if (folder === undefined) return yield* Effect.fail(errors.REFUSED());
      openInTerminal(folder);
    }),
    [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_CLOSE]: macTerminalPort[
      MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_CLOSE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const panel = panels.get(context.actor.sender);
      panel?.asking.delete(input.agentId);
      const drawn = panel?.terminals.get(input.agentId);
      if (drawn === undefined) return;
      panel?.terminals.delete(input.agentId);
      closed(drawn);
    }),
  };
}
