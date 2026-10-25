import { readFailedWords, readingWords } from "@luke/features/words";
import {
  Badge,
  BUTTON_VARIANT,
  Button,
  ErrorState,
  GAP,
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
import { useId, useRef, useState } from "react";
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
 * Last, a menu embedded in a layer floated under words (`RectFloat`), as
 * the date picker's time zones are, which places it and sets its width.
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
                <ErrorState onRetry={() => setRead(true)}>
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
    </>
  );
}

export const SEARCHABLE_MENU_EXAMPLE: Example = {
  id: "searchable-menu",
  title: "Searchable menu",
  Render: SearchableMenuExample,
};
