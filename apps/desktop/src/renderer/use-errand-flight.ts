import type { AppSettingsView } from "@sidecar/settings/wire";
import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";
import {
  armErrand,
  EMPTY_ERRAND_RUN,
  type ErrandHold,
  type ErrandRun,
  errandBorrowedPanel,
  errandRunIdle,
  errandWait,
  finishErrand,
  flushErrands,
  landErrand,
  nextErrand,
  type PendingErrand,
} from "./errand-queue";
import type { Errand } from "./luke-errand";
import { PANEL_PRESENTATION, type PanelPresentation } from "./panel-state";
import type { PanelTab } from "./panel-tabs";
import type { SessionArrangement } from "./session-model";
import type { SettingsView } from "./settings-views";
import { appSettingsNow } from "./use-app-state";

export interface UseErrandFlightOptions {
  /** The settings the panel draws, which a flight holds back and releases. */
  holdSettings: Dispatch<SetStateAction<AppSettingsView | undefined>>;
  /** Draws a narrowing or re-ordering the flight was holding back. */
  applyView: (view: Partial<SessionArrangement>) => void;
  /** Opens the field a landed query fills. */
  openSearchField: () => void;
  changeTab: (tab: PanelTab) => void;
  setSettingsView: (view: SettingsView) => void;
  tabNow: () => PanelTab;
  settingsViewNow: () => SettingsView;
  presentationOf: () => PanelPresentation;
  pointerInside: () => boolean;
  heldAgainstPointer: () => boolean;
  cancelHover: () => void;
  settle: () => void;
}

export interface ErrandFlight {
  /** The flight on screen, while Luke is out signing something. */
  errand: Errand | undefined;
  /** Freezes the drawn settings before the write that is about to move them. */
  deferSettings: () => void;
  /** Draws what the panel was not drawing yet, because Luke had not reached it. */
  drawHold: (hold: ErrandHold) => void;
  /** Adds an action to the run, and sends Luke off if he is not already out. */
  arm: (pending: PendingErrand) => void;
  /** The tap has landed, so the action in the air may finally be drawn. */
  onLanded: () => void;
  /** The way home is over: the next act flies, or the panel stands back down. */
  onReturned: () => void;
}

/**
 * Luke crossing his own panel to sign the controls a reply moved: the run of
 * acts waiting on him, the drawing each one holds back until he arrives, and
 * the panel a flight borrowed and has to give back.
 */
export function useErrandFlight(options: UseErrandFlightOptions): ErrandFlight {
  const {
    holdSettings,
    applyView,
    openSearchField,
    changeTab,
    setSettingsView,
    tabNow,
    settingsViewNow,
    presentationOf,
    pointerInside,
    heldAgainstPointer,
    cancelHover,
    settle,
  } = options;
  const [errand, setErrand] = useState<Errand>();
  /**
   * How many errands Luke has run. Carried with each one so that asking for
   * the same control twice flies twice, exactly as a repeated face gesture is
   * replayed by counting its plays.
   */
  const errands = useRef(0);

  /**
   * Every action this reply asked Luke to sign, in the order he will sign them.
   * One flight at a time: a second action handed straight to the flight ends the
   * first one mid-air, which is both switches flipping at once with nobody
   * seen doing either.
   */
  const errandRun = useRef<ErrandRun>(EMPTY_ERRAND_RUN);

  /**
   * Stops the panel following the document's settings, from before the write
   * that is about to move them: the store answers before the errand is even
   * armed, and the switch Luke is on his way to move has to still read as it
   * did when he set off. A freeze already standing is kept, because the run
   * signs its actions in turn and the oldest is the one still owed its tap.
   */
  const deferSettings = useCallback(() => {
    holdSettings((held) => held ?? appSettingsNow());
  }, [holdSettings]);

  /**
   * Draws what the panel was not drawing yet, because Luke had not reached it.
   *
   * The change itself is made the moment it is asked for — nothing here delays
   * a write, and the spoken answer reports what actually happened. What waits
   * is only the drawing of it: a switch that has already flipped, or a list
   * already narrowed, by the time Luke arrives makes the action look like
   * something he flew over to inspect, and the whole point of the errand is
   * that he is the one doing it. Both kinds wait, because both are the same
   * mistake — the settings snapshot the store answered with, and the narrowing
   * or re-ordering a spoken ask chose for the list.
   *
   * A hold belongs to the action that caught it rather than to the app, because
   * one reply can ask for several actions and each has its own switch to move.
   * They ride the run in {@link errandRun}, which is a ref rather than state:
   * the callbacks that release them have to stay stable across the whole
   * flight they are timing, and an errand whose callbacks changed identity
   * would be torn down and rebuilt mid-air.
   */
  const drawErrandHold = useCallback(
    (hold: ErrandHold) => {
      if (hold.settings !== undefined) holdSettings(hold.settings);
      // Folded into whatever the view is at the moment it lands rather than the
      // moment it was chosen: the list corrects its own filter during render
      // when one empties, and a snapshot taken at the ask would undo that.
      const view = hold.view;
      if (view !== undefined) applyView(view);
      // A query landing opens the field it fills, on the rule the field's own
      // closing keeps: a narrowing in force behind no visible control would
      // hide sessions with nothing on screen admitting it.
      if (view?.query) openSearchField();
      // The panel goes back on the document's own settings once nothing is
      // left to sign: every hold this run caught has been drawn by then, and
      // the newest word — including a change another window made mid-flight
      // — is the document's.
      if (errandRunIdle(errandRun.current)) holdSettings(undefined);
    },
    [applyView, holdSettings, openSearchField],
  );

  /** The tap has landed, so the act in the air may finally be drawn. */
  const releaseErrandChange = useCallback(() => {
    const landed = landErrand(errandRun.current);
    errandRun.current = landed.run;
    drawErrandHold(landed.hold);
  }, [drawErrandHold]);

  /**
   * Whether the panel on screen is one an errand stood up. Only then is it the
   * errand's to put away again — a panel that was already open is somewhere
   * the developer had gone themselves, and closing it would be taking it from
   * them for having spoken.
   */
  const errandOpenedPanel = useRef(false);

  /**
   * Sends Luke to sign the next action waiting on him, and puts the panel where
   * that action can be seen.
   *
   * Only the panel can hold a signature, so every caller stands it up first
   * and this is the backstop rather than the decision: a run whose panel never
   * opened has nobody to show anything to, so everything it was holding is
   * drawn at once and the run is over. An action that named a control this build
   * does not draw is over the moment it is taken up, in the same way — which
   * is why this loops rather than returning: the next action takes its turn
   * immediately instead of waiting for a flight that will never be made.
   *
   * The tab and the page are turned here rather than where the action was asked
   * for, because a page turned at the ask would take the previous action's
   * control off screen before Luke had reached it.
   */
  const flyNextErrand = useCallback(() => {
    while (errandRun.current.flying === undefined && errandRun.current.waiting.length > 0) {
      if (presentationOf() !== PANEL_PRESENTATION.PANEL) {
        const flushed = flushErrands(errandRun.current);
        errandRun.current = flushed.run;
        drawErrandHold(flushed.hold);
        return;
      }
      const { run, launch } = nextErrand(errandRun.current);
      errandRun.current = run;
      if (launch === undefined) return;
      const wait = errandWait({
        opening: launch.opening,
        surfaceChanging:
          launch.page !== undefined &&
          (tabNow() !== launch.tab || settingsViewNow() !== launch.page),
      });
      // The control has to be drawn to be flown to, and a settings page that is
      // not open is not drawn at all — so the tab comes forward and then the
      // page the setting lives on, in that order, because arriving at the tab
      // is arriving at its front page. This is the same move a credential entry
      // returning from the key slot makes.
      changeTab(launch.tab);
      if (launch.page !== undefined) setSettingsView(launch.page);
      if (launch.targets.length > 0) {
        errands.current += 1;
        setErrand({ targets: launch.targets, wait, run: errands.current });
        // Whether the panel is still the run's to put away, asked of the run
        // rather than of this action alone. A later act must not answer "no" on
        // the first one's behalf just for having found the panel already open:
        // a close the first action scheduled and the second disowned still fires,
        // into the middle of the second action's flight. But an action that asked for
        // the panel itself does disclaim it, whichever action stood it up.
        errandOpenedPanel.current = errandBorrowedPanel(errandOpenedPanel.current, launch);
        return;
      }
      // Nothing flew, so nothing is coming to release it.
      const finished = finishErrand(errandRun.current);
      errandRun.current = finished.run;
      drawErrandHold(finished.hold);
    }
  }, [changeTab, drawErrandHold, presentationOf, setSettingsView, settingsViewNow, tabNow]);

  /** Adds an act to the run, and sends Luke off if he is not already out. */
  const armErrandFlight = useCallback(
    (pending: PendingErrand) => {
      errandRun.current = armErrand(errandRun.current, pending);
      flyNextErrand();
    },
    [flyNextErrand],
  );

  /**
   * The panel standing back down once an errand it stood up is over. The same
   * rule a saved key follows, for the same reason: the shape was brought
   * forward to show an answer, the answer has been shown, and nothing else
   * would ever ask it to close — the pointer is not on it, because the
   * developer was talking rather than reaching for it.
   *
   * Everything that holds a panel open against the pointer holds it open
   * against this too. A key half-typed and an ask half-written are both things
   * someone is in the middle of, and a panel someone's hands have arrived in
   * is theirs now rather than the errand's.
   */
  const standDownAfterErrand = useCallback(() => {
    if (!errandOpenedPanel.current) return;
    errandOpenedPanel.current = false;
    if (pointerInside() || heldAgainstPointer()) return;
    cancelHover();
    settle();
  }, [cancelHover, heldAgainstPointer, pointerInside, settle]);

  /**
   * One flight over, and the next one away if the reply asked for more than one
   * act. The panel only stands back down once the whole run is signed: a close
   * scheduled between two flights would land in the middle of the second, and
   * a flight whose shape goes out from under it is cut short where it stands.
   *
   * Every beat is acted on, with no test for whether the flight reporting it is
   * still the current one. There is no such thing as a stale flight —
   * a second action waits its turn rather than overtaking the one in the air — and
   * a guard here would be worse than redundant: this is what advances the run,
   * so a beat it declined to act on would strand every action still waiting and
   * every hold they carry.
   */
  const finishErrandFlight = useCallback(() => {
    const finished = finishErrand(errandRun.current);
    errandRun.current = finished.run;
    drawErrandHold(finished.hold);
    flyNextErrand();
    if (!errandRunIdle(errandRun.current)) return;
    standDownAfterErrand();
  }, [drawErrandHold, flyNextErrand, standDownAfterErrand]);

  return {
    errand,
    deferSettings,
    drawHold: drawErrandHold,
    arm: armErrandFlight,
    onLanded: releaseErrandChange,
    onReturned: finishErrandFlight,
  };
}
