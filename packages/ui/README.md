# `@luke/ui`

Luke's design system: the tokens, components, and page patterns the desktop
window and the site both draw with, plus the face, glyphs, provider marks, and
the DOM-free view models more than one app reads. `CLAUDE.md` beside this file
holds the package's rules; this file is the reference for what it ships.

## Surfaces: profile, theme, density

A surface is a root or an overlay portal, and three attributes on it select
the tokens every component reads (`src/tokens/surface.ts`):

| Attribute | Values | What it chooses |
| --- | --- | --- |
| `data-luke-profile` | `PROFILE.DESKTOP`, `PROFILE.WEB` | Which app's role values: the window's density or the site's |
| `data-luke-theme` | `THEME.DARK`, `THEME.LIGHT`, `THEME.SYSTEM` | Which palette; `system` follows the Mac and is the desktop's alone |
| `data-luke-density` | `DENSITY.COMPACT` | The site's dashboard size, a step under a public page's; web only, and only with a fine pointer: on a coarse one the site's full roles stand |

The desktop's window pages (`index.html`, `call.html`) and each web entry's
`.html` set them on `<html>`,
so whatever a component portals into `document.body` is drawn at them too.
Anything that renders a root of its own spreads `surfaceAttributes(profile,
theme, density?)`, whose types refuse `system` and a density on the desktop.

An app imports the sheets after its reset and before its utilities:

```css
@import "@luke/ui/tokens.css"; /* scale, profiles, palettes, display, motion */
@import "@luke/ui/styles.css"; /* every component, in the `components` layer */
```

## Tokens

Every token is a `--luke-*` custom property under `src/tokens/`.

- **Base scale** (`scale.css`), the same in every app: `--luke-space-{0,2,4,6,8,12,16,20,24,32,40,48,64,96}`,
  `--luke-radius-{6,8,10,14,full}`, and `--luke-weight-{regular,medium,semibold,bold}`
  (400, 500, 600, 700).
- **Roles** (`profiles.css`), set by both profiles; a component reads a role,
  never a base value at its call site:

  | Role | Desktop | Web | Web, compact |
  | --- | ---: | ---: | ---: |
  | `--luke-control-height` | 30px | 44px | 32px |
  | `--luke-control-radius` | 10px | 10px | 10px |
  | `--luke-control-icon` | 16px | 16px | 16px |
  | `--luke-type-body-*` (size / leading) | 13 / 20 | 16 / 24 | 14 / 20 |
  | `--luke-type-label-*` | 13 / 18 | 14 / 20 | 13 / 18 |
  | `--luke-type-caption-*` | 12 / 16 | 12 / 16 | 12 / 16 |
  | `--luke-type-section-*` | 13 / 18 | 16 / 24 | 16 / 24 |
  | `--luke-type-dialog-*` | 15 / 20 | 20 / 28 | 20 / 28 |
  | `--luke-type-title-*` | 26 / 34 | 28 / 36 | 22 / 30 |
  | `--luke-type-group-*`, `--luke-type-tag-*` | 12 / 16 | 12 / 16 | 12 / 16 |
  | `--luke-type-toolbar-title-*` | 15 / 20 | 15 / 20 | 15 / 20 |
  | `--luke-page-inset` | 48px (24px under 480px of content) | 24px | 24px |
  | `--luke-control-gap`, `--luke-icon-gap` | 8px | 8px | 8px |
  | `--luke-field-gap`, `--luke-section-gap` | 16px | 16px | 16px |
  | `--luke-page-section-gap` | 32px | 32px | 32px |
  | `--luke-tight-gap`, `--luke-item-gap`, `--luke-block-gap` | 4 / 6 / 12px | 4 / 6 / 12px | 4 / 6 / 12px |
  | `--luke-row-inset`, `--luke-list-inset` | 8 / 12px | 8 / 12px | 8 / 12px |
  | `--luke-menu-row-height` | 32px | 44px | 32px |
  | `--luke-touch-target` | 44px | 44px | 44px |
  | `--luke-scroll-fade` | 26px | 24px | 24px |
  | `--luke-scroll-band` | 32px | 32px | 32px |

  A compact site's roles hold only with a fine pointer: on a coarse one
  (`@media not all and (pointer: coarse)` in `profiles.css`) the site's full
  roles stand, so a finger meets 44px controls and fields never under 16px,
  which iOS would zoom into. `--luke-touch-target` is the least a press is
  taken across on a coarse pointer: a `Button` or `IconButton` drawn smaller
  takes the press in a box that size centred on it (`button.css`), its glyph
  and its place unchanged.

  **One weight to a type role**, set once in `profiles.css` as
  `--luke-type-<role>-weight` and read by every component that draws the
  job: the page title, the top bar's title, a dialog's and a section's
  heading are semibold; a label (a row's name, a button's words) is medium;
  body and caption are regular. `group` is the small heading over a group of
  rows (caption size, medium, muted by default); `tag` is a badge's, a chip's,
  a tooltip's, and a compact button's words (caption size, medium);
  `emphasis` is the weight a word takes to stand out of its role's own (an
  unread row, the current page). Only a title carries tracking
  (`--luke-type-title-tracking`). A component's sheet names no weight, no
  tracking, and no pixel size of its own, and a utility reads a role's
  (`font-label`, `font-tag`, `text-group`), which `tokens/roles.test.ts`
  holds. Words that count or tell time (`Time`, `Badge`, a count part) draw
  tabular figures themselves.

  **Spacing is named by role.** A page's sections stand
  `--luke-page-section-gap` apart (`GAP.PAGE`), two groups in a pane or a
  form `--luke-section-gap` (`GAP.SECTION`), a row holds its glyph and words
  `--luke-row-inset` from its edge and a list holds its rows
  `--luke-list-inset` from its own (`INSET.COLUMN`, `INSET.BLOCK`), and the
  parts of one item stand `--luke-tight-gap`, `--luke-item-gap`, or
  `--luke-block-gap` apart. A card's inset is one of the three
  `--luke-card-inset*` roles.

  The settings-row, card, dialog, and menu roles beside them (`--luke-settings-row-*`,
  `--luke-card-*`, `--luke-dialog-*`, `--luke-menu-*`) are set the same way. `tokens.test.ts`
  holds both profiles to one set of names.
- **Palette** (`palettes.css`): semantic colours, `--luke-color-*` (`text`,
  `text-muted`, `ground`, `surface`, `overlay`, `fill-*`, `border*`, `accent*`,
  `danger*`, `focus-ring`, …), set by both profiles in both themes.
- **Display** (`display.css`): the site's marketing styles, `--luke-display-*`,
  set under the web profile only; the window has no display type.
- **Motion** (`motion-tokens.css`, generated from `@luke/brand`'s tables by
  `pnpm --filter @luke/brand generate`; `motion.css`): `--luke-duration-*`,
  `--luke-duration-shape`, `--luke-spring`, `--luke-spring-fast`, `--luke-motion-exit|pane`,
  `--luke-row-stagger`, `--luke-hint-delay`, `--luke-late-delay`,
  `--luke-confirm-delay` (how long a `SavedTick` stands, which reduced motion
  keeps, so the words stay to be read), `--luke-settle-delay` (the beat a hover
  card or a delayed spinner waits to see whether the state settles), and
  `--luke-loop-motion`, the play state an endless loop holds, and
  `--luke-face-motion`, the face's. Reduced motion zeroes the durations but
  hover's and pauses both loops. The face's own rules are `face/face.css`, and
  its motions `face/face-motion.css`, which `@luke/brand`'s
  `generate-brand-assets.mjs` writes; an app sets only the face's size where
  it lays one out. A component reads
  only `--luke-*` custom properties, directly or through the Tailwind theme.
- **Tailwind theme** (`tailwind/theme.css`, `tailwind/sources.css`):
  shadcn/ui's utility vocabulary (`bg-primary`, `text-muted-foreground`,
  `border-border`, `bg-switch-on`, …), each name an alias of a `--luke-*`
  role. An app's Tailwind entry imports both after Tailwind's own theme and
  utilities, as the desktop's `tailwind.css`, the web's `app.css`, and the
  catalog's `catalog.css` do, so the utilities `@luke/ui`'s components spell
  are compiled.
- **Placement hooks**: the few properties an app may set on a component's
  container, each the one way a measurement of the app's reaches inside.
  `--luke-combobox-list-max` caps a `ComboboxList`'s height (280px where
  unset), so a picker placed against the window's edge hands its list the
  room it found; nothing else inside the list is the app's to set.
  `--luke-glyph-size` sizes the glyph a `GlyphSlot` seats (16px where
  unset), and a component's own glyph slot sets it for the glyph an app
  hands it, a tab's or a tab card's, so a container whose glyphs stand
  larger or smaller, a review card's face, says so once.

## Built on shadcn/ui

`@luke/ui`'s controls are moving onto shadcn/ui over Base UI, one component
at a time, each behind the props it already has, so no call site changes
as it moves. A vendored shadcn component lives in `src/shadcn/`, generated
by the shadcn CLI (style `base-nova`, base `base`) and drawn in the Tailwind
theme above; the `@luke/ui` component an app imports wraps it. Moved so far:
`Switch`; `Menu` and its submenus, on Base UI's menu (`useMenu`'s
`contextMenu` stays a spread, the same menu hung at the pointer); and
`Combobox` and `Calendar`, drawn in shadcn's combobox and calendar classes
over engines of their own, since each one's caller owns what Base UI's
combobox or react-day-picker would (the open list, its filter and
highlight; a controlled `YYYY-MM-DD` month in UTC). What a component's
classes cannot say (keyframes other surfaces share, a rule a finger's
media query must outrank, the keyboard's ring) stays in its own sheet.
The text entries and form pieces, `TextField`, `TextArea`,
`SearchField`, `AddressField`, `FormField`, `InlineEdit`, and
`LengthCounter`, stand on shadcn's Input, Textarea, Label, and Field. A name the
theme adds that tailwind-merge cannot read as a size is listed in `cn.ts`, or
`cn` drops it as a second colour.

The overlays: `Dialog` and `ConfirmDialog` stand on shadcn's dialog, and
`TooltipPill` and `TooltipCard` on its tooltip and hover card, placed by
Base UI. When a hint shows and goes stays `Tooltip`'s own (`hint.tsx`), and
`AnchoredPopover` keeps its own placement (`popover-place.ts`), which holds
an open menu by the edge of the button it hangs from as that button grows;
it, `PopoverPanel`, the hover card's parts, `DrawerScrim`, and `PortalFence`
are drawn in the theme's utilities.

The buttons and toggles: `Button`, `IconButton`, and `ButtonLink` stand on
shadcn's button, which `SplitButton` and `FoldingButton` join and fold;
`LineButton` and `TextButton` on Base UI's button; `Checkbox` and `Slider` on
shadcn's checkbox and slider; `ChoiceBar` on Base UI's toggle group and
`ChoiceList` on its radio and checkbox groups, each keeping its own keys.
`Tabs` keeps its own strip, since an editor's strip, choosing with Return,
closing with Delete, and reordering, is not what Base UI's tabs are for; its
plain looks are drawn in the theme.

A component's own sheet keeps what another sheet restyles it by from the
`components` layer, which a utility would outrank (a button's
`--luke-button-*` inks, a choice row's fill under a stepped-back region), and
what Tailwind has no words for (keyframes, scroll-state and style queries).
The theme's custom variants say a control's conditions beside its states:
`pointer-coarse:`, `fold-folded:`, `fold-bare:`, `fold-tight:`, and shadcn's
`data-horizontal:` and `data-vertical:`. `cn` is told the theme's own sizes,
or tailwind-merge reads `text-label` as an ink.

The feedback and display components are drawn the same way: `Badge`,
`Avatar`, `Progress`, `Spinner`, `Skeleton`, `Banner` (shadcn's alert),
`Card`, `ScrollArea`, `Pagination`, `Breadcrumbs`, and `DataTable` (shadcn's
table) wrap their vendored sources. `Chip` and `Toast` are drawn in the
theme's utilities with no shadcn base: a chip is a press shadcn's badge does
not take, and a toast's holds, stack, and timing stay the panel's on Effect's
`Clock` (`@luke/panel`'s `toast.tsx`), which Sonner's own timers would not
keep. `ScrollArea` keeps the platform's own scroller rather than Base UI's
viewport and bars, so its scrolling, keys, and the refs callers hold on it
are what they were. A component's sheet keeps only what a utility cannot
say: keyframes, `:has()`, container queries, and rules other sheets read.

## Icons

Every icon is imported through one door, `@luke/ui/icons`, built on Lucide
(`src/icons/`): Lucide's glyphs by Lucide's own names, `GLYPH`, and
`ICON_SIZE`. Nothing outside `@luke/ui` imports `lucide-react` directly:
`anti-slop/no-lucide-outside-door` refuses it from a baseline,
`tools/anti-slop/lucide-baseline.json` (each file still importing it, with its
count), which only shrinks. A file that holds fewer imports than its row fails
until the row comes down, so the list is always what is still owed, and the
rule takes no suppression.

- **One glyph per meaning.** `GLYPH` (`glyph-registry.tsx`) names each concept
  the app draws (a task, an agent, a pull request, an issue, a repository, copy,
  stop, open externally, "Open on GitHub", ...) and the one glyph that stands
  for it. A screen asks for `GLYPH.TASK` and picks no drawing. A concept has one
  glyph and a glyph one concept: `CircleDot` is a GitHub issue and nothing else,
  and a state wears its own (`SETTLED`, `FAILED`, `DISMISSED`).
  `glyph-registry.test.ts` holds no two concepts to the same mark. A glyph a
  screen needs that no concept names is a new row there.
- **Three seats and one more.** `ICON_SIZE`: `SMALL` 12px beside a caption's
  words, `MEDIUM` 16px in a button, a tab, a chip, and a menu row, `LARGE` 20px
  as a row's lead, and `EMPTY` 40px over an empty state. `GlyphSlot` takes the
  seat (`<GlyphSlot size={ICON_SIZE.MEDIUM}><GLYPH.TASK /></GlyphSlot>`); the
  pixels are `--luke-icon-12|16|20|40` in `tokens/scale.css`, and
  `--luke-control-icon` is the 16 seat on both profiles.
- **One stroke.** Every glyph is drawn at 1.9 in its 24 box, Lucide's behind
  `lucideGlyph` (`lucide-glyph.tsx`) as `glyphs.tsx`'s own.
- **No copies.** `glyphs.tsx` holds only what no icon set draws as well.
  The 27 that were copies of Lucide's (24) or Tabler's (3) are Lucide's now
  (`lucide-glyphs.tsx`), under the names the screens still import; a name goes
  when its last screen draws the glyph through `GLYPH`.

## Using a component

Import from the barrel:

```tsx
import { BUTTON_VARIANT, Button, GAP, Inline, TEXT_ELEMENT, TEXT_VARIANT, Text } from "@luke/ui";

<Inline gap={GAP.CONTROL}>
  <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>Workspace</Text>
  <Button variant={BUTTON_VARIANT.PRIMARY} onClick={save} busy={saving} busyLabel="Saving">
    Save
  </Button>
</Inline>
```

- **Finite variants.** Every choice is an `as const` object with its type
  derived from it (`BUTTON_VARIANT` / `ButtonVariant`, `GAP` / `Gap`); pass the
  constant, never a string.
- **No `className` or `style`.** A control owns its height, padding, type, and
  states. Where it stands, and the room around it, is its container's: a
  `Stack` or `Inline` with a `GAP` role, or a page pattern. A frame that is
  no control, a `Fill` or a `Card`, keeps its owner's class only to be named
  and placed by it, never to be drawn.
- **Data and callbacks in.** A component never reaches an app's bridge, its
  network, or its shortcuts; the app's adapter hands it values and handlers.
- **A row a list engine owns.** Where a library of the app's owns a list's
  items and their keys (cmdk's palette), each item is drawn as
  `ComboboxOptionItem`, handed through the engine's `asChild`: the engine's
  role, names, handlers, and ref pass through, no class or style does, and
  the row is lit by the `aria-selected` the engine sets. The engine's list
  box is drawn the same way, as `ComboboxListBox` through its own `asChild`,
  capped or filling its column (`COMBOBOX_LIST_HEIGHT`), so the box scrolls
  as every list does and the screen's own CSS sets no `overflow`.
- **One bar for choosing one.** A row of a few options where one is chosen
  is `ChoiceBar`: Fill for headers and filters, Segmented for inline modes
  and settings; `panels` makes it a tablist over the views it switches, and
  without them it is a radio group setting a value. A count is words or
  `CountPart`s, and a diff's lines are `linesCount`'s, always green and red.
- **Heavy dependencies stay off the barrel.** The chart is `@luke/ui/chart`;
  each view model is its own subpath (`@luke/ui/<name>`, see `package.json`).

What the barrel holds (`src/index.ts`):

| Kind | Components |
| --- | --- |
| Type and layout | `Text`, `Stack`, `Inline`, `ScrollArea`, `Card`, `Prose`, `FileText`, `GlyphSlot` |
| Actions | `Button`, `IconButton`, `ButtonLink`, `FoldingButton`, `RetryButton`, `Chip`, `AttachmentChip`, `InlineRef`, `NavItem`, `NavItemLink` |
| Press shortcuts | `HoldPress`, `MarkStrip`, `CommandLink`: a pointer's second way in beside a control's own (a held press, a strip standing for a hidden rail, a ⌘-click) |
| Entry | `FormField` (with `LengthCounter`), `TextField`, `TextArea`, `SearchField`, `Checkbox`, `ChoiceList`, `Switch`, `ChoiceBar` (with `CountPart`, `linesCount`), `Combobox` (with `ComboboxList`, `ComboboxListBox`, `ComboboxOptionItem`), `Calendar` |
| Status | `Badge`, `Avatar`, `Spinner`, `BusyLabel`, `SavedTick`, `Skeleton`, `EmptyState`, `ErrorState` |
| Overlays | `Dialog`, `ConfirmDialog` (with `useConfirmDialog`), `AnchoredPopover`, `Menu` (with `useMenu`), `TooltipPill`, `TooltipCard`, `HoverCard` |
| Patterns | `PageToolbar`, `SettingsRow`, `SettingsSection` (with `SettingsRowsSkeleton`, `SettingsSectionsSkeleton`), `SettingsPage`, `ListRow`, `CollectionPage`, `DetailPage`, `AuthPage`, `PublicPage` (with `PublicSection`, `PublicMedia`) |
| Brand | `WingFace`, the glyphs (`face/glyphs.tsx`), `ProviderMark` |

Each component's design comment, at the top of its `.tsx`, says what it owns
and what it leaves to its caller.

### Skeletons

A skeleton is a component named `*Skeleton` that draws the surface it stands
for through that surface's own components (`SettingsRow`, `ListRow`, the
composer's card), with only the words, marks, and controls swapped for
`Skeleton` blocks, so it lands where the surface does and follows it when the
surface changes. Its counts, order, and sizes come from what the surface
reads: its section list, its schema, its width token. A class of the
skeleton's own, laying its blocks out, names itself one (`…-skeleton…`);
`anti-slop/skeleton-through-components` refuses any other class on an
intrinsic element inside a skeleton, and `Skeleton` or `SkeletonRegion` drawn
outside one.

### The style guard

`pnpm lint` runs `tools/anti-slop/style-guard.ts`, which reads every
stylesheet and every Tailwind class string (in `@apply`, and in the modules
under `packages/ui/src/`, `packages/panel/src/`, and each app's `src/`, tests
aside) and refuses a literal where a token goes. The token sheets
(`src/tokens/`, `src/tailwind/theme.css`) and any `:root` block, where a token
is defined, are not read. A Tailwind utility passes where this theme maps its
name onto a token (`text-body`, `rounded-menu`, `ease-pane`, `bg-primary`) and
is refused where it reaches Tailwind's own scale (`text-sm`, `font-medium`,
`rounded-md`, `bg-red-500`).

| Rule | Refuses | How to fix one |
| --- | --- | --- |
| `literal-colour` | A hex, `rgb()`, `hsl()`, `oklch()`, or `color()` colour, or a palette utility | Read the palette role (`--luke-color-*`, `bg-primary`); a colour the palette lacks is added to `palettes.css`. A provider mark's brand ink (`.integration-mark-*`), a mask's alpha, and a terminal's or code theme's ink (`--terminal-*`, `--code-*`, `--integration-ink-*`) pass |
| `literal-type` | A literal `font-size`, `font-weight`, or `font`, or `text-sm`, `font-medium`, `text-[13px]` | Draw the words with `Text`, or read a type role (`--luke-type-*-size`, `--luke-weight-*`, `text-body`) |
| `literal-radius` | A literal corner, `50%` among them, or `rounded`, `rounded-md` | Read a radius role (`--luke-control-radius`, `--luke-radius-full`, `rounded-menu`); a factor of a role (`calc(var(--luke-control-height) / 2)`) passes |
| `ellipsis` | `text-overflow: ellipsis`, `truncate`, `text-ellipsis` | A cut line fades rather than ending in "…": mask the end it is cut at, `mask-image: linear-gradient(to left, transparent, #000 var(--luke-label-fade))`, as `Chip` and `ListRow` do |
| `literal-duration` | A literal duration or delay, or `duration-150` | Read a motion token (`--luke-duration-*`, `--luke-*-delay`). An endless loop whose `animation-play-state` answers `--luke-loop-motion` or `--luke-face-motion` may keep its literal |
| `literal-easing` | `ease`, `linear`, `cubic-bezier()`, `steps()` in a transition or animation, or `ease-in-out` | Read `--luke-spring`, `--luke-spring-fast`, `--luke-motion-exit`, or `--luke-motion-pane`; a hover's `ease` is the default, so drop it |

No comment silences it, and it refuses one that asks to
(`style-guard-disable`); the face's generated `face/face-motion.css` is the one
file a rule passes whole. A rule that had places left when it landed starts
from a baseline that may only shrink: `tools/anti-slop/style-baselines/<rule>.json`
counts each file's places, and the guard fails on a file holding more than its
count and on a count above what the file still holds. So the change that fixes a
place lowers its count; `node tools/anti-slop/style-guard.ts --shrink` lowers
every count to what the files hold and never raises one. A rule that started
clean (`literal-duration`) takes no baseline at all, and a baseline is deleted
from nothing: once every count is gone, its file is `{}`.

### Folding in a narrow container

A container short of room folds the controls in it with one inherited custom
property, set from its own container query, and owns nothing inside them;
each control answers it with a style query of its own:

| `--luke-fold` | What answers it |
| --- | --- |
| `folded` | A `FoldingButton`'s words, and a `SplitButton` main part's, fold away, leaving the glyph and the name; a `SearchField`'s tally is said rather than drawn |
| `bare` | A `SplitButton` is its main part's glyph alone, at the control's corner, with no chevron |

## Adding a component

A component lands whole in one change:

1. **Module.** `src/components/<name>/<name>.tsx`: line one names it, a design
   comment says what it owns, its variants are `as const` objects with derived
   types, and its props take no `className` or `style`.
2. **Stylesheet.** `src/components/<name>/<name>.css`: `luke-<name>*` classes
   inside `@layer components`, reading only `--luke-*` roles and palette.
   Import it from `src/styles.css`, where order is cascade order. A role a
   component needs that the profiles lack is added to both profiles in
   `profiles.css`.
3. **Barrel.** `export * from "./components/<name>/<name>.js";` in
   `src/index.ts`, alphabetically.
4. **Catalog example.** `apps/catalog/src/examples/<name>.tsx` exports an
   `Example` (`{ id, title, Render }`) drawing every state on synthetic data,
   grouped in `CatalogSection`s; list it in `apps/catalog/src/examples.ts`.
5. **Tests.** `src/components/<name>/<name>.test.ts`, under
   `// @vitest-environment jsdom`: mount through the public export and assert
   what a user meets (roles, names, shown text, focus, clicks and keys, the
   value a callback receives). Do not assert classes, styles, or `data-`
   attributes.

```sh
pnpm exec vitest run packages/ui/src/components/<name>
```

## The catalog

`apps/catalog` draws every example at both profiles, in both themes, offline.
The address is the whole view:
`?example=<id>&profile=desktop|web&theme=dark|light`, plus `&density=compact`
for the site's compact surface.

```sh
pnpm --filter @luke/catalog dev     # serve it with Vite
pnpm --filter @luke/catalog build   # a static folder under apps/catalog/dist
```
