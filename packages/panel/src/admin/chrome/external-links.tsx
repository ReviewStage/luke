/**
 * external-links.tsx -- the pages outside the dashboard an admin page links
 * to, such as an account's person in product analytics or a workspace's
 * GitHub account: each its provider's mark beside its words, opening in a
 * new tab.
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

/** One page outside the dashboard: whose page it is, what it is called, and where it is. */
export interface ExternalPlace {
  provider: MarkProvider;
  label: string;
  href: string;
}

/** One page outside the dashboard, its provider's mark leading its words. */
export function ExternalLink({ place }: { place: ExternalPlace }): React.JSX.Element {
  return (
    <Inline gap={GAP.ICON} wrap={false}>
      <ProviderMark provider={place.provider} size={PROVIDER_MARK_SIZE.CAPTION} />
      <TextLink href={place.href} variant={TEXT_VARIANT.CAPTION} external newTab>
        {place.label}
      </TextLink>
    </Inline>
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
