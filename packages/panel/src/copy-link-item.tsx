import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { LINK_PLACE, type LinkPlace, linkOf } from "@repo/features/link-grammar";
import { Atom } from "effect/reactivity";
import { createContext, useContext, useEffect } from "react";
import { commandAction, PANEL_COMMAND } from "./command-items.js";
import { LINK_COPY, useCopyToast } from "./copy-feedback.js";
import type { MenuAction } from "./desktop/action-menu.js";
import { useNumberedPlace } from "./tasks/use-link-standing.js";

const chordLinksAtom = Atom.keepAlive(Atom.make<readonly string[]>([]));

const LinkWorkspaceContext = createContext<string | undefined>(undefined);

export const LinkWorkspaceProvider = LinkWorkspaceContext.Provider;

export function useLinkWorkspace(): string | undefined {
  return useContext(LinkWorkspaceContext);
}

export function useHoldChordLinks(outside: string | undefined, inPanel: string | undefined): void {
  const hold = useAtomSet(chordLinksAtom);
  useEffect(() => {
    const held = [outside, inPanel].filter((link) => link !== undefined);
    hold(held);
    return () => hold((standing) => (standing === held ? [] : standing));
  }, [outside, inPanel, hold]);
}

export function useChordLinks(): readonly string[] {
  return useAtomValue(chordLinksAtom);
}

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

export function useCopyLink(): ((place: LinkPlace) => void) | undefined {
  const workspace = useContext(LinkWorkspaceContext);
  const copy = useCopyToast();
  const numbered = useNumberedPlace();
  return workspace === undefined
    ? undefined
    : (place) => copy(linkOf(numbered(place, workspace), workspace), LINK_COPY.COPIED);
}

export function useCopyLinkItem(): (place: LinkPlace) => MenuAction | undefined {
  const workspace = useContext(LinkWorkspaceContext);
  const copy = useCopyToast();
  const chord = useChordLinks();
  const numbered = useNumberedPlace();
  return (place) =>
    workspace === undefined
      ? undefined
      : copyLinkItem(copy, linkOf(numbered(place, workspace), workspace), chord);
}

export function agentPlace(agentId: string): LinkPlace {
  return { kind: LINK_PLACE.AGENT, agentId };
}
