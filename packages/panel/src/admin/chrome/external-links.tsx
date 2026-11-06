import {
  GAP,
  Inline,
  type MarkProvider,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  TEXT_VARIANT,
  TextLink,
} from "@repo/ui";

export interface ExternalPlace {
  provider: MarkProvider;
  label: string;
  href: string;
}

export function ExternalLink({ place }: { place: ExternalPlace }): React.JSX.Element {
  return (
    <TextLink
      href={place.href}
      variant={TEXT_VARIANT.CAPTION}
      lead={<ProviderMark provider={place.provider} size={PROVIDER_MARK_SIZE.CAPTION} />}
      external
      newTab
    >
      {place.label}
    </TextLink>
  );
}

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
