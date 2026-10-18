import { useAtomValue } from "@effect/atom-react";
import {
  MAC_TERMINAL_PORT_MESSAGE,
  macTerminalPortOutboundSchema,
} from "@luke/features/mac-terminal-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { onMacTerminalPort } from "@luke/panel/tasks/mac-terminal-port";
import { useOpenLink } from "@luke/panel/tasks/use-open-link";
import type { TerminalHandle } from "@luke/panel/terminal/contract";
import type { MacTerminalStripTab } from "@luke/ui/tab-strip-model";
import { Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef, useState } from "react";
import { TERMINAL_LOAD_FAILED, useSideBundles } from "../bundle-loader";

/**
 * mac-terminal-tab.tsx -- a terminal of this Mac, opened on an agent's pushed branch, drawn in the side panel.
 *
 * Run in the agent tab's ⋯ opens this tab at once. Drawn after a press,
 * the tab mounts the terminal's screen, reads the agent's pushed branch,
 * saying so on the screen, or says to ask the agent to push where it has
 * none, and asks main to open the agent's terminal on it at the screen's
 * size (`mac-terminal-acts.ts`): main starts it the first
 * time, in a worktree of Luke's own clone of the repository, running the
 * repository's command where this Mac has one and then a shell, and later
 * only hands the standing one a fresh port, its latest output first. What
 * is typed and the screen's size go back on that port. Out of sight, the tab
 * lets go of its port and the terminal runs on; closing the tab closes it
 * (`use-side-panel.ts`). A refusal from main is written on the screen.
 * What the terminal prints reaches this screen and nowhere else, so the tab
 * is left out of the screen recording.
 */

const readOutbound = Schema.decodeUnknownOption(macTerminalPortOutboundSchema);

/** Dim words on the screen, as Luke's own lines between the terminal's. */
function said(words: string): string {
  return `\r\n\x1b[2m${words}\x1b[0m\r\n`;
}

/**
 * The branch each agent's tab last read, by agent, with the Run press it was
 * read for, so the tab drawn again reads it only after another press.
 */
const readBranches = new Map<string, { readonly asked: number; readonly branch: string }>();

export function MacTerminalTab({ tab }: { tab: MacTerminalStripTab }): React.JSX.Element {
  const { macTerminal: agentId, repository, asked } = tab;
  const known = readBranches.get(agentId);
  const [branch, setBranch] = useState(known?.asked === asked ? known.branch : undefined);
  const { act } = useAct();
  const openLink = useOpenLink();
  const loaded = useAtomValue(useSideBundles().terminal);
  const module = Option.getOrUndefined(AsyncResult.value(loaded));
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const port = useRef<MessagePort | undefined>(undefined);

  useEffect(() => {
    if (module === undefined || element === null) return;
    let handle: TerminalHandle | undefined;
    // The port main posts for this agent, the newest drawn from; it is listened for before the open is asked.
    const stopListening = onMacTerminalPort(agentId, (posted) => {
      port.current?.close();
      port.current = posted;
      posted.onmessage = (event) => {
        const message = readOutbound(event.data);
        if (Option.isNone(message) || port.current !== posted) return;
        if (message.value.type === MAC_TERMINAL_PORT_MESSAGE.OUTPUT) {
          handle?.write(message.value.data, () => undefined);
        } else {
          handle?.write(said(`[exited ${message.value.code}]`), () => undefined);
        }
      };
      posted.start();
    });
    handle = module.mount(element, {
      onInput: (data) => port.current?.postMessage({ type: MAC_TERMINAL_PORT_MESSAGE.INPUT, data }),
      onResize: ({ cols, rows }) =>
        port.current?.postMessage({ type: MAC_TERMINAL_PORT_MESSAGE.RESIZE, cols, rows }),
      onLink: openLink,
    });
    const mounted = handle;
    let live = true;
    const tell = (words: string) => {
      if (live) mounted.write(said(words), () => undefined);
    };
    const held = readBranches.get(agentId);
    // The agent's pushed branch: the one read for this press, or read now.
    const reading: Promise<string | null> =
      held?.asked === asked
        ? Promise.resolve(held.branch)
        : (tell("▸ Reading the agent's pushed branch…"),
          act(ACT_KIND.CODING_AGENTS_PULL_REQUEST, { agentId }).then((answer) =>
            "failure" in answer ? null : answer.branch,
          ));
    reading
      .then((read) => {
        if (!live) return;
        if (read === null) {
          tell(
            "This agent has pushed no branch yet. Ask it to push its work, then press Run again.",
          );
          return;
        }
        readBranches.set(agentId, { asked, branch: read });
        setBranch(read);
        const { cols, rows } = mounted.size();
        return act(ACT_KIND.MAC_TERMINAL_OPEN, { agentId, repository, branch: read, cols, rows });
      })
      .catch((refused: Error) => tell(refused.message));
    mounted.focus();
    return () => {
      live = false;
      stopListening();
      port.current?.close();
      port.current = undefined;
      mounted.unmount();
    };
  }, [module, element, openLink, act, agentId, repository, asked]);

  return (
    <div className="terminal-tab file-view ph-no-capture">
      <header className="file-view-bar">
        <span className="terminal-tab-title">
          <span className="terminal-tab-agent">{repository}</span>
          <span className="terminal-tab-standing">
            {branch === undefined ? "" : ` · ${branch}`} · this Mac
          </span>
        </span>
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
