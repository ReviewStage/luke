import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { LINK_PLACE, type LinkPlace, linkOf } from "@luke/features/link-grammar";
import { Atom } from "effect/reactivity";
import { createContext, useContext, useEffect } from "react";
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
 * nowhere rather than copy a link that names no workspace. The item prints
 * ⇧⌘C only where its link is the one the chord would copy now, the open or
 * focused thing's (`links-at-hand.ts`); every other row's prints nothing.
 */

/** The links ⇧⌘C would copy now, as the keyboard stands outside the side panel and in it, which the window's Copy link holds (`useHoldChordLinks`). */
const chordLinksAtom = Atom.keepAlive(Atom.make<readonly string[]>([]));

const LinkWorkspaceContext = createContext<string | undefined>(undefined);

/** Hands the workspace a surface's links are written under, by slug, or by id until the workspaces are read. */
export const LinkWorkspaceProvider = LinkWorkspaceContext.Provider;

/** The workspace the surface hands down for its links; none where it hands down none. */
export function useLinkWorkspace(): string | undefined {
  return useContext(LinkWorkspaceContext);
}

/** Holds the links ⇧⌘C copies now, the first at hand outside the side panel and in it, for as long as the window's Copy link stands. */
export function useHoldChordLinks(outside: string | undefined, inPanel: string | undefined): void {
  const hold = useAtomSet(chordLinksAtom);
  useEffect(() => {
    const held = [outside, inPanel].filter((link) => link !== undefined);
    hold(held);
    return () => hold((standing) => (standing === held ? [] : standing));
  }, [outside, inPanel, hold]);
}

/** The links ⇧⌘C would copy now, which a Copy link item prints the chord beside. */
export function useChordLinks(): readonly string[] {
  return useAtomValue(chordLinksAtom);
}

/**
 * Copy link, copying `link`, a Luke link, through `copy`, the window's menu
 * copy (`useCopyToast`): the one item every Copy link in a menu draws,
 * printing ⇧⌘C where the chord copies the same link, one of `chord`
 * (`useChordLinks`). Note that a GitHub address is no Luke link and is
 * offered as Copy GitHub link (`PANEL_COMMAND.COPY_GITHUB_LINK`), and a
 * link's own right-click keeps its browser's Copy link (`link-menu.tsx`).
 */
export function copyLinkItem(
  copy: (words: string, label: string) => void,
  link: string,
  chord: readonly string[],
): MenuAction {
  return commandAction(
    PANEL_COMMAND.COPY_LINK,
    () => copy(link, LINK_COPY.COPIED),
    chord.includes(link),
  );
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
  const chord = useChordLinks();
  return (place) =>
    workspace === undefined ? undefined : copyLinkItem(copy, linkOf(place, workspace), chord);
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
