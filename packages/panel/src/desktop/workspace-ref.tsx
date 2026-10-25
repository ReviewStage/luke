import type { Workspace } from "@luke/features/workspace-wire";
import { cn, HoverCard, HoverCardHead, OneLine, Tooltip } from "@luke/ui";
import type { ReactNode } from "react";
import { TILE_SIZE, WorkspaceTile } from "./workspace-tile.js";

/**
 * workspace-ref.tsx -- a workspace named wherever the window names one: its tile, its photo or its letter, and its name beside it, at a line's, a row's, or the sidebar head's size.
 *
 * A workspace is drawn one way wherever it is named, as a person is
 * (`actor-ref.tsx`): its tile (`workspace-tile.tsx`) and its name as one
 * object, so a reader knows the square at a glance in a crumb, a chip, a
 * dialog's row, a search result, and a task's banner alike. A row may hang a
 * quieter line under the name, who shares the workspace or why it cannot
 * take a task, which turns the name and the line into a column beside the
 * tile. Named in a sentence it may hang the workspace's card: its tile at a
 * card's size, its name, and who shares it. The name is text, never an
 * attribute, because the session recording masks text and nothing else.
 * The ref takes no press of its own: a place that opens something from it
 * wraps it in its own button, as the crumb does.
 */

/** How large a workspace is named: in a line of words, as a row's glyph, or as the sidebar's head. */
export const WORKSPACE_REF_SIZE = {
  INLINE: "inline",
  ROW: "row",
  HEAD: "head",
} as const;

type WorkspaceRefSize = (typeof WORKSPACE_REF_SIZE)[keyof typeof WORKSPACE_REF_SIZE];

/**
 * How far apart each size stands its tile and its name: a line's and the
 * head's at their own gaps, a row's a step wider than a line's; a name with
 * a line under it stands as far from its tile as the head's does.
 */
const GAP_OF_SIZE = {
  [WORKSPACE_REF_SIZE.INLINE]: "gap-tight-gap",
  [WORKSPACE_REF_SIZE.ROW]: "gap-item-gap",
  [WORKSPACE_REF_SIZE.HEAD]: "gap-block-gap",
} as const;

/**
 * The name at each size: in a line of words it sits on the line's baseline,
 * as an actor's does, standing at least the tile's height so the tile stays
 * centred on it; at the sidebar's head it takes the head's weight.
 */
const NAME_OF_SIZE = {
  [WORKSPACE_REF_SIZE.INLINE]: "self-baseline py-workspace-ref-lift",
  [WORKSPACE_REF_SIZE.ROW]: undefined,
  [WORKSPACE_REF_SIZE.HEAD]:
    "text-foreground text-section-size font-luke-semibold tracking-workspace-head",
} as const;

/** The tile each size of ref draws. */
const TILE_OF_SIZE = {
  [WORKSPACE_REF_SIZE.INLINE]: TILE_SIZE.INLINE,
  [WORKSPACE_REF_SIZE.ROW]: TILE_SIZE.ROW,
  [WORKSPACE_REF_SIZE.HEAD]: TILE_SIZE.HEAD,
} as const;

type NamedWorkspace = Pick<Workspace, "id" | "name" | "photoVersion" | "pictureUrl">;

/**
 * Who shares a workspace in words: "Personal workspace" for the account's
 * own first workspace while no one else is in it, its members counted
 * otherwise, a team made a moment ago and joined by no one yet included;
 * nothing from a service that does not count them.
 */
export function sharedWords(count: number | undefined, personal: boolean): string | undefined {
  if (count === undefined) return undefined;
  if (count <= 1) return personal ? "Personal workspace" : "1 member";
  return `${count} members`;
}

/** A workspace's card: its tile at a card's size, its name, and who shares it. */
export function WorkspaceCard({
  workspace,
  personal,
}: {
  workspace: NamedWorkspace & Pick<Workspace, "memberCount">;
  /** Whether it is the account's own first workspace. */
  personal: boolean;
}): React.JSX.Element {
  return (
    <HoverCard data-workspace-card="">
      <HoverCardHead
        mark={<WorkspaceTile workspace={workspace} size={TILE_SIZE.HEAD} />}
        name={workspace.name}
        sub={sharedWords(workspace.memberCount, personal)}
      />
    </HoverCard>
  );
}

/**
 * A workspace named: its tile and its name, and under the name its `line`
 * where a row hangs one. `name` stands in for the plain name where a place
 * draws it otherwise, a search marking what matched. With `card` the ref
 * hangs it while the pointer rests on it.
 */
export function WorkspaceRef({
  workspace,
  size = WORKSPACE_REF_SIZE.INLINE,
  name,
  line,
  card,
}: {
  workspace: NamedWorkspace;
  size?: WorkspaceRefSize;
  name?: ReactNode;
  line?: ReactNode;
  card?: ReactNode;
}): React.JSX.Element {
  const nameClass = cn("workspace-ref-name", NAME_OF_SIZE[size]);
  const named =
    name === undefined ? (
      <OneLine className={nameClass} words={workspace.name}>
        {workspace.name}
      </OneLine>
    ) : (
      <OneLine className={nameClass}>{name}</OneLine>
    );
  // Note that the head fills its row, so its chevron stands at the row's end.
  const ref = (
    <span
      className={cn(
        "workspace-ref inline-flex min-w-0 max-w-full items-center",
        size === WORKSPACE_REF_SIZE.INLINE ? "align-baseline" : "align-middle",
        line === undefined ? GAP_OF_SIZE[size] : "gap-block-gap",
        size === WORKSPACE_REF_SIZE.HEAD && "flex-1",
      )}
      data-size={size}
    >
      <WorkspaceTile workspace={workspace} size={TILE_OF_SIZE[size]} />
      {line === undefined ? (
        named
      ) : (
        <span className="workspace-ref-copy flex min-w-0 flex-col gap-list-gap">
          {named}
          <span className="workspace-ref-line text-muted-foreground text-caption-inline">
            {line}
          </span>
        </span>
      )}
    </span>
  );
  if (card === undefined) return ref;
  return (
    <Tooltip label={workspace.name} card={card}>
      {ref}
    </Tooltip>
  );
}
