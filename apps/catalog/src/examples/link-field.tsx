import { GAP, LinkField, Stack } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * link-field.tsx -- the popover a link is written in: over words not linked
 * yet, empty; and over a link already there, holding it, with Open and
 * Remove beside it.
 */

const ignore = () => undefined;

function LinkFieldExample(): React.JSX.Element {
  return (
    <CatalogSection id="link-field" title="A new link, and one already there">
      <Stack gap={GAP.FIELD}>
        <LinkField onApply={ignore} onCancel={ignore} />
        <LinkField
          href="https://github.com/ReviewStage/luke/pull/4819"
          onApply={ignore}
          onCancel={ignore}
          onOpen={ignore}
          onRemove={ignore}
        />
      </Stack>
    </CatalogSection>
  );
}

export const LINK_FIELD_EXAMPLE: Example = {
  id: "link-field",
  title: "Link field",
  Render: LinkFieldExample,
};
