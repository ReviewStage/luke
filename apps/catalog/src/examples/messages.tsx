import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_SIZE,
  CopyIcon,
  IconButton,
  INLINE_REF_LOOK,
  InlineRef,
  MESSAGE_LINE_ALIGN,
  MESSAGE_LINE_INSET,
  MessageActions,
  MessageFailedMark,
  MessageFrame,
  MessageHead,
  MessageLine,
  RetryIcon,
  SUBJECT_FIT,
  SubjectLine,
  Text,
} from "@repo/ui";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const SENT_AT = new Date(2026, 9, 14, 15, 42).getTime();

const ADA = (
  <InlineRef
    look={INLINE_REF_LOOK.WASH}
    glyph={<Avatar name="Ada Lovelace" size={AVATAR_SIZE.INLINE} decorative />}
    label="Ada Lovelace"
    onPress={() => {}}
  />
);

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
            <MessageHead sender={ADA}>
              <SubjectLine lead="answered" fit={SUBJECT_FIT.OWN}>
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
      <CatalogSection
        id="message-not-delivered"
        title="A sent message that did not go: the red alert beside it, its menu saying why, and Not delivered leading its time"
      >
        <div className="catalog-frame">
          <MessageFrame revealActionsOnTap>
            <div className="flex items-center justify-end gap-tight-gap">
              <Text>Rebase on main and fix the lint errors.</Text>
              <MessageFailedMark
                label="Not delivered"
                reason="No answer came back."
                groups={[[{ label: "Retry", icon: <RetryIcon />, onSelect: () => {} }]]}
                failure={CATALOG_FAILURE}
              />
            </div>
            <MessageLine status="Not delivered" at={SENT_AT} />
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
