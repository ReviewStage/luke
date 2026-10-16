/**
 * pr-run-acts.ts -- the act rows that run a pull request on this Mac: the account's run commands read and set, a run started, stopped, and closed for the panel that drew it, and its checkout shown in Finder or deleted.
 *
 * The rows carry a pull request's workspace, repository, and number, and a
 * repository's setup and run commands, and nothing else. A start mints a connection for the asking
 * panel and that pull request, opens a channel, posts the channel's other
 * end to that panel alone, and only then asks the host to run, so the port
 * stands before anything is printed. What the run prints arrives as the
 * host's events for that connection and is posted on main's end; the acks
 * the tab sends back arrive on it and go to the host named by the same
 * connection. Nothing a run prints is read here beyond its connection's id,
 * kept, logged, or written to app state. A panel that runs a pull request it
 * already draws has the older port closed first, its run left to the host to
 * stop or join; a tab drawn again attaches a fresh connection to the run
 * standing without starting one, and a tab out of sight detaches, its run
 * going on; a closed tab lets its connection go, which stops its run; and a
 * panel whose page is gone has every connection it held let go. Only a
 * panel draws a run, so the run rows refuse the voice and call windows.
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

/** A panel's runs, by workspace, then repository lowercased, then number. */
type PanelRuns = Map<string, Map<string, Map<number, Drawn>>>;

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
  return [...runs.values()].flatMap((repositories) =>
    [...repositories.values()].flatMap((numbers) => [...numbers.values()]),
  );
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

  /** The numbers map of a panel's runs of one repository, its page's end watched the first time it draws any. */
  const drawnOf = (sender: WebContents, pullRequest: PrRunTarget) => {
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
    const repositories = runs.get(pullRequest.workspaceId) ?? new Map<string, Map<number, Drawn>>();
    runs.set(pullRequest.workspaceId, repositories);
    const key = pullRequest.repository.toLowerCase();
    const numbers = repositories.get(key) ?? new Map<number, Drawn>();
    repositories.set(key, numbers);
    return numbers;
  };

  /** A fresh connection for the panel and the pull request, its port posted and its acks heard, in place of any it drew before. */
  const opened = (sender: WebContents, pullRequest: PrRunTarget) => {
    const numbers = drawnOf(sender, pullRequest);
    const earlier = numbers.get(pullRequest.number);
    if (earlier !== undefined) forget(earlier);
    const connectionId = createId();
    const port = ports.open(sender, pullRequest);
    const drawn = { connectionId, port };
    numbers.set(pullRequest.number, drawn);
    byConnection.set(connectionId, port);
    port.onMessage((message) => void run(heard(connectionId, message)));
    /** The connection let go where a newer one has not taken its place. */
    const dropped = Effect.suspend(() => {
      if (numbers.get(pullRequest.number) === drawn) numbers.delete(pullRequest.number);
      return release(drawn);
    });
    return { connectionId, dropped };
  };

  /** The panel's connection for the pull request, taken out of its map; none where it draws none. */
  const takenDrawn = (sender: WebContents, pullRequest: PrRunTarget) => {
    const numbers = panels
      .get(sender)
      ?.get(pullRequest.workspaceId)
      ?.get(pullRequest.repository.toLowerCase());
    const drawn = numbers?.get(pullRequest.number);
    if (drawn !== undefined) numbers?.delete(pullRequest.number);
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
    [ACT_KIND.PR_RUN_START]: (pullRequest, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_START, sender);
      return Effect.gen(function* () {
        const { connectionId, dropped } = opened(sender.sender, pullRequest);
        const outcome = yield* host.prRunStart({ connectionId, ...pullRequest });
        if (outcome !== undefined && "done" in outcome) return undefined;
        yield* dropped;
        return yield* outcomeOf(ACT_KIND.PR_RUN_START, outcome);
      });
    },
    [ACT_KIND.PR_RUN_ATTACH]: (pullRequest, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_ATTACH, sender);
      const { connectionId } = opened(sender.sender, pullRequest);
      return host.prRunAttach({ connectionId, ...pullRequest });
    },
    [ACT_KIND.PR_RUN_DETACH]: (pullRequest, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_DETACH, sender);
      const drawn = takenDrawn(sender.sender, pullRequest);
      if (drawn === undefined) return Effect.void;
      forget(drawn);
      return host.prRunDetach({ connectionId: drawn.connectionId });
    },
    [ACT_KIND.PR_RUN_STOP]: (pullRequest, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_STOP, sender);
      return host.prRunStop(pullRequest);
    },
    [ACT_KIND.PR_RUN_CLOSE]: (pullRequest, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_CLOSE, sender);
      const drawn = takenDrawn(sender.sender, pullRequest);
      // Note that a tab closed while out of sight draws no connection, and its run is stopped all the same.
      return drawn === undefined ? host.prRunStop(pullRequest) : release(drawn);
    },
    [ACT_KIND.PR_RUN_SHOW_IN_FINDER]: (pullRequest, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_SHOW_IN_FINDER, sender);
      return Effect.flatMap(host.prRunLocate(pullRequest), (location) => {
        const folder = location?.path;
        if (folder === undefined || folder === null) {
          return Effect.fail(
            new ActRefused({ message: ACT[ACT_KIND.PR_RUN_SHOW_IN_FINDER].refusal }),
          );
        }
        return Effect.sync(() => showInFinder(folder));
      });
    },
    [ACT_KIND.PR_RUN_DELETE_CHECKOUT]: (pullRequest, sender) => {
      refuseUnlessPanel(ACT_KIND.PR_RUN_DELETE_CHECKOUT, sender);
      return Effect.flatMap(host.prRunDelete(pullRequest), (outcome) =>
        outcomeOf(ACT_KIND.PR_RUN_DELETE_CHECKOUT, outcome),
      );
    },
  };
}
