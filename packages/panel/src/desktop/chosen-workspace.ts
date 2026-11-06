import type { Workspace } from "@repo/features/workspace-wire";
import { Schema } from "effect";
import { useState } from "react";
import { keptKey, useKept } from "../use-kept.js";

const storedChoice = Schema.fromJsonString(Schema.String);

const KEPT = { CHOICE: keptKey("app.chosenWorkspace", storedChoice) } as const;

function resolveChoice<Listed extends Pick<Workspace, "id">>(
  workspaces: readonly Listed[],
  kept: string | undefined,
): Listed | undefined {
  return workspaces.find((workspace) => workspace.id === kept) ?? workspaces[0];
}

export interface ChosenWorkspace {
  chosen: Workspace | undefined;
  choose: (workspaceId: string) => void;
}

export function useChosenWorkspace(
  workspaces: readonly Workspace[],
  staged: boolean,
): ChosenWorkspace {
  const [kept, keep] = useKept(KEPT.CHOICE, "");
  const [stagedChoice, setStagedChoice] = useState<string | undefined>(undefined);
  const choose = (workspaceId: string) => {
    if (staged) {
      setStagedChoice(workspaceId);
      return;
    }
    keep(workspaceId);
  };
  return { chosen: resolveChoice(workspaces, staged ? stagedChoice : kept), choose };
}

export function useKeptChoice<Listed extends Pick<Workspace, "id">>(
  workspaces: readonly Listed[],
): Listed | undefined {
  const [kept] = useKept(KEPT.CHOICE, "");
  return resolveChoice(workspaces, kept);
}
