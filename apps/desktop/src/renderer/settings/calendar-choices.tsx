import type { AccountCalendar, CalendarAccount } from "@sidecar/settings/wire";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import type { ActionResult } from "@sidecar/wire";
import { Fragment } from "react";
import { useSettingWrite } from "./use-setting-write";

/**
 * Which of a connection's calendars count, one checkbox each — checked
 * meaning its meetings hold announcements — drawn in the calendar's own
 * colour where the list carried one, the panel's working accent where it did
 * not, and sectioned by source where the list reported sources, the way
 * Calendar.app sections its sidebar. A calendar the selection names but the
 * list no longer offers simply is not drawn — and never reaches a read
 * either way. The names drawn here are the user's own calendar names, on the
 * user's own screen.
 *
 * The write is this block's own, so one checkbox in flight stills the rest and
 * the refusal lands under the calendars it was asked about rather than on a
 * line shared with the connection's own actions.
 */
export function CalendarChoices({
  account,
  calendars,
  stilled,
  onToggle,
}: {
  account: CalendarAccount;
  calendars: readonly AccountCalendar[];
  /**
   * Whether the connection above is in the middle of an answer of its own. A
   * checkbox pressed while its account's disconnect is in flight would write to
   * a grant already leaving.
   */
  stilled?: boolean;
  onToggle: (calendarId: string, selected: boolean) => Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(
    ({ calendarId, selected }: { calendarId: string; selected: boolean }) =>
      onToggle(calendarId, selected),
  );
  return (
    <>
      {calendars.map((calendar, index) => {
        const selected = account.selectedCalendarIds.includes(calendar.id);
        const opensGroup =
          calendar.group !== undefined && calendar.group !== calendars[index - 1]?.group;
        return (
          <Fragment key={calendar.id}>
            {opensGroup ? <p className="calendar-group">{calendar.group}</p> : null}
            <label
              className="calendar-choice"
              {...(calendar.color
                ? { style: cssCustomProperties({ "--calendar-color": calendar.color }) }
                : undefined)}
            >
              <input
                type="checkbox"
                checked={selected}
                disabled={busy || stilled === true}
                aria-label={`Count meetings on ${calendar.label}`}
                onChange={() => run({ calendarId: calendar.id, selected: !selected })}
              />
              <span className="calendar-choice-name">{calendar.label}</span>
            </label>
          </Fragment>
        );
      })}
      {rejection ? (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      ) : null}
    </>
  );
}
