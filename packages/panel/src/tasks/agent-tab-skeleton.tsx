import {
  ComposerFrame,
  FILL_ELEMENT,
  Fill,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
} from "@luke/ui";

/**
 * agent-tab-skeleton.tsx -- an agent's tab in the shape it lands in, while what it draws is on its way.
 *
 * An agent's tab follows its transcript from the agent's id alone, while
 * the agent itself, its plan, its model, where it stands, is read beside it
 * (`AgentTab`). Until the agent is read the tab stands as this: the log's
 * last lines over the composer's card, each where the tab will draw it. The
 * composer then takes its card's place, and the log's lines stand on until
 * its first page lands, so the tab lands in place rather than through a
 * spinner per read. The
 * task's page stands its column as this too while the task itself is read
 * (`desktop-tasks.tsx`), so a task opened on an agent shows one placeholder
 * from the open to the transcript, never a chain of them.
 */

/** What the log's placeholder says to a reader. */
const TRANSCRIPT_LOADING_LABEL = "Loading transcript";

/** How wide each of the log's placeholder lines stands, the newest last: one message's lines. */
const LOG_LINE_WIDTHS = ["72%", "88%", "64%", "40%"] as const;

/** How wide the composer's model chip stands, a short model's name and its effort. */
const MODEL_CHIP_WIDTH = "120px";

/** A square control's width: the composer's + and every icon press, as tall as they are wide. */
const SQUARE_CONTROL_WIDTH = "var(--luke-control-height)";

/** The log's last lines, standing at its foot where the newest lines draw, which `label` names to a reader. */
export function TranscriptSkeleton({
  label = TRANSCRIPT_LOADING_LABEL,
}: {
  label?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="agent-log-wait">
      <SkeletonRegion label={label}>
        <div className="agent-log-skeleton">
          {LOG_LINE_WIDTHS.map((width) => (
            <Skeleton key={width} width={width} />
          ))}
        </div>
      </SkeletonRegion>
    </div>
  );
}

/**
 * The composer's card in its own frame and size: its empty field in the
 * field's own room, one line tall, and its foot's two ends as the composer
 * lays them, the + at the left, and the model chip beside the round send at
 * the right, so the card lands where it stood and its presses where their
 * blocks were. The icon presses between the chip and Send are left out, as
 * a narrow card folds them into its ⋯.
 */
export function ComposerSkeleton(): React.JSX.Element {
  return (
    <div className="agent-composer" aria-hidden="true">
      <ComposerFrame className="prompt-input">
        <div className="agent-composer-field">
          <div className="agent-composer-input" />
        </div>
        <div className="prompt-input-footer">
          <div className="prompt-input-tools">
            {/* Note that the + stands in the attach press's own box, which the narrowest card folds away as it folds the +. */}
            <span className="agent-composer-attach">
              <Skeleton shape={SKELETON_SHAPE.CONTROL} width={SQUARE_CONTROL_WIDTH} />
            </span>
          </div>
          <div className="agent-composer-actions">
            <Skeleton shape={SKELETON_SHAPE.CONTROL} width={MODEL_CHIP_WIDTH} />
            <Skeleton shape={SKELETON_SHAPE.CIRCLE} />
          </div>
        </div>
      </ComposerFrame>
    </div>
  );
}

/** A whole agent's tab before it can be drawn: the log's last lines over the composer, which `label` names to a reader. */
export function AgentTabSkeleton({ label }: { label?: string | undefined }): React.JSX.Element {
  return (
    <Fill as={FILL_ELEMENT.SECTION} className="agent-tab">
      <TranscriptSkeleton label={label} />
      <footer className="agent-tab-foot">
        <ComposerSkeleton />
      </footer>
    </Fill>
  );
}
