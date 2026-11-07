/**
 * external-links.tsx -- the pages outside the dashboard an admin page links
 * to, such as an account's person in product analytics or a workspace's
 * GitHub account: each its provider's mark beside its words, opening in a
 * new tab.
 *
 * Where the mount opens such a page itself (`AdminDoors.openLink`), as the
 * app does, whose window opens no browser tab, a press opens it there; on
 * the web page a press is the browser's, which opens the new tab.
 */

import {
  GAP,
  Inline,
  type MarkProvider,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  TEXT_VARIANT,
  TextLink,
} from "@repo/ui";
import type { MouseEvent } from "react";
import { useAdminDoorsIfAny } from "../admin-doors.js";

/** One page outside the dashboard: whose page it is, what it is called, and where it is. */
export interface ExternalPlace {
  provider: MarkProvider;
  label: string;
  href: string;
}

/** The press of a link to a page outside the dashboard: the mount's opener where it opens such a page itself, else none, the browser following the link. */
type ExternalPress = (href: string) => ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;

/** What a link to a page outside the dashboard presses with, by its address (`ExternalPress`). */
export function useExternalPress(): ExternalPress {
  const openLink = useAdminDoorsIfAny()?.openLink;
  return (href) =>
    openLink === undefined
      ? undefined
      : (event) => {
          event.preventDefault();
          openLink(href);
        };
}

/** One page outside the dashboard, its provider's mark leading its words inside the one link. */
export function ExternalLink({ place }: { place: ExternalPlace }): React.JSX.Element {
  const pressOf = useExternalPress();
  return (
    <TextLink
      href={place.href}
      variant={TEXT_VARIANT.CAPTION}
      lead={<ProviderMark provider={place.provider} size={PROVIDER_MARK_SIZE.CAPTION} />}
      external
      newTab
      onClick={pressOf(place.href)}
    >
      {place.label}
    </TextLink>
  );
}

/** A row of pages outside the dashboard, or nothing where there are none. */
export function ExternalLinks({
  places,
}: {
  places: readonly ExternalPlace[];
}): React.JSX.Element | null {
  if (places.length === 0) return null;
  return (
    <Inline gap={GAP.FIELD}>
      {places.map((place) => (
        <ExternalLink key={place.href} place={place} />
      ))}
    </Inline>
  );
}
