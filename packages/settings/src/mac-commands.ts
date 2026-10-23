import type { UnparsedWireValue } from "@luke/wire";
import { Schema } from "effect";

/**
 * mac-commands.ts -- whether an agent's command runs on this Mac: after the developer allows it, always, or never.
 *
 * Settings stores the mode as an app setting (`schema.ts`), the host reads
 * it before each read for commands and as each claimed command is about to
 * run (`compose-mac-commands.ts`), and the prompt's Always allow writes it.
 */

export const MAC_COMMAND_MODE = {
  /** Each command is shown to the developer first, and runs only once they allow it. */
  ASK: "ask",
  /** Any command from any of the account's agents runs without asking. */
  ALWAYS: "always",
  /** The Mac takes no commands. */
  NEVER: "never",
} as const;

export type MacCommandMode = (typeof MAC_COMMAND_MODE)[keyof typeof MAC_COMMAND_MODE];

export const MAC_COMMAND_MODE_LIST: readonly MacCommandMode[] = Object.values(MAC_COMMAND_MODE);

/** Each mode as the setting's menu words it. */
export const MAC_COMMAND_MODE_LABEL = {
  [MAC_COMMAND_MODE.ASK]: "Ask every time",
  [MAC_COMMAND_MODE.ALWAYS]: "Always allow",
  [MAC_COMMAND_MODE.NEVER]: "Never",
} as const satisfies Record<MacCommandMode, string>;

const readsMacCommandMode = Schema.is(Schema.Literals(MAC_COMMAND_MODE_LIST));

export function isMacCommandMode(value: UnparsedWireValue): value is MacCommandMode {
  return readsMacCommandMode(value);
}
