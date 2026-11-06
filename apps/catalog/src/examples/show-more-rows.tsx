import { List, ListRow, ShowMoreRow } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const CAP = 3;

const TASKS = [
  "Fix the sign-in loop",
  "Ship the spring release",
  "Move the Inbox to one list",
  "Name the workers",
  "Remember the Inbox's folds",
  "One Show more row",
  "Guard the stored choices",
] as const;

function CappedTasks({ tasks }: { tasks: readonly string[] }): React.JSX.Element {
  const [shown, setShown] = useState(false);
  return (
    <div className="catalog-column">
      <List label="Tasks">
        {(shown ? tasks : tasks.slice(0, CAP)).map((task) => (
          <ListRow key={task} title={task} />
        ))}
      </List>
      <ShowMoreRow more={tasks.length - CAP} shown={shown} onToggle={() => setShown(!shown)} />
    </div>
  );
}

function ShowMoreRows(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="show-more-row-capped" title="Capped at three rows">
        <CappedTasks tasks={TASKS} />
      </CatalogSection>
      <CatalogSection id="show-more-row-fits" title="Every row fits, so no foot">
        <CappedTasks tasks={TASKS.slice(0, CAP)} />
      </CatalogSection>
    </>
  );
}

export const SHOW_MORE_ROWS_EXAMPLE: Example = {
  id: "show-more-rows",
  title: "Show more rows",
  Render: ShowMoreRows,
};
