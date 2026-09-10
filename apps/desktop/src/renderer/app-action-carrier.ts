import { ACTION_KIND, dispatchByKind } from "@sidecar/actions";
import type { BrainAppActionRequest } from "@sidecar/brain/requests-wire";
import type { FeedbackKind } from "@sidecar/feedback";
import { FEEDBACK_KIND } from "@sidecar/feedback";
import {
  APP_UPDATE_ACTION,
  FEEDBACK_COMPOSER_KIND,
  type FeedbackComposerKind,
} from "@sidecar/guide";
import type { AppSettingsView } from "@sidecar/settings/wire";
import { appSettingsView } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { useEffect, useRef } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import { act, tell, updateSetting, updateSettingEntry } from "./act";
import type { ErrandHold, PendingErrand } from "./errand-queue";
import { NOTHING_HELD } from "./errand-queue";
import { accountSignature, type FeedbackEntry, openedFeedbackEntry } from "./feedback-entry";
import { errandTargets } from "./luke-errand";
import { applySpokenSetting, isAppSettingId } from "./luke-guide";
import { PANEL_PRESENTATION, type PanelPresentation } from "./panel-state";
import { PANEL_TAB } from "./panel-tabs";
import type { SessionArrangement } from "./session-model";
import { displaySessions, sessionFiltersFromSpoken, spokenSearchOutcome } from "./session-model";
import { SETTING_PAGE } from "./settings-views";
import { UPDATE_ROW_ACTION, updateRow } from "./update-row";
import { appSettingsNow, appStateNow } from "./use-app-state";

/**
 * Performs one app action the brain asked for and answers its result. The
 * action was already validated against the guide in the main process before
 * it got here; the carrier only performs and reports. Nothing here sends a
 * note: the feedback act opens the composer, and what it holds leaves only by
 * its own Send button.
 */
type AppActionCarrier = (action: BrainAppActionRequest["action"]) => Promise<WireRecord>;

/**
 * The composer kind a spoken open names, matched to the composer's own. The
 * two vocabularies are defined apart — the tool's in brand-neutral core, the
 * composer's beside the endpoint that reads a submission — so the seam between
 * them is written down once, here, rather than assumed at a call site.
 */
const FEEDBACK_KIND_FOR_COMPOSER = {
  [FEEDBACK_COMPOSER_KIND.FEEDBACK]: FEEDBACK_KIND.FEEDBACK,
  [FEEDBACK_COMPOSER_KIND.PROMPT]: FEEDBACK_KIND.PROMPT,
} satisfies Record<FeedbackComposerKind, FeedbackKind>;

/**
 * What a spoken settings change composes against: this window's own last
 * answer while the document has not moved since, and the document itself
 * from that version onward — by which point it carries the answer, and any
 * newer word from another window or hand with it.
 */
function composeSettingsAgainst(
  answered: { view: AppSettingsView; atVersion: number } | undefined,
): AppSettingsView | undefined {
  if (answered !== undefined && answered.atVersion === appStateNow()?.version) {
    return answered.view;
  }
  return appSettingsNow();
}

export interface UseAppActionCarrierOptions {
  presentationOf: () => PanelPresentation;
  changeMode: (panel: boolean) => Promise<void>;
  /** The errand run a settings change or a panel ask sends Luke out on. */
  errands: {
    deferSettings: () => void;
    drawHold: (hold: ErrandHold) => void;
    arm: (pending: PendingErrand) => void;
  };
  /** The composer a spoken open reaches, and the draft it leaves waiting. */
  feedback: {
    latest: () => FeedbackEntry | undefined;
    holdSpokenDraft: (draft: string | undefined) => void;
  };
  /** How the list is narrowed now, which a spoken search reads its outcome against. */
  sessionView: SessionArrangement;
  /** Keeps the conversation's view of Luke himself current with the store's answer. */
  publishGuide: (held: AppStateSnapshot, current: AppSettingsView) => void;
}

/**
 * The brain's own acts on the app, carried where only a panel can carry them:
 * this installs the subscription and answers by the request's id.
 */
export function useAppActionCarrier(options: UseAppActionCarrierOptions): void {
  const { presentationOf, changeMode, errands, feedback, sessionView, publishGuide } = options;
  /**
   * The store's own answer to this window's last spoken settings write, and
   * the document version that stood when it landed.
   *
   * A spoken change composes against it — two changes asked in one breath are
   * two calls in one turn, and the second has to compose against what the
   * first stored, before any version of the document could have carried it
   * back. It is read only while the document has not moved since: from the
   * version that carries the write onward the document is the newer word,
   * whichever window or hand wrote it.
   */
  const answeredSettings = useRef<{ view: AppSettingsView; atVersion: number } | undefined>(
    undefined,
  );

  /**
   * The spoken asks about Luke himself. All were validated against their fixed
   * vocabularies before they arrive here, so this only performs and reports.
   *
   * A settings change and a change of view are the two actions nobody
   * watched anyone make, so both end by showing the control that moved and
   * sending Luke to it. A settings change stands the panel up on the Settings
   * tab to do it: the switch is the whole report, and a switch flipped behind
   * a closed panel is a change the developer is only ever told about. The
   * errand is drawing over what already happened — it runs after the change,
   * it carries nothing to the store, and a refusal takes both the showing and
   * the flight with it. The composer is neither: it is a shape of its own
   * standing where the panel was, so there is nothing for a mark to land on.
   */
  const carryAppAction: AppActionCarrier = async (action) =>
    dispatchByKind(action, {
      [ACTION_KIND.SETTING]: async (action): Promise<WireRecord> => {
        // The drawing is held back before the write, not after it: the store
        // answers by moving the document, and the switch is what Luke is on
        // his way to move, so it has to still read as it did when he set
        // off. Every path out of here releases the hold, and the outcome the
        // conversation is told is the store's own either way — what is
        // delayed is the drawing, never the change or the report of it.
        //
        // Two things must not wait for Luke, and neither is the drawing. The
        // guide has to describe the store's answer at once, because the next
        // call in this same turn is validated against it — an effort named in
        // the same breath as a model only exists in the guide the model
        // change just made true. And that next call composes against the
        // same answer, before any version of the document could have carried
        // it back, which is why it is remembered outside the hold: the hold
        // belongs to one act, and every act after it has to read this.
        errands.deferSettings();
        let caught: AppSettingsView | undefined;
        const outcome = await applySpokenSetting(
          { updateSetting, updateSettingEntry },
          action,
          (wire) => {
            const next = appSettingsView(wire);
            caught = next;
            const held = appStateNow();
            answeredSettings.current = { view: next, atVersion: held?.version ?? -1 };
            if (held) publishGuide(held, next);
          },
          composeSettingsAgainst(answeredSettings.current),
        );
        const hold: ErrandHold = caught === undefined ? NOTHING_HELD : { settings: caught };
        // Nothing to show and nothing to sign: a refused change must not stand
        // the panel up in front of a switch that did not move.
        if (outcome.status !== ACTION_RESULT_STATUS.ACCEPTED) {
          errands.drawHold(hold);
          return {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: outcome.reason ?? "That setting could not be changed.",
          };
        }
        const opening = presentationOf() !== PANEL_PRESENTATION.PANEL;
        // The guide's ids travel as plain text, so one that names no setting
        // of Luke's names no page either — and nothing will fly to it.
        const page = isAppSettingId(action.setting.id)
          ? SETTING_PAGE[action.setting.id]
          : undefined;
        try {
          await changeMode(true);
          // Queued rather than flown at once. The tab, the page and the wait
          // are all decided when this action comes up for its turn, because an
          // earlier act may still be out over the very page this one would
          // otherwise turn away.
          errands.arm({
            targets: errandTargets(action),
            tab: PANEL_TAB.SETTINGS,
            ...(page === undefined ? undefined : { page }),
            opening,
            borrowsPanel: true,
            hold,
          });
        } catch {
          // Showing the change is not what was asked for — making it is, and it
          // is already made. A window that refused to come forward must not be
          // reported back as a setting that refused to change, and the switch
          // must be drawn whether or not anyone was shown it moving.
          errands.drawHold(hold);
        }
        return outcome;
      },
      [ACTION_KIND.FEEDBACK]: async (action) => {
        // The main process expands the window and sends the composer's
        // lifecycle event down the same ordered channel as the mode event,
        // so the composer's shape can never lose a race to the panel apply
        // the expansion causes. The draft
        // rides this ref because the lifecycle channel carries event names,
        // not payloads: set before the ask, consumed when the event lands.
        // Whether it will be placed is decided here with the same pure
        // decision the open itself makes, on the same entry — the open lands
        // a beat later on the event, and nothing else writes the entry in
        // between — so the spoken outcome says what actually happens. And
        // nothing here sends: the note leaves only by the Send button's own
        // press.
        const kind = FEEDBACK_KIND_FOR_COMPOSER[action.composer];
        const drafted = openedFeedbackEntry(feedback.latest(), {
          kind,
          fromPanel: false,
          ...(action.draft === undefined ? undefined : { draft: action.draft }),
          signature: accountSignature(appStateNow()?.account),
        }).drafted;
        feedback.holdSpokenDraft(action.draft);
        try {
          await act(ACT_KIND.FEEDBACK_SUMMON, { kind });
        } catch (error) {
          // The composer is not coming, so the event that would consume the
          // draft is not coming either; a stale one must not season some
          // later spoken request.
          feedback.holdSpokenDraft(undefined);
          throw error;
        }
        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          kind: action.composer,
          ...(action.draft === undefined
            ? undefined
            : drafted
              ? {
                  note: "The ask is drafted in the composer; the developer edits and sends it by hand.",
                }
              : {
                  note: "A note was already being written, so it was kept and nothing was drafted over it.",
                }),
        };
      },
      [ACTION_KIND.PANEL]: async (action) => {
        // Whether this ask is what opens the panel, read before it does: an
        // errand into a shape still growing has to trail the whole opening,
        // and one into a panel already up does not.
        const opening = presentationOf() !== PANEL_PRESENTATION.PANEL;
        const spoken = action.filters ? sessionFiltersFromSpoken(action.filters) : undefined;
        // An identity this build holds no chip for cannot narrow the list, and
        // Luke must not claim it did. The list still has to match the sentence
        // that says every session is shown, so an unmappable ask widens the view
        // to everything rather than leaving whatever narrowing was already in
        // force — the whole ask, because a combination quietly missing one of
        // its values would show more than the sentence names.
        const filters = action.filters ? (spoken ?? []) : undefined;
        // Caught rather than applied, on the settings switch's terms: the
        // narrowing is what Luke is on his way to the options control — or
        // its clear X, for a whole-list ask — to do, and a list that has
        // already re-sorted itself by the time he gets there makes the
        // flight a report rather than the action.
        const view =
          filters || action.sort || action.query !== undefined
            ? {
                ...(filters ? { filters } : undefined),
                ...(action.sort ? { sort: action.sort } : undefined),
                ...(action.query !== undefined ? { query: action.query } : undefined),
              }
            : undefined;
        // What the query will leave, read now against the roster and the
        // view the hold is about to land: the reply voices this outcome, and
        // it must not claim rows the list will not draw. Only the drawing
        // waits for the flight, never the report.
        const held = appStateNow();
        const searched =
          action.query !== undefined && held !== undefined
            ? spokenSearchOutcome(displaySessions(held), {
                ...sessionView,
                ...view,
              })
            : undefined;
        await changeMode(true);
        // The tab bar and the options button are drawn outside the settings
        // pages, so this action names no page and waits for none. An action with
        // nowhere to land releases what it holds the moment it comes up: the
        // panel itself is what was asked for and it is already open, so the
        // list must show what the answer is about to claim it shows.
        errands.arm({
          targets: errandTargets(action),
          tab: action.tab,
          opening,
          // The panel is what was asked for, so it is nobody's to take away.
          borrowsPanel: false,
          hold: view === undefined ? NOTHING_HELD : { view },
        });
        // One note line, because an unmappable narrowing and an emptied
        // search can arrive in the same ask and each has its own sentence.
        const notes = [
          action.filters && spoken === undefined
            ? "That narrowing has no filter of its own here, so every session is shown."
            : undefined,
          searched?.note,
        ].filter((line): line is string => line !== undefined);
        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          tab: action.tab,
          ...(spoken !== undefined ? { filters: action.filters } : undefined),
          ...(action.sort ? { sort: action.sort } : undefined),
          ...(action.query !== undefined ? { query: action.query } : undefined),
          ...(searched !== undefined ? { matches: searched.matches } : undefined),
          ...(notes.length > 0 ? { note: notes.join(" ") } : undefined),
        };
      },
      [ACTION_KIND.UPDATE]: async (action): Promise<WireRecord> => {
        // The Updates row's own three presses, behind the same bridge calls
        // its button uses; the main process holds its own guards — a check
        // never interrupts a download, an install runs only on a build in
        // hand, and the releases page is an address fixed by the build.
        if (action.action === APP_UPDATE_ACTION.CHECK) {
          // Answered rather than fire-and-forget, like the row's own press,
          // so the outcome voiced is the answer the check actually returned.
          const answered = await act(ACT_KIND.UPDATE_CHECK);
          return { status: ACTION_RESULT_STATUS.ACCEPTED, outcome: updateRow(answered).detail };
        }
        if (action.action === APP_UPDATE_ACTION.DOWNLOAD) {
          tell(ACT_KIND.UPDATE_OPEN_RELEASE);
          return {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            note: "The latest release's page is open in the browser; the download itself is by hand from there.",
          };
        }
        // Re-read at the action what the button reads at its press: the guide
        // the call was validated against is a snapshot, and an install that
        // failed or landed between the two must answer as the row now
        // stands. The main process quietly refuses a stale ask either way;
        // this makes the refusal a sentence rather than a claimed restart
        // that never comes.
        const standing = appStateNow()?.update;
        const row = standing ? updateRow(standing) : undefined;
        if (row?.action !== UPDATE_ROW_ACTION.RESTART) {
          return {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: row?.detail ?? "This run does not report where updates stand.",
          };
        }
        tell(ACT_KIND.UPDATE_INSTALL);
        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          note: "Luke is quitting to install the downloaded release; this conversation ends with it.",
        };
      },
    });

  // An app act the brain decided that only a panel can perform. It was
  // validated against the guide in the main process, which sends it to the
  // primary panel alone; the carrier performs it and the answer goes back by
  // the request's id, so the brain's turn can say what happened.
  const carryAppActionRef = useRef(carryAppAction);
  carryAppActionRef.current = carryAppAction;
  useEffect(
    () =>
      window.sidecar.onBrainAppAction((request) => {
        void carryAppActionRef
          .current(request.action)
          .catch((error: Error) => ({
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: error instanceof Error ? error.message : "The change could not be made.",
          }))
          .then((answer) => window.sidecar.answerBrainAppAction(request.requestId, answer));
      }),
    [],
  );
}
