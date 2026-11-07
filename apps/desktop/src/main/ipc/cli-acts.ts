/**
 * cli-acts.ts -- the act that installs the `vespin` command into this Mac's account, answered on the act port.
 *
 * Only a panel installs it, so the procedure refuses any other window. What
 * the install answers, installed or failed in the script's own words, crosses
 * as the answer (`@repo/host/contract`'s `cli.ts`).
 */

import type { ActSender } from "@repo/host/act-port";
import { actPortFor, type PlatformActProcedures } from "@repo/host/act-port";
import { CLI_ACT_KIND, type CliInstallAnswer } from "@repo/host/contract";
import { Effect } from "effect";
import type { WebContents } from "electron";

type CliActKind = (typeof CLI_ACT_KIND)[keyof typeof CLI_ACT_KIND];

export interface CliActsDependencies {
  /** Installs the command and answers how it went; the install script's own run, or a test's. */
  install: () => Effect.Effect<CliInstallAnswer>;
}

const cliPort = actPortFor<WebContents>();

/** The refusal a window that is not a panel hears, in its kind's own words, or nothing for a panel. */
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
