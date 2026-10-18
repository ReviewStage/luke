import type { AutomationSummary } from "@luke/features/automation-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { useAutomations } from "@luke/panel/desktop/use-automations";
import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * automation-directory.tsx -- the automations of the workspace a place stands in, read for the agents in it that an automation started, so an agent's card names the one that did.
 *
 * An agent's summary names the automation whose run started it by id
 * alone, so the card reads it against the workspace's automations for its
 * name, schedule, and last run, and opens its page on a press. The list is
 * read only while the Automations experiment is on and the place holds an
 * agent an automation started (`wanted`), and each minute after, as the
 * Automations page reads it. The window stands one around everything for
 * the listed workspace (`listed-automations.tsx`), for Home's rows and ⌘K,
 * and a place of its own, the open task or the Inbox, shares that read
 * where it is of the same workspace. With the experiment off, or outside a
 * directory, no automation is known, and an agent's card says nothing of
 * one.
 */

/** The workspace's automations as read, which workspace's and whose they are, whether a read of them stands, and the way to one's page; none while the experiment is off. */
interface Shelf {
  readonly automations: readonly AutomationSummary[] | undefined;
  readonly workspaceId: string | undefined;
  readonly workspaceName: string | undefined;
  /** Whether this directory, or one standing around it, reads the workspace's automations. */
  readonly reading: boolean;
  readonly onOpen: (automationId: string) => void;
}

/** One automation as a place names it: the automation, whose it is, and the way to its page. */
export interface KnownAutomation {
  readonly automation: AutomationSummary;
  readonly workspaceName: string | undefined;
  readonly onOpen: () => void;
}

const ShelfContext = createContext<Shelf | undefined>(undefined);

/**
 * Reads the workspace's automations for everything inside it while `on`
 * and `wanted` both hold, unless a directory standing around it already
 * reads the same workspace's, whose read it shares rather than asking for a
 * second.
 */
export function AutomationDirectory({
  workspace,
  on,
  wanted,
  onOpen,
  children,
}: {
  workspace: Pick<Workspace, "id" | "name"> | undefined;
  /** Whether the Automations experiment is on (`EXPERIMENT.AUTOMATIONS`). */
  on: boolean;
  /** Whether the place holds an agent an automation started. */
  wanted: boolean;
  /** Opens an automation's page. */
  onOpen: (automationId: string) => void;
  children: ReactNode;
}): React.JSX.Element {
  const outer = useContext(ShelfContext);
  const workspaceId = workspace?.id;
  const shared = outer?.reading === true && outer.workspaceId === workspaceId;
  const reads = on && wanted && !shared;
  const { read } = useAutomations(reads ? workspaceId : undefined);
  const own = read !== undefined && "automations" in read ? read.automations : undefined;
  const automations = shared ? outer?.automations : own;
  const reading = reads || shared;
  const workspaceName = workspace?.name;
  const shelf = useMemo(
    () => (on ? { automations, workspaceId, workspaceName, reading, onOpen } : undefined),
    [on, automations, workspaceId, workspaceName, reading, onOpen],
  );
  return <ShelfContext.Provider value={shelf}>{children}</ShelfContext.Provider>;
}

/** The automation `automationId` names, as the directory standing around the caller knows it; none while the experiment is off, the list is unread, or it lists no such automation. */
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
