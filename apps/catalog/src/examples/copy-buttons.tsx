import { devBuildBadge } from "@repo/settings/dev-build";
import {
  BUTTON_SIZE,
  BuildChip,
  COPY_FIELD_WIDTH,
  COPY_LOOK,
  CopyButton,
  CopyField,
  GAP,
  Inline,
  Stack,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * copy-buttons.tsx -- the one Copy, named for what it copies: one whose copy
 * lands and turns to the check, one the clipboard refuses and turns to the
 * alert, compact, one with nothing to copy, and the chip look that names
 * what it copies, a branch, and a development build's chip, led by its
 * color; and a field that shows what it copies, at a control's width and
 * across its row. The catalog's copy act is
 * the browser's own clipboard; an app hands in its shell's.
 */

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

/** Two development builds, a named instance and a plain one on a detached head. */
const BUILDS = [
  devBuildBadge({ instance: "demo", commit: { sha: "f8b5406", dirty: false, branch: "main" } }),
  devBuildBadge({ commit: { sha: "8f3c2a1", dirty: true, branch: "fix/merge-queue-notice~2" } }),
];

const refuse = (): Promise<void> => Promise.reject(new Error("The clipboard refused the copy."));

function CopyButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="copy-button-copies" title="Copies, and turns to the check">
        <Inline gap={GAP.CONTROL}>
          <CopyButton text="pnpm exec vitest run" what="code" copy={copyToClipboard} />
          <CopyButton text="https://example.com/plan/42" what="link" copy={copyToClipboard} />
        </Inline>
      </CatalogSection>
      <CatalogSection id="copy-button-refused" title="Refused, and says so">
        <CopyButton text="pnpm exec vitest run" what="code" copy={refuse} />
      </CatalogSection>
      <CatalogSection id="copy-button-sizes" title="Compact, and nothing to copy">
        <Inline gap={GAP.CONTROL}>
          <CopyButton
            text="feat/ui-copy-button"
            what="branch name"
            copy={copyToClipboard}
            size={BUTTON_SIZE.COMPACT}
          />
          <CopyButton text="" what="lines" copy={copyToClipboard} disabled />
        </Inline>
      </CatalogSection>
      <CatalogSection id="copy-button-chip" title="A chip that names what it copies">
        <Inline gap={GAP.CONTROL}>
          <CopyButton
            look={COPY_LOOK.CHIP}
            lead={GLYPH.BRANCH}
            text="main"
            what="branch main"
            copy={copyToClipboard}
          />
          <CopyButton
            look={COPY_LOOK.CHIP}
            lead={GLYPH.BRANCH}
            text="agent/copy-button-chip-look-for-the-branch-chips"
            what="branch agent/copy-button-chip-look-for-the-branch-chips"
            copy={refuse}
          />
        </Inline>
      </CatalogSection>
      <CatalogSection id="copy-field" title="A field that shows what it copies">
        <Stack gap={GAP.CONTROL}>
          <Inline gap={GAP.CONTROL}>
            <CopyField
              label="Server URL"
              value="https://app.example.com/api/mcp"
              what="URL"
              copy={copyToClipboard}
            />
          </Inline>
          <CopyField
            label="Claude Code command"
            value="claude mcp add --transport http example https://app.example.com/api/mcp"
            what="command"
            copy={copyToClipboard}
            width={COPY_FIELD_WIDTH.FULL}
          />
        </Stack>
      </CatalogSection>
      <CatalogSection id="copy-button-build" title="A development build, led by its color">
        <Inline gap={GAP.CONTROL}>
          {BUILDS.map((build) => (
            <BuildChip
              key={build.detail}
              detail={build.detail}
              color={build.color}
              copy={copyToClipboard}
            />
          ))}
        </Inline>
      </CatalogSection>
    </>
  );
}

export const COPY_BUTTONS_EXAMPLE: Example = {
  id: "copy-buttons",
  title: "Copy buttons",
  Render: CopyButtons,
};
