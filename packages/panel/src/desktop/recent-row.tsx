import type { TaskSummary } from "@luke/features/task-wire";
import { FolderIcon, ListRow } from "@luke/ui";
import { creatorActor, teammateCreator } from "@luke/ui/actor-model";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { ACTOR_SIZE, ActorMark, CreatorHeard } from "../actor-ref.js";
import { FadingWords } from "../fading-words.js";
import { useMemberDirectory } from "../member-directory.js";
import { RepositoryPicture } from "../repository-picture.js";
import { RelativeTime } from "../tasks/relative-time.js";
import { useTaskOrigin } from "../tasks/use-task-origin.js";
import { TaskStatusMark } from "./task-card.js";

/**
 * recent-row.tsx -- a plan as a person's page lists it: the repository's picture, the name, and at its end the repository, its creator's face where a teammate created it, and its mark and time.
 */

/** A plan as a `ListRow`: the owner's picture, the name, and at its end the repository, its creator's face where a teammate created it, and its mark and time. */
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
  /** Whether a teammate's task wears its creator's face, which a person's own page says once in its head instead. */
  face?: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const directory = useMemberDirectory();
  // Note that Luke or the agent that made a task wears its square on a person's page too, where the person's own face is left to the head.
  const origin = useTaskOrigin()(task);
  const creator = origin ?? (face ? teammateCreator(task, directory) : undefined);
  const forWhom =
    origin !== undefined && face ? creatorActor(task, directory, undefined) : undefined;
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
          <FadingWords className="home-row-context" words={task.repository ?? "No repository"} />
          {creator === undefined ? null : <CreatorHeard actor={creator} />}
          {creator === undefined ? null : (
            <ActorMark actor={creator} size={ACTOR_SIZE.MARK} forWhom={forWhom} />
          )}
          <TaskStatusMark task={task} />
          <RelativeTime at={taskTime(task, TASK_ORDER.UPDATED)} now={now} />
        </span>
      }
      onPress={onOpen}
    />
  );
}
