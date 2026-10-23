import { harnessNameOf } from "@luke/features/agent-runtime-models";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import * as ui from "@luke/ui";
import { HarnessMark, MARK_PROVIDER, PROVIDER_MARK_SIZE, ProviderMark, WingFace } from "@luke/ui";
import codexOneX from "../../../../packages/panel/marks/codex-16.png";
import codexTwoX from "../../../../packages/panel/marks/codex-32.png";
import codexThreeX from "../../../../packages/panel/marks/codex-48.png";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * artwork.tsx -- the production artwork `@luke/ui` draws from `@luke/brand`'s
 * generated sources: Luke's face at rest, every glyph, and every provider's
 * mark, each drawn from the package itself rather than from a copy.
 */

/** Codex's picture as the desktop serves it, from the panel's own files. */
const CODEX_ART = { oneX: codexOneX, twoX: codexTwoX, threeX: codexThreeX };

/** A glyph's name as `@luke/ui` exports it: every glyph ends in `Icon`, a heading's starts with `Heading`. */
type GlyphName = Extract<keyof typeof ui, `${string}Icon` | `Heading${string}`>;

/** Whether an export of the package is a glyph, by the name it is exported under. */
function isGlyph(entry: [string, unknown]): entry is [GlyphName, (typeof ui)[GlyphName]] {
  return entry[0].endsWith("Icon") || entry[0].startsWith("Heading");
}

/** Every glyph `face/glyphs.tsx` draws, by the name it is exported under, read off the package so none is left out. */
const GLYPHS = Object.entries(ui).filter(isGlyph);

function Artwork(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="artwork-face" title="Face">
        <div className="catalog-face">
          <WingFace />
        </div>
      </CatalogSection>
      <CatalogSection id="artwork-face-muted" title="Muted face, filling its box">
        <div className="catalog-face">
          <WingFace muted fill />
        </div>
      </CatalogSection>
      <CatalogSection id="artwork-face-inherit" title="Face in its holder's ink, filling its box">
        <div className="catalog-face">
          <WingFace fill inherit />
        </div>
      </CatalogSection>
      <CatalogSection id="artwork-glyphs" title="Glyphs">
        <ul className="catalog-tiles">
          {GLYPHS.map(([name, Glyph]) => (
            <li key={name} className="catalog-tile">
              <span className="catalog-glyph">
                <Glyph />
              </span>
              <span className="catalog-tile-name">{name}</span>
            </li>
          ))}
        </ul>
      </CatalogSection>
      <CatalogSection id="artwork-harness-marks" title="Harness marks">
        <ul className="catalog-tiles">
          {Object.values(MODEL_PROVIDER).map((provider) => (
            <li key={provider} className="catalog-tile">
              <span className="catalog-glyph">
                <HarnessMark provider={provider} codexArt={CODEX_ART} />
              </span>
              <span className="catalog-tile-name">{harnessNameOf(provider)}</span>
            </li>
          ))}
        </ul>
      </CatalogSection>
      <CatalogSection id="artwork-marks" title="Provider marks">
        <ul className="catalog-tiles">
          {Object.values(MARK_PROVIDER).map((provider) => (
            <li key={provider} className="catalog-tile">
              <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.ROW} />
              <span className="catalog-tile-name">{provider}</span>
            </li>
          ))}
        </ul>
      </CatalogSection>
    </>
  );
}

export const ARTWORK_EXAMPLE: Example = { id: "artwork", title: "Artwork", Render: Artwork };
