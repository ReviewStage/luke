import {
  ArrowLeftIcon,
  BUTTON_VARIANT,
  COMMAND_LINK_ELEMENT,
  CommandLink,
  dropBelowStart,
  GAP,
  HoldPress,
  IconButton,
  Inline,
  MARK_STRIP_LOOK,
  MARK_STRIP_TONE,
  MarkStrip,
  Menu,
  PlayIcon,
  SkillChip,
  SplitButton,
  type StripMark,
  TEXT_TONE,
  Text,
  useMenu,
} from "@luke/ui";
import { useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * press-shortcuts.tsx -- the second ways in a press offers beside a control's
 * own: Back held, or right-clicked, listing the steps behind it; a split
 * button that hears every press of its main part, a refused one too; a hidden
 * rail's strip of marks, pressed to show the rail; a title a ⌘-click opens;
 * and a chosen skill's pill in a box's words, pressed to open its file. Each
 * says what it last did, since the catalog has nowhere to go.
 */

const STEPS = ["Auth refactor · Code", "Auth refactor · Plan", "Inbox"] as const;

/** Back: a press takes a step, and a press held or a right-click lists the steps behind. */
function HeldBack({ onDone }: { onDone: (what: string) => void }): React.JSX.Element {
  const menu = useMenu(true);
  const button = useRef<HTMLButtonElement>(null);
  const openList = () => {
    const element = button.current;
    if (element !== null) menu.show(dropBelowStart(element), element);
  };
  return (
    <HoldPress
      mouse
      onHold={openList}
      onContextMenu={() => {
        if (menu.open === undefined) openList();
      }}
    >
      <IconButton
        ref={button}
        icon={<ArrowLeftIcon />}
        label="Back"
        aria-haspopup="menu"
        aria-expanded={menu.open !== undefined}
        onClick={() => onDone("Back one step")}
      />
      {menu.drawn === undefined ? null : (
        <Menu
          label="Back history"
          menu={menu.drawn}
          groups={[
            STEPS.map((step) => ({ label: step, onSelect: () => onDone(`Went to ${step}`) })),
          ]}
          onClose={menu.close}
        />
      )}
    </HoldPress>
  );
}

/** Start, busy, whose refused press is still heard. */
function HeardSplit({ onDone }: { onDone: (what: string) => void }): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <SplitButton
      variant={BUTTON_VARIANT.OUTLINE}
      icon={<PlayIcon />}
      busy="Starting"
      onClick={() => onDone("Started")}
      onMainPress={() => onDone("Heard a press of Start")}
      menu={{ label: "Choose a model to start with", ...menu.trigger() }}
    >
      Start
    </SplitButton>
  );
}

const MARKS: readonly StripMark[] = [
  { tone: MARK_STRIP_TONE.DANGER, viewed: true },
  { tone: MARK_STRIP_TONE.ATTENTION, current: true },
  { tone: MARK_STRIP_TONE.COMPLETE },
  { tone: MARK_STRIP_TONE.ATTENTION },
  {},
];

/** A changed file's bar for each of a pull request's files, a renamed one in the working tone, the file shown standing wider. */
const BARS: readonly StripMark[] = [
  { tone: MARK_STRIP_TONE.COMPLETE, viewed: true },
  { tone: MARK_STRIP_TONE.ATTENTION },
  { tone: MARK_STRIP_TONE.ATTENTION, current: true },
  { tone: MARK_STRIP_TONE.WORKING },
  { tone: MARK_STRIP_TONE.DANGER },
  ...Array.from({ length: 40 }, () => ({ tone: MARK_STRIP_TONE.ATTENTION })),
];

function PressShortcuts(): React.JSX.Element {
  const [done, setDone] = useState("Nothing yet");
  const said = (
    <Text tone={TEXT_TONE.MUTED} aria-live="polite">
      {done}
    </Text>
  );
  return (
    <>
      <CatalogSection id="press-hold" title="Held, or right-clicked: Back lists its steps">
        <Inline gap={GAP.CONTROL}>
          <HeldBack onDone={setDone} />
          {said}
        </Inline>
      </CatalogSection>
      <CatalogSection id="press-split" title="A split button hearing a refused press">
        <Inline gap={GAP.CONTROL}>
          <HeardSplit onDone={setDone} />
          {said}
        </Inline>
      </CatalogSection>
      <CatalogSection id="press-strip" title="A hidden rail's strip of marks">
        <Inline gap={GAP.CONTROL}>
          <div className="catalog-mark-strip">
            <MarkStrip marks={MARKS} onPress={() => setDone("Showed the rail")} />
          </div>
          {said}
        </Inline>
      </CatalogSection>
      <CatalogSection
        id="press-strip-bars"
        title="Bars sharing the strip, rested on rather than pressed"
      >
        <Inline gap={GAP.CONTROL}>
          <div className="catalog-mark-strip">
            <MarkStrip
              look={MARK_STRIP_LOOK.BARS}
              marks={BARS}
              onPointerEnter={() => setDone("Peeked the tree")}
              onPointerLeave={() => setDone("Put the tree away")}
            />
          </div>
          {said}
        </Inline>
      </CatalogSection>
      <CatalogSection id="press-command" title="Words a ⌘-click opens">
        <CommandLink
          as={COMMAND_LINK_ELEMENT.SPAN}
          onOpen={() => setDone("Opened the pull request on GitHub")}
        >
          Fix token refresh on wake #4635
        </CommandLink>
        {said}
      </CatalogSection>
      <CatalogSection id="press-skill" title="A chosen skill in a box's words">
        <Text>
          Run <SkillChip label="/testing" onOpen={() => setDone("Opened testing's SKILL.md")} /> on
          the new store, then <SkillChip label="/orchestrate" /> the rest.
        </Text>
        {said}
      </CatalogSection>
    </>
  );
}

export const PRESS_SHORTCUTS_EXAMPLE: Example = {
  id: "press-shortcuts",
  title: "Press shortcuts",
  Render: PressShortcuts,
};
