/**
 * zoom-images.tsx -- a picture zoomed and moved about as Preview's is: a press zooms it in and back, a pinch or a Control-scroll zooms it about the pointer, the buttons step it, and zoomed it is dragged or scrolled about its frame.
 */

import { Button, Inline, Stack, useImageZoom, ZoomImage } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** A stand-in diagram, finer than its frame, so a press has pixels to zoom to. */
const DIAGRAM = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#7aa7f4"/><stop offset="1" stop-color="#3d5ac8"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect x="60" y="60" width="360" height="48" rx="8" fill="#fff9"/><rect x="60" y="150" width="840" height="390" rx="12" fill="#fff5"/></svg>`,
)}`;

function ZoomImages(): React.JSX.Element {
  const zoom = useImageZoom("diagram.svg", DIAGRAM);
  return (
    <CatalogSection id="zoom-image-frame" title="A picture in its frame">
      <Stack>
        <Inline>
          <Button onClick={() => zoom.step(-1)}>Zoom out</Button>
          <Button onClick={() => zoom.step(1)}>Zoom in</Button>
        </Inline>
        <div ref={zoom.frameRef} className="catalog-zoom-frame">
          <ZoomImage zoom={zoom} src={DIAGRAM} alt="A diagram" />
        </div>
      </Stack>
    </CatalogSection>
  );
}

export const ZOOM_IMAGES_EXAMPLE: Example = {
  id: "zoom-images",
  title: "Zoom images",
  Render: ZoomImages,
};
