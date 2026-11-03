// dev-build.ts -- what tells one development build from another: its label, its color, and where it was cut.
import type { BuildCommit } from "./update.js";

/**
 * The colors a development build is told apart by, on its Dock tile's band
 * and its window's chip alike. They are values rather than `--ui-*` tokens
 * because the Dock's tile is drawn in the main process, which reads no
 * stylesheet, and the chip must wear the very color the tile does. Each
 * carries white words, and none is near the copper tile's own, against which
 * an orange band would vanish.
 */
const DEV_BUILD_COLORS = [
  "#2066b6",
  "#20b65f",
  "#8420b6",
  "#b6206b",
  "#20aab6",
  "#4a5a70",
] as const;

/** How many characters a label keeps, about what a Dock tile's band holds legibly. */
const LABEL_LENGTH = 8;

/** What a plain development build with no branch to name is labeled. */
const PLAIN_LABEL = "dev";

/** A development build as its tile and chip draw it. */
export interface DevBuildBadge {
  /** A few characters for the Dock tile's band: the instance, or the branch's last words. */
  readonly label: string;
  /** Where it was cut, for the chip to show and copy: `branch @ sha`. */
  readonly detail: string;
  /** Its color, the same on every launch of the same build. */
  readonly color: string;
}

/**
 * A name cut to the band: whole where it fits, else its last word, past its
 * last `/` or `-` (`feat/dock-ribbon` is “ribbon”), without a `~2` distance or
 * a `^0`, and cut to the band's length.
 */
function shortLabel(name: string): string {
  const distance = name.search(/[~^]/u);
  const bare = distance === -1 ? name : name.slice(0, distance);
  if (bare.length <= LABEL_LENGTH) return bare;
  const word = bare.slice(Math.max(bare.lastIndexOf("/"), bare.lastIndexOf("-")) + 1);
  return word.slice(0, LABEL_LENGTH);
}

/** A color from the palette, read off the name the same way every launch. */
function colorFor(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return DEV_BUILD_COLORS[hash % DEV_BUILD_COLORS.length] ?? DEV_BUILD_COLORS[0];
}

/** The commit as `git describe --dirty` would mark it. */
export function commitLabel(commit: BuildCommit): string {
  return commit.dirty ? `${commit.sha}-dirty` : commit.sha;
}

/** Where a development build was cut from: the branch and commit, as far as the build knew. */
export function devBuildDetail(commit: BuildCommit | undefined): string {
  if (!commit) return "Run from source.";
  return commit.branch ? `${commit.branch} @ ${commitLabel(commit)}` : commitLabel(commit);
}

/**
 * A development build's badge: a named instance by its name, the plain one by
 * its branch. The color is read off the same name, so two runs of one build
 * match, and two builds may still share one, the label then telling them apart.
 */
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
    detail: devBuildDetail(commit),
    color: colorFor(name ?? PLAIN_LABEL),
  };
}
