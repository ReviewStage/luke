import type { AutomationSummary } from "@repo/features/automation-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useAutomations } from "./desktop/use-automations.js";

interface Shelf {
  readonly automations: readonly AutomationSummary[] | undefined;
  readonly workspaceId: string | undefined;
  readonly workspaceName: string | undefined;
  readonly reading: boolean;
  readonly settled: boolean;
  readonly onOpen: (automationId: string) => void;
}

export interface KnownAutomation {
  readonly automation: AutomationSummary;
  readonly workspaceName: string | undefined;
  readonly onOpen: () => void;
}

const ShelfContext = createContext<Shelf | undefined>(undefined);

export function AutomationDirectory({
  workspace,
  wanted,
  onOpen,
  children,
}: {
  workspace: Pick<Workspace, "id" | "name"> | undefined;
  wanted: boolean;
  onOpen: (automationId: string) => void;
  children: ReactNode;
}): React.JSX.Element {
  const outer = useContext(ShelfContext);
  const workspaceId = workspace?.id;
  const reading = wanted || (outer?.reading === true && outer.workspaceId === workspaceId);
  const { read } = useAutomations(reading ? workspaceId : undefined);
  const automations = read !== undefined && "automations" in read ? read.automations : undefined;
  const settled = read !== undefined;
  const workspaceName = workspace?.name;
  const shelf = useMemo(
    () => ({ automations, workspaceId, workspaceName, reading, settled, onOpen }),
    [automations, workspaceId, workspaceName, reading, settled, onOpen],
  );
  return <ShelfContext.Provider value={shelf}>{children}</ShelfContext.Provider>;
}

export function AutomationsWanted({
  wanted,
  children,
}: {
  wanted: boolean;
  children: ReactNode;
}): ReactNode {
  const outer = useContext(ShelfContext);
  if (!wanted || outer === undefined || outer.reading || outer.workspaceId === undefined) {
    return children;
  }
  return (
    <AutomationDirectory
      workspace={{ id: outer.workspaceId, name: outer.workspaceName ?? "" }}
      wanted
      onOpen={outer.onOpen}
    >
      {children}
    </AutomationDirectory>
  );
}

export function useAutomation(automationId: string | undefined): KnownAutomation | undefined {
  const shelf = useContext(ShelfContext);
  if (shelf === undefined || automationId === undefined) return undefined;
  const automation = shelf.automations?.find((each) => each.id === automationId);
  if (automation === undefined) return undefined;
  return {
    automation,
    workspaceName: shelf.workspaceName,
    onOpen: () => shelf.onOpen(automation.id),
  };
}

export function useAutomationsLanded(): boolean {
  const shelf = useContext(ShelfContext);
  return shelf === undefined || !shelf.reading || shelf.settled;
}
