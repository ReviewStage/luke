import type { CatalogModel, ModelChoice } from "@repo/features/models-wire";
import { readingWords } from "@repo/features/words";
import { CHIP_LOOK, Chip, ChipName, ComposerFoot, Skeleton, SkeletonRegion } from "@repo/ui";
import { Message, MessageContent } from "../ai-elements/message.js";
import { PromptInputCard } from "../ai-elements/prompt-input.js";
import {
  BUTTON,
  ComposerActions,
  ComposerAttach,
  ComposerCard,
  PLACEHOLDER,
} from "./agent-composer.js";
import { AgentTabFoot, AgentTabFrame } from "./agent-tab-frame.js";
import { AttachFilesButton } from "./attach-files-button.js";
import { ComposerFieldRoom, ComposerPlaceholder, UnloadedComposerField } from "./composer-field.js";
import { ModelLabel } from "./model-label.js";

/**
 * agent-tab-skeleton.tsx -- an agent's tab in the shape it lands in, while what it draws is on its way.
 *
 * An agent's tab follows its transcript from the agent's id alone, while
 * the agent itself, its plan, its model, where it stands, is read beside it
 * (`AgentTab`). Until the agent is read the tab stands as this: the log's
 * last exchange over the composer, each where the tab will draw it. The
 * log stands as a conversation's foot does, the developer's bubble at the
 * right over the agent's reply and the line under it, drawn in the
 * transcript's own turns, and its lines stand on until its first page
 * lands. The composer stands as itself, held: its field asking for a follow
 * up, its + and its send as they land, and only the model's name, which the
 * agent alone knows, a block, so the composer lands without moving. So the
 * tab lands in place rather than through a spinner per read, on every
 * platform alike. The task's page stands its column as this too while the
 * task itself is read (`desktop-tasks.tsx`), so a task opened on an agent
 * shows one placeholder from the open to the transcript, never a chain of
 * them.
 */

/** What the log's placeholder says to a reader. */
const TRANSCRIPT_LOADING_LABEL = readingWords("the transcript");

/**
 * How wide each line of the log's last exchange stands, the newest last: the
 * developer's two lines in their bubble, the agent's three in its reply, and
 * the short line under the reply that says how long it worked.
 */
const LOG_LINE_WIDTHS = {
  ASKED: ["208px", "132px"],
  REPLY: ["94%", "86%", "58%"],
  WORKED: "36%",
} as const;

/** How wide the model's name stands in the composer until the agent says which it is. */
const MODEL_NAME_WIDTH = "96px";

/** A model the held composer's chip draws before its agent is read: the choice, and the catalog that names it. */
export interface ComposerModel {
  readonly choice: ModelChoice;
  /** The catalog as last read, which names the model; empty before the first read lands. */
  readonly models: readonly CatalogModel[];
}

/** Does nothing with files handed to the held composer's +, which takes no press. */
function takeNoFiles(): void {}

/** The log's last exchange, standing at its foot where the newest lines draw, which `label` names to a reader. */
export function TranscriptSkeleton({
  label = TRANSCRIPT_LOADING_LABEL,
}: {
  label?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="agent-log-skeleton-wait">
      <SkeletonRegion label={label}>
        <div className="agent-log-skeleton">
          <Message from="user">
            <MessageContent>
              {LOG_LINE_WIDTHS.ASKED.map((width) => (
                <Skeleton key={width} width={width} />
              ))}
            </MessageContent>
          </Message>
          <Message from="assistant">
            <MessageContent>
              {LOG_LINE_WIDTHS.REPLY.map((width) => (
                <Skeleton key={width} width={width} />
              ))}
            </MessageContent>
          </Message>
          <Skeleton width={LOG_LINE_WIDTHS.WORKED} />
        </div>
      </SkeletonRegion>
    </div>
  );
}

/**
 * The composer's card in its own frame and size, drawn as the composer
 * itself, held and inert: its field unloaded and asking for a follow up as
 * the loaded one will, and its foot as the composer lays it, the + at the
 * left and the round send at the right, each taking no press, with the model's
 * chip beside the send where the model is known, and a block of its name
 * where it is not. The icon presses between
 * the chip and Send are left out, as a narrow card folds them into its ⋯.
 */
export function ComposerSkeleton({
  model,
}: {
  /** The model already known, as a starting agent's is, which the chip draws as it will land; its name a block where none is. */
  model?: ComposerModel | undefined;
}): React.JSX.Element {
  return (
    <ComposerCard inert>
      <PromptInputCard>
        <ComposerFieldRoom>
          <ComposerPlaceholder>{PLACEHOLDER.FOLLOW_UP}</ComposerPlaceholder>
          <UnloadedComposerField />
        </ComposerFieldRoom>
        <ComposerFoot
          tools={
            <ComposerAttach>
              <AttachFilesButton label={BUTTON.ATTACH} disabled onFiles={takeNoFiles} />
            </ComposerAttach>
          }
          actions={
            <ComposerActions>
              {model === undefined ? (
                <Skeleton width={MODEL_NAME_WIDTH} />
              ) : (
                <Chip look={CHIP_LOOK.TOOLBAR} chevron>
                  <ChipName>
                    <ModelLabel choice={model.choice} models={model.models} />
                  </ChipName>
                </Chip>
              )}
            </ComposerActions>
          }
          send={{ label: BUTTON.SEND, empty: true }}
        />
      </PromptInputCard>
    </ComposerCard>
  );
}

/** A whole agent's tab before it can be drawn: the log's last exchange over the composer, which `label` names to a reader. */
export function AgentTabSkeleton({ label }: { label?: string | undefined }): React.JSX.Element {
  return (
    <AgentTabFrame>
      <TranscriptSkeleton label={label} />
      <AgentTabFoot>
        <ComposerSkeleton />
      </AgentTabFoot>
    </AgentTabFrame>
  );
}
