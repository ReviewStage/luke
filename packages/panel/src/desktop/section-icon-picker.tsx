import { useAtomValue } from "@effect/atom-react";
import {
  TASK_SECTION_BOUNDS,
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_ICON_KIND,
  type TaskSectionGlyph,
  type TaskSectionIcon,
  type TaskSectionIconColor,
  taskSectionIconSchema,
} from "@luke/features/task-section-wire";
import { IconButton, SearchField, Segmented, TextField } from "@luke/ui";
import {
  emojiGroups,
  findEmoji,
  findGlyphs,
  glyphChoices,
  glyphKey,
  glyphLabel,
} from "@luke/ui/section-icon-model";
import { Effect, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import {
  BanIcon,
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
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { rendererRuntime } from "../renderer-runtime.js";
import { Tooltip } from "../tooltip.js";

/**
 * section-icon-picker.tsx -- how a sidebar section's icon is drawn, and the section dialog's picker of one: every Lucide glyph in a color of the palette, every emoji by category, one search over whichever is shown, and No icon.
 *
 * A glyph travels by its Lucide name (`task-section-wire.ts`). The few the
 * picker suggests are drawn from the bundle every window parses, so a
 * section wearing one draws it at once; any other is drawn from the whole
 * of Lucide, a chunk of its own loaded the first time a section or the
 * picker needs it, and a name this Mac's Lucide does not know draws an
 * empty cell rather than failing. The emoji, `unicode-emoji-json`'s, load
 * the first time the picker's Emoji tab is shown. The picker's grid is one
 * tab stop, moved through with the arrows, and Enter in its search chooses
 * the first thing found; a glyph's or emoji's name is said under the grid
 * while the pointer or the keyboard rests on it, since a tooltip on each of
 * some two thousand buttons would cost more than it says.
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
  if (Glyph === undefined) return <span className="section-glyph-blank" aria-hidden="true" />;
  return <Glyph data-icon-color={color} />;
}

/** A glyph in its color: one of the suggested at once, any other once Lucide has loaded. */
function drawnGlyph(glyph: string, color: TaskSectionIconColor | undefined): React.JSX.Element {
  const Suggested = SUGGESTED_BY_NAME.get(glyph);
  if (Suggested !== undefined) return <Suggested data-icon-color={color} />;
  return <LoadedGlyph glyph={glyph} color={color} />;
}

/** A section's icon: its emoji, its glyph in its color, or nothing for a section without one, which wears none. */
export function sectionGlyph(icon: TaskSectionIcon | undefined): React.JSX.Element | undefined {
  if (icon === undefined) return undefined;
  if (icon.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return (
      <span className="sidebar-section-emoji" aria-hidden="true">
        {icon.emoji}
      </span>
    );
  }
  return drawnGlyph(icon.glyph, icon.color);
}

/** Whether a glyph is the icon chosen, a name Lucide draws alike (`flask` and `flask-conical`) being the same glyph. */
function chosenGlyph(icon: TaskSectionIcon | undefined, glyph: string): boolean {
  return icon?.kind === TASK_SECTION_ICON_KIND.GLYPH && glyphKey(icon.glyph) === glyphKey(glyph);
}

/** Whether an emoji is the icon chosen. */
function chosenEmoji(icon: TaskSectionIcon | undefined, emoji: string): boolean {
  return icon?.kind === TASK_SECTION_ICON_KIND.EMOJI && icon.emoji === emoji;
}

/** A glyph in a color, as the wire carries it, with no color where none is chosen. */
function glyphIcon(glyph: string, color: TaskSectionIconColor | undefined): TaskSectionIcon {
  return {
    kind: TASK_SECTION_ICON_KIND.GLYPH,
    glyph,
    ...(color === undefined ? undefined : { color }),
  };
}

/** One choice in the grid: a button pressed while it is the icon chosen, the grid's tab stop where `stop`. */
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
    <button
      type="button"
      className="section-icon-choice"
      aria-label={label}
      aria-pressed={pressed}
      data-label={label}
      tabIndex={stop ? 0 : -1}
      onClick={onPress}
    >
      {face}
    </button>
  );
}

/** What a panel says in its grid's place while its set loads, failed to, or holds nothing the search found. */
function PanelNote({
  loaded,
  tab,
  query,
}: {
  loaded: AsyncResult.AsyncResult<unknown, Error>;
  tab: IconTab;
  query: string;
}): React.JSX.Element {
  const words = AsyncResult.isFailure(loaded)
    ? LOAD_FAILED[tab]
    : AsyncResult.isSuccess(loaded)
      ? `Nothing matches “${query.trim()}”.`
      : "Loading…";
  return <p className="section-icon-note">{words}</p>;
}

/** The Icons tab: every glyph the search finds, each in the color chosen; the one chosen, or the first, is the grid's tab stop. */
const GlyphPanel = memo(function GlyphPanel({
  query,
  icon,
  color,
  onIcon,
}: {
  query: string;
  icon: TaskSectionIcon | undefined;
  color: TaskSectionIconColor | undefined;
  onIcon: (icon: TaskSectionIcon) => void;
}): React.JSX.Element {
  const loaded = useAtomValue(lucideAtom);
  const icons = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const choices = useMemo(() => glyphChoices(Object.keys(icons ?? {})), [icons]);
  const found = useMemo(() => findGlyphs(choices, query), [choices, query]);
  if (icons === undefined || found.length === 0) {
    return <PanelNote loaded={loaded} tab={ICON_TAB.ICONS} query={query} />;
  }
  const stop = found.find((choice) => chosenGlyph(icon, choice.glyph)) ?? found[0];
  return (
    <div className="section-icon-grid">
      {found.map((choice) => {
        const Glyph = lucideGlyph(icons, choice.glyph);
        return (
          <GridChoice
            key={choice.glyph}
            label={choice.label}
            pressed={chosenGlyph(icon, choice.glyph)}
            stop={choice === stop}
            face={Glyph === undefined ? null : <Glyph data-icon-color={color} />}
            onPress={() => onIcon(glyphIcon(choice.glyph, color))}
          />
        );
      })}
    </div>
  );
});

/** The Emoji tab: every emoji the search finds, under its category's name; the one chosen, or the first, is the grid's tab stop. */
const EmojiPanel = memo(function EmojiPanel({
  query,
  icon,
  onIcon,
}: {
  query: string;
  icon: TaskSectionIcon | undefined;
  onIcon: (icon: TaskSectionIcon) => void;
}): React.JSX.Element {
  const loaded = useAtomValue(emojiAtom);
  const groups = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const found = useMemo(() => findEmoji(groups ?? [], query), [groups, query]);
  if (found.length === 0) return <PanelNote loaded={loaded} tab={ICON_TAB.EMOJI} query={query} />;
  const all = found.flatMap((group) => group.emojis);
  const stop = all.find((one) => chosenEmoji(icon, one.emoji)) ?? all[0];
  return (
    <>
      {found.map((group) => (
        <section key={group.name} className="section-emoji-group" aria-label={group.name}>
          <h3 className="section-emoji-group-name">{group.name}</h3>
          <div className="section-icon-grid">
            {group.emojis.map((one) => (
              <GridChoice
                key={one.emoji}
                label={one.name}
                pressed={chosenEmoji(icon, one.emoji)}
                stop={one === stop}
                face={one.emoji}
                onPress={() => onIcon({ kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: one.emoji })}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
});

/** The palette a glyph is drawn in: the text's own, then each color, the one chosen pressed. */
function ColorChoices({
  color,
  onColor,
}: {
  color: TaskSectionIconColor | undefined;
  onColor: (color: TaskSectionIconColor | undefined) => void;
}): React.JSX.Element {
  const swatch = (label: string, value: TaskSectionIconColor | undefined) => (
    <button
      key={label}
      type="button"
      className="section-icon-color"
      aria-label={label}
      aria-pressed={color === value}
      data-icon-color={value}
      onClick={() => onColor(value)}
    />
  );
  return (
    <fieldset className="section-icon-colors">
      <legend className="visually-hidden">Icon color</legend>
      {swatch("No color", undefined)}
      {Object.values(TASK_SECTION_ICON_COLOR).map((value) => swatch(COLOR_LABEL[value], value))}
    </fieldset>
  );
}

/** Moves focus through the grid's choices with the arrows, from whichever holds it. */
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
 * Makes the choice that took focus the grid's one tab stop, so Tab out and
 * Shift+Tab back lands where the arrows left it. Note that this is written
 * on the buttons themselves rather than drawn, because drawing it would
 * draw every one of some two thousand buttons again on each arrow press;
 * the next choice made draws the stop again as the icon chosen.
 */
function standTabStop(event: React.FocusEvent<HTMLFieldSetElement>): void {
  const focused = event.target;
  if (!(focused instanceof HTMLButtonElement)) return;
  for (const stop of event.currentTarget.querySelectorAll<HTMLButtonElement>(
    'button[tabindex="0"]',
  )) {
    stop.tabIndex = -1;
  }
  focused.tabIndex = 0;
}

/** The name of the choice a pointer or the keyboard rests on, read off the button under it. */
function restingLabel(event: React.SyntheticEvent): string | undefined {
  if (!(event.target instanceof Element)) return undefined;
  return event.target.closest<HTMLElement>("[data-label]")?.dataset.label;
}

/**
 * The dialog's choice of icon: No icon; the Icons tab, every Lucide glyph
 * over the palette it is drawn in; and the Emoji tab, every emoji by
 * category over a field any one emoji is typed or picked into (⌃⌘Space),
 * which chooses it as soon as it reads as one. One search filters the tab
 * shown, and a color chosen recolors the glyph chosen and every one picked
 * after it.
 */
export function SectionIconPicker({
  icon,
  disabled,
  onIcon,
}: {
  icon: TaskSectionIcon | undefined;
  disabled: boolean;
  onIcon: (icon: TaskSectionIcon | undefined) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<IconTab>(
    icon?.kind === TASK_SECTION_ICON_KIND.EMOJI ? ICON_TAB.EMOJI : ICON_TAB.ICONS,
  );
  const [query, setQuery] = useState("");
  const [color, setColor] = useState(
    icon?.kind === TASK_SECTION_ICON_KIND.GLYPH ? icon.color : undefined,
  );
  // Note that the field opens on the emoji chosen, which may be one the grid leaves out, newer than every Mac draws.
  const [typed, setTyped] = useState(icon?.kind === TASK_SECTION_ICON_KIND.EMOJI ? icon.emoji : "");
  const [resting, setResting] = useState<string | undefined>(undefined);
  const grid = useRef<HTMLDivElement | null>(null);
  // A choice made anywhere but the field leaves the field empty, so it never names an emoji no longer chosen.
  const choose = useCallback(
    (next: TaskSectionIcon | undefined) => {
      setTyped("");
      onIcon(next);
    },
    [onIcon],
  );
  const recolor = (next: TaskSectionIconColor | undefined) => {
    setColor(next);
    if (icon?.kind === TASK_SECTION_ICON_KIND.GLYPH) onIcon(glyphIcon(icon.glyph, next));
  };
  // Enter, shifted or not, chooses the first thing found, as a press on it would.
  const chooseFirst = () => grid.current?.querySelector<HTMLButtonElement>("button")?.click();
  // Note that the search's own keys stop at Enter and Escape, so the arrow down into the grid is heard around it.
  const toGrid = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  };
  return (
    <fieldset className="section-icon-picker" disabled={disabled}>
      <legend className="section-icon-legend">Icon</legend>
      <div className="section-icon-bar">
        <Segmented
          legend="Icon kind"
          options={[
            { value: ICON_TAB.ICONS, label: "Icons" },
            { value: ICON_TAB.EMOJI, label: "Emoji" },
          ]}
          value={tab}
          disabled={disabled}
          onChange={setTab}
        />
        <Tooltip label="No icon">
          <IconButton
            icon={<BanIcon />}
            label="No icon"
            pressed={icon === undefined}
            onClick={() => choose(undefined)}
          />
        </Tooltip>
      </div>
      <search onKeyDown={toGrid}>
        <SearchField
          label={tab === ICON_TAB.ICONS ? "Search icons" : "Search emoji"}
          placeholder={tab === ICON_TAB.ICONS ? "Search icons" : "Search emoji"}
          value={query}
          onChange={setQuery}
          onClear={() => setQuery("")}
          onEnter={chooseFirst}
          onShiftEnter={chooseFirst}
        />
      </search>
      {tab === ICON_TAB.ICONS ? <ColorChoices color={color} onColor={recolor} /> : null}
      <fieldset
        className="section-icon-choices"
        onKeyDown={stepGrid}
        onPointerOver={(event) => setResting(restingLabel(event))}
        onPointerLeave={() => setResting(undefined)}
        onFocus={(event) => {
          standTabStop(event);
          setResting(restingLabel(event));
        }}
      >
        <legend className="visually-hidden">{tab === ICON_TAB.ICONS ? "Icons" : "Emoji"}</legend>
        <div ref={grid} className="section-icon-scroll">
          {tab === ICON_TAB.ICONS ? (
            <GlyphPanel query={query} icon={icon} color={color} onIcon={choose} />
          ) : (
            <EmojiPanel query={query} icon={icon} onIcon={choose} />
          )}
        </div>
      </fieldset>
      <p className="section-icon-resting" aria-hidden="true">
        {resting ??
          (tab === ICON_TAB.ICONS && icon?.kind === TASK_SECTION_ICON_KIND.GLYPH
            ? glyphLabel(icon.glyph)
            : "")}
      </p>
      {tab === ICON_TAB.EMOJI ? (
        <TextField
          label="Any emoji"
          placeholder="Or type an emoji (⌃⌘Space)"
          spellCheck={false}
          value={typed}
          maxLength={TASK_SECTION_BOUNDS.MAX_EMOJI_UNITS}
          onChange={(next) => {
            setTyped(next);
            const asked = { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: next.trim() };
            if (isSectionIcon(asked)) onIcon(asked);
          }}
        />
      ) : null}
    </fieldset>
  );
}
