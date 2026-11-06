import { ACT_USE, PORT_ACT_USE } from "../../../packages/host/src/contract/kinds.ts";
import { TYPESCRIPT_SOURCE } from "./effect-edges.ts";
import { isTestFile } from "./kept-guard.ts";

export const HOST_READ_GUARD_RULE = "anti-slop/no-follow-outside-host-read";

const READ_FILES: ReadonlySet<string> = new Set([
  "packages/panel/src/use-host-read.ts",
  "packages/panel/src/live-reads.ts",
]);

const DOOR_FILE = "packages/panel/src/act-stream.ts";

const DOOR_MODULE = /(?:^|\/)act-stream(?:\.[cm]?[jt]s)?$/u;

export function isWatchedSource(file: string): boolean {
  return (
    (file.startsWith("packages/panel/src/") || file.startsWith("packages/ui/src/")) &&
    TYPESCRIPT_SOURCE.test(file) &&
    !isTestFile(file) &&
    !READ_FILES.has(file)
  );
}

export function isHoldDoor(file: string): boolean {
  return file === DOOR_FILE;
}

export function namesHoldDoor(specifier: string): boolean {
  return DOOR_MODULE.test(specifier);
}

export const FOLLOW_OPENERS: ReadonlySet<string> = new Set(["streamFrom", "followStream"]);

const READ_KINDS: ReadonlySet<string> = new Set(
  Object.entries(PORT_ACT_USE)
    .filter(([, use]) => use === ACT_USE.READ)
    .map(([name]) => name),
);

export function isReadKind(name: string): boolean {
  return READ_KINDS.has(name);
}
