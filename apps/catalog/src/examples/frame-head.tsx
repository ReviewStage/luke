import { FrameHead, FrameHeadSkeleton, FramePlace } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * frame-head.tsx -- a task's head over its column: the task as a chip, its
 * key and name, and what waits on the reader there; the same head with
 * nothing waiting; a task from before keys, named alone; a long name in a
 * narrow column, cut short before the count; and the head while its task is
 * read. Then a place that is no task, named by its words: the Inbox, a
 * channel with its purpose after it, and an automation's run under the
 * places above it.
 */

/** A press the catalog has nowhere to take. */
function stay(): void {}

const WAITING = { count: 2, noun: { one: "needs you", many: "need you" }, onOpen: stay } as const;

const NAME = "Opening reference materials to the right";

function FrameHeads(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="frame-head-task" title="The task as a chip, and what needs you">
        <FrameHead taskKey="STAGE-214" name={NAME} onOpen={stay} waiting={WAITING} />
      </CatalogSection>
      <CatalogSection id="frame-head-none-waiting" title="Nothing waits, so no count">
        <FrameHead
          taskKey="STAGE-214"
          name={NAME}
          onOpen={stay}
          waiting={{ ...WAITING, count: 0 }}
        />
      </CatalogSection>
      <CatalogSection id="frame-head-no-key" title="A task from before keys, named alone">
        <FrameHead name={NAME} onOpen={stay} waiting={{ ...WAITING, count: 1 }} />
      </CatalogSection>
      <CatalogSection id="frame-head-narrow" title="A long name is cut short before the count">
        <div className="catalog-narrow">
          <FrameHead
            taskKey="STAGE-214"
            name="Quarterly review of the onboarding funnel and its drop-off"
            onOpen={stay}
            waiting={WAITING}
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
