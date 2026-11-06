import {
  Badge,
  BUTTON_VARIANT,
  Button,
  CheckIcon,
  GAP,
  Inline,
  QUIET_MARK,
  QuietWords,
  SETTINGS_ROW_INDENT,
  SettingsRow,
  SettingsSection,
  STATUS_TONE,
  Text,
  VISUALLY_HIDDEN_UNDER,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const SAYS = {
  [STATUS_TONE.NEUTRAL]: "Draft",
  [STATUS_TONE.WORKING]: "Working",
  [STATUS_TONE.ATTENTION]: "Needs you",
  [STATUS_TONE.COMPLETE]: "Connected",
  [STATUS_TONE.MERGED]: "Merged",
  [STATUS_TONE.DANGER]: "Failed",
} as const;

const LABELS = [
  { name: "bug", color: "d73a4a" },
  { name: "enhancement", color: "a2eeef" },
  { name: "needs design", color: "1d1d1f" },
  { name: "imported", color: "not-a-color" },
] as const;

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
          <QuietWords mark={QUIET_MARK.ATTENTION} label="2 need you">
            2
          </QuietWords>
          <QuietWords mark={QUIET_MARK.FAILED}>Destructive</QuietWords>
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
