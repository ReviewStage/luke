import {
  Badge,
  BUTTON_VARIANT,
  Button,
  CheckIcon,
  GAP,
  Inline,
  QUIET_MARK,
  QuietWords,
  RowCount,
  SETTINGS_ROW_INDENT,
  SettingsRow,
  SettingsSection,
  STATUS_TONE,
  Text,
  VISUALLY_HIDDEN_UNDER,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * badges.tsx -- every tone with its words, one with a glyph, a provider's
 * labels each wearing its color as a dot, a dark one and one with no color
 * it can paint among them, the same labels filled with their color, a
 * badge lit as the reader's own, badges standing on a line of body words,
 * words given up to a glyph or a tone's dot in a narrow room, a long
 * label in a narrow column, and a short badge beside a long row name in a
 * settings column at a page's measure and narrower, where the name gives way
 * and the badge stays whole; and where a state is a note rather than a
 * call to act, its quiet words in place of a badge, alone and after the
 * failure glyph; and a count at a row's end, a tally in the muted ink and
 * what waits on the reader in the attention tone.
 */

const SAYS = {
  [STATUS_TONE.NEUTRAL]: "Draft",
  [STATUS_TONE.WORKING]: "Working",
  [STATUS_TONE.ATTENTION]: "Needs you",
  [STATUS_TONE.COMPLETE]: "Connected",
  [STATUS_TONE.MERGED]: "Merged",
  [STATUS_TONE.DANGER]: "Failed",
} as const;

/** GitHub labels as GitHub answers them: six hex digits, or a color the badge cannot paint. */
const LABELS = [
  { name: "bug", color: "d73a4a" },
  { name: "enhancement", color: "a2eeef" },
  { name: "needs design", color: "1d1d1f" },
  { name: "imported", color: "not-a-color" },
] as const;

/** A repository's row under GitHub's, its long name marked Token, as Settings draws one. */
function TokenRow(): React.JSX.Element {
  return (
    <SettingsSection>
      <SettingsRow
        indent={SETTINGS_ROW_INDENT.MARK}
        label="reviewstage/a-repository-with-a-long-name"
        adornment={<Badge>Token</Badge>}
      >
        {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Remove</Button>}
      </SettingsRow>
    </SettingsSection>
  );
}

function Badges(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="badge-tones" title="Tones">
        <Inline gap={GAP.CONTROL}>
          {Object.values(STATUS_TONE).map((tone) => (
            <Badge key={tone} tone={tone}>
              {SAYS[tone]}
            </Badge>
          ))}
          <Badge tone={STATUS_TONE.COMPLETE} icon={<CheckIcon />}>
            Signed in
          </Badge>
        </Inline>
      </CatalogSection>
      <CatalogSection id="quiet-words" title="Quiet words">
        <Inline gap={GAP.CONTROL}>
          <QuietWords>Waiting on a teammate</QuietWords>
          <QuietWords>Pending</QuietWords>
          <QuietWords mark={QUIET_MARK.FAILED}>Failed</QuietWords>
        </Inline>
      </CatalogSection>
      <CatalogSection id="row-count" title="A count at a row's end">
        <Inline gap={GAP.CONTROL}>
          <RowCount value={4} noun="agents" />
          <RowCount value={2} noun="need you" tone={STATUS_TONE.ATTENTION} />
          <RowCount value={0} noun="need you" tone={STATUS_TONE.ATTENTION} />
        </Inline>
      </CatalogSection>
      <CatalogSection id="badge-swatch" title="A provider's colors">
        <Inline gap={GAP.ICON}>
          {LABELS.map((label) => (
            <Badge key={label.name} swatch={label.color}>
              {label.name}
            </Badge>
          ))}
          <Badge>+3</Badge>
        </Inline>
      </CatalogSection>
      <CatalogSection id="badge-fill" title="Filled with a provider's color">
        <Inline gap={GAP.ICON}>
          {LABELS.map((label) => (
            <Badge key={label.name} fill={label.color}>
              {label.name}
            </Badge>
          ))}
        </Inline>
        <div className="catalog-narrow">
          <Badge fill="0e8a16">waiting on the release train before it can merge</Badge>
        </div>
      </CatalogSection>
      <CatalogSection id="badge-lit" title="Lit, the reader's own">
        <Inline gap={GAP.ICON}>
          <Badge lit>👍 12</Badge>
          <Badge>🚀 1</Badge>
        </Inline>
      </CatalogSection>
      <CatalogSection id="badge-line" title="On a line of words">
        <div className="catalog-column">
          <Text>
            The release build is <Badge tone={STATUS_TONE.WORKING}>Working</Badge> and the
            notarization step <Badge tone={STATUS_TONE.ATTENTION}>Needs you</Badge> before it can
            finish.
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="badge-room" title="Words given up in a narrow room">
        <div className="catalog-narrow catalog-room">
          <Badge
            tone={STATUS_TONE.COMPLETE}
            icon={<CheckIcon />}
            hideWordsUnder={VISUALLY_HIDDEN_UNDER.SNUG}
          >
            Ready to merge
          </Badge>
          <Badge tone={STATUS_TONE.ATTENTION} hideWordsUnder={VISUALLY_HIDDEN_UNDER.SNUG}>
            Pending
          </Badge>
        </div>
      </CatalogSection>
      <CatalogSection id="badge-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <Inline gap={GAP.CONTROL}>
            <Badge tone={STATUS_TONE.ATTENTION}>Waiting for administrator approval</Badge>
            <Badge tone={STATUS_TONE.COMPLETE}>Connected</Badge>
          </Inline>
        </div>
      </CatalogSection>
      <CatalogSection id="badge-row" title="Beside a settings row's name, at a page's measure">
        <div className="catalog-settings">
          <TokenRow />
        </div>
      </CatalogSection>
      <CatalogSection
        id="badge-row-narrow"
        title="Beside a settings row's name, in a narrow column"
      >
        <div className="catalog-settings catalog-settings-between">
          <TokenRow />
        </div>
        <div className="catalog-settings catalog-settings-narrow">
          <TokenRow />
        </div>
      </CatalogSection>
    </>
  );
}

export const BADGES_EXAMPLE: Example = { id: "badges", title: "Badges", Render: Badges };
