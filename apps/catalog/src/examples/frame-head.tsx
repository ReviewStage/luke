import { TASK_STATUS } from "@luke/features/task-wire";
import {
  BREADCRUMB_POPUP,
  type Crumb,
  FolderIcon,
  FrameHead,
  FrameHeadSkeleton,
  FramePlace,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * frame-head.tsx -- a task's head over its column: the task by its path,
 * its repository then the task by status mark, name, and key; a child task,
 * its parent before it; a task from before keys, named alone; a deep path
 * in a narrow column, folding its eldest tasks; and the head while its task
 * is read. Then a place that is no task, named by its words: the Inbox, a
 * channel with its purpose after it, and an automation's run under the
 * places above it.
 */

/** A press the catalog has nowhere to take. */
function stay(): void {}

const TASK = {
  name: "Opening reference materials to the right",
  taskKey: "STAGE-214",
  status: TASK_STATUS.IN_PROGRESS,
  onOpen: stay,
} as const;

const PARENT = {
  name: "Places and things",
  taskKey: "STAGE-200",
  status: TASK_STATUS.IN_PROGRESS,
  onOpen: stay,
} as const;

const REPOSITORY: Crumb = {
  label: "stage/luke",
  glyph: <FolderIcon />,
  popup: BREADCRUMB_POPUP.DIALOG,
  onPress: stay,
};

function FrameHeads(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="frame-head-task" title="A task by its path: repository, then the task">
        <FrameHead repository={REPOSITORY} task={TASK} />
      </CatalogSection>
      <CatalogSection id="frame-head-child" title="A child task, its parent before it">
        <FrameHead repository={REPOSITORY} ancestors={[PARENT]} task={TASK} />
      </CatalogSection>
      <CatalogSection
        id="frame-head-no-key"
        title="A task from before keys and statuses, named alone"
      >
        <FrameHead task={{ name: TASK.name, onOpen: stay }} />
      </CatalogSection>
      <CatalogSection
        id="frame-head-narrow"
        title="A deep path in a narrow column folds its eldest tasks, then cuts the name short"
      >
        <div className="catalog-narrow">
          <FrameHead
            repository={REPOSITORY}
            ancestors={[{ ...PARENT, name: "Roadmap", taskKey: "STAGE-100" }, PARENT]}
            task={{ ...TASK, name: "Quarterly review of the onboarding funnel and its drop-off" }}
          />
        </div>
      </CatalogSection>
      <CatalogSection id="frame-head-skeleton" title="While the task is read">
        <FrameHeadSkeleton />
      </CatalogSection>
      <CatalogSection id="frame-head-place" title="A place named by its words">
        <FramePlace title="Inbox" />
      </CatalogSection>
      <CatalogSection id="frame-head-place-detail" title="Quiet words after the name">
        <FramePlace title="#launch · Needs you" detail="Where the launch is planned and called" />
      </CatalogSection>
      <CatalogSection id="frame-head-place-trail" title="The places above it, each a press back">
        <FramePlace
          title="Check the 2.14.0 deploy"
          trail={[
            { label: "Automations", onPress: stay },
            { label: "Check each deploy", onPress: stay },
          ]}
        />
      </CatalogSection>
    </>
  );
}

export const FRAME_HEAD_EXAMPLE: Example = {
  id: "frame-head",
  title: "Frame head",
  Render: FrameHeads,
};
