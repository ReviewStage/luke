import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { CLI_ACT_KIND } from "./kinds.js";

export const CLI_INSTALL_OUTCOME = {
  INSTALLED: "installed",
  FAILED: "failed",
} as const;

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
