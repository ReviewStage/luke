import { isWireUuid } from "./service-wire.js";

const TASK_NUMBER = /^(?:[\p{L}\p{N}]+-)?(\d+)$/u;

export type CliTaskRef = { readonly id: string } | { readonly number: number };

export function cliTaskRefOf(argument: string): CliTaskRef | undefined {
  const trimmed = argument.trim();
  const lowered = trimmed.toLowerCase();
  if (isWireUuid(lowered)) return { id: lowered };
  const number = Number(TASK_NUMBER.exec(trimmed)?.[1]);
  return Number.isSafeInteger(number) && number >= 1 ? { number } : undefined;
}
