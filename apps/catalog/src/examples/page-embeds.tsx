import { PAGE_EMBED_HEIGHT, PageEmbed, PageEmbedViewer } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * page-embeds.tsx -- a page drawn live in written words: at a stand-in's
 * height until it says how tall it is, at its whole height once it has, at a
 * screenful where it fills its frame, and opened full screen from its corner.
 */

const PAGE = `data:text/html,${encodeURIComponent(
  "<meta charset='utf-8'><meta name='color-scheme' content='light dark'><body style='margin:0;padding:16px;font:14px sans-serif'><h3 style='margin:0 0 8px'>Cold start by release</h3><p style='margin:0'>0.22: 1,420 ms · 0.23: 930 ms · 0.24: 880 ms</p>",
)}`;

const FRAME = { title: "Cold start by release", src: PAGE, sandbox: "allow-scripts" };

function PageEmbeds(): React.JSX.Element {
  const [fullScreen, setFullScreen] = useState(false);
  return (
    <>
      <CatalogSection id="page-embed-stand-in" title="Before the page says how tall it is">
        <div className="catalog-column">
          <PageEmbed frame={FRAME} height={{ kind: PAGE_EMBED_HEIGHT.STAND_IN }} />
        </div>
      </CatalogSection>
      <CatalogSection
        id="page-embed-measured"
        title="As tall as the page, its corner under the pointer"
      >
        <div className="catalog-column">
          <PageEmbed
            frame={FRAME}
            height={{ kind: PAGE_EMBED_HEIGHT.CONTENT, height: 96 }}
            onFullScreen={() => setFullScreen(true)}
            onOpenInPanel={() => undefined}
          />
        </div>
      </CatalogSection>
      <CatalogSection id="page-embed-fill" title="A page that fills whatever frame holds it">
        <div className="catalog-column">
          <PageEmbed frame={FRAME} height={{ kind: PAGE_EMBED_HEIGHT.FILL }} />
        </div>
      </CatalogSection>
      {fullScreen ? (
        <PageEmbedViewer
          frame={FRAME}
          onOpenInPanel={() => setFullScreen(false)}
          onClose={() => setFullScreen(false)}
        />
      ) : null}
    </>
  );
}

export const PAGE_EMBEDS_EXAMPLE: Example = {
  id: "page-embeds",
  title: "Page embeds",
  Render: PageEmbeds,
};
