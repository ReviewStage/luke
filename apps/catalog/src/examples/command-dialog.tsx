import { APP_COMMAND, APP_SHORTCUTS, SHORTCUT_KEY } from "@luke/settings/shortcuts";
import { BUTTON_VARIANT, Button, Shortcut } from "@luke/ui";
import { CommandDialog, type CommandGroup } from "@luke/ui/command";
import { GLYPH } from "@luke/ui/icons";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * command-dialog.tsx -- a palette of tasks and actions, found by typing and
 * chosen with the arrows and Return, its keys' hints along its foot and a
 * failed source's note under its group; and one still reading its rows.
 * Each opens from its button and goes with Escape, a press on the dimmed
 * window, or a row chosen.
 */

/** The palette's rows, each closing it as it is chosen. */
function paletteGroups(close: () => void): CommandGroup[] {
  return [
    {
      id: "tasks",
      label: "Tasks",
      items: [
        {
          id: "task-41",
          lead: "LUKE-41",
          icon: <GLYPH.TASK />,
          label: "Ship the voice window",
          detail: "luke",
          words: "LUKE-41 Ship the voice window luke",
          onSelect: close,
        },
        {
          id: "task-42",
          lead: "LUKE-42",
          icon: <GLYPH.TASK />,
          label: "Fix the login page on a phone's narrow screen",
          detail: "web",
          words: "LUKE-42 Fix the login page on a phone's narrow screen web",
          onSelect: close,
        },
      ],
      note: "Archived tasks could not be read.",
    },
    {
      id: "actions",
      label: "Actions",
      items: [
        {
          id: "new-task",
          icon: <GLYPH.ADD />,
          label: "New task",
          hint: <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_TASK].chord} spoken />,
          words: "New task",
          onSelect: close,
        },
        {
          id: "settings",
          icon: <GLYPH.SETTINGS />,
          label: "Open Settings",
          words: "Open Settings preferences",
          opens: true,
          onSelect: close,
        },
        {
          id: "archive",
          icon: <GLYPH.ARCHIVE />,
          label: "Archive task",
          detail: "No task is open",
          words: "Archive task",
          disabled: true,
          onSelect: close,
        },
      ],
    },
  ];
}

/** The keys' hints along the palette's foot. */
function PaletteFoot(): React.JSX.Element {
  return (
    <>
      <span>
        <Shortcut chord={{ key: SHORTCUT_KEY.ENTER, bare: true }} /> Open
      </span>
      <span>
        <Shortcut chord={{ key: SHORTCUT_KEY.ESCAPE, bare: true }} /> Close
      </span>
    </>
  );
}

function CommandDialogExample(): React.JSX.Element {
  const [palette, setPalette] = useState(false);
  const [reading, setReading] = useState(false);
  return (
    <>
      <CatalogSection id="command-dialog-palette" title="A palette, its groups, keys and notes">
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setPalette(true)}>
          Open the palette
        </Button>
        <CommandDialog
          open={palette}
          onOpenChange={setPalette}
          label="Command palette"
          placeholder="Search tasks and actions"
          groups={paletteGroups(() => setPalette(false))}
          foot={<PaletteFoot />}
        />
      </CatalogSection>
      <CatalogSection id="command-dialog-reading" title="Still reading its rows">
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setReading(true)}>
          Open while reading
        </Button>
        <CommandDialog
          open={reading}
          onOpenChange={setReading}
          label="Command palette"
          placeholder="Search tasks"
          groups={[]}
          loading="Reading tasks"
        />
      </CatalogSection>
    </>
  );
}

export const COMMAND_DIALOG_EXAMPLE: Example = {
  id: "command-dialog",
  title: "Command dialog",
  Render: CommandDialogExample,
};
