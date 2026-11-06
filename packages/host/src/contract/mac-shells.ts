import {
  terminalAgentParamsSchema,
  terminalAttachParamsSchema,
  terminalShellParamsSchema,
} from "@repo/features/terminal-acts";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { MAC_SHELL_ACT_KIND } from "./kinds.js";

const FOLDER_MAX_CHARS = 1024;

const macShellOpenParamsSchema = EffectSchema.Struct({
  agentId: terminalShellParamsSchema.fields.agentId,
  folder: EffectSchema.String.check(
    EffectSchema.isPattern(/^\//u),
    EffectSchema.isMaxLength(FOLDER_MAX_CHARS),
  ),
});

const macShellMirrorSchema = EffectSchema.Struct({ folder: EffectSchema.String });

const macShellOpenedSchema = EffectSchema.Struct({
  terminalId: terminalShellParamsSchema.fields.terminalId,
});

export const macShellActsContract = {
  [MAC_SHELL_ACT_KIND.MAC_SHELL_MIRROR]: actProcedure("Could not mirror this agent’s files.")
    .input(exactInput(terminalAgentParamsSchema))
    .output(macShellMirrorSchema),
  [MAC_SHELL_ACT_KIND.MAC_SHELL_OPEN]: actProcedure("Could not open a shell in that folder.")
    .input(exactInput(macShellOpenParamsSchema))
    .output(macShellOpenedSchema),
  [MAC_SHELL_ACT_KIND.MAC_SHELL_ATTACH]: actProcedure("Could not open that shell.")
    .input(exactInput(terminalAttachParamsSchema))
    .output(EffectSchema.Void),
  [MAC_SHELL_ACT_KIND.MAC_SHELL_CLOSE]: actProcedure("Could not close that shell.")
    .input(exactInput(terminalShellParamsSchema))
    .output(EffectSchema.Void),
};
