import { WRITING_BLOCK, WRITING_INSERT, WRITING_MARK } from "@luke/settings/shortcuts";
import { GAP, Inline, TEXT_VARIANT, Text, WritingGlyph } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * writing-glyphs.tsx -- the glyph of every writing action, each mark, block
 * and insert, beside the action it stands for, as the format toolbar, Turn
 * into, and the `/` menu draw them.
 */

const GROUPS = [
  ["writing-marks", "Marks", Object.values(WRITING_MARK)],
  ["writing-blocks", "Blocks", Object.values(WRITING_BLOCK)],
  ["writing-inserts", "Inserts", Object.values(WRITING_INSERT)],
] as const;

function WritingGlyphs(): React.JSX.Element {
  return (
    <>
      {GROUPS.map(([id, title, actions]) => (
        <CatalogSection key={id} id={id} title={title}>
          <Inline gap={GAP.SECTION}>
            {actions.map((action) => (
              <Inline key={action} gap={GAP.CONTROL}>
                <WritingGlyph action={action} />
                <Text variant={TEXT_VARIANT.CAPTION}>{action}</Text>
              </Inline>
            ))}
          </Inline>
        </CatalogSection>
      ))}
    </>
  );
}

export const WRITING_GLYPHS_EXAMPLE: Example = {
  id: "writing-glyphs",
  title: "Writing glyphs",
  Render: WritingGlyphs,
};
