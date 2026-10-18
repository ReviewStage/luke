import {
  TEXT_BUTTON_LINES,
  TEXT_BUTTON_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * text-buttons.tsx -- every TextButton tone among the words it stands in: a
 * quiet name and count, a link-look act in a caption, an accent toggle that
 * shows its replies, and long words cut short in a narrow column, on one
 * line or, as a card's name, on two.
 */

/** Does nothing, for a press the catalog only draws. */
function pressed(): void {}

function RepliesToggle(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Text>
      <TextButton
        tone={TEXT_BUTTON_TONE.ACCENT}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {open ? "Hide replies" : "3 replies"}
      </TextButton>
    </Text>
  );
}

function TextButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="text-buttons-quiet" title="Quiet, words that already read as the act">
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          Edited by Ada Lovelace,{" "}
          <TextButton onClick={pressed} aria-label="Open the version history">
            2 hours ago
          </TextButton>
        </Text>
      </CatalogSection>
      <CatalogSection id="text-buttons-link" title="Link, an act nothing else says is pressable">
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
          Draws the video tile beside the call.{" "}
          <TextButton tone={TEXT_BUTTON_TONE.LINK} onClick={pressed}>
            Send feedback
          </TextButton>
        </Text>
      </CatalogSection>
      <CatalogSection id="text-buttons-accent" title="Accent, the one act a line offers">
        <RepliesToggle />
      </CatalogSection>
      <CatalogSection id="text-buttons-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <Text>
            <TextButton onClick={pressed}>
              “Every behavior change ships with a test that fails without it, same PR.”
            </TextButton>
          </Text>
          <Text>
            <TextButton lines={TEXT_BUTTON_LINES.TWO} onClick={pressed}>
              Review all failed deployment checks every morning and summarise them for the team
            </TextButton>
          </Text>
        </div>
      </CatalogSection>
    </>
  );
}

export const TEXT_BUTTONS_EXAMPLE: Example = {
  id: "text-buttons",
  title: "Text buttons",
  Render: TextButtons,
};
