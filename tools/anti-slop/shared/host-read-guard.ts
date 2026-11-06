import { ACT_USE, PORT_ACT_USE } from "../../../packages/host/src/contract/kinds.ts";
import { TYPESCRIPT_SOURCE } from "./effect-edges.ts";
import { isTestFile } from "./kept-guard.ts";

/**
 * host-read-guard.ts -- what the `no-follow-outside-host-read` rule reads:
 * the modules a surface reads server data through, the door they hold their
 * reads open by, and the kinds that read, as `@repo/host`'s `PORT_ACT_USE`
 * declares them.
 */
export const HOST_READ_GUARD_RULE = "anti-slop/no-follow-outside-host-read";

/** The module a surface reads server data through, the only one that may open a read: the live reads' TanStack Query queries. */
const READ_FILES: ReadonlySet<string> = new Set(["packages/panel/src/live-reads.ts"]);

/** The live reads' door: it opens and polls the streams their queries hold, and only `live-reads.ts` imports it. */
const DOOR_FILE = "packages/panel/src/act-stream.ts";

/** The door's module, by its name however the path to it is spelled, with or without an extension. */
const DOOR_MODULE = /(?:^|\/)act-stream(?:\.[cm]?[jt]s)?$/u;

/** The panel's and the design system's own code, which the rule watches; a test, and what tests share, stand in for the host and are left be. */
export function isWatchedSource(file: string): boolean {
  return (
    (file.startsWith("packages/panel/src/") || file.startsWith("packages/ui/src/")) &&
    TYPESCRIPT_SOURCE.test(file) &&
    !isTestFile(file) &&
    !READ_FILES.has(file)
  );
}

/** Whether a file is the live reads' door, which opens and polls what their queries hold and so reads nothing of its own. */
export function isHoldDoor(file: string): boolean {
  return file === DOOR_FILE;
}

/** Whether an import's specifier names the live reads' door, from whatever folder it is spelled. */
export function namesHoldDoor(specifier: string): boolean {
  return DOOR_MODULE.test(specifier);
}

/** The helpers that hold a follow open on the window's act port. */
export const FOLLOW_OPENERS: ReadonlySet<string> = new Set(["streamFrom", "followStream"]);

/** The kinds whose answer can change while a surface shows it, by the name a call site spells. */
const READ_KINDS: ReadonlySet<string> = new Set(
  Object.entries(PORT_ACT_USE)
    .filter(([, use]) => use === ACT_USE.READ)
    .map(([name]) => name),
);

/** Whether an act kind reads data a surface shows, which only a live read's query may ask. */
export function isReadKind(name: string): boolean {
  return READ_KINDS.has(name);
}
