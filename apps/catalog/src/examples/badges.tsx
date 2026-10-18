import { BADGE_TONE, Badge, CheckIcon, GAP, Inline, Text } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * badges.tsx -- every tone with its words, one with a glyph, a provider's
 * labels each wearing its colour as a dot, a dark one and one with no colour
 * it can paint among them, badges standing on a line of body words, and a
 * long label in a narrow column.
 */

const SAYS = {
  [BADGE_TONE.NEUTRAL]: "Draft",
  [BADGE_TONE.WORKING]: "Working",
  [BADGE_TONE.ATTENTION]: "Needs you",
  [BADGE_TONE.COMPLETE]: "Connected",
  [BADGE_TONE.MERGED]: "Merged",
  [BADGE_TONE.DANGER]: "Failed",
} as const;

/** GitHub labels as GitHub answers them: six hex digits, or a colour the badge cannot paint. */
const LABELS = [
  { name: "bug", color: "d73a4a" },
  { name: "enhancement", color: "a2eeef" },
  { name: "needs design", color: "1d1d1f" },
  { name: "imported", color: "not-a-colour" },
] as const;

function Badges(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="badge-tones" title="Tones">
        <Inline gap={GAP.CONTROL}>
          {Object.values(BADGE_TONE).map((tone) => (
            <Badge key={tone} tone={tone}>
              {SAYS[tone]}
            </Badge>
          ))}
          <Badge tone={BADGE_TONE.COMPLETE} icon={<CheckIcon />}>
            Signed in
          </Badge>
        </Inline>
      </CatalogSection>
      <CatalogSection id="badge-swatch" title="A provider's colours">
        <Inline gap={GAP.ICON}>
          {LABELS.map((label) => (
            <Badge key={label.name} swatch={label.color}>
              {label.name}
            </Badge>
          ))}
          <Badge>+3</Badge>
        </Inline>
      </CatalogSection>
      <CatalogSection id="badge-line" title="On a line of words">
        <div className="catalog-column">
          <Text>
            The release build is <Badge tone={BADGE_TONE.WORKING}>Working</Badge> and the
            notarization step <Badge tone={BADGE_TONE.ATTENTION}>Needs you</Badge> before it can
            finish.
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="badge-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <Inline gap={GAP.CONTROL}>
            <Badge tone={BADGE_TONE.ATTENTION}>Waiting for administrator approval</Badge>
            <Badge tone={BADGE_TONE.COMPLETE}>Connected</Badge>
          </Inline>
        </div>
      </CatalogSection>
    </>
  );
}

export const BADGES_EXAMPLE: Example = { id: "badges", title: "Badges", Render: Badges };
