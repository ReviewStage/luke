import {
  PICTURE_SET_SHOWN,
  PictureSet,
  PictureSetTile,
  PictureStandIn,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { PICTURE_STATE, type PictureState } from "@luke/ui/picture-cache";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * picture-sets.tsx -- several pictures shown together: a few in one row at
 * their own shapes, captioned and stretched to the column; many as
 * thumbnails that wrap, six drawn, the last veiled with how many more; a
 * call's few as thumbnails, one still read and one not kept; and what
 * stands in a picture's place alone, read or gone. A press only counts,
 * since opening a picture over the window is the app's.
 */

/** A stand-in screenshot, `width` by `height`, in a gradient of `from` to `to`. */
function screenshot(width: number, height: number, from: string, to: string): PictureState {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect x="8%" y="10%" width="40%" height="8%" rx="4" fill="#fff9"/><rect x="8%" y="26%" width="84%" height="56%" rx="6" fill="#fff5"/></svg>`;
  return { kind: PICTURE_STATE.READY, url: `data:image/svg+xml,${encodeURIComponent(svg)}` };
}

const WIDE = { width: 1200, height: 720 } as const;
const TALL = { width: 390, height: 700 } as const;

const FEW = [
  { words: "Members page", caption: "Members page", size: WIDE, from: "#7aa7f4", to: "#3d5ac8" },
  { words: "On a phone", caption: "On a phone", size: TALL, from: "#7af4b3", to: "#3dc87e" },
] as const;

const MANY = Array.from({ length: 9 }, (_, at) => ({
  words: `Step ${String(at + 1)}`,
  size: at % 3 === 2 ? TALL : WIDE,
  from: at % 2 === 0 ? "#f4b37a" : "#b37af4",
  to: at % 2 === 0 ? "#c8603d" : "#5a3dc8",
}));

/** How many times a tile above was pressed. */
function OpenedLine({ opened }: { opened: number }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      Opened {opened} {opened === 1 ? "time" : "times"}
    </Text>
  );
}

function PictureSets(): React.JSX.Element {
  const [opened, setOpened] = useState(0);
  const open = () => setOpened((was) => was + 1);
  return (
    <>
      <CatalogSection id="picture-sets-few" title="A few, captioned, at their own shapes">
        <div className="catalog-column">
          <PictureSet label="Pictures the agent showed" count={FEW.length}>
            {FEW.map((each) => (
              <PictureSetTile
                key={each.words}
                state={screenshot(each.size.width, each.size.height, each.from, each.to)}
                width={each.size.width}
                height={each.size.height}
                words={each.words}
                caption={each.caption}
                onOpen={open}
              />
            ))}
          </PictureSet>
          <OpenedLine opened={opened} />
        </div>
      </CatalogSection>
      <CatalogSection id="picture-sets-many" title="Many, six drawn and the rest counted">
        <div className="catalog-column">
          <PictureSet label="Pictures the agent showed" count={MANY.length}>
            {MANY.slice(0, PICTURE_SET_SHOWN).map((each) => (
              <PictureSetTile
                key={each.words}
                state={screenshot(each.size.width, each.size.height, each.from, each.to)}
                width={each.size.width}
                height={each.size.height}
                words={each.words}
                onOpen={open}
              />
            ))}
          </PictureSet>
        </div>
      </CatalogSection>
      <CatalogSection
        id="picture-sets-call"
        title="A call's, as thumbnails: one read, one still read, one gone, one not kept, one failed"
      >
        <div className="catalog-column">
          <PictureSet label="Pictures the call answered" count={5} thumbnails>
            <PictureSetTile
              state={screenshot(1280, 800, "#7aa7f4", "#3d5ac8")}
              width={1280}
              height={800}
              words="screenshot-1"
              onOpen={open}
            />
            <PictureSetTile
              state={{ kind: PICTURE_STATE.READING }}
              width={1280}
              height={800}
              words="screenshot-2"
              onOpen={open}
            />
            <PictureSetTile state={{ kind: PICTURE_STATE.MISSING }} words="screenshot-3" />
            <PictureSetTile
              state={{ kind: PICTURE_STATE.MISSING }}
              words="screenshot-4"
              why="not kept · 6.4 MB"
            />
            <PictureSetTile
              state={{ kind: PICTURE_STATE.FAILED, retry: () => undefined }}
              width={1280}
              height={800}
              words="screenshot-5"
              onOpen={open}
            />
          </PictureSet>
        </div>
      </CatalogSection>
      <CatalogSection
        id="picture-sets-stand-in"
        title="In a picture's place: read, gone, and failed"
      >
        <div className="catalog-stack">
          <PictureStandIn state={PICTURE_STATE.READING} words="Members page" />
          <PictureStandIn state={PICTURE_STATE.MISSING} words="Members page" />
          <PictureStandIn state={PICTURE_STATE.MISSING} words="" />
          <PictureStandIn
            state={PICTURE_STATE.FAILED}
            words="Members page"
            onRetry={() => undefined}
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const PICTURE_SETS_EXAMPLE: Example = {
  id: "picture-sets",
  title: "Picture sets",
  Render: PictureSets,
};
