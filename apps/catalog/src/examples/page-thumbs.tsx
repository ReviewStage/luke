import { CheckIcon, PAGE_THUMB_SIZE, PageThumb } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * page-thumbs.tsx -- a small inert preview in a page's shape: a card's
 * preview as wide as its column, a row's tile with a picture, a glyph where
 * the page is gone, and the ground alone while it is read.
 */

const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="100%" height="100%" fill="#7aa7f4"/><rect x="12" y="12" width="70" height="10" rx="4" fill="#fff9"/></svg>',
)}`;

const PAGE = `data:text/html,${encodeURIComponent("<body style='margin:0;font:48px sans-serif;background:#fff'><h1>A page</h1>")}`;

function PageThumbs(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="page-thumb-card" title="A card's preview">
        <div className="catalog-column">
          <PageThumb frame={{ title: "A page", src: PAGE, sandbox: "allow-scripts" }} />
        </div>
      </CatalogSection>
      <CatalogSection id="page-thumb-row" title="A row's tiles">
        <div className="catalog-stack">
          <PageThumb size={PAGE_THUMB_SIZE.ROW} image={PICTURE} />
          <PageThumb
            size={PAGE_THUMB_SIZE.ROW}
            frame={{ title: "A page", src: PAGE, sandbox: "allow-scripts", lazy: true }}
          />
          <PageThumb size={PAGE_THUMB_SIZE.ROW} glyph={<CheckIcon />} />
          <PageThumb size={PAGE_THUMB_SIZE.ROW} />
        </div>
      </CatalogSection>
    </>
  );
}

export const PAGE_THUMBS_EXAMPLE: Example = {
  id: "page-thumbs",
  title: "Page thumbs",
  Render: PageThumbs,
};
