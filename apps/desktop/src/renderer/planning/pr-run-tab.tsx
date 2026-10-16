import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { runsAsked } from "@luke/features/pr-run-store";
import {
  PR_RUN_FLOW,
  PR_RUN_PHASE,
  PR_RUN_PORT_MESSAGE,
  type PrRunState,
  type PrRunTarget,
  prRunPortOutboundSchema,
} from "@luke/features/pr-run-view";
import { ACT_KIND } from "@luke/host/acts";
import type { PrRunStripTab } from "@luke/ui/tab-strip-model";
import { Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAct } from "../act";
import type { TerminalHandle } from "../terminal/contract";
import { onPrRunPort } from "./pr-run-port";
import { TERMINAL_LOAD_FAILED, terminalModuleAtom } from "./terminal-bundle";
import { useOpenLink } from "./use-open-link";

/**
 * pr-run-tab.tsx -- a pull request run on this Mac: the live output of the repository's run command, from Luke's own checkout of the pull request, and its Stop.
 *
 * The tab is the Terminal tab's frame: a bar naming the pull request, the
 * commit it runs, and where the run stands, with Stop while it prepares or
 * runs and Run again once it has ended; then the run's output on the
 * terminal's screen, read-only, which fills the rest. A run is started by
 * Run on this Mac in the pull request's menu, which opens this tab and asks
 * it once (`pr-run-store.ts`); the tab starts it once its screen stands, so
 * the port the output comes on is listening first. Drawn again without an
 * ask, the tab shows the run that stands, from where it is now; taken out of
 * sight, it lets the run go on unwatched. Closing the tab stops the run
 * (`side-panel.tsx`), and the checkout stays. What the run prints reaches
 * this screen and nowhere else, so the whole tab is left out of the screen
 * recording.
 */

const readOutbound = Schema.decodeUnknownOption(prRunPortOutboundSchema);

/** The pull request in the words its tab names it by. */
function pullRequestWords(pullRequest: PrRunTarget): string {
  return `${pullRequest.repository} #${pullRequest.number}`;
}

/** Where a run stands, in a word or two. */
function standingWords(state: PrRunState | undefined): string {
  if (state === undefined) return "Starting";
  switch (state.phase) {
    case PR_RUN_PHASE.PREPARING:
      return "Preparing";
    case PR_RUN_PHASE.RUNNING:
      return "Running";
    case PR_RUN_PHASE.SUCCESS:
      return "Exited 0";
    case PR_RUN_PHASE.FAILURE:
      return state.exitCode === undefined ? "Could not run" : `Exited ${state.exitCode}`;
    case PR_RUN_PHASE.STOPPED:
      return "Stopped";
  }
}

/** Whether a run is under way, so Stop stands rather than Run again. */
function underWay(state: PrRunState | undefined): boolean {
  return state?.phase === PR_RUN_PHASE.PREPARING || state?.phase === PR_RUN_PHASE.RUNNING;
}

/** The same pull request, its repository's name read without case. */
function samePullRequest(a: PrRunTarget, b: PrRunTarget): boolean {
  return (
    a.workspaceId === b.workspaceId &&
    a.repository.toLowerCase() === b.repository.toLowerCase() &&
    a.number === b.number
  );
}

/** What the tab holds between renders: the port it draws from, its screen, and the bytes drawn since the last ack. */
interface Held {
  port: MessagePort | undefined;
  handle: TerminalHandle | undefined;
  unacked: number;
}

export function PrRunTab({
  tab,
  shown,
}: {
  tab: PrRunStripTab;
  /** Whether the tab is on screen, the one moment it draws the run. */
  shown: boolean;
}): React.JSX.Element {
  const { pullRequest, prRun: agentId } = tab;
  const { act } = useAct();
  const registry = useContext(RegistryContext);
  const openLink = useOpenLink();
  const loaded = useAtomValue(terminalModuleAtom);
  const module = Option.getOrUndefined(AsyncResult.value(loaded));
  const asked = useAtomValue(runsAsked(agentId));
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [handle, setHandle] = useState<TerminalHandle | undefined>(undefined);
  const [state, setState] = useState<PrRunState | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const live = useRef<Held>({ port: undefined, handle: undefined, unacked: 0 });

  // The screen mounts once the bundle has loaded and the tab has drawn its place; it takes no input.
  useEffect(() => {
    if (module === undefined || element === null) return;
    // Note that the run's output comes from a pipe, so its bare line feeds are drawn as new lines.
    const mounted = module.mount(element, {
      onInput: () => undefined,
      onResize: () => undefined,
      onLink: openLink,
      convertEol: true,
    });
    live.current.handle = mounted;
    setHandle(mounted);
    return () => {
      live.current.handle = undefined;
      setHandle(undefined);
      mounted.unmount();
    };
  }, [module, element, openLink]);

  // The run's port, which main posts to this window alone; the newest for this pull request is the one drawn from.
  useEffect(
    () =>
      onPrRunPort((ticket, port) => {
        if (!samePullRequest(ticket, pullRequest)) return;
        const held = live.current;
        held.port?.close();
        held.port = port;
        held.unacked = 0;
        port.onmessage = (event) => {
          if (held.port !== port) return;
          const message = readOutbound(event.data);
          if (Option.isNone(message)) return;
          if (message.value.type === PR_RUN_PORT_MESSAGE.STATE) {
            setState(message.value.state);
            return;
          }
          // Note that the output is counted in the bytes it came as, and acked only on the port it came on.
          const { data } = message.value;
          held.handle?.write(data, () => {
            if (held.port !== port) return;
            held.unacked += data.length;
            if (held.unacked < PR_RUN_FLOW.ACK_EVERY_BYTES) return;
            port.postMessage({ type: PR_RUN_PORT_MESSAGE.ACK, bytes: held.unacked });
            held.unacked = 0;
          });
        };
        port.start();
      }),
    [pullRequest],
  );

  const start = useCallback(() => {
    live.current.handle?.reset();
    setRefusal(undefined);
    setState(undefined);
    act(ACT_KIND.PR_RUN_START, pullRequest).catch((refused: Error) => setRefusal(refused.message));
  }, [act, pullRequest]);

  const stop = useCallback(() => {
    act(ACT_KIND.PR_RUN_STOP, pullRequest).catch((refused: Error) => setRefusal(refused.message));
  }, [act, pullRequest]);

  // Drawn, the tab starts each run asked of it, or shows the run that stands; out of sight, it sets the run aside.
  useEffect(() => {
    if (!shown || handle === undefined) return;
    if (registry.get(runsAsked(agentId)) === 0) {
      act(ACT_KIND.PR_RUN_ATTACH, pullRequest).catch(() => undefined);
    }
    return () => {
      live.current.port?.close();
      live.current.port = undefined;
      act(ACT_KIND.PR_RUN_DETACH, pullRequest).catch(() => undefined);
    };
  }, [shown, handle, registry, agentId, act, pullRequest]);

  useEffect(() => {
    if (!shown || handle === undefined || asked === 0) return;
    registry.set(runsAsked(agentId), 0);
    start();
  }, [shown, handle, asked, registry, agentId, start]);

  const sha = state?.sha;
  const message = refusal ?? state?.message;
  return (
    <div className="terminal-tab pr-run-tab file-view ph-no-capture" data-phase={state?.phase}>
      <header className="file-view-bar">
        <span className="terminal-tab-title">
          <span className="terminal-tab-agent">{pullRequestWords(pullRequest)}</span>
          <span className="terminal-tab-standing">
            · this Mac · {standingWords(refusal === undefined ? state : undefined)}
            {sha === undefined ? null : <> · {sha.slice(0, 7)}</>}
          </span>
        </span>
        <div className="file-view-actions">
          {underWay(state) && refusal === undefined ? (
            <button type="button" className="terminal-bar-action" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" className="terminal-bar-action" onClick={start}>
              Run again
            </button>
          )}
        </div>
      </header>
      <div className="terminal-tab-body">
        <div className="terminal-tab-host">
          {message === undefined ? null : (
            <div className="terminal-bar" role="status">
              <span className="terminal-bar-words">{message}</span>
            </div>
          )}
          {AsyncResult.isFailure(loaded) ? (
            <p className="terminal-tab-failed">{TERMINAL_LOAD_FAILED}</p>
          ) : (
            <div ref={setElement} className="terminal-tab-screen" />
          )}
        </div>
      </div>
    </div>
  );
}
