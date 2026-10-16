/**
 * pr-run-acts.ts -- the act rows that run a coding agent's work on this Mac: the workspace's run commands read and set, a run started, stopped, and closed for the panel that drew it, and its checkout shown in Finder or deleted.
 *
 * The rows carry an agent's id, workspace, and repository, and a
 * repository's setup and run commands, and nothing else. A start mints a
 * connection for the asking panel and that agent, opens a channel, posts the
 * channel's other end to that panel alone, and only then asks the host to
 * run, so the port stands before anything is printed. What the run prints
 * arrives as the host's events for that connection and is posted on main's
 * end; the acks the tab sends back arrive on it and go to the host named by
 * the same connection. Nothing a run prints is read here beyond its
 * connection's id, kept, logged, or written to app state. A panel that runs
 * an agent it already draws has the older port closed first, its run left
 * to the host to stop or join; a tab drawn again attaches a fresh connection
 * to the run standing without starting one, and a tab out of sight
 * detaches, its run going on; a closed tab lets its connection go, which
 * stops its run; and a panel whose page is gone has every connection it
 * held let go. Only a panel draws a run, so the run rows refuse the voice
 * and call windows.
 */

import {
  PR_RUN_PORT_MESSAGE,
  type PrRunOutcome,
  type PrRunPortOutbound,
  type PrRunTarget,
  prRunPortInboundSchema,
} from "@luke/features/pr-run-view";
import { ACT, ACT_KIND } from "@luke/host/acts";
import type { HostOperator } from "@luke/host/host-operator";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type { WebContents } from "electron";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

type PrRunActKind =
  | typeof ACT_KIND.PR_RUN_COMMANDS
  | typeof ACT_KIND.PR_RUN_SET_COMMAND
  | typeof ACT_KIND.PR_RUN_START
  | typeof ACT_KIND.PR_RUN_ATTACH
  | typeof ACT_KIND.PR_RUN_DETACH
  | typeof ACT_KIND.PR_RUN_STOP
  | typeof ACT_KIND.PR_RUN_CLOSE
  | typeof ACT_KIND.PR_RUN_SHOW_IN_FINDER
  | typeof ACT_KIND.PR_RUN_DELETE_CHECKOUT;

/** Main's end of one run's channel. */
export interface MainPrRunPort {
  post(message: PrRunPortOutbound): void;
  /** Hears each message the panel sends, unread. */
  onMessage(listener: (message: WireBoundaryInput) => void): void;
  close(): void;
}

/** How main reaches a panel's page for its ports. */
interface PrRunPortSeam {
  /** A fresh channel: main's end, with the other end already posted to the panel under the ticket. */
  open(sender: WebContents, ticket: PrRunTarget): MainPrRunPort;
  /** Calls `then` once, when the panel's page is gone. */
  whenGone(sender: WebContents, then: () => void): void;
}

export interface PrRunActsDependencies {
  host: Pick<
    HostOperator,
    | "prRunCommands"
    | "prRunSetCommand"
    | "prRunStart"
    | "prRunAttach"
    | "prRunDetach"
    | "prRunStop"
    | "prRunAck"
    | "prRunRelease"
    | "prRunLocate"
    | "prRunDelete"
    | "onPrRunOutput"
    | "onPrRunState"
  >;
  ports: PrRunPortSeam;
  /** Reveals a folder in Finder. */
  showInFinder: (folder: string) => void;
  /** A fresh connection id. */
  createId: () => string;
  /** Runs what a port's message asks of the host, from the port's own callback. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

/** One run a panel draws: the connection the host knows it by, and main's end of its channel. */
interface Drawn {
  readonly connectionId: string;
  readonly port: MainPrRunPort;
}

/** A panel's runs, by the agent whose work each runs. */
type PanelRuns = Map<string, Drawn>;

const readInbound = readEither(prRunPortInboundSchema);

/** The refusal a window that draws no run hears, in its kind's own words. */
function refuseUnlessPanel(kind: PrRunActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

/** An outcome the host answered, as the row's own: done is nothing, a refusal its words, no answer the kind's own words. */
function outcomeOf(
  kind: PrRunActKind,
  outcome: PrRunOutcome | undefined,
): Effect.Effect<void, ActRefused> {
  if (outcome === undefined) return Effect.fail(new ActRefused({ message: ACT[kind].refusal }));
  return "refused" in outcome
    ? Effect.fail(new ActRefused({ message: outcome.refused }))
    : Effect.void;
}

/** Every run a panel draws, flat. */
function everyDrawn(runs: PanelRuns): Drawn[] {
  return [...runs.values()];
}

export function prRunActRows(dependencies: PrRunActsDependencies): Pick<ActRows, PrRunActKind> {
  const { host, ports, showInFinder, createId, run } = dependencies;
  const panels = new Map<WebContents, PanelRuns>();
  /** Every drawn run, by connection, which is how the host names its events. */
  const byConnection = new Map<string, MainPrRunPort>();

  host.onPrRunOutput(({ connectionId, data }) => {
    byConnection.get(connectionId)?.post({ type: PR_RUN_PORT_MESSAGE.OUTPUT, data });
  });
  host.onPrRunState(({ connectionId, ...state }) => {
    byConnection.get(connectionId)?.post({ type: PR_RUN_PORT_MESSAGE.STATE, state });
  });

  /** One drawn run's port closed and its connection forgotten here, its run left standing at the host. */
  const forget = (drawn: Drawn) => {
    drawn.port.close();
    byConnection.delete(drawn.connectionId);
  };

  /** One drawn run let go: its port closed and its connection released at the host, which stops its run. */
  const release = (drawn: Drawn) =>
    Effect.suspend(() => {
      forget(drawn);
      return host.prRunRelease({ connectionId: drawn.connectionId });
    });

  /** A panel's runs, its page's end watched the first time it draws any. */
  const drawnOf = (sender: WebContents) => {
    let runs = panels.get(sender);
    if (runs === undefined) {
      const fresh: PanelRuns = new Map();
      runs = fresh;
      panels.set(sender, fresh);
      ports.whenGone(sender, () => {
        panels.delete(sender);
        void run(Effect.forEach(everyDrawn(fresh), release, { discard: true }));
      });
    }
    return runs;
  };

  /** A fresh connection for the panel and the agent, its port posted and its acks heard, in place of any it drew before. */
  const opened = (sender: WebContents, target: PrRunTarget) => {
    const runs = drawnOf(sender);
    const earlier = runs.get(target.agentId);
    if (earlier !== undefined) forget(earlier);
    const connectionId = createId();
    const port = ports.open(sender, target);
    const drawn = { connectionId, port };
    runs.set(target.agentId, drawn);
    byConnection.set(connectionId, port);
    port.onMessage((message) => void run(heard(connectionId, message)));
    /** The connection let go where a newer one has not taken its place. */
    const dropped = Effect.suspend(() => {
      if (runs.get(target.agentId) === drawn) runs.delete(target.agentId);
      return release(drawn);
    });
    return { connectionId, dropped };
  };

  /** The panel's connection for the agent, taken out of its map; none where it draws none. */
  const takenDrawn = (sender: WebContents, target: PrRunTarget) => {
    const runs = panels.get(sender);
    const drawn = runs?.get(target.agentId);
    if (drawn !== undefined) runs?.delete(target.agentId);
    return drawn;
  };

  /** An ack the panel sent on a run's port, handed to the host; anything else is dropped. */
  const heard = (connectionId: string, message: WireBoundaryInput): Effect.Effect<void> => {
    const read = readInbound(unparsedWire(message));
    return Result.isFailure(read)
      ? Effect.void
      : host.prRunAck({ connectionId, bytes: read.success.bytes });
  };

  return {
    [ACT_KIND.PR_RUN_COMMANDS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_COMMANDS, sender);
      return Effect.flatMap(host.prRunCommands(params), (answer) =>
        answer === undefined
          ? Effect.fail(new ActRefused({ message: ACT[ACT_KIND.PR_RUN_COMMANDS].refusal }))
          : Effect.succeed(answer),
      );
    },
    [ACT_KIND.PR_RUN_SET_COMMAND]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_SET_COMMAND, sender);
      return Effect.flatMap(host.prRunSetCommand(params), (outcome) =>
        outcomeOf(ACT_KIND.PR_RUN_SET_COMMAND, outcome),
      );
    },
    [ACT_KIND.PR_RUN_START]: (target, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_START, sender);
      return Effect.gen(function* () {
        const { connectionId, dropped } = opened(sender.sender, target);
        const outcome = yield* host.prRunStart({ connectionId, ...target });
        if (outcome !== undefined && "done" in outcome) return undefined;
        yield* dropped;
        return yield* outcomeOf(ACT_KIND.PR_RUN_START, outcome);
      });
    },
    [ACT_KIND.PR_RUN_ATTACH]: (target, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_ATTACH, sender);
      const { connectionId } = opened(sender.sender, target);
      return host.prRunAttach({ connectionId, ...target });
    },
    [ACT_KIND.PR_RUN_DETACH]: (target, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_DETACH, sender);
      const drawn = takenDrawn(sender.sender, target);
      if (drawn === undefined) return Effect.void;
      forget(drawn);
      return host.prRunDetach({ connectionId: drawn.connectionId });
    },
    [ACT_KIND.PR_RUN_STOP]: (target, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_STOP, sender);
      return host.prRunStop(target);
    },
    [ACT_KIND.PR_RUN_CLOSE]: (target, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_CLOSE, sender);
      const drawn = takenDrawn(sender.sender, target);
      // Note that a tab closed while out of sight draws no connection, and its run is stopped all the same.
      return drawn === undefined ? host.prRunStop(target) : release(drawn);
    },
    [ACT_KIND.PR_RUN_SHOW_IN_FINDER]: (target, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_SHOW_IN_FINDER, sender);
      return Effect.flatMap(host.prRunLocate(target), (location) => {
        const folder = location?.path;
        if (folder === undefined || folder === null) {
          return Effect.fail(
            new ActRefused({ message: ACT[ACT_KIND.PR_RUN_SHOW_IN_FINDER].refusal }),
          );
        }
        return Effect.sync(() => showInFinder(folder));
      });
    },
    [ACT_KIND.PR_RUN_DELETE_CHECKOUT]: (target, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_DELETE_CHECKOUT, sender);
      return Effect.flatMap(host.prRunDelete(target), (outcome) =>
        outcomeOf(ACT_KIND.PR_RUN_DELETE_CHECKOUT, outcome),
      );
    },
  };
}
