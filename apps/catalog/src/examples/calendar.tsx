import { Calendar } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * calendar.tsx -- a month with one day picked, with a range picked across
 * a month's edge, and with today picked; each answers its picks and pages
 * its months, the range taking a second pick as its end. Today is a fixed
 * day, so the catalog draws the same months whatever the day.
 */

const TODAY = "2026-10-20";

/** A calendar that keeps its own month and one picked day. */
function OneDay({ from, picked }: { from: string; picked: string }): React.JSX.Element {
  const [month, setMonth] = useState(from);
  const [day, setDay] = useState(picked);
  return (
    <Calendar month={month} today={TODAY} start={day} onPick={setDay} onShowMonth={setMonth} />
  );
}

/** A calendar that keeps its own month and a range: a pick starts one, the next ends it. */
function Range({
  from,
  start,
  end,
}: {
  from: string;
  start: string;
  end: string;
}): React.JSX.Element {
  const [month, setMonth] = useState(from);
  const [range, setRange] = useState<{ start: string; end: string | undefined }>({ start, end });
  const pick = (day: string) =>
    setRange((held) => {
      if (held.end !== undefined) return { start: day, end: undefined };
      return day < held.start ? { start: day, end: held.start } : { start: held.start, end: day };
    });
  return (
    <Calendar
      month={month}
      today={TODAY}
      start={range.start}
      end={range.end}
      onPick={pick}
      onShowMonth={setMonth}
    />
  );
}

function Calendars(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="calendar-day" title="One day picked">
        <OneDay from="2026-10" picked="2026-10-23" />
      </CatalogSection>
      <CatalogSection id="calendar-range" title="A range, across a month's edge">
        <Range from="2026-10" start="2026-10-27" end="2026-11-04" />
      </CatalogSection>
      <CatalogSection id="calendar-today" title="Today picked">
        <OneDay from="2026-10" picked={TODAY} />
      </CatalogSection>
    </>
  );
}

export const CALENDAR_EXAMPLE: Example = { id: "calendar", title: "Calendar", Render: Calendars };
