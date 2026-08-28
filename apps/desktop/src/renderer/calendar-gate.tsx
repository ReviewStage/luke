import { GOOGLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import { ProviderMark } from "@sidecar/panel";
import { APPLE_CALENDAR_ID } from "#shared/apple-calendar";
import type { AccountCalendar, CalendarAccount } from "#shared/wire/calendar";
import { CalendarChoices } from "./settings-panel";

/** One connectable calendar source the gate offers, absent where the build cannot. */
export interface CalendarGateSource {
  /** True while this source's connect is under way, which holds every control. */
  connecting: boolean;
  /** Starts the source's own consent flow, the same one its settings row runs. */
  onConnect: () => void;
}

/** One connection already made at the gate, with its calendars to choose from. */
export interface CalendarGateConnection {
  /** The Mac's fixed id, or the Google account's own. */
  id: string;
  /** What the block is called: the account's address, or the Mac calendar's name. */
  name: string;
  /** The stored connection, whose selection the checkboxes draw. */
  account: CalendarAccount;
  /** The connection's calendars as last observed; empty until the first pass answers. */
  calendars: readonly AccountCalendar[];
  onToggle: (calendarId: string, selected: boolean) => void;
}

/**
 * What the gate can do, assembled by the app, which is what knows the
 * build's capabilities and the current connections. A gate offered no source
 * is never drawn at all, because an onboarding step with nothing to offer
 * would be a locked door.
 */
export interface CalendarGateControl {
  apple?: CalendarGateSource;
  google?: CalendarGateSource;
  /** The connections made so far; any at all moves the gate to its review half. */
  connections: readonly CalendarGateConnection[];
  /** Declines the step for good; the settings rows stay the way to connect later. */
  onSkip: () => void;
  /** Confirms the connected calendars and settles the step. */
  onDone: () => void;
}

/**
 * The calendar step of onboarding, standing where the roster would be from
 * the first sign-in until it is answered. Unconnected, it asks; connected, it
 * shows each connection's calendars to choose from and offers another
 * connection, until Done confirms the choice. Every button runs the same
 * consent flow or bridge call the settings rows do, and the gate falls on the
 * answer the main process records, never on anything decided here.
 */
export function CalendarGate({
  control,
  onQuit,
}: {
  control: CalendarGateControl;
  onQuit: () => void;
}): React.JSX.Element {
  const pending = control.apple?.connecting === true || control.google?.connecting === true;
  const connected = control.connections.length > 0;
  const googleConnected = control.connections.some(
    (connection) => connection.id !== APPLE_CALENDAR_ID,
  );
  return (
    <section className="sign-in-gate calendar-gate" aria-labelledby="calendar-gate-title">
      <h1 id="calendar-gate-title">Quiet during meetings</h1>
      <p>
        {connected
          ? "Choose which calendars count, or add another. Done keeps the choice."
          : "Connect a calendar so announcements wait during your meetings. Luke reads only " +
            "when meetings start and end, never titles or attendees."}
      </p>
      {connected ? (
        <div className="calendar-gate-connections">
          {control.connections.map((connection) => (
            <div key={connection.id} className="calendar-gate-connection">
              <span className="calendar-gate-connection-name">{connection.name}</span>
              {connection.calendars.length > 0 ? (
                <CalendarChoices
                  account={connection.account}
                  calendars={connection.calendars}
                  disabled={pending}
                  onToggle={connection.onToggle}
                />
              ) : (
                <p className="calendar-gate-reading">Reading its calendars…</p>
              )}
            </div>
          ))}
        </div>
      ) : null}
      <div className="sign-in-actions">
        {control.apple ? (
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
        {control.google ? (
          <button
            type="button"
            className="sign-in-provider"
            disabled={pending}
            onClick={control.google.onConnect}
          >
            <ProviderMark providerId={GOOGLE_CALENDAR_ID} />
            {googleConnected ? "Add another Google account" : "Connect Google Calendar"}
          </button>
        ) : null}
        {connected ? (
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
        {connected ? null : (
          <button
            type="button"
            className="calendar-gate-skip"
            disabled={pending}
            onClick={control.onSkip}
          >
            Set up later
          </button>
        )}
        <button type="button" className="sign-in-quit" onClick={onQuit}>
          Quit Luke
        </button>
      </div>
    </section>
  );
}
