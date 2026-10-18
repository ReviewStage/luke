import {
  AVATAR_SHAPE,
  AVATAR_SIZE,
  Avatar,
  GAP,
  Inline,
  Stack,
  TerminalIcon,
  Text,
  WingFace,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * avatars.tsx -- every size with a picture, a letter, a picture that fails,
 * and a name with no letter, side by side so their boxes line up; an app's
 * square by its picture, its glyph bare and tiled, and its letter; the six
 * hues; and discs beside the names they stand for in a narrow column.
 */

/** A synthetic picture drawn in place, so the catalog renders offline. */
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#f4b860"/><stop offset="1" stop-color="#c8553d"/></linearGradient></defs><rect width="40" height="40" fill="url(#g)"/><circle cx="20" cy="16" r="7" fill="#fff8"/><path d="M6 40a14 14 0 0 1 28 0" fill="#fff8"/></svg>',
)}`;

/** An address whose bytes are no picture, so the disc shows what a failed fetch leaves. */
const BROKEN = "data:image/png;base64,AAAA";

const NAMES = [
  "Ada Lovelace",
  "Grace Hopper",
  "Katherine Johnson",
  "Margaret Hamilton",
  "Radia Perlman",
  "Hedy Lamarr",
];

function Avatars(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="avatar-states" title="Picture, letter, failed picture, no letter">
        <Stack gap={GAP.CONTROL}>
          {Object.values(AVATAR_SIZE).map((size) => (
            <Inline key={size} gap={GAP.CONTROL} align="center">
              <Avatar name="Ada Lovelace" src={PICTURE} size={size} />
              <Avatar name="Ada Lovelace" size={size} />
              <Avatar name="Ada Lovelace" src={BROKEN} size={size} />
              <Avatar name="" size={size} />
            </Inline>
          ))}
        </Stack>
      </CatalogSection>
      <CatalogSection id="avatar-squares" title="Square: picture, glyph, tiled glyph, letter">
        <Stack gap={GAP.CONTROL}>
          {Object.values(AVATAR_SIZE).map((size) => (
            <Inline key={size} gap={GAP.CONTROL} align="center">
              <Avatar name="Vercel" src={PICTURE} shape={AVATAR_SHAPE.SQUARE} size={size} />
              <Avatar
                name="Agent"
                glyph={<TerminalIcon />}
                shape={AVATAR_SHAPE.SQUARE}
                size={size}
              />
              <Avatar
                name="Luke"
                glyph={<WingFace />}
                shape={AVATAR_SHAPE.SQUARE}
                size={size}
                tiled
              />
              <Avatar name="Vercel" shape={AVATAR_SHAPE.SQUARE} size={size} />
            </Inline>
          ))}
        </Stack>
      </CatalogSection>
      <CatalogSection id="avatar-hues" title="Hues">
        <Inline gap={GAP.CONTROL}>
          {NAMES.map((name) => (
            <Avatar key={name} name={name} size={AVATAR_SIZE.CARD} />
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="avatar-names" title="Beside their names, narrow column">
        <div className="catalog-narrow">
          {NAMES.slice(0, 3).map((name, index) => (
            <Inline key={name} gap={GAP.ICON} wrap={false}>
              {index === 0 ? (
                <Avatar name={name} src={PICTURE} size={AVATAR_SIZE.ROW} decorative />
              ) : (
                <Avatar name={name} size={AVATAR_SIZE.ROW} decorative />
              )}
              <Text>{index === 2 ? `${name}, Director of Flight Research Operations` : name}</Text>
            </Inline>
          ))}
        </div>
      </CatalogSection>
    </>
  );
}

export const AVATARS_EXAMPLE: Example = { id: "avatars", title: "Avatars", Render: Avatars };
