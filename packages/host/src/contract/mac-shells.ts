import {
  terminalAgentParamsSchema,
  terminalAttachParamsSchema,
  terminalShellParamsSchema,
} from "@repo/features/terminal-acts";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { MAC_SHELL_ACT_KIND } from "./kinds.js";

/**
 * mac-shells.ts -- a shell on this Mac, opened in a folder for the asking panel, attached, and closed, as procedures.
 *
 * Main answers them itself (`../act-port/mac-shell-procedures.ts`), and a
 * browser tab refuses them. A shell is named as a cloud shell is, by its
 * agent and its own id, so an attach takes the cloud's attach as it stands
 * and posts the same port: what the shell prints, how it stands, and what
 * the panel types, resizes, and acks travel on it, never on these.
 */

/** The longest folder a shell opens in, as macOS's `PATH_MAX` bounds a path. */
const FOLDER_MAX_CHARS = 1024;

/** A shell opened for an agent, in a folder named by its absolute path, at the size its screen was first fitted to. */
const macShellOpenParamsSchema = EffectSchema.Struct({
  agentId: terminalShellParamsSchema.fields.agentId,
  folder: EffectSchema.String.check(
    EffectSchema.isPattern(/^\//u),
    EffectSchema.isMaxLength(FOLDER_MAX_CHARS),
  ),
  cols: terminalAttachParamsSchema.fields.cols,
  rows: terminalAttachParamsSchema.fields.rows,
});

/** The agent's mirror, by the absolute path of its folder. */
const macShellMirrorSchema = EffectSchema.Struct({ folder: EffectSchema.String });

/** The shell opened, by the id an attach and a close name it by. */
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
