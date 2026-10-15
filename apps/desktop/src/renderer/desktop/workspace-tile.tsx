import type { Workspace } from "@luke/features/workspace-wire";

/**
 * workspace-tile.tsx -- a workspace's mark: the first letter of its name on a square of one of six hues.
 *
 * The square says a workspace is a team, as GitHub draws an organization
 * square and a person round. The hue is read off the workspace's id rather
 * than its name, so a rename keeps the mark the members know it by, and two
 * workspaces of one name still read apart more often than not. The letter is
 * the tile's own text, the name's first character as a reader sees it, an
 * emoji's whole, because text is what session replay masks
 * (`session-replay.ts`), and is hidden from a screen reader, since the row
 * beside it already says the name.
 */

/** How many hues a tile is drawn in: `--workspace-hue-1` through `--workspace-hue-6`. */
const WORKSPACE_HUES = 6;

/** Splits a name into the characters a reader sees, an emoji's parts as one. */
const CHARACTERS = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The name's first character as a reader sees it, upper-cased; none for a blank name. */
function letterOf(name: string): string {
  const [first] = CHARACTERS.segment(name.trim());
  return first === undefined ? "" : first.segment.toUpperCase();
}

/** The hue a workspace is drawn in, from 1, read off its id alone. */
function hueOf(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % WORKSPACE_HUES) + 1;
}

/** A workspace's tile, at a row's glyph size. */
export function WorkspaceTile({
  workspace,
}: {
  workspace: Pick<Workspace, "id" | "name">;
}): React.JSX.Element {
  return (
    <span className="workspace-tile" data-hue={hueOf(workspace.id)} aria-hidden="true">
      {letterOf(workspace.name)}
    </span>
  );
}
