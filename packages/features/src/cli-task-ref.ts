/**
 * cli-task-ref.ts -- the task a `vespin` command's argument names: by its id, by its number in the workspace, or by its key (`ACME-42`).
 *
 * A window and a link name a task by its key, a script by the id an answer
 * printed, so the command takes all three. A number or a key names a task of
 * the workspace the command acts in (`plans.find`); the key's prefix is read
 * off the workspace's name and follows a rename (`workspace-key.ts`), so only
 * its number is read, and the prefix is never checked against the workspace.
 */

import { isWireUuid } from "./service-wire.js";

/** A task's key or its bare number: an optional prefix of letters and digits and a hyphen, then the number. */
const TASK_NUMBER = /^(?:[\p{L}\p{N}]+-)?(\d+)$/u;

/** What a command's argument names: a task by its id, or by its number in the workspace. */
export type CliTaskRef = { readonly id: string } | { readonly number: number };

/** The task an argument names, or none where it is neither an id, a number, nor a key. */
export function cliTaskRefOf(argument: string): CliTaskRef | undefined {
  const trimmed = argument.trim();
  const lowered = trimmed.toLowerCase();
  if (isWireUuid(lowered)) return { id: lowered };
  const number = Number(TASK_NUMBER.exec(trimmed)?.[1]);
  return Number.isSafeInteger(number) && number >= 1 ? { number } : undefined;
}
