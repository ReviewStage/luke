import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

export const MAC_COMMAND_MODE = {
  ASK: "ask",
  ALWAYS: "always",
  NEVER: "never",
} as const;

export type MacCommandMode = (typeof MAC_COMMAND_MODE)[keyof typeof MAC_COMMAND_MODE];

export const MAC_COMMAND_MODE_LIST: readonly MacCommandMode[] = Object.values(MAC_COMMAND_MODE);

export const MAC_COMMAND_MODE_LABEL = {
  [MAC_COMMAND_MODE.ASK]: "Ask every time",
  [MAC_COMMAND_MODE.ALWAYS]: "Always allow",
  [MAC_COMMAND_MODE.NEVER]: "Never",
} as const satisfies Record<MacCommandMode, string>;

const readsMacCommandMode = Schema.is(Schema.Literals(MAC_COMMAND_MODE_LIST));

export function isMacCommandMode(value: UnparsedWireValue): value is MacCommandMode {
  return readsMacCommandMode(value);
}
