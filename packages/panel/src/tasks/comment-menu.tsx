import { BUTTON_SIZE, MoreButton, moreLabel, useMenu } from "@repo/ui";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";

/**
 * comment-menu.tsx -- a comment's ⋯ and the menu it drops, its writer's acts on it, as every comment draws them: a description's, a page's, and a pull request's, posted or pending.
 */

/** What the ⋯ and its menu are named for. */
const THING = "Comment";

/** A comment's ⋯ and its menu; nothing where it offers no act, rather than a ⋯ opening an empty menu. */
export function CommentMenu({
  groups,
}: {
  groups: readonly MenuAction[][];
}): React.JSX.Element | null {
  const menu = useMenu(true);
  const trigger = menu.trigger();
  if (groups.length === 0) return null;
  return (
    <>
      <MoreButton thing={THING} size={BUTTON_SIZE.COMPACT} {...trigger} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={moreLabel(THING)}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </>
  );
}
