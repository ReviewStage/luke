import { useAtomValue } from "@effect/atom-react";
import {
  MAC_TERMINAL_PORT_MESSAGE,
  macTerminalPortOutboundSchema,
} from "@luke/features/mac-terminal-wire";
import { ACT_KIND } from "@luke/host/acts";
import { BUTTON_SIZE, BUTTON_VARIANT, Button } from "@luke/ui";
import type { MacTerminalStripTab } from "@luke/ui/tab-strip-model";
import { Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { PlayIcon, SquareIcon, TerminalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { TERMINAL_LOAD_FAILED, useSideBundles } from "../bundle-loader.js";
import type { TerminalHandle } from "../terminal/contract.js";
import { onMacTerminalPort } from "./mac-terminal-port.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * mac-terminal-tab.tsx -- an agent's pushed branch run on this Mac, drawn in the side panel: Run and Stop, how the run stands, and what it prints.
 *
 * Run in the agent tab's ⋯ opens this tab and starts a run. The tab reads
 * the agent's pushed branch, saying so on the screen, or says to ask the
 * agent to push where it has none, and asks main to run it at the screen's
 * size (`mac-terminal-acts.ts`): main brings the branch into a worktree of
 * Luke's own clone and runs the repository's command there. The screen
 * shows what the run prints and takes nothing typed. Stop ends the run, the
 * tab hearing it end; Run starts it anew; Open in Terminal opens the Mac's
 * own Terminal in the worktree for what the developer wants to do by hand.
 * Out of sight, the tab lets go of its port and the run goes on; drawn
 * again, it is shown the run's output so far, or as it ended, and only a
 * Run press starts another. Closing the tab ends the run
 * (`use-side-panel.ts`). A refusal from main is written on the screen. What
 * the run prints reaches this screen and nowhere else, so the tab is left
 * out of the screen recording.
 */

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

export function MacTerminalTab({ tab }: { tab: MacTerminalStripTab }): React.JSX.Element {
  const { macTerminal: agentId, repository, asked } = tab;
  const known = lastRuns.get(agentId);
  // Note that a press of Run in the tab counts on from the ⋯'s, so each press is a run of its own, and the tab drawn again counts on from the last run.
  const [presses, setPresses] = useState(known?.asked === asked ? known.presses : 0);
  const [branch, setBranch] = useState(known?.asked === asked ? known.branch : undefined);
  const [standing, setStanding] = useState<Standing>({ kind: "starting" });
  const { act } = useAct();
  const openLink = useOpenLink();
  const loaded = useAtomValue(useSideBundles().terminal);
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
      onLink: openLink,
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
      : (tell("▸ Reading the agent's pushed branch…"),
        act(ACT_KIND.CODING_AGENTS_PULL_REQUEST, { agentId }).then((answer) =>
          "failure" in answer || answer.branch === null
            ? null
            : { branch: answer.branch, pullRequest: answer.pullRequest?.number ?? null },
        ));
    reading
      .then((read) => {
        if (!live) return;
        if (read === null) {
          tell(
            "This agent has pushed no branch yet. Ask it to push its work, then press Run again.",
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
  }, [module, element, openLink, act, agentId, repository, asked, presses]);

  const running = standing.kind === "running" || standing.kind === "stopping";
  const stop = () => {
    stopAsked.current = true;
    const ran = lastRuns.get(agentId);
    if (ran !== undefined) ran.stopped = true;
    setStanding({ kind: "stopping" });
    act(ACT_KIND.MAC_TERMINAL_STOP, { agentId }).catch(() => undefined);
  };
  const openInTerminal = () => {
    // Note that a refusal is written on the screen, so a press that opened nothing says why.
    act(ACT_KIND.MAC_TERMINAL_REVEAL, { agentId }).catch((refused: Error) =>
      tellOnScreen.current(refused.message),
    );
  };

  return (
    <div className="terminal-tab file-view ph-no-capture">
      <header className="file-view-bar">
        <span className="terminal-tab-title">
          <span className="terminal-tab-agent">{repository}</span>
          <span className="terminal-tab-standing">
            {branch === undefined ? "" : ` · ${branch}`} · this Mac · {standingWords(standing)}
          </span>
        </span>
        <div className="file-view-actions">
          <Button
            icon={<TerminalIcon aria-hidden />}
            label="Open in Terminal"
            size={BUTTON_SIZE.COMPACT}
            disabled={branch === undefined || standing.kind === "starting"}
            onClick={openInTerminal}
          >
            Open in Terminal
          </Button>
          {running ? (
            <Button
              icon={<SquareIcon aria-hidden />}
              variant={BUTTON_VARIANT.DANGER_OUTLINE}
              size={BUTTON_SIZE.COMPACT}
              disabled={standing.kind === "stopping"}
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
              onClick={() => setPresses((count) => count + 1)}
            >
              Run
            </Button>
          )}
        </div>
      </header>
      <div className="terminal-tab-body">
        <div className="terminal-tab-host">
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
