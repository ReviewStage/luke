import { LINK_PLACE, type LinkPlace, linkOf } from "@luke/features/link-grammar";
import { createContext, useContext } from "react";
import { commandAction, PANEL_COMMAND } from "./command-items.js";
import { LINK_COPY, useCopyToast } from "./copy-feedback.js";
import type { MenuAction } from "./desktop/action-menu.js";

/**
 * copy-link-item.tsx -- Copy link as any menu offers it: the one item every thing's ⋯ and right-click menu holds, copying the thing's Luke link and saying Link copied.
 *
 * A menu names its thing by place (`@luke/features/link-grammar`), and the
 * item writes it under the workspace the surface's links are written in,
 * which the surface hands down: a task's page its workspace's slug, an
 * agent's page its agent's. Where none is handed down, as in a test of
 * one surface or a place whose workspace is not yet read, the item stands
 * nowhere rather than copy a link that names no workspace.
 */

const LinkWorkspaceContext = createContext<string | undefined>(undefined);

/** Hands the workspace a surface's links are written under, by slug, or by id until the workspaces are read. */
export const LinkWorkspaceProvider = LinkWorkspaceContext.Provider;

/** The workspace the surface hands down for its links; none where it hands down none. */
export function useLinkWorkspace(): string | undefined {
  return useContext(LinkWorkspaceContext);
}

/**
 * Copy link, copying `link`, a Luke link, through `copy`, the window's menu
 * copy (`useCopyToast`): the one item every Copy link in a menu draws. Note
 * that a GitHub address is no Luke link and is offered as Copy GitHub link
 * (`PANEL_COMMAND.COPY_GITHUB_LINK`), and a link's own right-click keeps its
 * browser's Copy link (`link-menu.tsx`).
 */
export function copyLinkItem(
  copy: (words: string, label: string) => void,
  link: string,
): MenuAction {
  return commandAction(PANEL_COMMAND.COPY_LINK, () => copy(link, LINK_COPY.COPIED), false);
}

/** The copy of a place's link under the workspace the surface hands down, saying Link copied; none where it hands down none. */
export function useCopyLink(): ((place: LinkPlace) => void) | undefined {
  const workspace = useContext(LinkWorkspaceContext);
  const copy = useCopyToast();
  return workspace === undefined
    ? undefined
    : (place) => copy(linkOf(place, workspace), LINK_COPY.COPIED);
}

/** Copy link for a place, under the workspace the surface hands down; none where it hands down none. */
export function useCopyLinkItem(): (place: LinkPlace) => MenuAction | undefined {
  const workspace = useContext(LinkWorkspaceContext);
  const copy = useCopyToast();
  return (place) =>
    workspace === undefined ? undefined : copyLinkItem(copy, linkOf(place, workspace));
}

/** The place an agent is linked by: under its task where it has one, else its own. */
export function agentPlace(agent: {
  readonly id: string;
  readonly planId: string | null;
}): LinkPlace {
  return agent.planId === null
    ? { kind: LINK_PLACE.AGENT, agentId: agent.id }
    : { kind: LINK_PLACE.AGENT, planId: agent.planId, agentId: agent.id };
}
