import { ChevronsLeftIcon, ChevronsRightIcon, ListIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { shownFiles } from "../planning/code-pane-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { workRowsOf } from "../planning/work-model";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import { AGENTS_SECTION, agentEntries } from "./main-tabs";
import { ADD_SECTION, panelEntries, planWorkers } from "./side-panel";
import type { AddEntry } from "./strip-tabs";

/**
 * plan-summary.tsx -- the open plan's summary at its column's right: everything the plan's two "+" menus open, at a glance, pinned beside the document or folded to a rail of glyphs that expands in place as a card.
 *
 * The summary lists what the side panel's "+" and the plan's column's "+"
 * open, in their rows' words and glyphs (`panelEntries`, `agentEntries`),
 * under quiet headings: the panel's kinds the plan has used, its coding
 * agents, its subagents, and the files Luke showed on it. An agent or a
 * subagent wears where it stands on its glyph, as its tab does, since no
 * tab stands beside the row to say it. A row opens what it names exactly as
 * its "+" row does: a kind, a subagent, or a file opens the side panel on
 * its tab, and an agent chooses its tab in the column.
 *
 * It is always drawn, expanded or collapsed, and never hidden. Expanded and
 * where the column has room to keep the document at its measure beside it,
 * side panel open or shut, it stands pinned at the column's right, as
 * Cursor's does: borderless on the column's own ground, the document or the
 * agent's transcript, and the call bar's row under them, centred again in
 * the room it leaves. Collapsed, or where the column has no such room, it is
 * a rail of the panel's kinds alone, each naming itself in its hint, under a
 * chevron that pins it again where it fits and otherwise hangs the whole
 * summary as a card over the rail's own footprint, the rail expanding in
 * place, with its own chevron back on the spot the rail's stood. The card
 * goes on that chevron, on Escape, on a row chosen, or on a press anywhere
 * outside it, which still lands where it was pressed. Whether it is pinned
 * is the window's preference, kept in the renderer's storage as the
 * sidebar's fold is, and a fixture run keeps none.
 *
 * Pinning or collapsing it changes the column's layout at once: the content
 * glides to its new middle and the summary to its new edge (pane-motion.tsx).
 */

/**
 * The storage key the pin is kept under. Note that a `false` kept from when
 * unpinning hid the summary now reads collapsed, the nearest thing to hidden
 * the summary still has.
 */
const SUMMARY_PINNED_KEY = "luke.summary-pinned";

/**
 * The least width of the plan's column, in CSS pixels, at which the summary
 * can stand pinned rather than as a rail: the document's measure and its page
 * insets either side (desktop.css's `--reading-width`, 720, and
 * `--page-inset`, 40) beside the column's own `--summary-width`, 240, so
 * making room for it never reads the document under its measure. Note that
 * the column is measured whole, the summary included, and the side panel
 * beside it is not, so an open panel narrows what is measured and the
 * summary's own width never moves it.
 */
const SUMMARY_WIDE = 1040;

/** How the summary stands in the plan's column. */
const SUMMARY_MODE = {
  COLUMN: "column",
  RAIL: "rail",
} as const;

type SummaryMode = (typeof SUMMARY_MODE)[keyof typeof SUMMARY_MODE];

/** What hung the card, which takes the focus back when Escape or its chevron takes the card down. */
const CARD_FROM = {
  TOOLBAR: "toolbar",
  RAIL: "rail",
} as const;

type CardFrom = (typeof CARD_FROM)[keyof typeof CARD_FROM];

/** The heading over the side panel's kinds, which their "+" menu lists under none. */
const PANELS_SECTION = "Panels";

/** The summary's headings, in the order it lists them. */
const SECTION_ORDER = [
  PANELS_SECTION,
  AGENTS_SECTION,
  ADD_SECTION.SUBAGENTS,
  ADD_SECTION.FILES,
] as const;

/** What the summary says on a plan that holds nothing yet to list. */
const NOTHING_YET_LINE = "Board, code, agents, and files appear here as you plan.";

/** The controls that hang the card, so a press on one toggles it rather than dismissing it first. */
const OPENER = "[data-summary-opener]";

/** Whether the summary stands pinned where it fits, rather than collapsed to its rail, and the press that turns it. */
export interface SummaryPin {
  pinned: boolean;
  onToggle: () => void;
}

/** The kept pin, or pinned where there is none or storage refuses the read. */
function readPinned(): boolean {
  try {
    return window.localStorage.getItem(SUMMARY_PINNED_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * The pin, kept across launches. A fixture run starts pinned and keeps
 * nothing, so its frames never wear a developer's own choice.
 */
export function useSummaryPin(fixtureMode: boolean): SummaryPin {
  const [kept, setKept] = useState(readPinned);
  const [staged, setStaged] = useState(true);
  const onToggle = useCallback(
    () => (fixtureMode ? setStaged : setKept)((was) => !was),
    [fixtureMode],
  );
  // A write that fails costs only the preference, so it is not worth a word on screen.
  useEffect(() => {
    try {
      window.localStorage.setItem(SUMMARY_PINNED_KEY, String(kept));
    } catch {
      // The summary keeps working on the pin it holds.
    }
  }, [kept]);
  return { pinned: fixtureMode ? staged : kept, onToggle };
}

/** How the summary stands now, whether its card hangs, and the presses that change either. */
export interface SummaryLayout {
  mode: SummaryMode;
  /** Whether the column has room for the summary pinned, which is what the toolbar's button turns. */
  wide: boolean;
  /** What hung the card, while it hangs. */
  card: CardFrom | undefined;
  /** The toolbar's button: the pin where the summary fits, else the card. */
  onToggle: () => void;
  /** The rail's chevron, which does what the toolbar's button does. */
  onExpand: () => void;
  onDismiss: () => void;
}

/**
 * How the summary stands in the plan's `column`, measured whole: pinned
 * while it is pinned and the column holds it beside the document's measure,
 * and a rail otherwise. A card hangs only over a rail that cannot be pinned,
 * so a column grown wide enough takes it down. A column not laid out,
 * hidden or not yet drawn, measures nothing and changes nothing.
 */
export function useSummaryLayout(pin: SummaryPin, column: HTMLElement | null): SummaryLayout {
  const [wide, setWide] = useState(true);
  const [hung, setHung] = useState<CardFrom | undefined>(undefined);
  useLayoutEffect(() => {
    if (column === null) return;
    const measure = () => {
      const width = column.getBoundingClientRect().width;
      if (width > 0) setWide(width >= SUMMARY_WIDE);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, [column]);
  if (wide && hung !== undefined) setHung(undefined);
  const card = wide ? undefined : hung;
  const expand = (from: CardFrom) =>
    wide ? pin.onToggle() : setHung(card === undefined ? from : undefined);
  const onDismiss = useCallback(() => setHung(undefined), []);
  return {
    mode: wide && pin.pinned ? SUMMARY_MODE.COLUMN : SUMMARY_MODE.RAIL,
    wide,
    card,
    onToggle: () => expand(CARD_FROM.TOOLBAR),
    onExpand: () => expand(CARD_FROM.RAIL),
    onDismiss,
  };
}

/**
 * The toolbar's button, after the ⋯ menu, drawn on while the summary is
 * expanded, pinned or hung. Where the summary fits it pins it or collapses
 * it to its rail, and says which it is; where it does not it hangs the card
 * over the rail or takes it down.
 */
export function SummaryButton({
  layout,
  cardId,
}: {
  layout: SummaryLayout;
  cardId: string;
}): React.JSX.Element {
  const label = layout.wide ? "Toggle pinned summary" : "Toggle summary";
  const state = layout.wide
    ? { "aria-pressed": layout.mode === SUMMARY_MODE.COLUMN }
    : {
        "aria-haspopup": "dialog" as const,
        "aria-expanded": layout.card !== undefined,
        "aria-controls": layout.card === undefined ? undefined : cardId,
      };
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="icon-button summary-toggle"
        aria-label={label}
        {...state}
        data-summary-opener={CARD_FROM.TOOLBAR}
        onClick={layout.onToggle}
      >
        <ListIcon />
      </button>
    </Tooltip>
  );
}

/** A heading and the rows under it. */
interface SummarySection {
  heading: string;
  entries: readonly AddEntry[];
}

/** What the summary lists, under its headings in their order, each heading only where it has a row. */
function summarySections(plans: PlansControl): SummarySection[] {
  const { sidePanel, mainTabs, agents, work } = plans;
  const workers = planWorkers(work.turns, workRowsOf(work.turns, work.callLive));
  const entries = [
    ...panelEntries({
      panel: sidePanel,
      kinds: sidePanel.used,
      workers,
      files: shownFiles(plans.shownCode ?? []),
      standing: true,
    }),
    ...agentEntries(mainTabs, agents, true),
  ];
  return SECTION_ORDER.flatMap((heading) => {
    const own = entries.filter((entry) => (entry.row.section ?? PANELS_SECTION) === heading);
    return own.length === 0 ? [] : [{ heading, entries: own }];
  });
}

/** A row of the column or the card: its glyph, its label, and what tells it apart, a file's folder, as its "+" row says it, faded at its end where it is cut short. */
function SummaryRow({ entry, onPick }: { entry: AddEntry; onPick: () => void }) {
  const [words, clipped] = useClipped();
  return (
    <li>
      <button type="button" className="plan-summary-row" onClick={onPick}>
        <span className="plan-summary-glyph">{entry.row.icon}</span>
        <span ref={words} className="plan-summary-label" data-overflow={String(clipped)}>
          {entry.row.label}
          {entry.row.detail === undefined ? null : (
            <span className="plan-summary-detail">{entry.row.detail}</span>
          )}
        </span>
      </button>
    </li>
  );
}

/** A row of the rail: its glyph alone, naming itself to a reader and in its hint, a file's hint its whole path, which its "+" row is searched by. */
function RailRow({ entry }: { entry: AddEntry }) {
  return (
    <li>
      <Tooltip label={entry.row.terms?.[0] ?? entry.row.label}>
        <button type="button" className="icon-button" onClick={entry.onPick}>
          <span className="plan-summary-glyph">{entry.row.icon}</span>
          <span className="visually-hidden">{entry.row.label}</span>
        </button>
      </Tooltip>
    </li>
  );
}

/** The summary's headings and rows, as the column and the card list them; `onPicked` hears a row chosen before it opens. */
function SummaryList({
  sections,
  onPicked,
}: {
  sections: readonly SummarySection[];
  onPicked?: () => void;
}): React.JSX.Element {
  if (sections.length === 0) return <p className="plan-summary-empty">{NOTHING_YET_LINE}</p>;
  return (
    <>
      {sections.map(({ heading, entries }) => (
        <div key={heading} className="plan-summary-section">
          <p className="plan-summary-heading">{heading}</p>
          <ul className="plan-summary-rows" aria-label={heading}>
            {entries.map((entry) => (
              <SummaryRow
                key={entry.row.id}
                entry={entry}
                onPick={() => {
                  onPicked?.();
                  entry.onPick();
                }}
              />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/**
 * The card, hung over the rail's footprint, its top and right edges the
 * rail's, over whatever the column shows, and its chevron, drawn while the
 * pointer is on the card, on the very spot of the rail's own, so the
 * pointer that expanded it collapses it without moving. It takes the focus
 * as it hangs, so the keys reach its rows, and gives it to the control that
 * hung it when Escape or its chevron takes it down. A press anywhere
 * outside it takes it down too, and still lands where it was pressed, but
 * one on a control that hangs it is that control's to answer.
 */
function SummaryCard({
  id,
  from,
  sections,
  onDismiss,
}: {
  id: string;
  from: CardFrom;
  sections: readonly SummarySection[];
  onDismiss: () => void;
}): React.JSX.Element {
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = card.current;
    (element?.querySelector<HTMLElement>(".plan-summary-row") ?? element)?.focus({
      preventScroll: true,
    });
  }, []);
  const collapse = useCallback(() => {
    const opener = document.querySelector<HTMLElement>(`[data-summary-opener="${from}"]`);
    onDismiss();
    opener?.focus({ preventScroll: true });
  }, [from, onDismiss]);
  useEffect(() => {
    const press = (event: PointerEvent) => {
      const { target } = event;
      if (!(target instanceof Element) || card.current?.contains(target)) return;
      if (target.closest(OPENER) === null) onDismiss();
    };
    // Note that the window's own Escape mutes a call or steps back a layer
    // (app.tsx), so the card keeps the press, as a menu does, before it is
    // heard there.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      collapse();
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [collapse, onDismiss]);
  return (
    <div
      ref={card}
      id={id}
      className="plan-summary-card"
      role="dialog"
      aria-label="Summary"
      tabIndex={-1}
    >
      <Tooltip label="Collapse summary">
        <button
          type="button"
          className="icon-button plan-summary-collapse"
          aria-label="Collapse summary"
          onClick={collapse}
        >
          <ChevronsRightIcon />
        </button>
      </Tooltip>
      <SummaryList sections={sections} onPicked={onDismiss} />
    </div>
  );
}

/**
 * The summary in the plan's column, pinned or as its rail, and the card
 * while it hangs. The rail lists the panel's kinds alone, one glyph after
 * another under its chevron at one even step, since a glyph tells an agent,
 * a subagent, or a file from its neighbours by nothing a reader could tell
 * at a glance.
 */
export function PlanSummary({
  plans,
  layout,
  cardId,
}: {
  plans: PlansControl;
  layout: SummaryLayout;
  cardId: string;
}): React.JSX.Element {
  const sections = summarySections(plans);
  const kinds = sections.find(({ heading }) => heading === PANELS_SECTION)?.entries ?? [];
  return (
    <>
      <aside className="plan-summary" aria-label="Summary" data-mode={layout.mode}>
        {layout.mode === SUMMARY_MODE.RAIL ? (
          <>
            <Tooltip label="Expand summary">
              <button
                type="button"
                className="icon-button"
                aria-label="Expand summary"
                {...(layout.wide
                  ? {}
                  : {
                      "aria-haspopup": "dialog" as const,
                      "aria-expanded": layout.card !== undefined,
                      "aria-controls": layout.card === undefined ? undefined : cardId,
                    })}
                data-summary-opener={CARD_FROM.RAIL}
                onClick={layout.onExpand}
              >
                <ChevronsLeftIcon />
              </button>
            </Tooltip>
            {kinds.length === 0 ? null : (
              <ul className="plan-summary-rows" aria-label={PANELS_SECTION}>
                {kinds.map((entry) => (
                  <RailRow key={entry.row.id} entry={entry} />
                ))}
              </ul>
            )}
          </>
        ) : (
          <SummaryList sections={sections} />
        )}
      </aside>
      {layout.card === undefined ? null : (
        <SummaryCard
          id={cardId}
          from={layout.card}
          sections={sections}
          onDismiss={layout.onDismiss}
        />
      )}
    </>
  );
}
