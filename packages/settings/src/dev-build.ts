import type { BuildCommit } from "./update.js";

const DEV_BUILD_COLORS = [
  "#2066b6",
  "#20b65f",
  "#8420b6",
  "#b6206b",
  "#20aab6",
  "#4a5a70",
] as const;

const LABEL_LENGTH = 8;

const PLAIN_LABEL = "dev";

export interface DevBuildBadge {
  readonly label: string;
  readonly color: string;
}

function shortLabel(name: string): string {
  const distance = name.search(/[~^]/u);
  const bare = distance === -1 ? name : name.slice(0, distance);
  if (bare.length <= LABEL_LENGTH) return bare;
  const word = bare.slice(Math.max(bare.lastIndexOf("/"), bare.lastIndexOf("-")) + 1);
  return word.slice(0, LABEL_LENGTH);
}

function colorFor(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return DEV_BUILD_COLORS[hash % DEV_BUILD_COLORS.length] ?? DEV_BUILD_COLORS[0];
}

export function commitLabel(commit: BuildCommit): string {
  return commit.dirty ? `${commit.sha}-dirty` : commit.sha;
}

export function devBuildDetail(commit: BuildCommit | undefined): string {
  if (!commit) return "Run from source.";
  return commit.branch ? `${commit.branch} @ ${commitLabel(commit)}` : commitLabel(commit);
}

export function devBuildBadge({
  instance,
  commit,
}: {
  instance?: string | undefined;
  commit?: BuildCommit | undefined;
}): DevBuildBadge {
  const name = instance ?? commit?.branch;
  return {
    label: (name === undefined ? "" : shortLabel(name)) || PLAIN_LABEL,
    color: colorFor(name ?? PLAIN_LABEL),
  };
}
