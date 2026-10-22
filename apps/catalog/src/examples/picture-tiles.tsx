import { PictureTile, TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * picture-tiles.tsx -- a picture that opens when pressed, sinking a little
 * under the press: one hugging its picture in a column of words, one with
 * no words of its own, and a row of tiles that fill the room each is given,
 * captioned under the picture. A press here only counts, since opening a
 * picture over the window is the app's.
 */

/** A stand-in screenshot, `width` by `height`, in a gradient of `from` to `to`. */
function screenshot(width: number, height: number, from: string, to: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect x="8%" y="10%" width="40%" height="8%" rx="4" fill="#fff9"/><rect x="8%" y="26%" width="84%" height="56%" rx="6" fill="#fff5"/></svg>`,
  )}`;
}

const SETTINGS = screenshot(360, 220, "#7aa7f4", "#3d5ac8");
const BEFORE = screenshot(320, 200, "#f4b37a", "#c8603d");
const AFTER = screenshot(200, 320, "#7af4b3", "#3dc87e");

/** Counts its presses, and says how many under the tiles it draws. */
function useOpened(): [number, () => void] {
  const [opened, setOpened] = useState(0);
  return [opened, () => setOpened((was) => was + 1)];
}

/** How many times a tile above was pressed. */
function OpenedLine({ opened }: { opened: number }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      Opened {opened} {opened === 1 ? "time" : "times"}
    </Text>
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
    </>
  );
}

export const PICTURE_TILES_EXAMPLE: Example = {
  id: "picture-tiles",
  title: "Picture tiles",
  Render: PictureTiles,
};
