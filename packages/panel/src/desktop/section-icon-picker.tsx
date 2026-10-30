import { useAtomValue } from "@effect/atom-react";
import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_ICON_KIND,
  type TaskSectionGlyph,
  type TaskSectionIcon,
  type TaskSectionIconColor,
  taskSectionIconSchema,
} from "@luke/features/task-section-wire";
import { noMatchWords, readingWords } from "@luke/features/words";
import {
  BUTTON_SIZE,
  type ButtonSize,
  type ButtonVariant,
  CHOICE_BAR_LOOK,
  ChoiceBar,
  IconButton,
  NOTE_LINE_LOOK,
  NoteLine,
  PopoverIconButton,
  ScrollArea,
  SearchField,
  Swatch,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TextButton,
  VisuallyHidden,
} from "@luke/ui";
import { SmilePlusIcon } from "@luke/ui/icons";
import {
  emojiGroups,
  findEmoji,
  findGlyphs,
  glyphChoices,
  glyphKey,
  glyphLabel,
  isSuggestedGlyph,
  recentIcons,
} from "@luke/ui/section-icon-model";
import { Effect, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import {
  BookmarkIcon,
  BriefcaseIcon,
  BugIcon,
  CircleIcon,
  FlagIcon,
  FlaskConicalIcon,
  FolderIcon,
  HeartIcon,
  LayersIcon,
  type LucideIcon,
  RocketIcon,
  StarIcon,
  ZapIcon,
} from "lucide-react";
import { memo, type RefObject, useCallback, useId, useMemo, useRef, useState } from "react";
import { readKept, writeKept } from "../kept-storage.js";
import { rendererRuntime } from "../renderer-runtime.js";

/**
 * section-icon-picker.tsx -- how a sidebar section's icon is drawn, and the icon well that changes it: a button wearing the icon, hanging a picker of every Lucide glyph in a color of the palette and every emoji, the icons this Mac picked last and the suggested ones first, under one search.
 *
 * A glyph travels by its Lucide name (`task-section-wire.ts`). The few the
 * picker suggests are drawn from the bundle every window parses, so a
 * section wearing one draws it at once; any other is drawn from the whole
 * of Lucide, a chunk of its own loaded the first time a section or the
 * picker needs it, and a name this Mac's Lucide does not know draws an
 * empty cell rather than failing. The emoji, `unicode-emoji-json`'s, load
 * the first time the picker's Emoji tab is shown or a search is typed.
 *
 * The well is the section's icon, or a quiet add-icon glyph where it has
 * none, and hangs the picker in a popover of its own, so neither a sidebar's
 * column nor a dialog's card cuts it. The picker opens on its search. With
 * nothing searched it shows the tab chosen: Icons offers Recent, the icons
 * this Mac chose last (kept in this window's storage, the newest first),
 * then Suggested, then every other glyph by name; Emoji offers every emoji
 * by category. A search finds glyphs and emoji alike, each under its kind,
 * and an emoji typed or picked into it (⌃⌘Space) is offered first, so one
 * newer than the grid's still can be chosen. Choosing one hands it on, and
 * the owner puts the picker away; a color recolors the glyph chosen and
 * every glyph shown, and leaves the picker standing. The palette is one tab
 * stop moved through with the arrows, and so is the grid; Enter in the
 * search chooses the first thing found. A glyph's or emoji's name is said at
 * the picker's foot while the pointer or the keyboard rests on it, since a
 * tooltip on each of some two thousand buttons would cost more than it says.
 * Remove icon stands only while the section wears one.
 */

/** The glyphs drawn without loading Lucide whole, by their name on the wire. */
const SUGGESTED_ICONS = {
  [TASK_SECTION_GLYPH.FOLDER]: FolderIcon,
  [TASK_SECTION_GLYPH.STAR]: StarIcon,
  [TASK_SECTION_GLYPH.BOOKMARK]: BookmarkIcon,
  [TASK_SECTION_GLYPH.FLAG]: FlagIcon,
  [TASK_SECTION_GLYPH.ROCKET]: RocketIcon,
  [TASK_SECTION_GLYPH.ZAP]: ZapIcon,
  [TASK_SECTION_GLYPH.BUG]: BugIcon,
  [TASK_SECTION_GLYPH.FLASK]: FlaskConicalIcon,
  [TASK_SECTION_GLYPH.BRIEFCASE]: BriefcaseIcon,
  [TASK_SECTION_GLYPH.LAYERS]: LayersIcon,
  [TASK_SECTION_GLYPH.HEART]: HeartIcon,
  [TASK_SECTION_GLYPH.CIRCLE]: CircleIcon,
} as const satisfies Record<TaskSectionGlyph, LucideIcon>;

/** The suggested glyphs, looked up by any name a section may wear. */
const SUGGESTED_BY_NAME = new Map<string, LucideIcon>(Object.entries(SUGGESTED_ICONS));

/** The ink each color of the palette draws a glyph in, from the file tree's palette, which already answers light and dark. */
const COLOR_INK = {
  [TASK_SECTION_ICON_COLOR.RED]: "text-file-icon-red",
  [TASK_SECTION_ICON_COLOR.ORANGE]: "text-file-icon-orange",
  [TASK_SECTION_ICON_COLOR.YELLOW]: "text-file-icon-yellow",
  [TASK_SECTION_ICON_COLOR.GREEN]: "text-file-icon-green",
  [TASK_SECTION_ICON_COLOR.TEAL]: "text-file-icon-teal",
  [TASK_SECTION_ICON_COLOR.BLUE]: "text-file-icon-blue",
  [TASK_SECTION_ICON_COLOR.PURPLE]: "text-file-icon-purple",
  [TASK_SECTION_ICON_COLOR.PINK]: "text-file-icon-pink",
} as const satisfies Record<TaskSectionIconColor, string>;

/** The ink a glyph is drawn in: its color's, or the text's own where it has none. */
function inkOf(color: TaskSectionIconColor | undefined): string | undefined {
  return color === undefined ? undefined : COLOR_INK[color];
}

/** What each color of the palette is called. */
const COLOR_LABEL = {
  [TASK_SECTION_ICON_COLOR.RED]: "Red",
  [TASK_SECTION_ICON_COLOR.ORANGE]: "Orange",
  [TASK_SECTION_ICON_COLOR.YELLOW]: "Yellow",
  [TASK_SECTION_ICON_COLOR.GREEN]: "Green",
  [TASK_SECTION_ICON_COLOR.TEAL]: "Teal",
  [TASK_SECTION_ICON_COLOR.BLUE]: "Blue",
  [TASK_SECTION_ICON_COLOR.PURPLE]: "Purple",
  [TASK_SECTION_ICON_COLOR.PINK]: "Pink",
} as const satisfies Record<TaskSectionIconColor, string>;

/** The picker's two tabs. */
const ICON_TAB = {
  ICONS: "icons",
  EMOJI: "emoji",
} as const;

type IconTab = (typeof ICON_TAB)[keyof typeof ICON_TAB];

/** How many choices stand in one row of the grid, which `.section-icon-grid` lays out alike; the arrows step a row by it. */
const GRID_COLUMNS = 10;

/** The arrow keys that move through the grid, and by how many choices. */
const GRID_STEPS = new Map([
  ["ArrowLeft", -1],
  ["ArrowRight", 1],
  ["ArrowUp", -GRID_COLUMNS],
  ["ArrowDown", GRID_COLUMNS],
]);

/** What the picker says where a set could not be loaded. */
const LOAD_FAILED = {
  [ICON_TAB.ICONS]: "The icons could not be loaded.",
  [ICON_TAB.EMOJI]: "The emoji could not be loaded.",
} as const satisfies Record<IconTab, string>;

/** What the picker says while a set is loaded. */
const READING = {
  [ICON_TAB.ICONS]: readingWords("icons"),
  [ICON_TAB.EMOJI]: readingWords("emoji"),
} as const satisfies Record<IconTab, string>;

/** What the picker says where the search found nothing in a set. */
const NO_MATCH = {
  [ICON_TAB.ICONS]: noMatchWords({ one: "icon", many: "icons" }),
  [ICON_TAB.EMOJI]: noMatchWords({ one: "emoji", many: "emoji" }),
} as const satisfies Record<IconTab, string>;

/** What the picker says where a search found neither a glyph nor an emoji. */
const NO_MATCH_EITHER = noMatchWords({ one: "icon or emoji", many: "icons or emoji" });

/** Whether a value is an icon the wire takes. */
const isSectionIcon = Schema.is(taskSectionIconSchema);

/** Lucide's every glyph, by its PascalCase name. */
type LucideIcons = Readonly<Record<string, LucideIcon>>;

/**
 * The whole of Lucide's `icons`, loaded once per window the first time a
 * glyph outside the suggested ones is drawn or picked. Note that the build
 * answers this `import()` with Lucide's CommonJS build, not the ES build
 * the window's own glyphs come from (`scripts/build.mjs`'s
 * `lucideWholeOnDemand`), so the whole stays out of the bundle every
 * window parses.
 */
const lucideAtom = Atom.keepAlive(
  rendererRuntime.atom(
    Effect.tryPromise({
      try: () => import("lucide-react"),
      catch: () => new Error(LOAD_FAILED[ICON_TAB.ICONS]),
    }).pipe(Effect.map((module): LucideIcons => module.icons)),
  ),
);

/** Every emoji by category, loaded once per window the first time the picker's Emoji tab is shown. */
const emojiAtom = Atom.keepAlive(
  rendererRuntime.atom(
    Effect.tryPromise({
      try: () => import("unicode-emoji-json/data-by-group.json"),
      catch: () => new Error(LOAD_FAILED[ICON_TAB.EMOJI]),
    }).pipe(Effect.map((module) => emojiGroups(module.default))),
  ),
);

/** A glyph found in Lucide's own map, or nothing for a name it does not know. */
function lucideGlyph(icons: LucideIcons, glyph: string): LucideIcon | undefined {
  const key = glyphKey(glyph);
  return Object.hasOwn(icons, key) ? icons[key] : undefined;
}

/** A glyph outside the suggested ones, drawn once Lucide has loaded, and an empty cell until then or where Lucide knows no such glyph. */
function LoadedGlyph({
  glyph,
  color,
}: {
  glyph: string;
  color: TaskSectionIconColor | undefined;
}): React.JSX.Element {
  const loaded = useAtomValue(lucideAtom);
  const Glyph = AsyncResult.isSuccess(loaded) ? lucideGlyph(loaded.value, glyph) : undefined;
  if (Glyph === undefined)
    return <span className="section-glyph-blank block size-control-icon" aria-hidden="true" />;
  return <Glyph data-icon-color={color} className={inkOf(color)} />;
}

/** A glyph in its color: one of the suggested at once, any other once Lucide has loaded. */
function drawnGlyph(glyph: string, color: TaskSectionIconColor | undefined): React.JSX.Element {
  const Suggested = SUGGESTED_BY_NAME.get(glyph);
  if (Suggested !== undefined)
    return <Suggested data-icon-color={color} className={inkOf(color)} />;
  return <LoadedGlyph glyph={glyph} color={color} />;
}

/** A section's icon: its emoji, its glyph in its color, or nothing for a section without one, which wears none. */
export function sectionGlyph(icon: TaskSectionIcon | undefined): React.JSX.Element | undefined {
  if (icon === undefined) return undefined;
  if (icon.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return (
      <span
        className="sidebar-section-emoji grid size-control-icon place-items-center text-caption-inline leading-none"
        aria-hidden="true"
      >
        {icon.emoji}
      </span>
    );
  }
  return drawnGlyph(icon.glyph, icon.color);
}

/** Where this Mac keeps the icons it chose last, newest first. */
const RECENT_KEY = "luke.recentSectionIcons";

/** The icons kept as chosen last. */
const keptRecent = Schema.fromJsonString(Schema.Array(taskSectionIconSchema));

/** How many icons Recent offers. */
const RECENT_MOST = 10;

/** The icons this Mac chose last, newest first, none where storage holds none or refuses the read. */
function readRecent(): readonly TaskSectionIcon[] {
  return readKept(RECENT_KEY, keptRecent, []);
}

/** Keeps `icon` as the one this Mac chose last. */
function keepRecent(icon: TaskSectionIcon): void {
  writeKept(RECENT_KEY, keptRecent, recentIcons(readRecent(), icon, RECENT_MOST));
}

/** Whether a glyph is the icon chosen, a name Lucide draws alike (`flask` and `flask-conical`) being the same glyph. */
function chosenGlyph(icon: TaskSectionIcon | undefined, glyph: string): boolean {
  return icon?.kind === TASK_SECTION_ICON_KIND.GLYPH && glyphKey(icon.glyph) === glyphKey(glyph);
}

/** Whether an emoji is the icon chosen. */
function chosenEmoji(icon: TaskSectionIcon | undefined, emoji: string): boolean {
  return icon?.kind === TASK_SECTION_ICON_KIND.EMOJI && icon.emoji === emoji;
}

/** Whether `one` is the icon chosen. */
function chosenIcon(icon: TaskSectionIcon | undefined, one: TaskSectionIcon): boolean {
  return one.kind === TASK_SECTION_ICON_KIND.EMOJI
    ? chosenEmoji(icon, one.emoji)
    : chosenGlyph(icon, one.glyph);
}

/** A glyph in a color, as the wire carries it, with no color where none is chosen. */
function glyphIcon(glyph: string, color: TaskSectionIconColor | undefined): TaskSectionIcon {
  return {
    kind: TASK_SECTION_ICON_KIND.GLYPH,
    glyph,
    ...(color === undefined ? undefined : { color }),
  };
}

/** What an icon is called at the picker's foot. */
function iconLabel(icon: TaskSectionIcon): string {
  return icon.kind === TASK_SECTION_ICON_KIND.EMOJI ? icon.emoji : glyphLabel(icon.glyph);
}

/** One choice in a grid: a button pressed while it is the icon chosen, the grid's tab stop where `stop`. */
function GridChoice({
  label,
  pressed,
  stop,
  face,
  onPress,
}: {
  label: string;
  pressed: boolean;
  stop: boolean;
  face: React.ReactNode;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <IconButton icon={face} label={label} pressed={pressed} tabbable={stop} onClick={onPress} />
  );
}

/** A group of choices under its name. */
function ChoiceGroup({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className="section-icon-group [.section-icon-group+&]:mt-control-gap"
      aria-label={name}
    >
      <Text
        as={TEXT_ELEMENT.H3}
        variant={TEXT_VARIANT.GROUP}
        className="section-icon-group-name m-0 mb-tight-gap"
      >
        {name}
      </Text>
      <div className="section-icon-grid grid grid-cols-section-icons gap-tight-gap">{children}</div>
    </section>
  );
}

/** What a panel says in its grid's place while its set loads, failed to, or holds nothing the search found. */
function PanelNote({
  loaded,
  tab,
}: {
  loaded: AsyncResult.AsyncResult<unknown, Error>;
  tab: IconTab;
}): React.JSX.Element {
  const words = AsyncResult.isFailure(loaded)
    ? LOAD_FAILED[tab]
    : AsyncResult.isSuccess(loaded)
      ? NO_MATCH[tab]
      : READING[tab];
  return <NoteLine look={NOTE_LINE_LOOK.LIST}>{words}</NoteLine>;
}

/** What the grids are handed: the icon chosen, the color glyphs are shown in, and where a choice goes. */
interface GridProps {
  readonly icon: TaskSectionIcon | undefined;
  readonly color: TaskSectionIconColor | undefined;
  readonly onIcon: (icon: TaskSectionIcon) => void;
}

/** One glyph's choice, in the color shown. */
function glyphChoice(
  icons: LucideIcons,
  choice: { glyph: string; label: string },
  props: GridProps,
  stop: boolean,
): React.JSX.Element {
  const Glyph = lucideGlyph(icons, choice.glyph);
  return (
    <GridChoice
      key={choice.glyph}
      label={choice.label}
      pressed={chosenGlyph(props.icon, choice.glyph)}
      stop={stop}
      face={
        Glyph === undefined ? null : (
          <Glyph data-icon-color={props.color} className={inkOf(props.color)} />
        )
      }
      onPress={() => props.onIcon(glyphIcon(choice.glyph, props.color))}
    />
  );
}

/** One emoji's choice. */
function emojiChoice(
  one: { emoji: string; name: string },
  props: GridProps,
  stop: boolean,
): React.JSX.Element {
  return (
    <GridChoice
      key={one.emoji}
      label={one.name}
      pressed={chosenEmoji(props.icon, one.emoji)}
      stop={stop}
      face={<span className="section-emoji-face text-foreground">{one.emoji}</span>}
      onPress={() => props.onIcon({ kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: one.emoji })}
    />
  );
}

/**
 * The Icons tab with nothing searched: Recent, Suggested, then every other
 * glyph by name, each glyph in the color shown and every recent icon in its
 * own; the one chosen, or the first, is the grid's tab stop.
 */
const GlyphPanel = memo(function GlyphPanel(
  props: GridProps & { recent: readonly TaskSectionIcon[] },
): React.JSX.Element {
  const loaded = useAtomValue(lucideAtom);
  const icons = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const choices = useMemo(() => glyphChoices(Object.keys(icons ?? {})), [icons]);
  if (icons === undefined) return <PanelNote loaded={loaded} tab={ICON_TAB.ICONS} />;
  const suggested = choices.filter((choice) => isSuggestedGlyph(choice.glyph));
  const rest = choices.filter((choice) => !isSuggestedGlyph(choice.glyph));
  const first = props.recent[0] ?? suggested[0];
  const chosenShown =
    props.icon !== undefined &&
    (props.recent.some((one) => chosenIcon(props.icon, one)) ||
      (props.icon.kind === TASK_SECTION_ICON_KIND.GLYPH && choices.length > 0));
  const stopAt = (pressed: boolean, isFirst: boolean) => (chosenShown ? pressed : isFirst);
  return (
    <>
      {props.recent.length === 0 ? null : (
        <ChoiceGroup name="Recent">
          {props.recent.map((one) => (
            <GridChoice
              key={
                one.kind === TASK_SECTION_ICON_KIND.EMOJI
                  ? one.emoji
                  : `${one.glyph} ${one.color ?? ""}`
              }
              label={iconLabel(one)}
              pressed={chosenIcon(props.icon, one)}
              stop={stopAt(chosenIcon(props.icon, one), one === first)}
              face={sectionGlyph(one)}
              onPress={() => props.onIcon(one)}
            />
          ))}
        </ChoiceGroup>
      )}
      <ChoiceGroup name="Suggested">
        {suggested.map((choice) =>
          glyphChoice(
            icons,
            choice,
            props,
            stopAt(chosenGlyph(props.icon, choice.glyph), choice === first),
          ),
        )}
      </ChoiceGroup>
      <ChoiceGroup name="All icons">
        {rest.map((choice) =>
          glyphChoice(icons, choice, props, stopAt(chosenGlyph(props.icon, choice.glyph), false)),
        )}
      </ChoiceGroup>
    </>
  );
});

/** The Emoji tab with nothing searched: every emoji under its category's name; the one chosen, or the first, is the grid's tab stop. */
const EmojiPanel = memo(function EmojiPanel(props: GridProps): React.JSX.Element {
  const loaded = useAtomValue(emojiAtom);
  const groups = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  if (groups === undefined || groups.length === 0) {
    return <PanelNote loaded={loaded} tab={ICON_TAB.EMOJI} />;
  }
  const all = groups.flatMap((group) => group.emojis);
  const stop = all.find((one) => chosenEmoji(props.icon, one.emoji)) ?? all[0];
  return (
    <>
      {groups.map((group) => (
        <ChoiceGroup key={group.name} name={group.name}>
          {group.emojis.map((one) => emojiChoice(one, props, one === stop))}
        </ChoiceGroup>
      ))}
    </>
  );
});

/**
 * What a search found, glyphs and emoji alike, each under its kind: an
 * emoji typed into the search first, then the glyphs, then the emoji whose
 * name it matches. The first found is the grid's tab stop.
 */
const FoundPanel = memo(function FoundPanel(
  props: GridProps & { query: string },
): React.JSX.Element {
  const lucide = useAtomValue(lucideAtom);
  const emoji = useAtomValue(emojiAtom);
  const icons = AsyncResult.isSuccess(lucide) ? lucide.value : undefined;
  const choices = useMemo(() => glyphChoices(Object.keys(icons ?? {})), [icons]);
  const glyphs = icons === undefined ? [] : findGlyphs(choices, props.query);
  const groups = AsyncResult.isSuccess(emoji) ? findEmoji(emoji.value, props.query) : [];
  const typed = { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: props.query.trim() };
  const typedOne = isSectionIcon(typed) ? [{ emoji: typed.emoji, name: typed.emoji }] : [];
  const found = [
    ...typedOne,
    ...groups.flatMap((group) => group.emojis).filter((one) => one.emoji !== typed.emoji),
  ];
  if (icons !== undefined && glyphs.length === 0 && found.length === 0) {
    return <NoteLine look={NOTE_LINE_LOOK.LIST}>{NO_MATCH_EITHER}</NoteLine>;
  }
  if (icons === undefined && found.length === 0)
    return <PanelNote loaded={lucide} tab={ICON_TAB.ICONS} />;
  const firstEmoji = typedOne.length > 0;
  return (
    <>
      {firstEmoji ? (
        <ChoiceGroup name="Emoji">
          {typedOne.map((one) => emojiChoice(one, props, true))}
        </ChoiceGroup>
      ) : null}
      {icons === undefined || glyphs.length === 0 ? null : (
        <ChoiceGroup name="Icons">
          {glyphs.map((choice, at) => glyphChoice(icons, choice, props, !firstEmoji && at === 0))}
        </ChoiceGroup>
      )}
      {found.length === typedOne.length ? null : (
        <ChoiceGroup name={firstEmoji ? "More emoji" : "Emoji"}>
          {found
            .slice(typedOne.length)
            .map((one, at) =>
              emojiChoice(one, props, !firstEmoji && glyphs.length === 0 && at === 0),
            )}
        </ChoiceGroup>
      )}
    </>
  );
});

/** Moves focus through the choices with the arrows, from whichever holds it, a row's width up and down. */
function stepGrid(event: React.KeyboardEvent<HTMLFieldSetElement>): void {
  const step = GRID_STEPS.get(event.key);
  if (step === undefined) return;
  const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
  const from = event.target instanceof HTMLButtonElement ? choices.indexOf(event.target) : -1;
  if (from === -1) return;
  event.preventDefault();
  choices[Math.min(Math.max(from + step, 0), choices.length - 1)]?.focus();
}

/**
 * Makes the choice that took focus its set's one tab stop, so Tab out and
 * Shift+Tab back lands where the arrows left it. Note that this is written
 * on the buttons themselves rather than drawn, because drawing it would
 * draw every one of some two thousand buttons again on each arrow press;
 * the next choice made draws the stop again as the icon chosen.
 */
function standTabStop(event: React.FocusEvent<HTMLFieldSetElement>): void {
  const focused = event.target;
  if (!(focused instanceof HTMLButtonElement)) return;
  for (const stop of event.currentTarget.querySelectorAll<HTMLButtonElement>(
    'button:not([tabindex="-1"])',
  )) {
    stop.tabIndex = -1;
  }
  focused.tabIndex = 0;
}

/** The name of the choice a pointer or the keyboard rests on, read off the button under it. */
function restingLabel(event: React.SyntheticEvent): string | undefined {
  if (!(event.target instanceof Element)) return undefined;
  return event.target.closest("button")?.getAttribute("aria-label") ?? undefined;
}

/** The palette a glyph is drawn in: the text's own, then each color, the one chosen pressed; one tab stop, moved through with the arrows. */
function ColorChoices({
  color,
  onColor,
}: {
  color: TaskSectionIconColor | undefined;
  onColor: (color: TaskSectionIconColor | undefined) => void;
}): React.JSX.Element {
  const swatch = (label: string, value: TaskSectionIconColor | undefined) => (
    <Swatch
      key={label}
      label={label}
      color={value === undefined ? undefined : `var(--file-icon-${value})`}
      pressed={color === value}
      tabbable={color === value}
      onClick={() => onColor(value)}
    />
  );
  return (
    <fieldset
      className="section-icon-colors m-0 flex flex-none gap-luke-4 border-0 p-0"
      onKeyDown={stepGrid}
      onFocus={standTabStop}
    >
      <VisuallyHidden as="legend">Icon color</VisuallyHidden>
      {swatch("No color", undefined)}
      {Object.values(TASK_SECTION_ICON_COLOR).map((value) => swatch(COLOR_LABEL[value], value))}
    </fieldset>
  );
}

/**
 * The picker a section's icon well hangs: its search, which `search` names
 * so the popover opens on it; Icons and Emoji over what it offers; and the
 * palette at its foot while glyphs are shown. Choosing an icon hands it to
 * `onIcon` and keeps it among this Mac's recent ones; Remove icon hands on
 * none; a color chosen while a glyph is the icon hands that glyph, recolored,
 * to `onRecolor`.
 */
function SectionIconPicker({
  icon,
  search,
  onIcon,
  onRecolor,
}: {
  icon: TaskSectionIcon | undefined;
  search?: RefObject<HTMLInputElement | null> | undefined;
  onIcon: (icon: TaskSectionIcon | undefined) => void;
  /** Hears the glyph chosen recolored, which is no new choice. */
  onRecolor: (icon: TaskSectionIcon) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<IconTab>(
    icon?.kind === TASK_SECTION_ICON_KIND.EMOJI ? ICON_TAB.EMOJI : ICON_TAB.ICONS,
  );
  const [query, setQuery] = useState("");
  const [color, setColor] = useState(
    icon?.kind === TASK_SECTION_ICON_KIND.GLYPH ? icon.color : undefined,
  );
  const [recent] = useState(readRecent);
  const [resting, setResting] = useState<string | undefined>(undefined);
  const grid = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const tabIds = {
    [ICON_TAB.ICONS]: useId(),
    [ICON_TAB.EMOJI]: useId(),
  } satisfies Record<IconTab, string>;
  const choose = useCallback(
    (next: TaskSectionIcon) => {
      keepRecent(next);
      onIcon(next);
    },
    [onIcon],
  );
  const recolor = (next: TaskSectionIconColor | undefined) => {
    setColor(next);
    if (icon?.kind === TASK_SECTION_ICON_KIND.GLYPH) onRecolor(glyphIcon(icon.glyph, next));
  };
  // Enter, shifted or not, chooses the first thing found, as a press on it would.
  const chooseFirst = () => grid.current?.querySelector<HTMLButtonElement>("button")?.click();
  // Note that the search's own keys stop at Enter and Escape, so the arrow down into the grid is heard around it.
  const toGrid = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    grid.current?.querySelector<HTMLButtonElement>('button:not([tabindex="-1"])')?.focus();
  };
  const searching = query.trim() !== "";
  const glyphsShown = searching || tab === ICON_TAB.ICONS;
  const props: GridProps = { icon, color, onIcon: choose };
  return (
    <div className="section-icon-picker flex w-section-icon-picker flex-col">
      <div className="section-icon-head flex flex-col gap-control-gap p-card-inset-snug pb-0">
        <search onKeyDown={toGrid}>
          <SearchField
            ref={search}
            label="Search icons and emoji"
            placeholder="Search icons and emoji"
            value={query}
            onChange={setQuery}
            onClear={() => setQuery("")}
            onEnter={chooseFirst}
            onShiftEnter={chooseFirst}
          />
        </search>
        <div className="section-icon-bar flex items-center justify-between gap-control-gap">
          <ChoiceBar<IconTab>
            label="Icon kind"
            items={[
              { value: ICON_TAB.ICONS, label: "Icons" },
              { value: ICON_TAB.EMOJI, label: "Emoji" },
            ]}
            value={tab}
            onChange={setTab}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            panels={(each) => ({ tab: tabIds[each], panel: panelId })}
          />
          {icon === undefined ? null : (
            <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={() => onIcon(undefined)}>
              Remove icon
            </TextButton>
          )}
        </div>
      </div>
      <fieldset
        className="section-icon-choices m-0 min-w-0 border-0 px-card-inset-snug pt-control-gap pb-0"
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabIds[tab]}
        onKeyDown={stepGrid}
        onPointerOver={(event) => setResting(restingLabel(event))}
        onPointerLeave={() => setResting(undefined)}
        onFocus={(event) => {
          standTabStop(event);
          setResting(restingLabel(event));
        }}
      >
        <VisuallyHidden as="legend">{tab === ICON_TAB.ICONS ? "Icons" : "Emoji"}</VisuallyHidden>
        <div className="section-icon-scroll flex h-section-icon-scroll flex-col">
          <ScrollArea ref={grid}>
            {searching ? (
              <FoundPanel {...props} query={query} />
            ) : tab === ICON_TAB.ICONS ? (
              <GlyphPanel {...props} recent={recent} />
            ) : (
              <EmojiPanel {...props} />
            )}
          </ScrollArea>
        </div>
      </fieldset>
      <div className="section-icon-foot mt-tight-gap flex min-h-control items-center justify-between gap-control-gap border-t border-border px-card-inset-snug py-tight-gap">
        <Text
          as={TEXT_ELEMENT.P}
          variant={TEXT_VARIANT.INHERIT}
          truncate
          className="section-icon-resting m-0 min-w-0 text-muted-foreground text-caption-inline"
          aria-hidden="true"
        >
          {resting ?? (icon === undefined ? "" : iconLabel(icon))}
        </Text>
        {glyphsShown ? <ColorChoices color={color} onColor={recolor} /> : null}
      </div>
    </div>
  );
}

/**
 * A section's icon well: a button wearing the section's icon, or the
 * add-icon glyph where it has none, hanging the picker while `open`.
 * Choosing an icon hands it on and puts the picker away; a color leaves it
 * standing, so a glyph is recolored in place.
 */
export function SectionIconWell({
  icon,
  open,
  onOpenChange,
  onIcon,
  size,
  variant,
  disabled,
}: {
  icon: TaskSectionIcon | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIcon: (icon: TaskSectionIcon | undefined) => void;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const search = useRef<HTMLInputElement | null>(null);
  const label = icon === undefined ? "Add icon" : "Change icon";
  return (
    <PopoverIconButton
      icon={sectionGlyph(icon) ?? <SmilePlusIcon className="text-muted-foreground" />}
      label={label}
      title="Section icon"
      open={open}
      onOpenChange={onOpenChange}
      size={size ?? BUTTON_SIZE.CONTROL}
      variant={variant}
      disabled={disabled}
      initialFocus={search}
    >
      <SectionIconPicker
        icon={icon}
        search={search}
        onIcon={(next) => {
          onIcon(next);
          onOpenChange(false);
        }}
        onRecolor={onIcon}
      />
    </PopoverIconButton>
  );
}
