import type { ActSender } from "@repo/host/act-port";
import { actPortFor, type PlatformActProcedures } from "@repo/host/act-port";
import { CLI_ACT_KIND, type CliInstallAnswer } from "@repo/host/contract";
import { Effect } from "effect";
import type { WebContents } from "electron";

type CliActKind = (typeof CLI_ACT_KIND)[keyof typeof CLI_ACT_KIND];

export interface CliActsDependencies {
  install: () => Effect.Effect<CliInstallAnswer>;
}

const cliPort = actPortFor<WebContents>();

function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function cliProcedures(
  dependencies: CliActsDependencies,
): Pick<PlatformActProcedures<WebContents>, CliActKind> {
  const { install } = dependencies;
  return {
    [CLI_ACT_KIND.CLI_INSTALL]: cliPort[CLI_ACT_KIND.CLI_INSTALL].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* install();
    }),
  };
}
