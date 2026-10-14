/**
 * terminal-acts.ts -- the Terminal tab's act rows: a coding agent's shells listed, started, named, ended, attached, and detached, and its sandbox resumed.
 *
 * The rows carry ids, sizes, and names alone; what a shell prints travels on
 * the port an attach posts to the asking panel (`#shared/messages/terminal`).
 * Until the host's terminal client stands, every row refuses with its kind's
 * own sentence, so the tab built against the contract reads the outage it
 * would read of an unreachable service.
 */

import { Effect } from "effect";
import { ACT, ACT_KIND } from "#shared/messages/acts";
import { ActRefused, type ActRows } from "../act-router";

type TerminalActKind =
  | typeof ACT_KIND.TERMINAL_LIST
  | typeof ACT_KIND.TERMINAL_CREATE
  | typeof ACT_KIND.TERMINAL_RENAME
  | typeof ACT_KIND.TERMINAL_KILL
  | typeof ACT_KIND.TERMINAL_RESUME
  | typeof ACT_KIND.TERMINAL_ATTACH
  | typeof ACT_KIND.TERMINAL_DETACH;

/** A row that refuses with its kind's own sentence. */
function refusing(kind: TerminalActKind) {
  return () => Effect.fail(new ActRefused({ message: ACT[kind].refusal }));
}

export function terminalActRows(): Pick<ActRows, TerminalActKind> {
  return {
    [ACT_KIND.TERMINAL_LIST]: refusing(ACT_KIND.TERMINAL_LIST),
    [ACT_KIND.TERMINAL_CREATE]: refusing(ACT_KIND.TERMINAL_CREATE),
    [ACT_KIND.TERMINAL_RENAME]: refusing(ACT_KIND.TERMINAL_RENAME),
    [ACT_KIND.TERMINAL_KILL]: refusing(ACT_KIND.TERMINAL_KILL),
    [ACT_KIND.TERMINAL_RESUME]: refusing(ACT_KIND.TERMINAL_RESUME),
    [ACT_KIND.TERMINAL_ATTACH]: refusing(ACT_KIND.TERMINAL_ATTACH),
    [ACT_KIND.TERMINAL_DETACH]: refusing(ACT_KIND.TERMINAL_DETACH),
  };
}
