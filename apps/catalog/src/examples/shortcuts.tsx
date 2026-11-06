import { PRODUCT_NAME } from "@repo/features/product-name";
import { APP_COMMAND, APP_SHORTCUTS, SHORTCUT_KEY } from "@repo/settings/shortcuts";
import { GAP, Inline, Shortcut, Stack, Text } from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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
            <Text>Talk to {PRODUCT_NAME}</Text>
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
