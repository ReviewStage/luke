import { Text, TIME_LOOK, Time } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * times.tsx -- the one time: a row's few letters, a line's words, a call's
 * day, the moment in full, and a run's length counting each second; an age
 * hangs its full moment in the window's tooltip.
 */

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function Times(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="time-since" title="Since, in a row's letters">
        <div className="catalog-frame">
          <Text>
            <Time at={NOW - 5 * MINUTE} /> · <Time at={NOW - 3 * HOUR} /> ·{" "}
            <Time at={NOW - 3 * DAY} /> · <Time at={NOW - 60 * DAY} />
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="time-ago" title="Ago, in a line's words">
        <div className="catalog-frame">
          <Text>
            Last edited by you · <Time at={NOW - 2 * HOUR} look={TIME_LOOK.AGO} />
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="time-day" title="Day, as a call's header">
        <div className="catalog-frame">
          <Text>
            <Time at={NOW - 2 * HOUR} look={TIME_LOOK.DAY} /> ·{" "}
            <Time at={NOW - 2 * DAY} look={TIME_LOOK.DAY} />
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="time-moment" title="Moment, in full">
        <div className="catalog-frame">
          <Text>
            <Time at={NOW - 2 * HOUR} look={TIME_LOOK.MOMENT} />
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="time-duration" title="Duration, counting each second">
        <div className="catalog-frame">
          <Text>
            Working <Time at={NOW - 72_000} look={TIME_LOOK.DURATION} />
          </Text>
        </div>
      </CatalogSection>
    </>
  );
}

export const TIMES_EXAMPLE: Example = {
  id: "times",
  title: "Times",
  Render: Times,
};
