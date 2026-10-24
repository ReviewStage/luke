/**
 * messages.tsx -- a turn of a conversation and the line under it: who sent it, when, then its actions, in that order, the actions hidden until the pointer rests on the turn or the keyboard is on one of them, and on a touch screen shown by a tap on the turn.
 */

import {
  BUTTON_SIZE,
  CopyIcon,
  IconButton,
  MESSAGE_LINE_ALIGN,
  MessageActions,
  MessageFrame,
  MessageLine,
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
