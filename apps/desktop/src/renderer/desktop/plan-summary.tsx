import { ChevronsLeftIcon, ListIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { shownFiles } from "../planning/code-pane-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { workRowsOf } from "../planning/work-model";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import { AGENTS_SECTION, agentEntries } from "./main-tabs";
import { paneTiming } from "./pane-motion";
import { ADD_SECTION, panelEntries, planWorkers } from "./side-panel";
import type { AddEntry } from "./strip-tabs";

/**
 * plan-summary.tsx -- the open plan's summary at its column's right: everything the plan's two "+" menus open, at a glance, pinned beside the document, folded to a rail of glyphs, or hung over the column as a card.
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
 * With the side panel shut it stands pinned at the column's right, as
 * Cursor's does: borderless on the column's own ground, the document or the
 * agent's transcript, and the call bar's row under them, centred again in
 * the room it leaves. Where the plan's area is too narrow to keep the
 * document at its measure beside it, it folds to a rail of the glyphs alone,
 * each naming itself in its hint, whose chevron hangs the whole summary
 * over the column as a card. With the panel open the panel says what the
 * summary would, so nothing is pinned, and the toolbar's button hangs the
 * card instead, as ChatGPT's does. The card goes on Escape, on a row
 * chosen, or on a press anywhere outside it, which still lands where it was
 * pressed. Whether it stands pinned is the window's preference, kept in the
 * renderer's storage as the sidebar's fold is, and a fixture run keeps none.
 *
 * Pinning or unpinning it changes the column's layout at once: the content
 * glides to its new middle and the summary slides in from the window's
 * right (pane-motion.tsx), and out again through its own exit, held drawn
 * until it has played.
 */

/** The storage key the pin is kept under. */
const SUMMARY_PINNED_KEY = "luke.summary-pinned";

/**
 * The least width of the plan's area, in CSS pixels, at which the summary
 * stands as a column rather than a rail: the document's measure and its page
 * insets either side (desktop.css's `--reading-width`, 720, and
 * `--page-inset`, 40) beside the column's own `--summary-width`, 240, so
 * making room for it never reads the document under its measure. Note that
 * the area is measured whole, the summary included, so the summary's own
 * width never moves the area it is measured against.
 */
const SUMMARY_WIDE = 1040;

/** How the summary stands in the plan's column. */
const SUMMARY_MODE = {
  HIDDEN: "hidden",
  COLUMN: "column",
  RAIL: "rail",
} as const;

type SummaryMode = (typeof SUMMARY_MODE)[keyof typeof SUMMARY_MODE];

/** What hung the card: the toolbar's button over an open side panel, or the rail's chevron. */
const CARD_FROM = {
  PANEL: "panel",
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

/** Whether the summary stands pinned while the side panel is shut, and the press that turns it. */
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
  card: boolean;
  /** The toolbar's button: the card over an open panel, else the pin. */
  onToggle: () => void;
  /** The rail's chevron, which hangs the card or takes it down. */
  onExpand: () => void;
  onDismiss: () => void;
}

/**
 * How the summary stands in the plan's `area`, measured whole: pinned as a
 * column while the panel is shut and the area holds it beside the
 * document's measure, a rail while it does not, and hidden while the panel
 * is open or the developer unpinned it. A card hangs only where it was
 * hung from, so a panel opened or shut under it takes it down. An area not
 * laid out, hidden or not yet drawn, measures nothing and changes nothing.
 */
export function useSummaryLayout(
  pin: SummaryPin,
  panelOpen: boolean,
  area: HTMLElement | null,
): SummaryLayout {
  const [wide, setWide] = useState(true);
  const [cardFrom, setCardFrom] = useState<CardFrom | undefined>(undefined);
  useLayoutEffect(() => {
    if (area === null) return;
    const measure = () => {
      const width = area.getBoundingClientRect().width;
      if (width > 0) setWide(width >= SUMMARY_WIDE);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [area]);
  const mode =
    panelOpen || !pin.pinned ? SUMMARY_MODE.HIDDEN : wide ? SUMMARY_MODE.COLUMN : SUMMARY_MODE.RAIL;
  const from = panelOpen
    ? CARD_FROM.PANEL
    : mode === SUMMARY_MODE.RAIL
      ? CARD_FROM.RAIL
      : undefined;
  const card = from !== undefined && cardFrom === from;
  const toggleCard = (asked: CardFrom) => setCardFrom(card ? undefined : asked);
  const onDismiss = useCallback(() => setCardFrom(undefined), []);
  return {
    mode,
    card,
    onToggle: () => (panelOpen ? toggleCard(CARD_FROM.PANEL) : pin.onToggle()),
    onExpand: () => toggleCard(CARD_FROM.RAIL),
    onDismiss,
  };
}

/**
 * The toolbar's button, after the ⋯ menu. With the panel shut it pins the
 * summary or takes it away, and says which it is; with the panel open it
 * hangs the card under itself or takes it down.
 */
export function SummaryButton({
  layout,
  pinned,
  panelOpen,
  cardId,
}: {
  layout: SummaryLayout;
  pinned: boolean;
  panelOpen: boolean;
  cardId: string;
}): React.JSX.Element {
  const label = panelOpen ? "Toggle summary" : "Toggle pinned summary";
  const state = panelOpen
    ? {
        "aria-haspopup": "dialog" as const,
        "aria-expanded": layout.card,
        "aria-controls": layout.card ? cardId : undefined,
      }
    : { "aria-pressed": pinned };
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        {...state}
        data-summary-opener=""
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

/** A row of the column or the card: its glyph and its label, faded at its end where it is cut short. */
function SummaryRow({ entry, onPick }: { entry: AddEntry; onPick: () => void }) {
  const [words, clipped] = useClipped();
  return (
    <li>
      <button type="button" className="plan-summary-row" onClick={onPick}>
        <span className="plan-summary-glyph">{entry.row.icon}</span>
        <span ref={words} className="plan-summary-label" data-overflow={String(clipped)}>
          {entry.row.label}
        </span>
      </button>
    </li>
  );
}

/** A row of the rail: its glyph alone, naming itself to a reader and in its hint. */
function RailRow({ entry }: { entry: AddEntry }) {
  return (
    <li>
      <Tooltip label={entry.row.label}>
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
 * The card, hung at the column's top right, under the toolbar's button, over
 * whatever the column shows. It takes the focus as it hangs, so the keys
 * reach its rows, and gives it to the control that hung it when Escape
 * takes it down. A press anywhere outside it takes it down too, and still lands
 * where it was pressed, but one on a control that hangs it is that
 * control's to answer.
 */
function SummaryCard({
  id,
  sections,
  onDismiss,
}: {
  id: string;
  sections: readonly SummarySection[];
  onDismiss: () => void;
}): React.JSX.Element {
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = card.current;
    (element?.querySelector<HTMLElement>("button") ?? element)?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const press = (event: PointerEvent) => {
      const { target } = event;
      if (!(target instanceof Element) || card.current?.contains(target)) return;
      if (target.closest(OPENER) === null) onDismiss();
    };
    // Note that the window's own Escape steps back a layer (app.tsx), so the
    // card claims the press before it is heard there, and hands the focus to
    // the control that hung it, which names it.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const opener = [...document.querySelectorAll<HTMLElement>(OPENER)].find(
        (control) => control.getAttribute("aria-controls") === id,
      );
      onDismiss();
      opener?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [id, onDismiss]);
  return (
    <div
      ref={card}
      id={id}
      className="plan-summary-card"
      role="dialog"
      aria-label="Summary"
      tabIndex={-1}
    >
      <SummaryList sections={sections} onPicked={onDismiss} />
    </div>
  );
}

/** The summary as the column draws it: the mode asked for, or, while its exit plays, the one it is leaving, which `onLeft` lets go of. */
interface SummaryDrawing {
  drawn: SummaryMode;
  leaving: boolean;
  onLeft: () => void;
}

function useSummaryDrawing(mode: SummaryMode): SummaryDrawing {
  const [last, setLast] = useState(mode);
  const [held, setHeld] = useState<SummaryMode | undefined>(undefined);
  if (last !== mode) {
    setLast(mode);
    setHeld(mode === SUMMARY_MODE.HIDDEN ? (held ?? last) : undefined);
  }
  const onLeft = useCallback(() => setHeld(undefined), []);
  return { drawn: held ?? mode, leaving: held !== undefined, onLeft };
}

/**
 * The summary in the plan's column: pinned as a column or a rail, and the
 * card while it hangs. A summary on its way out stands over the column
 * rather than beside it, so the column has its room back at once to glide
 * into.
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
  const { drawn, leaving, onLeft } = useSummaryDrawing(layout.mode);
  const aside = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = aside.current;
    if (!leaving || element === null) return;
    const timing = paneTiming(element);
    if (timing === undefined) {
      onLeft();
      return;
    }
    const from = getComputedStyle(element).transform;
    const exit = element.animate(
      [{ transform: from === "none" ? "none" : from }, { transform: "translateX(100%)" }],
      { ...timing, fill: "forwards" },
    );
    exit.onfinish = onLeft;
    return () => exit.cancel();
  }, [leaving, onLeft]);
  const sections = summarySections(plans);
  const rail = drawn === SUMMARY_MODE.RAIL;
  return (
    <>
      {drawn === SUMMARY_MODE.HIDDEN ? null : (
        <aside
          ref={aside}
          className="plan-summary"
          aria-label="Summary"
          data-mode={drawn}
          data-leaving={leaving ? "" : undefined}
          inert={leaving}
        >
          {rail ? (
            <>
              <Tooltip label="Expand summary">
                <button
                  type="button"
                  className="icon-button plan-summary-expand"
                  aria-label="Expand summary"
                  aria-haspopup="dialog"
                  aria-expanded={layout.card}
                  aria-controls={layout.card ? cardId : undefined}
                  data-summary-opener=""
                  onClick={layout.onExpand}
                >
                  <ChevronsLeftIcon />
                </button>
              </Tooltip>
              {sections.map(({ heading, entries }) => (
                <ul key={heading} className="plan-summary-rows" aria-label={heading}>
                  {entries.map((entry) => (
                    <RailRow key={entry.row.id} entry={entry} />
                  ))}
                </ul>
              ))}
            </>
          ) : (
            <SummaryList sections={sections} />
          )}
        </aside>
      )}
      {layout.card ? (
        <SummaryCard id={cardId} sections={sections} onDismiss={layout.onDismiss} />
      ) : null}
    </>
  );
}
