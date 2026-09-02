import { GOOGLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import { ProviderMark } from "@sidecar/panel";
import { APPLE_CALENDAR_ID } from "#shared/apple-calendar";

/** One connectable calendar source the gate offers, absent where the build cannot. */
export interface CalendarGateSource {
  /** True while this source's connect is under way, which holds every control. */
  connecting: boolean;
  /** Starts the source's own consent flow, the same one its settings row runs. */
  onConnect: () => void;
}

/**
 * What the gate can do, assembled by the app, which is what knows the
 * build's capabilities. A gate offered no source is never drawn at all,
 * because an onboarding step with nothing to offer would be a locked door.
 */
export interface CalendarGateControl {
  apple?: CalendarGateSource;
  google?: CalendarGateSource;
  /** Declines the step for good; the settings rows stay the way to connect later. */
  onSkip: () => void;
  /** Confirms the connected calendars and settles the step. */
  onDone: () => void;
}

/**
 * The calendar step of onboarding, standing where the roster would be from
 * the first sign-in until it is answered. Unconnected, it asks; connected,
 * the caller hands in the settings page's own calendar block as `review`, so
 * the calendars read exactly as they do everywhere else, until Done confirms
 * the choice. Every button runs the same consent flow or bridge call the
 * settings rows do, and the gate falls on the answer the main process
 * records, never on anything decided here.
 */
export function CalendarGate({
  control,
  review,
  onQuit,
}: {
  control: CalendarGateControl;
  /** The connected calendars, drawn by the settings page's own component. */
  review?: React.ReactNode;
  onQuit: () => void;
}): React.JSX.Element {
  const pending = control.apple?.connecting === true || control.google?.connecting === true;
  return (
    // No heading and no prose of its own: the spoken beat says why the panel
    // is asking, and the review half's borrowed block carries the settings
    // page's own note. The label survives for readers the voice cannot reach.
    <section className="sign-in-gate calendar-gate" aria-label="Connect a calendar">
      {review !== undefined ? <div className="calendar-gate-review">{review}</div> : null}
      <div className="sign-in-actions">
        {review === undefined && control.apple ? (
          <button
            type="button"
            className="sign-in-provider"
            disabled={pending}
            onClick={control.apple.onConnect}
          >
            <ProviderMark providerId={APPLE_CALENDAR_ID} />
            Use this Mac's Calendar
          </button>
        ) : null}
        {review === undefined && control.google ? (
          <button
            type="button"
            className="sign-in-provider"
            disabled={pending}
            onClick={control.google.onConnect}
          >
            <ProviderMark providerId={GOOGLE_CALENDAR_ID} />
            Connect Google Calendar
          </button>
        ) : null}
        {review !== undefined ? (
          <button
            type="button"
            className="sign-in-provider calendar-gate-done"
            disabled={pending}
            onClick={control.onDone}
          >
            Done
          </button>
        ) : null}
      </div>
      {/* The quiet ways out. The skip is an answer and only stands while the
          question does: with a calendar connected, Done is the answer. */}
      <div className="calendar-gate-footer">
        {review === undefined ? (
          <button
            type="button"
            className="calendar-gate-skip"
            disabled={pending}
            onClick={control.onSkip}
          >
            Set up later
          </button>
        ) : null}
        <button type="button" className="sign-in-quit" onClick={onQuit}>
          Quit Luke
        </button>
      </div>
    </section>
  );
}
