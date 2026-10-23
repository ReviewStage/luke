/**
 * messages.tsx -- a turn of a conversation and its actions, hidden until the pointer rests on the turn or the keyboard is on one of them, and on a touch screen shown by a tap on the turn: floated on a card over its corner, or set in the line under it.
 */

import {
  BUTTON_SIZE,
  CopyIcon,
  IconButton,
  MESSAGE_ACTIONS_PLACEMENT,
  MessageActions,
  type MessageActionsPlacement,
  MessageFrame,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** A turn whose Copy stands where `placement` says. */
function Turn({ placement }: { placement: MessageActionsPlacement }): React.JSX.Element {
  const actions = (
    <MessageActions placement={placement}>
      <IconButton icon={<CopyIcon />} label="Copy" size={BUTTON_SIZE.COMPACT} onClick={() => {}} />
    </MessageActions>
  );
  return (
    <div className="catalog-frame">
      <MessageFrame revealActionsOnTap>
        {placement === MESSAGE_ACTIONS_PLACEMENT.FLOATING ? actions : null}
        <Text>Rerunning the spec on WebKit.</Text>
        {placement === MESSAGE_ACTIONS_PLACEMENT.INLINE ? actions : null}
      </MessageFrame>
    </div>
  );
}

function Messages(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="message-floating" title="Actions floated over the turn's corner">
        <Turn placement={MESSAGE_ACTIONS_PLACEMENT.FLOATING} />
      </CatalogSection>
      <CatalogSection id="message-inline" title="Actions in the line under the turn">
        <Turn placement={MESSAGE_ACTIONS_PLACEMENT.INLINE} />
      </CatalogSection>
    </>
  );
}

export const MESSAGES_EXAMPLE: Example = {
  id: "messages",
  title: "Messages",
  Render: Messages,
};
