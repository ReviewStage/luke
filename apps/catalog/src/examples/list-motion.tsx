import {
  ArchiveIcon,
  Button,
  GAP,
  IconButton,
  Inline,
  LIST_ROW_ACTIONS,
  List,
  ListMotion,
  ListRow,
  PinIcon,
  Stack,
  TEXT_VARIANT,
  Text,
  useLeaving,
} from "@repo/ui";
import { useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

interface Sample {
  readonly id: string;
  readonly name: string;
}

const FIRST: readonly Sample[] = [
  { id: "billing", name: "Billing usage alerts" },
  { id: "invites", name: "Invite links expire" },
  { id: "retries", name: "Retry failed emails" },
];

const ADDED = ["Dark mode for the docs", "Export to CSV", "Weekly digest", "Audit log filters"];

function taskKey(task: Sample): string {
  return task.id;
}

function Rows({
  label,
  tasks,
  pinned,
  onPin,
  onArchive,
}: {
  label: string;
  tasks: readonly Sample[];
  pinned: boolean;
  onPin: (task: Sample) => void;
  onArchive: (task: Sample) => void;
}): React.JSX.Element {
  const drawn = useLeaving(tasks, taskKey);
  return (
    <Stack gap={GAP.TIGHT}>
      <Text variant={TEXT_VARIANT.SECTION}>{label}</Text>
      <List label={label} moves>
        {drawn.map(({ key, value }) => (
          <ListRow
            key={key}
            motionKey={key}
            title={value.name}
            actionsAt={LIST_ROW_ACTIONS.HOVER}
            actions={
              <>
                <IconButton
                  icon={<PinIcon />}
                  label={pinned ? `Unpin ${value.name}` : `Pin ${value.name}`}
                  onClick={() => onPin(value)}
                />
                <IconButton
                  icon={<ArchiveIcon />}
                  label={`Archive ${value.name}`}
                  onClick={() => onArchive(value)}
                />
              </>
            }
          />
        ))}
      </List>
    </Stack>
  );
}

function Lists(): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState<readonly Sample[]>([]);
  const [rest, setRest] = useState<readonly Sample[]>(FIRST);
  const [added, setAdded] = useState(0);
  const [archived, setArchived] = useState<Sample | undefined>(undefined);
  const add = () => {
    const name = ADDED[added % ADDED.length] ?? "New task";
    setRest((now) => [{ id: `added-${added}`, name }, ...now]);
    setAdded(added + 1);
  };
  const pin = (task: Sample) => {
    setRest((now) => now.filter((each) => each.id !== task.id));
    setPinned((now) => [task, ...now]);
  };
  const unpin = (task: Sample) => {
    setPinned((now) => now.filter((each) => each.id !== task.id));
    setRest((now) => [task, ...now]);
  };
  const archive = (task: Sample) => {
    setPinned((now) => now.filter((each) => each.id !== task.id));
    setRest((now) => now.filter((each) => each.id !== task.id));
    setArchived(task);
  };
  const undo = () => {
    if (archived !== undefined) setRest((now) => [archived, ...now]);
    setArchived(undefined);
  };
  return (
    <Stack>
      <Inline gap={GAP.TIGHT}>
        <Button onClick={add}>Add a task</Button>
        <Button onClick={undo} disabled={archived === undefined}>
          {archived === undefined ? "Undo" : `Undo archiving ${archived.name}`}
        </Button>
      </Inline>
      <ListMotion root={root}>
        <div ref={root} className="catalog-column">
          <Rows label="Pinned" tasks={pinned} pinned onPin={unpin} onArchive={archive} />
          <Rows label="Tasks" tasks={rest} pinned={false} onPin={pin} onArchive={archive} />
        </div>
      </ListMotion>
    </Stack>
  );
}

function ListMotions(): React.JSX.Element {
  return (
    <CatalogSection id="list-motion-lists" title="Pin, add, archive, undo">
      <Lists />
    </CatalogSection>
  );
}

export const LIST_MOTION_EXAMPLE: Example = {
  id: "list-motion",
  title: "List motion",
  Render: ListMotions,
};
