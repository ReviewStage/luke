import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  MAC_TERMINAL_PORT_MESSAGE,
  macTerminalPortOutboundSchema,
} from "@luke/features/mac-terminal-wire";
import { IRREVERSIBLE_WORDS } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_FLOW,
  Fill,
  PaneBar,
  useConfirmDialog,
} from "@luke/ui";
import { GLYPH, PlayIcon } from "@luke/ui/icons";
import type { MacTerminalStripTab } from "@luke/ui/tab-strip-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef, useState } from "react";
import { askActResult, useAct } from "../act.js";
import { TERMINAL_LOAD_FAILED, useSideBundles } from "../bundle-loader.js";
import { useTabActions } from "../desktop/strip-tabs.js";
import { useBusyPress } from "../settings/busy-press.js";
import { usePhoneRoom } from "../stage-room.js";
import type { TerminalHandle } from "../terminal/contract.js";
import { onMacTerminalPort } from "./mac-terminal-port.js";
import { pullRequestAsked } from "./pull-request-number.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * mac-terminal-tab.tsx -- an agent's pushed branch run on this Mac, drawn in the side panel: Run and Stop, how the run stands, and what it prints.
 *
 * Run in the agent tab's ⋯ opens this tab and starts a run. The tab reads
 * the agent's pushed branch, saying so on the screen, or says to ask the
 * agent to push where it has none, and asks main to run it at the screen's
 * size (`mac-terminal-acts.ts`): main brings the branch into a worktree of
 * Luke's own clone and runs the repository's command there. The screen
 * shows what the run prints and takes nothing typed. Stop asks first, then ends the run, the
 * tab hearing it end; Run starts it anew; Open in Terminal opens the Mac's
 * own Terminal in the worktree for what the developer wants to do by hand.
 * Out of sight, the tab lets go of its port and the run goes on; drawn
 * again, it is shown the run's output so far, or as it ended, and only a
 * Run press starts another. Closing the tab ends the run
 * (`use-side-panel.ts`), asking first while it is going (`side-panel.tsx`). A refusal from main is written on the screen. What
 * the run prints reaches this screen and nowhere else, so the tab is left
 * out of the screen recording.
 */

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

const readOutbound = Schema.decodeUnknownOption(macTerminalPortOutboundSchema);

/** Dim words on the screen, as Luke's own lines between the run's. */
function said(words: string): string {
  return `\r\n\x1b[2m${words}\x1b[0m\r\n`;
}

/** An agent's pushed branch and the number of the pull request from it, where there is one. */
interface ReadBranch {
  readonly branch: string;
  readonly pullRequest: number | null;
}

/** Where a run stands, as the tab draws it. */
type Standing =
  | { readonly kind: "starting" }
  | { readonly kind: "running" }
  | { readonly kind: "stopping" }
  | { readonly kind: "ended"; readonly code: number | null; readonly stopped: boolean }
  | { readonly kind: "idle" };

/** The words the bar says of a run. */
function standingWords(standing: Standing): string {
  switch (standing.kind) {
    case "starting":
      return "Starting…";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping…";
    case "idle":
      return "Not running";
    case "ended":
      if (standing.stopped) return "Stopped";
      return standing.code === 0 ? "Finished" : `Exited with code ${standing.code ?? "unknown"}`;
  }
}

/**
 * The run each agent's tab last started, by agent: the press it was for and
 * the branch read for it, so the tab drawn again shows that run rather than
 * starting another, and reads the branch only after another press.
 */
const lastRuns = new Map<
  string,
  ReadBranch & { readonly asked: number; readonly presses: number; stopped: boolean }
>();

/**
 * Whether each agent's run is going, as its tab last drew it: kept past the
 * tab, which lets go of its port out of sight, so a close asks for a run it
 * last saw going. A run never drawn is not here, and is not going.
 */
const goingRuns = new Map<string, boolean>();

/** Whether the agent's run is going, or was when its tab was last drawn: what a close of its tab ends. */
export function macTerminalGoing(agentId: string): boolean {
  return goingRuns.get(agentId) === true;
}

/** What each end of a run asks first: what is running in it cannot be got back. */
const ENDS_WHAT_RUNS = `What's running in it ends. ${IRREVERSIBLE_WORDS}`;

export const MAC_TERMINAL_STOP_QUESTION: DialogQuestion = {
  title: "Stop the run?",
  body: ENDS_WHAT_RUNS,
  verb: "Stop",
  running: "Stopping",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

export const MAC_TERMINAL_CLOSE_QUESTION: DialogQuestion = {
  title: "Close this terminal?",
  body: ENDS_WHAT_RUNS,
  verb: "Close",
  running: "Closing",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

export function MacTerminalTab({ tab }: { tab: MacTerminalStripTab }): React.JSX.Element {
  const { macTerminal: agentId, repository, asked, number } = tab;
  const known = lastRuns.get(agentId);
  // Note that a press of Run in the tab counts on from the ⋯'s, so each press is a run of its own, and the tab drawn again counts on from the last run.
  const [presses, setPresses] = useState(known?.asked === asked ? known.presses : 0);
  const [branch, setBranch] = useState(known?.asked === asked ? known.branch : undefined);
  const [standing, setStanding] = useState<Standing>({ kind: "starting" });
  const { act } = useAct();
  const openLink = useOpenLink();
  // Note that the link opener is read through a ref rather than hung on the run's effect, because it is made anew whenever the listed tasks change, and the effect would tear the terminal down and draw it again each time.
  const opensLink = useRef(openLink);
  opensLink.current = openLink;
  const { terminal } = useSideBundles();
  const loaded = useAtomValue(terminal);
  const retry = useAtomRefresh(terminal);
  const module = Option.getOrUndefined(AsyncResult.value(loaded));
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const port = useRef<MessagePort | undefined>(undefined);
  // Note that a Stop press is kept with the run it stopped, so the tab drawn again says Stopped rather than how the stop made it exit.
  const stopAsked = useRef(false);
  const tellOnScreen = useRef<(words: string) => void>(() => undefined);

  useEffect(() => {
    if (module === undefined || element === null) return;
    let handle: TerminalHandle | undefined;
    const ran = lastRuns.get(agentId);
    stopAsked.current = ran?.asked === asked && ran.presses === presses && ran.stopped;
    setStanding({ kind: "starting" });
    // The port main posts for this agent, the newest drawn from; it is listened for before the open is asked.
    const stopListening = onMacTerminalPort(agentId, (posted) => {
      port.current?.close();
      port.current = posted;
      setStanding((now) => (now.kind === "starting" ? { kind: "running" } : now));
      posted.onmessage = (event) => {
        const message = readOutbound(event.data);
        if (Option.isNone(message) || port.current !== posted) return;
        if (message.value.type === MAC_TERMINAL_PORT_MESSAGE.OUTPUT) {
          handle?.write(message.value.data, () => undefined);
        } else {
          setStanding({ kind: "ended", code: message.value.code, stopped: stopAsked.current });
        }
      };
      posted.start();
    });
    handle = module.mount(element, {
      // Note that a run takes nothing typed; what it needs by hand is done in Open in Terminal.
      onInput: () => undefined,
      onResize: ({ cols, rows }) =>
        port.current?.postMessage({ type: MAC_TERMINAL_PORT_MESSAGE.RESIZE, cols, rows }),
      onLink: (href) => opensLink.current(href),
    });
    const mounted = handle;
    let live = true;
    const tell = (words: string) => {
      if (live) mounted.write(said(words), () => undefined);
    };
    tellOnScreen.current = tell;
    const held = lastRuns.get(agentId);
    // Note that a press not yet run starts a run; the tab drawn again over the press it ran only shows it.
    const again = held?.asked !== asked || held.presses !== presses;
    const reading: Promise<ReadBranch | null> = !again
      ? Promise.resolve(held)
      : (tell(
          number === undefined
            ? "▸ Reading the agent's pushed branch…"
            : `▸ Reading the branch of pull request #${number}…`,
        ),
        act(ACT_KIND.CODING_AGENTS_PULL_REQUEST, pullRequestAsked(agentId, number)).then(
          (answer) =>
            "failure" in answer || answer.branch === null
              ? null
              : { branch: answer.branch, pullRequest: answer.pullRequest?.number ?? null },
        ));
    reading
      .then((read) => {
        if (!live) return;
        if (read === null) {
          tell(
            number === undefined
              ? "This agent has pushed no branch yet. Ask it to push its work, then press Run again."
              : `Pull request #${number} could not be read from GitHub. Press Run again to retry.`,
          );
          setStanding({ kind: "idle" });
          return;
        }
        if (again) lastRuns.set(agentId, { asked, presses, stopped: false, ...read });
        setBranch(read.branch);
        const { cols, rows } = mounted.size();
        return act(ACT_KIND.MAC_TERMINAL_OPEN, {
          agentId,
          repository,
          branch: read.branch,
          pullRequest: read.pullRequest,
          // Note that a run asked for a pull request by its number runs that pull request's own head, not whatever branch now has its name.
          pullRequestHead: number !== undefined,
          again,
          cols,
          rows,
        });
      })
      .catch((refused: Error) => {
        tell(refused.message);
        if (live) setStanding({ kind: "idle" });
      });
    return () => {
      live = false;
      stopListening();
      port.current?.close();
      port.current = undefined;
      mounted.unmount();
    };
  }, [module, element, act, agentId, repository, asked, number, presses]);

  const running = standing.kind === "running" || standing.kind === "stopping";
  const going = running || standing.kind === "starting";
  useEffect(() => {
    goingRuns.set(agentId, going);
  }, [agentId, going]);
  const stopRun = (): Promise<ActionResult> => {
    stopAsked.current = true;
    const ran = lastRuns.get(agentId);
    if (ran !== undefined) ran.stopped = true;
    setStanding({ kind: "stopping" });
    return askActResult(act(ACT_KIND.MAC_TERMINAL_STOP, { agentId }).then(() => ACCEPTED)).then(
      (answer) => {
        if (answer.status === ACTION_RESULT_STATUS.ACCEPTED) return answer;
        // Note that a refused stop leaves the run going, so the tab says it is still running, unless the run has ended meanwhile.
        stopAsked.current = false;
        if (ran !== undefined) ran.stopped = false;
        setStanding((now) => (now.kind === "stopping" ? { kind: "running" } : now));
        return answer;
      },
    );
  };
  // Stopping ends what runs, which nothing brings back, so it asks first; a refusal is said in the question.
  const stopping = useConfirmDialog({ subject: running, surfaceOpen: true }, stopRun);
  const stop = stopping.ask;
  // Note that a refusal is written on the screen, so a press that opened nothing says why.
  const opening = useBusyPress(() =>
    act(ACT_KIND.MAC_TERMINAL_REVEAL, { agentId }).catch((refused: Error) =>
      tellOnScreen.current(refused.message),
    ),
  );

  const run = () => setPresses((count) => count + 1);
  // A phone draws no bar over the screen: its header's ⋯ runs, stops, and opens the run in
  // Terminal, saying where it stands and what it runs.
  const phone = usePhoneRoom();
  const where = `${repository}${branch === undefined ? "" : ` · ${branch}`} · this Mac`;
  useTabActions(
    phone
      ? [
          [
            running
              ? {
                  label: "Stop",
                  icon: <GLYPH.STOP />,
                  detail: standingWords(standing),
                  danger: true,
                  disabled: standing.kind === "stopping",
                  onSelect: stop,
                }
              : {
                  label: "Run",
                  icon: <PlayIcon aria-hidden />,
                  detail: standingWords(standing),
                  disabled: standing.kind === "starting",
                  onSelect: run,
                },
            {
              label: "Open in Terminal",
              icon: <GLYPH.TERMINAL />,
              detail: where,
              disabled: branch === undefined || standing.kind === "starting",
              onSelect: opening.onPress,
            },
          ],
        ]
      : undefined,
  );

  return (
    <Fill className="terminal-tab file-view ph-no-capture">
      {phone ? null : (
        <PaneBar
          title={repository}
          detail={
            <span className="terminal-tab-standing">
              {branch === undefined ? "" : ` · ${branch}`} · this Mac · {standingWords(standing)}
            </span>
          }
          actions={
            <>
              <Button
                icon={<GLYPH.TERMINAL />}
                label="Open in Terminal"
                size={BUTTON_SIZE.COMPACT}
                busy={opening.busy}
                busyLabel="Opening Terminal"
                disabled={branch === undefined || standing.kind === "starting"}
                onClick={opening.onPress}
              >
                Open in Terminal
              </Button>
              {running ? (
                <Button
                  icon={<GLYPH.STOP />}
                  variant={BUTTON_VARIANT.DANGER_OUTLINE}
                  size={BUTTON_SIZE.COMPACT}
                  busy={standing.kind === "stopping"}
                  busyLabel="Stopping"
                  onClick={stop}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  icon={<PlayIcon aria-hidden />}
                  variant={BUTTON_VARIANT.PRIMARY}
                  size={BUTTON_SIZE.COMPACT}
                  disabled={standing.kind === "starting"}
                  onClick={run}
                >
                  Run
                </Button>
              )}
            </>
          }
        />
      )}
      <Fill flow={FILL_FLOW.ROW} clip className="terminal-tab-body">
        <div className="terminal-tab-host">
          {AsyncResult.isFailure(loaded) ? (
            <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={retry}>
              {TERMINAL_LOAD_FAILED}
            </ErrorState>
          ) : (
            <div ref={setElement} className="terminal-tab-screen" />
          )}
        </div>
      </Fill>
      <ConfirmDialog open confirm={stopping} question={MAC_TERMINAL_STOP_QUESTION} />
    </Fill>
  );
}
