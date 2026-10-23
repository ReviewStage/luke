import {
  CODING_AGENT_STATUS,
  type CodingAgentAttachment,
  type CodingAgentMessage,
} from "@luke/features/coding-agent-wire";
import { BUTTON_SIZE, BUTTON_VARIANT, Button } from "@luke/ui";
import { type ReactNode, useState } from "react";
import { AgentComposer } from "./agent-composer.js";
import { useMessageAttachments } from "./agent-pictures.js";
import type { PublishedDoors } from "./agent-published.js";
import type { SkillSource } from "./skill-picker.js";
import type { AgentComposerControl } from "./use-agent-composer.js";

/**
 * edit-composer.tsx -- one of the developer's lines written again where it stands, in the agent's own message box.
 *
 * Edit opens the line as the box at the tab's foot is drawn, its "+",
 * Dictate, and `@` and `/` lists and all, holding the line's words and the
 * files it carried, which come off and on as a draft's do. What belongs to
 * the agent rather than to one line, its model, its servers, what it has
 * cost and what its context holds, stays on the foot's box alone. Cancel,
 * or Escape where no list or dictation takes it, closes it and sends
 * nothing; Send hands the words and files on to go in the line's place.
 * Its draft is its own and kept nowhere, so the foot's box keeps whatever
 * it held.
 */

/** What the foot's Cancel says. */
const CANCEL_WORDS = "Cancel";

/** What the box hands on as it sends, and the doors it is drawn with beside the tab's own box. */
export interface EditComposerDoors {
  readonly agentId: string;
  readonly doors: PublishedDoors;
  readonly keywords?: readonly string[] | undefined;
  readonly skills?: SkillSource | undefined;
  readonly dictates: boolean;
  readonly onCancel: () => void;
  readonly onSend: (words: string, attachments: readonly CodingAgentAttachment[]) => void;
}

const noop = () => undefined;

export function EditComposer({
  message,
  words,
  edit,
}: {
  message: CodingAgentMessage;
  /** The line's words as its bubble shows them. */
  words: string;
  edit: EditComposerDoors;
}): ReactNode {
  const opened = useMessageAttachments(message);
  const [draft, setDraft] = useState(words);
  const [attachments, setAttachments] = useState<readonly CodingAgentAttachment[]>(opened);
  const composer: AgentComposerControl = {
    draft,
    setDraft,
    attachments,
    setAttachments: (next) => setAttachments(next),
    sending: false,
    note: undefined,
    closed: undefined,
    send: () => edit.onSend(draft, attachments),
    retry: noop,
    sent: [],
  };
  return (
    <AgentComposer
      agentId={edit.agentId}
      // Note that the box's round button sends while it is open, whatever the agent is doing.
      status={CODING_AGENT_STATUS.COMPLETED}
      composer={composer}
      model={undefined}
      models={undefined}
      readModels={noop}
      usage={undefined}
      servers={undefined}
      published={undefined}
      doors={edit.doors}
      onStop={() => Promise.resolve()}
      followsUp
      keywords={edit.keywords}
      skills={edit.skills}
      dictates={edit.dictates}
      onLeave={edit.onCancel}
      beforeSend={() => (
        <Button variant={BUTTON_VARIANT.QUIET} size={BUTTON_SIZE.COMPACT} onClick={edit.onCancel}>
          {CANCEL_WORDS}
        </Button>
      )}
    />
  );
}
