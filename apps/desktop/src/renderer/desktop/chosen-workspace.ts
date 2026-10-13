import type { Workspace } from "@sidecar/hosted/workspace-wire";
import { Option, Schema } from "effect";
import { useState } from "react";

/**
 * chosen-workspace.ts -- which of the account's workspaces the sidebar lists and New plan starts in, kept across launches.
 *
 * The choice is this window's alone, as a fold is (`folded-groups.ts`), so it
 * is kept in the renderer's own storage rather than on the account: a Mac
 * left on a team's workspace opens on it again, and another Mac opens where
 * it was left. The service names the workspace on every request, so nothing
 * but this file ever knows which one is chosen. A kept id the view does not
 * list, another account's or one the account has left, is answered with the
 * personal workspace, and is overwritten only by the next choice. A fixture
 * run starts on the personal workspace and keeps nothing, so its frames
 * never wear a developer's choice.
 */

/** Where the choice is kept in the renderer's storage. */
const STORAGE_KEY = "luke.chosenWorkspace";

/** The chosen workspace's id. */
const storedChoice = Schema.fromJsonString(Schema.String);

/** The kept id, or nothing where none was kept, it no longer reads, or storage refuses the read. */
function readChoice(): string | undefined {
  try {
    const decoded = Schema.decodeUnknownOption(storedChoice)(
      window.localStorage.getItem(STORAGE_KEY),
    );
    return Option.getOrUndefined(decoded);
  } catch {
    return undefined;
  }
}

/** Keeps the choice; a write that fails costs only the personal workspace again next launch, so it is not worth a word. */
function writeChoice(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, Schema.encodeSync(storedChoice)(id));
  } catch {
    // The personal workspace is chosen again on the next launch.
  }
}

/**
 * The workspace `kept` names where the view lists it, else the personal one,
 * else the first listed; nothing while the view lists none, as before the
 * first read lands, which the sidebar answers by filtering nothing.
 */
function resolveChoice(
  workspaces: readonly Workspace[],
  kept: string | undefined,
): Workspace | undefined {
  return (
    workspaces.find((workspace) => workspace.id === kept) ??
    workspaces.find((workspace) => workspace.personal) ??
    workspaces[0]
  );
}

/** The chosen workspace, and the press that chooses another. */
export interface ChosenWorkspace {
  chosen: Workspace | undefined;
  choose: (workspaceId: string) => void;
}

/** The chosen one of `workspaces`, kept as it is chosen, unless the run is `staged`. */
export function useChosenWorkspace(
  workspaces: readonly Workspace[],
  staged: boolean,
): ChosenWorkspace {
  // Note that the fixture run's choice is a state of its own rather than the
  // kept one reset, because the run is only known a render after the kept
  // choice was read, as `folded-groups.ts` says of its folds.
  const [kept, setKept] = useState(readChoice);
  const [stagedChoice, setStagedChoice] = useState<string | undefined>(undefined);
  const choose = (workspaceId: string) => {
    if (staged) {
      setStagedChoice(workspaceId);
      return;
    }
    setKept(workspaceId);
    writeChoice(workspaceId);
  };
  return { chosen: resolveChoice(workspaces, staged ? stagedChoice : kept), choose };
}
