/**
 * messages.tsx -- a turn of a conversation, the line over a received one naming who sent it and what they did, and the line under every one: when, then its actions, flush with an agent's words where they stand on no bubble, the actions hidden until the pointer rests on the turn or the keyboard is on one of them, and on a touch screen shown by a tap on the turn.
 */

import {
  BUTTON_SIZE,
  CopyIcon,
  IconButton,
  INLINE_REF_LOOK,
  InlineRef,
  MESSAGE_LINE_ALIGN,
  MESSAGE_LINE_INSET,
  MessageActions,
  MessageFrame,
  MessageHead,
  MessageLine,
  SUBJECT_FIT,
  SubjectLine,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** Oct 14, 2026, 3:42 PM, on the viewer's own clock. */
const SENT_AT = new Date(2026, 9, 14, 15, 42).getTime();

const COPY = (
  <MessageActions>
    <IconButton icon={<CopyIcon />} label="Copy" size={BUTTON_SIZE.COMPACT} onClick={() => {}} />
  </MessageActions>
);

function Messages(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="message-sent" title="A sent message's line, at the column's right">
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <Text>Rerunning the spec on WebKit.</Text>
            <MessageLine sender="Dean" at={SENT_AT} actions={COPY} />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection id="message-received" title="A received message's line, at the column's left">
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <Text>Which browser is it failing on?</Text>
            <MessageLine
              align={MESSAGE_LINE_ALIGN.START}
              sender="Ada"
              at={SENT_AT}
              actions={COPY}
            />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection
        id="message-head"
        title="A received message names its sender over it, the time and actions under it"
      >
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <MessageHead sender="Ada" />
            <Text>Which browser is it failing on?</Text>
            <MessageLine align={MESSAGE_LINE_ALIGN.START} at={SENT_AT} actions={COPY} />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection
        id="message-head-thread"
        title="A received thread line names its sender, then what they did on the thread"
      >
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <MessageHead sender="Ada">
              <SubjectLine lead="Thread answer" fit={SUBJECT_FIT.OWN}>
                <InlineRef
                  look={INLINE_REF_LOOK.PILL}
                  label="Expire an invitation after a week?"
                  onPress={() => {}}
                />
              </SubjectLine>
            </MessageHead>
            <Text>Yes, a week.</Text>
            <MessageLine align={MESSAGE_LINE_ALIGN.START} at={SENT_AT} actions={COPY} />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection
        id="message-flush"
        title="An agent's turn, its words on no bubble, leads its line flush with them"
      >
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <Text>The spec passes on WebKit now.</Text>
            <MessageLine
              align={MESSAGE_LINE_ALIGN.START}
              inset={MESSAGE_LINE_INSET.FLUSH}
              sender="Worked for 2m 29s · Today, 3:42 PM"
              actions={COPY}
            />
          </MessageFrame>
        </div>
      </CatalogSection>
      <CatalogSection id="message-own" title="The reader's own line names no one">
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <Text>Looks good, merging.</Text>
            <MessageLine at={SENT_AT} actions={COPY} />
          </MessageFrame>
        </div>
      </CatalogSection>
    </>
  );
}

export const MESSAGES_EXAMPLE: Example = {
  id: "messages",
  title: "Messages",
  Render: Messages,
};
