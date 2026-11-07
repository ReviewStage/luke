/**
 * cli.ts -- the `vespin` command installed into this Mac's account, as a procedure: the version installed and whether the shell finds it, or why the install did not finish.
 *
 * Main answers it itself (`apps/desktop/src/main/ipc/cli-acts.ts`), running
 * the install script of the service it signs in to, never one a window
 * names; a browser tab refuses it. Note that an install that did not finish
 * is answered rather than refused, since what the script said is what the
 * developer needs to read, and a refusal crosses in its kind's sentence alone.
 */

import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { CLI_ACT_KIND } from "./kinds.js";

/** How an install ended. */
export const CLI_INSTALL_OUTCOME = {
  INSTALLED: "installed",
  FAILED: "failed",
} as const;

/** An install that landed: the version the command says it is, and whether the login shell's PATH holds its folder; or one that did not, in the words it failed with. */
const cliInstallAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    outcome: EffectSchema.Literal(CLI_INSTALL_OUTCOME.INSTALLED),
    version: EffectSchema.String,
    onPath: EffectSchema.Boolean,
  }),
  EffectSchema.Struct({
    outcome: EffectSchema.Literal(CLI_INSTALL_OUTCOME.FAILED),
    reason: EffectSchema.String,
  }),
]);

export type CliInstallAnswer = typeof cliInstallAnswerSchema.Type;

export const cliActsContract = {
  [CLI_ACT_KIND.CLI_INSTALL]: actProcedure("Could not install the command-line tool on this Mac.")
    .input(exactInput(EffectSchema.Undefined))
    .output(cliInstallAnswerSchema),
};
