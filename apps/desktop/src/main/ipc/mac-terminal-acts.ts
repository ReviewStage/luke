/**
 * mac-terminal-acts.ts -- the act that opens a local agent's worktree in the Mac's own Terminal, answered on the act port.
 *
 * Only a panel opens one, so the procedure refuses any other window.
 */

import { deviceAgentLayout } from "@luke/features/device-agent-wire";
import type { ActSender } from "@luke/host/act-port";
import { actPortFor, type PlatformActProcedures } from "@luke/host/act-port";
import { MAC_TERMINAL_ACT_KIND } from "@luke/host/contract";
import { Effect } from "effect";
import type { WebContents } from "electron";

type MacTerminalActKind = (typeof MAC_TERMINAL_ACT_KIND)[keyof typeof MAC_TERMINAL_ACT_KIND];

export interface MacTerminalActsDependencies {
  /** This Mac's home folder, under which a local agent's worktree stands (`deviceAgentLayout`). */
  home: string;
  /** Opens the Mac's own Terminal in a folder; the host's own, or a test's. */
  openInTerminal: (folder: string) => void;
  /** Whether a folder stands on this Mac; the file system's own, or a test's. */
  exists: (folder: string) => boolean;
}

const macTerminalPort = actPortFor<WebContents>();

/** The refusal a window that is not a panel hears, in its kind's own words, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function macTerminalProcedures(
  dependencies: MacTerminalActsDependencies,
): Pick<PlatformActProcedures<WebContents>, MacTerminalActKind> {
  const { home, openInTerminal, exists } = dependencies;
  return {
    [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_LOCAL_AGENT]: macTerminalPort[
      MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_LOCAL_AGENT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that the worktree is the host's to make, as it takes the agent's launch, so one not made yet is refused rather than made here.
      const folder = deviceAgentLayout(home, input.agentId).checkoutPath;
      if (!exists(folder)) return yield* Effect.fail(errors.REFUSED());
      openInTerminal(folder);
    }),
  };
}
