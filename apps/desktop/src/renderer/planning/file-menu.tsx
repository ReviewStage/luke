import { CopyIcon, DownloadIcon, EllipsisIcon } from "@sidecar/panel";
import { ClipboardCopyIcon, ListOrderedIcon, WrapTextIcon } from "lucide-react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { useCopyToast } from "../copy-feedback";
import { ActionMenu, dropBelow, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { Tooltip } from "../tooltip";
import { fileName } from "./code-pane-model";
import { useFileViewSettings } from "./file-view-settings";

/**
 * file-menu.tsx -- the File view bar's ⋯: what is done with the file shown, then how every File tab draws its lines.
 *
 * The window's own menu (`../desktop/action-menu.tsx`), as the plan's ⋯
 * draws it: the file's name or its whole text copied, said in the copy
 * toast as every copy from a menu is; the file saved where the system's
 * save dialog chooses (`ACT_KIND.WINDOW_SAVE_FILE`); and, under a rule, the
 * File tabs' two settings as checks (`file-view-settings.ts`). The text is
 * read whole only when it is asked for, a window at a time, so a file
 * scrolled through a window costs nothing more until it is copied.
 */

/** What the menu says where the file's text could not be read whole. */
const UNREAD = "Could not read the whole file.";

export function FileMenu({
  path,
  ready,
  readText,
}: {
  /** The file shown, from the repository's root. */
  path: string;
  /** Whether the file was read, so its text can be: a file refused or still loading offers its name alone. */
  ready: boolean;
  /** The file's whole text, read a window at a time, or nothing where a window did not land. */
  readText: () => Promise<string | undefined>;
}): React.JSX.Element {
  const menu = useActionMenu(true);
  const { act } = useAct();
  const copyWithToast = useCopyToast();
  const show = useToast();
  const { settings, change } = useFileViewSettings();
  const name = fileName(path);
  const failed = (words: string) =>
    show({ words, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });

  const withText = (use: (text: string) => void) =>
    readText().then((text) => (text === undefined ? failed(UNREAD) : use(text)));
  const save = (text: string) =>
    act(ACT_KIND.WINDOW_SAVE_FILE, { name, text }).then(
      (saved) => {
        if (saved) show({ words: "File saved", tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
      },
      () => failed("Could not save the file."),
    );

  const groups: readonly (readonly MenuAction[])[] = [
    [
      {
        label: "Copy file name",
        icon: <CopyIcon />,
        onSelect: () => copyWithToast(name, "File name copied"),
      },
      {
        label: "Copy file contents",
        icon: <ClipboardCopyIcon aria-hidden="true" />,
        disabled: !ready,
        onSelect: () => withText((text) => copyWithToast(text, "File contents copied")),
      },
      {
        label: "Download file",
        icon: <DownloadIcon />,
        disabled: !ready,
        onSelect: () => withText(save),
      },
    ],
    [
      {
        label: "Line numbers",
        icon: <ListOrderedIcon aria-hidden="true" />,
        checked: settings.lineNumbers,
        onSelect: () => change({ lineNumbers: !settings.lineNumbers }),
      },
      {
        label: "Word wrap",
        icon: <WrapTextIcon aria-hidden="true" />,
        checked: settings.wordWrap,
        onSelect: () => change({ wordWrap: !settings.wordWrap }),
      },
    ],
  ];

  return (
    <>
      <Tooltip label="File actions">
        <button
          type="button"
          className="icon-button"
          aria-label="File actions"
          aria-haspopup="menu"
          aria-expanded={menu.open !== undefined}
          onClick={(event) => {
            if (menu.open !== undefined) {
              menu.close(true);
              return;
            }
            menu.show(dropBelow(event.currentTarget), event.currentTarget);
          }}
        >
          <EllipsisIcon />
        </button>
      </Tooltip>
      {menu.open === undefined ? null : (
        <ActionMenu label="File actions" menu={menu.open} groups={groups} onClose={menu.close} />
      )}
    </>
  );
}
