import type { TaskSummary } from "@luke/features/task-wire";
import { FolderIcon, ListRow, OneLine, Time } from "@luke/ui";
import { assigneeFace } from "@luke/ui/actor-model";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { AssigneeFaceMark } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";
import { RepositoryPicture } from "../repository-picture.js";
import { TaskStatusMark } from "./task-card.js";

/**
 * recent-row.tsx -- a plan as a person's page lists it: the repository's picture, the name, and at its end the repository, who is on it, and its mark and time.
 */

/**
 * A plan as a `ListRow`: the owner's picture, the name, and at its end the
 * repository, the face of who is on it (`assigneeFace`): a teammate's where
 * they are assigned, the dashed unassigned mark where no one is, and none
 * where the reader is; then its mark and time. Who made it is never its
 * face, and stays on its card.
 */
export function RecentRow({
  task,
  pictures,
  now,
  face = true,
  onOpen,
}: {
  task: TaskSummary;
  pictures: boolean;
  now: number;
  /** Whether the row wears who is on it, which a person's own page says once in its head instead. */
  face?: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const directory = useMemberDirectory();
  const worn = face ? assigneeFace(task, directory) : undefined;
  return (
    <ListRow
      leading={
        <span className="home-row-picture">
          {task.repository === null ? (
            <FolderIcon />
          ) : (
            <RepositoryPicture
              repository={task.repository}
              pictures={pictures}
              fallback={<FolderIcon />}
            />
          )}
        </span>
      }
      title={task.name}
      meta={
        <span className="home-row-meta">
          <OneLine className="home-row-context" words={task.repository ?? "No repository"}>
            {task.repository ?? "No repository"}
          </OneLine>
          {worn === undefined ? null : <AssigneeFaceMark face={worn} />}
          <TaskStatusMark task={task} />
          <Time at={taskTime(task, TASK_ORDER.UPDATED)} now={now} />
        </span>
      }
      onPress={onOpen}
    />
  );
}
