import { PageEmbed } from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * page-embeds.tsx -- a page drawn live in written words: at a stand-in's
 * height until it says how tall it is, at its own height once it has, and
 * scrolling inside a screenful where it is taller.
 */

const PAGE = `data:text/html,${encodeURIComponent(
  "<meta charset='utf-8'><meta name='color-scheme' content='light dark'><body style='margin:0;padding:16px;font:14px sans-serif'><h3 style='margin:0 0 8px'>Cold start by release</h3><p style='margin:0'>0.22: 1,420 ms · 0.23: 930 ms · 0.24: 880 ms</p>",
)}`;

function PageEmbeds(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="page-embed-stand-in" title="Before the page says how tall it is">
        <div className="catalog-column">
          <PageEmbed
            frame={{ title: "A page", src: PAGE, sandbox: "allow-scripts" }}
            height={undefined}
          />
        </div>
      </CatalogSection>
      <CatalogSection id="page-embed-measured" title="As tall as the page">
        <div className="catalog-column">
          <PageEmbed frame={{ title: "A page", src: PAGE, sandbox: "allow-scripts" }} height={96} />
        </div>
      </CatalogSection>
      <CatalogSection id="page-embed-tall" title="A screenful of a taller page">
        <div className="catalog-column">
          <PageEmbed
            frame={{ title: "A page", src: PAGE, sandbox: "allow-scripts" }}
            height={2400}
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const PAGE_EMBEDS_EXAMPLE: Example = {
  id: "page-embeds",
  title: "Page embeds",
  Render: PageEmbeds,
};
