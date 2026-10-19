/**
 * choice-bar.tsx -- the one bar of options where you choose one, in its
 * fill and its segmented look at both sizes: tabs over panels with glyphs
 * and toned counts, a diff's lines among them; a value set by a radio
 * group; a clearable one with none chosen; an option and a whole bar that
 * cannot be chosen; and a row too narrow for its options, which names
 * every option while none is chosen.
 */

import {
  AlertIcon,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  CheckIcon,
  ChoiceBar,
  type ChoiceBarLook,
  type ChoiceBarSize,
  type ChoiceItem,
  CloseIcon,
  COUNT_TONE,
  CodeIcon,
  GAP,
  linesCount,
  Stack,
  TEXT_TONE,
  Text,
  UserIcon,
} from "@luke/ui";
import { useId, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const VIEW = {
  CONVERSATION: "conversation",
  CHECKS: "checks",
  FILES: "files",
} as const;
type View = (typeof VIEW)[keyof typeof VIEW];

/** A pull request's three views, each counting what it holds, its checks failing. */
const VIEWS: readonly ChoiceItem<View>[] = [
  { value: VIEW.CONVERSATION, icon: <UserIcon />, label: "Conversation", count: "12" },
  {
    value: VIEW.CHECKS,
    icon: <CheckIcon />,
    label: "Checks",
    count: [{ text: "2", tone: COUNT_TONE.DANGER, glyph: <CloseIcon />, glyphLabel: "failing" }],
  },
  { value: VIEW.FILES, icon: <CodeIcon />, label: "Files changed", count: linesCount(128, 42) },
];

const SHOW = {
  NEEDS_YOU: "needs-you",
  UNREAD: "unread",
  ALL: "all",
} as const;
type Show = (typeof SHOW)[keyof typeof SHOW];

/** An Inbox's tabs: names and counts, one needing the reader in the attention tone. */
const SHOWS: readonly ChoiceItem<Show>[] = [
  {
    value: SHOW.NEEDS_YOU,
    label: "Needs you",
    count: [{ text: "3", tone: COUNT_TONE.ATTENTION, glyph: <AlertIcon />, glyphLabel: "waiting" }],
  },
  { value: SHOW.UNREAD, label: "Unread", count: "7" },
  { value: SHOW.ALL, label: "All open", count: "24" },
];

const EFFORT = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  HIGHEST: "highest",
} as const;
type Effort = (typeof EFFORT)[keyof typeof EFFORT];

const EFFORTS: readonly ChoiceItem<Effort>[] = [
  { value: EFFORT.LOW, label: "Low" },
  { value: EFFORT.MEDIUM, label: "Medium" },
  { value: EFFORT.HIGH, label: "High" },
  { value: EFFORT.HIGHEST, label: "Highest", disabled: true },
];

/** A tab bar the example holds, over a panel for each of its views. */
function HeldTabs<Value extends string>({
  label,
  items,
  start,
  look,
  size,
}: {
  label: string;
  items: readonly ChoiceItem<Value>[];
  start: Value;
  look: ChoiceBarLook;
  size?: ChoiceBarSize | undefined;
}): React.JSX.Element {
  const [value, setValue] = useState<Value>(start);
  const id = useId();
  const panels = (each: Value) => ({ tab: `${id}-${each}-tab`, panel: `${id}-${each}-panel` });
  return (
    <Stack gap={GAP.CONTROL} align="start">
      <ChoiceBar<Value>
        label={label}
        items={items}
        value={value}
        onChange={setValue}
        look={look}
        size={size}
        panels={panels}
      />
      {items.map((item) => (
        <div
          key={item.value}
          role="tabpanel"
          id={panels(item.value).panel}
          aria-labelledby={panels(item.value).tab}
          hidden={item.value !== value}
        >
          <Text tone={TEXT_TONE.MUTED}>{`${item.label} view`}</Text>
        </div>
      ))}
    </Stack>
  );
}

/** A radio group the example holds, setting an effort, clearable as given. */
function HeldEffort({
  start,
  look = CHOICE_BAR_LOOK.SEGMENTED,
  size,
  clearable = false,
  disabled = false,
}: {
  start: Effort | undefined;
  look?: ChoiceBarLook;
  size?: ChoiceBarSize | undefined;
  clearable?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const [effort, setEffort] = useState<Effort | undefined>(start);
  return (
    <ChoiceBar<Effort>
      label="Effort"
      items={EFFORTS}
      value={effort}
      onChange={setEffort}
      look={look}
      size={size}
      clearable={clearable}
      disabled={disabled}
    />
  );
}

/** A clearable radio group over glyphed options the example holds, none chosen at first. */
function HeldClearableViews(): React.JSX.Element {
  const [view, setView] = useState<View | undefined>(undefined);
  return (
    <ChoiceBar<View>
      label="Show only"
      items={VIEWS}
      value={view}
      onChange={setView}
      look={CHOICE_BAR_LOOK.FILL}
      clearable
    />
  );
}

function ChoiceBarExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="choice-bar-fill" title="Fill, as tabs over panels">
        <Stack gap={GAP.SECTION}>
          <HeldTabs
            label="Pull request"
            items={VIEWS}
            start={VIEW.CHECKS}
            look={CHOICE_BAR_LOOK.FILL}
          />
          <HeldTabs
            label="Show"
            items={SHOWS}
            start={SHOW.NEEDS_YOU}
            look={CHOICE_BAR_LOOK.FILL}
            size={CHOICE_BAR_SIZE.COMPACT}
          />
        </Stack>
      </CatalogSection>
      <CatalogSection id="choice-bar-segmented" title="Segmented, as tabs over panels">
        <Stack gap={GAP.SECTION}>
          <HeldTabs
            label="Pull request"
            items={VIEWS}
            start={VIEW.FILES}
            look={CHOICE_BAR_LOOK.SEGMENTED}
          />
          <HeldTabs
            label="Show"
            items={SHOWS}
            start={SHOW.UNREAD}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            size={CHOICE_BAR_SIZE.COMPACT}
          />
        </Stack>
      </CatalogSection>
      <CatalogSection id="choice-bar-radio" title="Setting a value, as a radio group">
        <Stack gap={GAP.CONTROL} align="start">
          <HeldEffort start={EFFORT.MEDIUM} />
          <HeldEffort start={EFFORT.MEDIUM} size={CHOICE_BAR_SIZE.COMPACT} />
          <HeldEffort start={EFFORT.HIGH} look={CHOICE_BAR_LOOK.FILL} />
          <HeldEffort
            start={EFFORT.HIGH}
            look={CHOICE_BAR_LOOK.FILL}
            size={CHOICE_BAR_SIZE.COMPACT}
          />
        </Stack>
      </CatalogSection>
      <CatalogSection id="choice-bar-clearable" title="Clearable, none chosen">
        <Stack gap={GAP.CONTROL} align="start">
          <HeldEffort start={undefined} clearable />
          <HeldEffort start={undefined} look={CHOICE_BAR_LOOK.FILL} clearable />
        </Stack>
      </CatalogSection>
      <CatalogSection id="choice-bar-disabled" title="Unavailable">
        <Stack gap={GAP.CONTROL} align="start">
          <HeldEffort start={EFFORT.LOW} disabled />
          <HeldEffort start={EFFORT.LOW} look={CHOICE_BAR_LOOK.FILL} disabled />
        </Stack>
      </CatalogSection>
      <CatalogSection id="choice-bar-narrow" title="Narrow column">
        <div className="catalog-narrow">
          <HeldTabs
            label="Pull request"
            items={VIEWS}
            start={VIEW.CHECKS}
            look={CHOICE_BAR_LOOK.FILL}
          />
          <HeldClearableViews />
          <HeldEffort start={EFFORT.HIGH} />
        </div>
      </CatalogSection>
    </>
  );
}

export const CHOICE_BAR_EXAMPLE: Example = {
  id: "choice-bar",
  title: "Choice bar",
  Render: ChoiceBarExample,
};
