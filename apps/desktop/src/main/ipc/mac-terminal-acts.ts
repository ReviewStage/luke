import { deviceAgentLayout } from "@repo/features/device-agent-wire";
import type { ActSender } from "@repo/host/act-port";
import { actPortFor, type PlatformActProcedures } from "@repo/host/act-port";
import { MAC_TERMINAL_ACT_KIND } from "@repo/host/contract";
import { Effect } from "effect";
import type { WebContents } from "electron";

type MacTerminalActKind = (typeof MAC_TERMINAL_ACT_KIND)[keyof typeof MAC_TERMINAL_ACT_KIND];

export interface MacTerminalActsDependencies {
  home: string;
  openInTerminal: (folder: string) => void;
  exists: (folder: string) => boolean;
}

const macTerminalPort = actPortFor<WebContents>();

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
      const folder = deviceAgentLayout(home, input.agentId).checkoutPath;
      if (!exists(folder)) return yield* Effect.fail(errors.REFUSED());
      openInTerminal(folder);
    }),
  };
}
