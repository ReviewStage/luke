import {
  BUTTON_VARIANT,
  type ButtonVariant,
  GAP,
  Inline,
  Menu,
  PlayIcon,
  SplitButton,
  useMenu,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * split-buttons.tsx -- a split button in each look, its chevron dropping the
 * models its main part starts on; unavailable and busy; and folded to its
 * glyph, as a toolbar short of room draws it.
 */

const MODELS = ["Opus 5.5", "Sonnet 5.5", "Haiku 5.5"] as const;

/** Start on the chosen model, and a chevron that drops the models to choose from. */
function StartSplit({
  variant,
  disabled,
  busy,
}: {
  variant?: ButtonVariant | undefined;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
}): React.JSX.Element {
  const menu = useMenu(true);
  const [model, setModel] = useState<string>(MODELS[0]);
  return (
    <>
      <SplitButton
        variant={variant}
        icon={<PlayIcon />}
        label={`Start on ${model}`}
        disabled={disabled}
        busy={busy === true ? "Starting" : undefined}
        menu={{ label: "Choose a model to start with", ...menu.trigger() }}
      >
        Start
      </SplitButton>
      {menu.drawn && (
        <Menu
          label="Models"
          menu={menu.drawn}
          openOnChecked
          groups={[
            MODELS.map((each) => ({
              label: each,
              checked: each === model,
              onSelect: () => setModel(each),
            })),
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

function SplitButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="split-looks" title="Looks">
        <Inline gap={GAP.CONTROL}>
          <StartSplit />
          <StartSplit variant={BUTTON_VARIANT.OUTLINE} />
          <StartSplit variant={BUTTON_VARIANT.PRIMARY} />
        </Inline>
      </CatalogSection>
      <CatalogSection id="split-states" title="Unavailable and busy">
        <Inline gap={GAP.CONTROL}>
          <StartSplit disabled />
          <StartSplit busy />
          <StartSplit variant={BUTTON_VARIANT.PRIMARY} busy />
        </Inline>
      </CatalogSection>
      <CatalogSection id="split-folded" title="Folded">
        <div className="catalog-folded">
          <Inline gap={GAP.CONTROL}>
            <StartSplit />
            <StartSplit variant={BUTTON_VARIANT.PRIMARY} />
          </Inline>
        </div>
      </CatalogSection>
    </>
  );
}

export const SPLIT_BUTTONS_EXAMPLE: Example = {
  id: "split-buttons",
  title: "Split buttons",
  Render: SplitButtons,
};
