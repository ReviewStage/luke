import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { readFailedWords, readingWords } from "@luke/features/words";
import {
  Badge,
  BUTTON_VARIANT,
  Button,
  ErrorState,
  GAP,
  HarnessMark,
  Inline,
  MARK_PROVIDER,
  type MenuRow,
  POPOVER_ALIGN,
  POPOVER_SIDE,
  POPOVER_WIDTH,
  type PopoverAlign,
  type PopoverWidth,
  ProviderMark,
  RectFloat,
  SEARCHABLE_MENU_LAYER,
  SearchableMenu,
  Spinner,
} from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useEffect, useId, useRef, useState } from "react";
import codexOneX from "../../../../packages/panel/marks/codex-16.png";
import codexTwoX from "../../../../packages/panel/marks/codex-32.png";
import codexThreeX from "../../../../packages/panel/marks/codex-48.png";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * searchable-menu.tsx -- the picker menu hung from its button at each of its
 * three widths, over synthetic repositories under their owners, the one
 * chosen checked and one that cannot be picked now saying why; a menu with
 * rows pinned under its list, one opening a submenu of efforts; and the
 * notes said in the list's place while the rows are read and once a read
 * failed, with Retry. Each closes on Escape, a pick, a second press of its
 * button, and focus leaving it, and hands the focus back to its button.
 * Then a menu embedded in a layer floated under words (`RectFloat`), as
 * the date picker's time zones are, which places it and sets its width.
 * Last, the model menu as it rises on a phone: its button marks the
 * document's root a phone's room before the menu opens, as the panel's
 * shell marks it in a narrow window (`stage-room.ts`), and takes the mark
 * off once the menu is gone, so the menu stands as a sheet from the
 * window's foot, its field unfocused until pressed, Effort opening in the
 * sheet's place and Fast switching where it stands.
 */

/** Synthetic repositories, under the owners a GitHub account would list. */
const REPOSITORIES: readonly MenuRow[] = [
  {
    id: "acme/app",
    label: "app",
    section: "acme",
    icon: <ProviderMark provider={MARK_PROVIDER.GITHUB} />,
  },
  {
    id: "acme/site",
    label: "site",
    section: "acme",
    icon: <ProviderMark provider={MARK_PROVIDER.GITHUB} />,
  },
  {
    id: "acme/infrastructure-and-deployment-scripts",
    label: "infrastructure-and-deployment-scripts",
    section: "acme",
    icon: <ProviderMark provider={MARK_PROVIDER.GITHUB} />,
    disabled: "Archived",
  },
  {
    id: "maya/dotfiles",
    label: "dotfiles",
    section: "maya",
    icon: <ProviderMark provider={MARK_PROVIDER.GITHUB} />,
  },
];

/** What a menu holds: its rows, or a note in their place, and what is pinned under them. */
interface Held {
  rows: readonly MenuRow[];
  note?: React.ReactNode;
  pinned?: boolean;
}

/** A button and the menu it opens, hung from the edge `align` names at `width`. */
function Hung({
  label,
  align,
  width,
  held,
}: {
  label: string;
  align: PopoverAlign;
  width?: PopoverWidth;
  held: Held;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // Note that the menu is held drawn through its fade, as a panel owner does, so it fades out in place.
  const drawn = useDisclosure(open);
  const [chosen, setChosen] = useState<string | undefined>("acme/app");
  const [effort, setEffort] = useState("high");
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="catalog-anchor" ref={root}>
      <Button
        ref={trigger}
        variant={BUTTON_VARIANT.OUTLINE}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        {label}
      </Button>
      {drawn.mounted && (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label="Repository"
          placeholder="Search repositories"
          rows={held.rows}
          value={chosen}
          note={held.note}
          noMatch="No repositories match"
          align={align}
          width={width}
          foot={
            held.pinned === true
              ? [
                  {
                    id: "effort",
                    label: "Effort",
                    detail: effort,
                    submenu: {
                      label: "Effort",
                      rows: [
                        { id: "low", label: "low" },
                        { id: "medium", label: "medium" },
                        { id: "high", label: "high" },
                      ],
                      value: effort,
                      onPick: setEffort,
                    },
                  },
                  // A row with a quiet mark after its label, as Start's Run on wears its Experimental tag.
                  { id: "run-on", label: "Run on", tag: <Badge>Beta</Badge>, onPress: close },
                  { id: "github", label: "Open on GitHub", onPress: close },
                ]
              : undefined
          }
          footNote={held.pinned === true ? "$1.20 spent on this agent" : undefined}
          onPick={(id) => {
            setChosen(id);
            close();
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** A menu whose read failed, which reads again on Retry and then lists its rows. */
function Failed(): React.JSX.Element {
  const [read, setRead] = useState(false);
  return (
    <Hung
      label="Failed read"
      align={POPOVER_ALIGN.START}
      held={
        read
          ? { rows: REPOSITORIES }
          : {
              rows: [],
              note: (
                <ErrorState failure={CATALOG_FAILURE} onRetry={() => setRead(true)}>
                  {readFailedWords("your repositories")}
                </ErrorState>
              ),
            }
      }
    />
  );
}

/** A menu standing in a layer floated under marked words, with no layer of its own. */
function Embedded(): React.JSX.Element {
  const words = useRef<HTMLElement>(null);
  const [chosen, setChosen] = useState<string | undefined>("acme/app");
  const menuId = useId();
  const ignore = () => undefined;
  return (
    <div className="catalog-anchor">
      <p>
        The agent works in <mark ref={words}>a repository</mark> picked from the list under it.
      </p>
      <RectFloat
        open
        anchor={() => words.current?.getBoundingClientRect()}
        side={POPOVER_SIDE.BELOW}
        width={POPOVER_WIDTH.NARROW}
      >
        <SearchableMenu
          layer={SEARCHABLE_MENU_LAYER.EMBEDDED}
          id={menuId}
          label="Repository"
          placeholder="Search repositories"
          rows={REPOSITORIES}
          value={chosen}
          noMatch="No repositories match"
          onPick={setChosen}
          onClose={ignore}
          onLeave={ignore}
        />
      </RectFloat>
    </div>
  );
}

/** The Codex mark's files, as the desktop's build copies them beside the panel. */
const CODEX_ART = { oneX: codexOneX, twoX: codexTwoX, threeX: codexThreeX };

/** The mark of the harness each synthetic model runs in. */
const CLAUDE = <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />;
const CODEX = <HarnessMark provider={MODEL_PROVIDER.OPENAI} codexArt={CODEX_ART} />;

/** What a model nothing of the reader's pays for says at its row's end. */
const CONNECT_CLAUDE = "Connect Claude";

/** Synthetic models, the newest of each family listed and the older ones found by a search. */
const MODELS: readonly MenuRow[] = [
  { id: "opus-5.5", label: "Opus 5.5", icon: CLAUDE, end: CONNECT_CLAUDE },
  { id: "fable-5.1", label: "Fable 5.1", icon: CLAUDE, end: CONNECT_CLAUDE },
  { id: "sonnet-5.5", label: "Sonnet 5.5", icon: CLAUDE, end: CONNECT_CLAUDE },
  { id: "haiku-5.5", label: "Haiku 5.5", icon: CLAUDE, end: CONNECT_CLAUDE },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", icon: CODEX },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", icon: CODEX },
  { id: "gpt-6-luna", label: "GPT-6 Luna", icon: CODEX },
  { id: "gpt-6-astra", label: "GPT-6 Astra", icon: CODEX },
  { id: "opus-5", label: "Opus 5", icon: CLAUDE, end: CONNECT_CLAUDE, searchOnly: true },
  { id: "opus-4.8", label: "Opus 4.8", icon: CLAUDE, end: CONNECT_CLAUDE, searchOnly: true },
  { id: "opus-4.7", label: "Opus 4.7", icon: CLAUDE, end: CONNECT_CLAUDE, searchOnly: true },
];

/** The efforts a model runs at, as the Effort submenu lists them. */
const EFFORTS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
  { id: "max", label: "Max" },
] as const;

/** The attribute the panel's shell marks the document's root with in a phone's layout (`stage-room.ts`). */
const ROOM_ATTRIBUTE = "data-luke-room";

/** The model menu from a button that opens it as a phone's layout does, as a sheet. */
function PhoneSheet(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const [chosen, setChosen] = useState("opus-5.5");
  const [effort, setEffort] = useState("high");
  const [fast, setFast] = useState(true);
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  // The phone's mark comes off once the sheet is gone, so the catalog's other menus hang as they do on the desktop.
  useEffect(() => {
    if (!drawn.mounted) document.documentElement.removeAttribute(ROOM_ATTRIBUTE);
  }, [drawn.mounted]);
  useEffect(() => () => document.documentElement.removeAttribute(ROOM_ATTRIBUTE), []);
  const words = EFFORTS.find((each) => each.id === effort)?.label ?? effort;
  const detail = fast ? `${words} Fast` : words;
  return (
    <div className="catalog-anchor">
      <Button
        ref={trigger}
        variant={BUTTON_VARIANT.OUTLINE}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          document.documentElement.setAttribute(ROOM_ATTRIBUTE, "narrow");
          setOpen(!open);
        }}
      >
        Model
      </Button>
      {drawn.mounted && (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label="Model"
          placeholder="Search models"
          rows={MODELS.map((row) => (row.id === chosen ? { ...row, detail } : row))}
          value={chosen}
          noMatch="No models match"
          align={POPOVER_ALIGN.START}
          foot={[
            {
              id: "effort",
              label: "Effort",
              detail: words,
              submenu: {
                label: "Effort",
                rows: EFFORTS,
                value: effort,
                onPick: (id) => {
                  close();
                  setEffort(id);
                },
              },
            },
            { id: "fast", label: "Fast", toggle: { on: fast, onToggle: () => setFast(!fast) } },
          ]}
          onPick={(id) => {
            close();
            setChosen(id);
          }}
          onClose={close}
          // Note that a sheet traps the focus, so it never says the focus left it.
          onLeave={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SearchableMenuExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="searchable-menu-widths" title="Three widths">
        <div className="catalog-popover-stage">
          <Inline gap={GAP.CONTROL}>
            <Hung
              label="Narrow"
              align={POPOVER_ALIGN.START}
              width={POPOVER_WIDTH.NARROW}
              held={{ rows: REPOSITORIES }}
            />
            <Hung label="Regular" align={POPOVER_ALIGN.START} held={{ rows: REPOSITORIES }} />
            <Hung
              label="Wide"
              align={POPOVER_ALIGN.START}
              width={POPOVER_WIDTH.WIDE}
              held={{ rows: REPOSITORIES }}
            />
          </Inline>
        </div>
      </CatalogSection>
      <CatalogSection id="searchable-menu-pinned" title="Pinned rows and a submenu">
        <div className="catalog-popover-stage">
          <Hung
            label="With a foot"
            align={POPOVER_ALIGN.START}
            held={{ rows: REPOSITORIES, pinned: true }}
          />
        </div>
      </CatalogSection>
      <CatalogSection id="searchable-menu-notes" title="Reading and a failed read">
        <div className="catalog-popover-stage">
          <Inline gap={GAP.CONTROL}>
            <Hung
              label="Reading"
              align={POPOVER_ALIGN.START}
              held={{
                rows: [],
                note: <Spinner label={readingWords("repositories")} />,
              }}
            />
            <Failed />
          </Inline>
        </div>
      </CatalogSection>
      <CatalogSection id="searchable-menu-embedded" title="Embedded in a floated layer">
        <Embedded />
      </CatalogSection>
      <CatalogSection id="searchable-menu-phone" title="On a phone, a sheet">
        <PhoneSheet />
      </CatalogSection>
    </>
  );
}

export const SEARCHABLE_MENU_EXAMPLE: Example = {
  id: "searchable-menu",
  title: "Searchable menu",
  Render: SearchableMenuExample,
};
