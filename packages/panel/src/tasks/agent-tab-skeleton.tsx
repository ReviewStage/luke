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

const TRANSCRIPT_LOADING_LABEL = readingWords("the transcript");

const LOG_LINE_WIDTHS = {
  ASKED: ["208px", "132px"],
  REPLY: ["94%", "86%", "58%"],
  WORKED: "36%",
} as const;

const MODEL_NAME_WIDTH = "96px";

export interface ComposerModel {
  readonly choice: ModelChoice;
  readonly models: readonly CatalogModel[];
}

function takeNoFiles(): void {}

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

export function ComposerSkeleton({
  model,
}: {
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
