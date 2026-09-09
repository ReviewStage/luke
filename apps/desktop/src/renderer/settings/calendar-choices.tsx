import type { AccountCalendar, CalendarAccount } from "@sidecar/settings/wire";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { Fragment } from "react";

/**
 * Which of a connection's calendars count, one checkbox each — checked
 * meaning its meetings hold announcements — drawn in the calendar's own
 * colour where the list carried one, the panel's working accent where it did
 * not, and sectioned by source where the list reported sources, the way
 * Calendar.app sections its sidebar. A calendar the selection names but the
 * list no longer offers simply is not drawn — and never reaches a read
 * either way. The names drawn here are the user's own calendar names, on the
 * user's own screen.
 */
export function CalendarChoices({
  account,
  calendars,
  disabled,
  onToggle,
}: {
  account: CalendarAccount;
  calendars: readonly AccountCalendar[];
  disabled: boolean;
  onToggle: (calendarId: string, selected: boolean) => void;
}): React.JSX.Element {
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
                disabled={disabled}
                aria-label={`Count meetings on ${calendar.label}`}
                onChange={() => onToggle(calendar.id, !selected)}
              />
              <span className="calendar-choice-name">{calendar.label}</span>
            </label>
          </Fragment>
        );
      })}
    </>
  );
}
