import {
  AVATAR_SIZE,
  Avatar,
  DIALOG_SIZE,
  Dialog,
  PICTURE_TILE_FACE,
  PictureTile,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useImageZoom,
  usePictureExpand,
  ZoomImage,
} from "@repo/ui";
import { useId, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function screenshot(width: number, height: number, from: string, to: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect x="8%" y="10%" width="40%" height="8%" rx="4" fill="#fff9"/><rect x="8%" y="26%" width="84%" height="56%" rx="6" fill="#fff5"/></svg>`,
  )}`;
}

const SETTINGS = screenshot(360, 220, "#7aa7f4", "#3d5ac8");
const BEFORE = screenshot(320, 200, "#f4b37a", "#c8603d");
const AFTER = screenshot(200, 320, "#7af4b3", "#3dc87e");
const WINDOW = screenshot(1200, 760, "#b37af4", "#5a3dc8");

function useOpened(): [number, () => void] {
  const [opened, setOpened] = useState(0);
  return [opened, () => setOpened((was) => was + 1)];
}

function OpenedLine({ opened }: { opened: number }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      Opened {opened} {opened === 1 ? "time" : "times"}
    </Text>
  );
}

function OpenPicture({
  url,
  words,
  onClose,
}: {
  url: string;
  words: string;
  onClose: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const zoom = useImageZoom(words, url);
  const expand = usePictureExpand(true);
  return (
    <Dialog
      open
      size={DIALOG_SIZE.MEDIA}
      labelledBy={titleId}
      onDismiss={() => expand.close(onClose)}
      expand={expand}
    >
      <span id={titleId} className="catalog-picture-viewer-title">
        {words}
      </span>
      <div ref={zoom.frameRef} className="catalog-picture-viewer-body">
        <ZoomImage zoom={zoom} src={url} alt={words} />
      </div>
    </Dialog>
  );
}

function ExpandingTile(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="catalog-picture-row">
        <span className="catalog-picture-slot">
          <PictureTile name="The whole window" fill onOpen={() => setOpen(true)}>
            <span className="catalog-picture-frame catalog-picture-frame-wide">
              <img src={WINDOW} alt="The whole window" draggable={false} />
            </span>
          </PictureTile>
        </span>
        <span className="catalog-picture-slot" />
      </div>
      {open ? (
        <OpenPicture url={WINDOW} words="The whole window" onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function PictureTiles(): React.JSX.Element {
  const [hugged, openHugged] = useOpened();
  const [set, openSet] = useOpened();
  return (
    <>
      <CatalogSection id="picture-tiles-hug" title="Hugging its picture, named or not">
        <div className="catalog-stack">
          <PictureTile name="The settings page" onOpen={openHugged}>
            <span className="catalog-picture-frame">
              <img src={SETTINGS} alt="The settings page" draggable={false} />
            </span>
          </PictureTile>
          <PictureTile name="" onOpen={openHugged}>
            <span className="catalog-picture-frame">
              <img src={AFTER} alt="" draggable={false} />
            </span>
          </PictureTile>
          <OpenedLine opened={hugged} />
        </div>
      </CatalogSection>
      <CatalogSection id="picture-tiles-set" title="A set, each filling its room, captioned">
        <div className="catalog-stack">
          <div className="catalog-picture-row">
            {[
              { url: BEFORE, words: "Before" },
              { url: AFTER, words: "After, a caption longer than its tile" },
            ].map(({ url, words }) => (
              <span key={words} className="catalog-picture-slot">
                <PictureTile
                  name={words}
                  fill
                  onOpen={openSet}
                  caption={<span className="catalog-picture-caption">{words}</span>}
                >
                  <span className="catalog-picture-frame catalog-picture-frame-wide">
                    <img src={url} alt={words} draggable={false} />
                  </span>
                </PictureTile>
              </span>
            ))}
          </div>
          <OpenedLine opened={set} />
        </div>
      </CatalogSection>
      <CatalogSection
        id="picture-tiles-keyed"
        title="Opened by a key alone, a pointer's press falling through"
      >
        <div className="catalog-stack">
          <PictureTile name="A diagram" pointerOpens={false} onOpen={openHugged}>
            <span className="catalog-picture-frame">
              <img src={BEFORE} alt="A diagram" draggable={false} />
            </span>
          </PictureTile>
        </div>
      </CatalogSection>
      <CatalogSection id="picture-tiles-round" title="A person's disc, its face round">
        <div className="catalog-stack">
          <PictureTile name="Ada Lovelace" face={PICTURE_TILE_FACE.ROUND} onOpen={openHugged}>
            <Avatar name="Ada Lovelace" size={AVATAR_SIZE.MASTHEAD} decorative />
          </PictureTile>
        </div>
      </CatalogSection>
      <CatalogSection id="picture-tiles-expand" title="Opened over the window, grown from its tile">
        <div className="catalog-stack">
          <ExpandingTile />
        </div>
      </CatalogSection>
    </>
  );
}

export const PICTURE_TILES_EXAMPLE: Example = {
  id: "picture-tiles",
  title: "Picture tiles",
  Render: PictureTiles,
};
