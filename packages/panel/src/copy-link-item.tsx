import { LINK_PLACE, type LinkPlace, linkOf } from "@luke/features/luke-link";
import { LinkIcon } from "lucide-react";
import { createContext, useContext } from "react";
import { LINK_COPY, useCopyToast } from "./copy-feedback.js";
import type { MenuAction } from "./desktop/action-menu.js";

/**
 * copy-link-item.tsx -- Copy link as any menu offers it: the one item every thing's ⋯ and right-click menu holds, copying the thing's Luke link and saying Link copied.
 *
 * A menu names its thing by place (`@luke/features/luke-link`), and the
 * item writes it under the workspace the surface's links are written in,
 * which the surface hands down: a task's page its workspace's slug, an
 * agent's page its agent's. Where none is handed down, as in a test of
 * one surface or a place whose workspace is not yet read, the item stands
 * nowhere rather than copy a link that names no workspace.
 */

const LinkWorkspaceContext = createContext<string | undefined>(undefined);

/** Hands the workspace a surface's links are written under, by slug, or by id until the workspaces are read. */
export const LinkWorkspaceProvider = LinkWorkspaceContext.Provider;

/** Copy link, copying a place's link under `workspace` through `copy`, the window's menu copy (`useCopyToast`). */
function copyLinkItem(
  copy: (words: string, label: string) => void,
  place: LinkPlace,
  workspace: string,
): MenuAction {
  return {
    label: LINK_COPY.LABEL,
    icon: <LinkIcon aria-hidden="true" />,
    onSelect: () => copy(linkOf(place, workspace), LINK_COPY.COPIED),
  };
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
  return (place) => (workspace === undefined ? undefined : copyLinkItem(copy, place, workspace));
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
