import {
  BUTTON_VARIANT,
  Button,
  EllipsisIcon,
  GAP,
  IconButton,
  Inline,
  PlusIcon,
  SidebarIcon,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TrashIcon,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * buttons.tsx -- every Button look at rest, with a glyph, unavailable,
 * unavailable but focusable, and busy; the IconButton's looks and toggle;
 * and a long label in a narrow column.
 */

const STATES = [
  { id: "buttons-rest", name: "At rest", props: {} },
  { id: "buttons-unavailable", name: "Unavailable", props: { disabled: true } },
  {
    id: "buttons-unavailable-focusable",
    name: "Unavailable, keeps the keyboard",
    props: { disabled: true, focusableWhenDisabled: true },
  },
  { id: "buttons-busy", name: "Busy", props: { busy: true, busyLabel: "Saving" } },
] as const;

function Buttons(): React.JSX.Element {
  return (
    <>
      {STATES.map((state) => (
        <CatalogSection key={state.id} id={state.id} title={state.name}>
          <Inline>
            {Object.values(BUTTON_VARIANT).map((variant) => (
              <Button key={variant} variant={variant} {...state.props}>
                {variant}
              </Button>
            ))}
          </Inline>
        </CatalogSection>
      ))}
      <CatalogSection id="buttons-glyph" title="With a glyph">
        <Inline>
          <Button variant={BUTTON_VARIANT.PRIMARY} icon={<PlusIcon />}>
            New plan
          </Button>
          <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />}>
            Invite
          </Button>
          <Button variant={BUTTON_VARIANT.DANGER_OUTLINE} icon={<TrashIcon />}>
            Remove
          </Button>
        </Inline>
      </CatalogSection>
      <CatalogSection id="buttons-icon" title="Glyph alone">
        <Inline>
          <IconButton icon={<EllipsisIcon />} label="More" />
          <IconButton icon={<SidebarIcon />} label="Sidebar" pressed />
          <IconButton icon={<PlusIcon />} label="New plan" variant={BUTTON_VARIANT.OUTLINE} />
          <IconButton icon={<TrashIcon />} label="Delete" disabled />
          <IconButton icon={<EllipsisIcon />} label="Loading" busy busyLabel="Loading" />
        </Inline>
      </CatalogSection>
      <CatalogSection id="buttons-narrow" title="Narrow column, long label">
        <div className="catalog-narrow">
          <Stack gap={GAP.CONTROL} align="start">
            <Button variant={BUTTON_VARIANT.OUTLINE}>
              Transfer ownership of this workspace to another member
            </Button>
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              A label longer than its column ends in an ellipsis rather than overflowing.
            </Text>
          </Stack>
        </div>
      </CatalogSection>
    </>
  );
}

export const BUTTONS_EXAMPLE: Example = { id: "buttons", title: "Buttons", Render: Buttons };
