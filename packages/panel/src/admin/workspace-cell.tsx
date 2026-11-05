/**
 * workspace-cell.tsx -- a workspace's name wherever an admin table names one, opening its page.
 *
 * Where the mount keeps addresses, the name is a real anchor, so a keyboard
 * reaches the workspace and a modified click still gets the browser's own
 * gesture; where it keeps none, it is a button, as an account's cell is.
 */

import { TEXT_ELEMENT, TEXT_VARIANT, Text, TextButton, TextLink } from "@repo/ui";
import { useAdminDoorsIfAny } from "./admin-doors.js";
import { plainLeftClick } from "./routing.js";

export function WorkspaceCell({
  workspace,
  onOpen,
}: {
  workspace: { readonly id: string; readonly name: string };
  onOpen: (id: string) => void;
}): React.JSX.Element {
  const href = useAdminDoorsIfAny()?.address.workspaceHref(workspace.id);
  const name = (
    <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
      {workspace.name}
    </Text>
  );
  if (href === undefined) {
    return <TextButton onClick={() => onOpen(workspace.id)}>{name}</TextButton>;
  }
  return (
    <TextLink
      href={href}
      onClick={(event) => {
        if (!plainLeftClick(event)) return;
        event.preventDefault();
        onOpen(workspace.id);
      }}
    >
      {name}
    </TextLink>
  );
}
