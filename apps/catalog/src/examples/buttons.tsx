import {
  ArchiveIcon,
  BUTTON_SHAPE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  CloseIcon,
  EllipsisIcon,
  GAP,
  IconButton,
  IconButtonLink,
  Inline,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PinIcon,
  PlusIcon,
  SidebarIcon,
  SpeakerIcon,
  Stack,
  SUBMIT_STATE,
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
 * ButtonLink's looks and an IconButtonLink; the round shape a call's
 * controls take, a danger toggle off and on; the compact marks a row reveals
 * at its end; a message's submit in each of its states, and unavailable; and
 * a long label in a narrow column.
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
      <CatalogSection id="buttons-link" title="As a link">
        <Inline>
          {Object.values(BUTTON_VARIANT).map((variant) => (
            <ButtonLink key={variant} variant={variant} href="#buttons-link">
              {variant}
            </ButtonLink>
          ))}
          <IconButtonLink href="#buttons-link" icon={<PlusIcon />} label="New plan" />
        </Inline>
      </CatalogSection>
      <CatalogSection id="buttons-round" title="Round, as a call's controls">
        <Inline>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            shape={BUTTON_SHAPE.ROUND}
            icon={<MicrophoneIcon />}
          >
            Talk about this task
          </Button>
          <IconButton
            icon={<SpeakerIcon />}
            label="Mute speaker"
            variant={BUTTON_VARIANT.DANGER}
            shape={BUTTON_SHAPE.ROUND}
            pressed={false}
          />
          <IconButton
            icon={<MicrophoneOffIcon />}
            label="Unmute microphone"
            variant={BUTTON_VARIANT.DANGER}
            shape={BUTTON_SHAPE.ROUND}
            pressed
          />
          <IconButton
            icon={<CloseIcon />}
            label="End call"
            variant={BUTTON_VARIANT.INK}
            shape={BUTTON_SHAPE.ROUND}
          />
        </Inline>
      </CatalogSection>
      <CatalogSection id="buttons-compact" title="Compact, a row's marks">
        <Inline gap={GAP.TIGHT}>
          <IconButton icon={<PinIcon />} label="Pin" size={BUTTON_SIZE.COMPACT} />
          <IconButton icon={<ArchiveIcon />} label="Archive" size={BUTTON_SIZE.COMPACT} />
          <IconButton icon={<EllipsisIcon />} label="Actions" size={BUTTON_SIZE.COMPACT} />
          <IconButton icon={<PinIcon />} label="Pin" size={BUTTON_SIZE.COMPACT} disabled />
        </Inline>
      </CatalogSection>
      <CatalogSection id="buttons-submit" title="A message's submit">
        <Inline>
          {Object.values(SUBMIT_STATE).map((state) => (
            <IconButton key={state} submit={state} label={state} variant={BUTTON_VARIANT.INK} />
          ))}
          <IconButton
            submit={SUBMIT_STATE.READY}
            label="Send"
            variant={BUTTON_VARIANT.INK}
            disabled
          />
          <IconButton submit={SUBMIT_STATE.READY} label="Send" variant={BUTTON_VARIANT.PRIMARY} />
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
