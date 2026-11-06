import { APP_COMMAND, SHORTCUT_KEY } from "@repo/settings/shortcuts";
import { BUTTON_VARIANT, Button, GAP, Inline, TEXT_TONE, Text, Tooltip } from "@repo/ui";
import { useRef } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function CardedRow(): React.JSX.Element {
  const row = useRef<HTMLSpanElement>(null);
  return (
    <span ref={row} className="catalog-carded-row">
      <Tooltip
        label="Teammate invitations"
        card={
          <>
            <Text>Teammate invitations</Text>
            <Text tone={TEXT_TONE.MUTED}>Hung beside the row, so it covers none under it.</Text>
          </>
        }
        cardBeside
        cardRegion={row}
      >
        <Button variant={BUTTON_VARIANT.QUIET}>Teammate invitations</Button>
      </Tooltip>
      <Tooltip label="Archive">
        <Button variant={BUTTON_VARIANT.QUIET}>Archive</Button>
      </Tooltip>
    </span>
  );
}

function Tooltips(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="tooltip-pills" title="Pills">
        <Inline gap={GAP.CONTROL}>
          <Tooltip label="New task" command={APP_COMMAND.NEW_TASK}>
            <Button variant={BUTTON_VARIANT.OUTLINE}>New</Button>
          </Tooltip>
          <Tooltip label="Zoom in" chord={{ key: SHORTCUT_KEY.EQUALS, bare: true }}>
            <Button variant={BUTTON_VARIANT.OUTLINE}>Zoom</Button>
          </Tooltip>
          <Tooltip label="Copy link">
            <Button variant={BUTTON_VARIANT.OUTLINE}>Share</Button>
          </Tooltip>
          <Tooltip label="https://example.com/a/very/long/address/that/is/wider/than/a/narrow/window/and/breaks/where/it/must">
            <Button variant={BUTTON_VARIANT.OUTLINE}>Long address</Button>
          </Tooltip>
        </Inline>
      </CatalogSection>
      <CatalogSection id="tooltip-cards" title="Cards">
        <Inline gap={GAP.CONTROL}>
          <Tooltip
            label="Launch plan"
            card={
              <>
                <Text>Launch plan</Text>
                <Text tone={TEXT_TONE.MUTED}>
                  Draft the announcement, confirm the date with the team, and schedule the post.
                </Text>
              </>
            }
          >
            <Button variant={BUTTON_VARIANT.OUTLINE}>Launch plan</Button>
          </Tooltip>
          <Tooltip
            label="Beside"
            card={
              <>
                <Text>A control's card</Text>
                <Text tone={TEXT_TONE.MUTED}>Hung past the control's end.</Text>
              </>
            }
            cardBeside
          >
            <Button variant={BUTTON_VARIANT.OUTLINE}>Beside</Button>
          </Tooltip>
          <CardedRow />
        </Inline>
      </CatalogSection>
    </>
  );
}

export const TOOLTIPS_EXAMPLE: Example = { id: "tooltips", title: "Tooltips", Render: Tooltips };
