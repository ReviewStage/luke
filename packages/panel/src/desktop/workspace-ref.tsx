import type { Workspace } from "@repo/features/workspace-wire";
import { cn, HoverCard, HoverCardHead, OneLine, Tooltip } from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { ReactNode } from "react";
import { TILE_SIZE, WorkspaceTile } from "./workspace-tile.js";

export const WORKSPACE_REF_SIZE = {
  INLINE: "inline",
  ROW: "row",
  HEAD: "head",
} as const;

type WorkspaceRefSize = (typeof WORKSPACE_REF_SIZE)[keyof typeof WORKSPACE_REF_SIZE];

const GAP_OF_SIZE = {
  [WORKSPACE_REF_SIZE.INLINE]: "gap-tight-gap",
  [WORKSPACE_REF_SIZE.ROW]: "gap-item-gap",
  [WORKSPACE_REF_SIZE.HEAD]: "gap-icon-gap",
} as const;

const NAME_OF_SIZE = {
  [WORKSPACE_REF_SIZE.INLINE]: "self-baseline py-workspace-ref-lift",
  [WORKSPACE_REF_SIZE.ROW]: undefined,
  [WORKSPACE_REF_SIZE.HEAD]: "text-foreground font-ui-semibold",
} as const;

const TILE_OF_SIZE = {
  [WORKSPACE_REF_SIZE.INLINE]: TILE_SIZE.INLINE,
  [WORKSPACE_REF_SIZE.ROW]: TILE_SIZE.ROW,
  [WORKSPACE_REF_SIZE.HEAD]: TILE_SIZE.SIDEBAR,
} as const;

type NamedWorkspace = Pick<Workspace, "id" | "name" | "photoVersion" | "pictureUrl">;

export function sharedWords(count: number | undefined, personal: boolean): string | undefined {
  if (count === undefined) return undefined;
  if (count <= 1) return personal ? "Personal workspace" : "1 member";
  return `${count} members`;
}

export function WorkspaceCard({
  workspace,
  personal,
}: {
  workspace: NamedWorkspace & Pick<Workspace, "memberCount">;
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
  const named = (
    <ReplayMask>
      {name === undefined ? (
        <OneLine className={nameClass} words={workspace.name}>
          {workspace.name}
        </OneLine>
      ) : (
        <OneLine className={nameClass}>{name}</OneLine>
      )}
    </ReplayMask>
  );
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
      <ReplayMask>
        <WorkspaceTile workspace={workspace} size={TILE_OF_SIZE[size]} />
      </ReplayMask>
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
