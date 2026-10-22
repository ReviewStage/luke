import { APP_COMMAND, APP_SHORTCUTS, SHORTCUT_KEY } from "@luke/settings/shortcuts";
import { GAP, Inline, Shortcut, Stack, Text } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * shortcuts.tsx -- chords as the window prints them: a command's beside its
 * words, a bare key, a system-wide key's accelerator, and a chord that is a
 * row's whole value, drawn at the row's label size and read aloud. Under a
 * finger only the value stands.
 */

function Shortcuts(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="shortcut-hints" title="Beside words">
        <Stack gap={GAP.CONTROL}>
          <Inline gap={GAP.CONTROL}>
            <Text>New task</Text>
            <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_TASK].chord} />
          </Inline>
          <Inline gap={GAP.CONTROL}>
            <Text>Close</Text>
            <Shortcut chord={{ key: SHORTCUT_KEY.ESCAPE, bare: true }} />
          </Inline>
          <Inline gap={GAP.CONTROL}>
            <Text>Talk to Luke</Text>
            <Shortcut accelerator="Alt+Space" />
          </Inline>
        </Stack>
      </CatalogSection>
      <CatalogSection id="shortcut-values" title="A row's value">
        <Inline gap={GAP.CONTROL}>
          <Text>Command palette</Text>
          <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE].chord} value spoken />
        </Inline>
      </CatalogSection>
    </>
  );
}

export const SHORTCUTS_EXAMPLE: Example = {
  id: "shortcuts",
  title: "Shortcuts",
  Render: Shortcuts,
};
