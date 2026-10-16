import { useAtomValue } from "@effect/atom-react";
import {
  MAC_TERMINAL_PORT_MESSAGE,
  macTerminalPortOutboundSchema,
} from "@luke/features/mac-repository-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { MacTerminalStripTab } from "@luke/ui/tab-strip-model";
import { Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act";
import type { TerminalHandle } from "../terminal/contract";
import { onMacTerminalPort } from "./mac-terminal-port";
import { TERMINAL_LOAD_FAILED, terminalModuleAtom } from "./terminal-bundle";
import { useOpenLink } from "./use-open-link";

/**
 * mac-terminal-tab.tsx -- a terminal of this Mac, opened on an agent's pushed branch, drawn in the side panel.
 *
 * Open on this Mac in the agent tab's ⋯ opens this tab. Drawn, the tab
 * mounts the terminal's screen and asks main to open the agent's terminal
 * at the screen's size (`mac-terminal-acts.ts`): main starts it the first
 * time, in a worktree of the developer's own clone, running the
 * repository's command, and later only hands the standing one a fresh port,
 * its latest output first. What is typed and the screen's size go back on
 * that port. Out of sight, the tab lets go of its port and the terminal
 * runs on; closing the tab closes it (`use-side-panel.ts`). Main's refusal,
 * a setting missing or no clone where it says, is written on the screen.
 * What the terminal prints reaches this screen and nowhere else, so the tab
 * is left out of the screen recording.
 */

const readOutbound = Schema.decodeUnknownOption(macTerminalPortOutboundSchema);

/** Dim words on the screen, as Luke's own lines between the terminal's. */
function said(words: string): string {
  return `\r\n\x1b[2m${words}\x1b[0m\r\n`;
}

export function MacTerminalTab({ tab }: { tab: MacTerminalStripTab }): React.JSX.Element {
  const { macTerminal: agentId, repository, branch } = tab;
  const { act } = useAct();
  const openLink = useOpenLink();
  const loaded = useAtomValue(terminalModuleAtom);
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
    const { cols, rows } = mounted.size();
    act(ACT_KIND.MAC_TERMINAL_OPEN, { agentId, repository, branch, cols, rows }).catch(
      (refused: Error) => mounted.write(said(refused.message), () => undefined),
    );
    mounted.focus();
    return () => {
      stopListening();
      port.current?.close();
      port.current = undefined;
      mounted.unmount();
    };
  }, [module, element, openLink, act, agentId, repository, branch]);

  return (
    <div className="terminal-tab file-view ph-no-capture">
      <header className="file-view-bar">
        <span className="terminal-tab-title">
          <span className="terminal-tab-agent">{repository}</span>
          <span className="terminal-tab-standing"> · {branch} · this Mac</span>
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
