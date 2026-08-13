import { PROVIDER_ID } from "@sidecar/core";
import { useId } from "react";

/**
 * The provider marks, and the one badge that rides them.
 *
 * Provider marks are inlined as path data rather than bundled image files, so
 * the renderer stays asset-free and the marks scale with the surface.
 *
 * Each is the provider's own mark, reproduced rather than redrawn — Claude Code
 * via Simple Icons (CC0-1.0, sourced from code.claude.com), Codex via
 * @lobehub/icons (MIT), Conductor's letter mark verbatim from the published
 * brand kit at https://www.conductor.build/brandkit, Cursor via Simple Icons
 * (CC0-1.0, sourced from https://cursor.com/brand), and Devin's verbatim from
 * the mark https://devin.ai serves as its own favicon and site header. Each
 * keeps its own brand colour (see the `--mark-*` custom properties), so a mark
 * says which provider a session belongs to while the chips and row tints say
 * what state it is in. Cursor and Devin each publish one silhouette rather than
 * a colour, so both are drawn in the light form their brand uses on a dark
 * surface. They are trademarks of their respective owners. Do not restyle the
 * geometry or recolour them; swap the path if a provider publishes an updated
 * mark.
 */
interface MarkProps {
  className?: string;
}

const CLAUDE_CODE_PATH =
  "M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z";

const CODEX_PATH =
  "M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z";

const CURSOR_PATH =
  "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23";

const DEVIN_PATH =
  "M70 159.333V91.3471C70 88.3592 71.594 85.5983 74.1816 84.1044L133.043 50.1205C135.631 48.6265 138.819 48.6265 141.407 50.1205L200.269 84.1044C202.856 85.5983 204.45 88.3592 204.45 91.3471V126.068C204.708 137.606 210.806 148.734 221.531 154.926C232.256 161.117 244.942 160.834 255.063 155.289L285.132 137.929C287.719 136.435 290.907 136.435 293.495 137.929L352.357 171.913C354.944 173.406 356.538 176.167 356.538 179.155V247.123C356.538 250.111 354.944 252.872 352.357 254.366L293.495 288.35C290.907 289.844 287.719 289.844 285.132 288.35L255.306 271.13C245.146 265.456 232.344 265.117 221.534 271.358C210.809 277.55 204.711 288.678 204.453 300.215V334.926C204.453 337.914 202.859 340.675 200.271 342.169L141.41 376.153C138.822 377.647 135.634 377.647 133.046 376.153L74.1845 342.169C71.5969 340.675 70.0028 337.914 70.0028 334.926V266.959C70.0029 263.971 71.5969 261.21 74.1845 259.716L133.046 225.732C135.634 224.238 138.822 224.238 141.41 225.732L171.547 243.132C181.656 248.638 194.306 248.906 205.005 242.729C215.815 236.488 221.922 225.231 222.088 213.595C221.83 202.057 215.732 189.737 205.008 183.545C194.283 177.353 181.597 177.636 171.476 183.181L141.269 200.72C138.67 202.229 135.461 202.228 132.864 200.716L74.1576 166.562C71.5835 165.065 70 162.311 70 159.333Z";

/* Conductor publishes a letter mark rather than a glyph, so it is taller than
   it is wide; the box below fits it by height like any other mark. */
const CONDUCTOR_MARK_PATHS = [
  "M4.57422 63.6992H22.373V37.251H4.57422C3.58785 37.2511 2.78711 38.0517 2.78711 39.0381V61.9121C2.78725 62.8984 3.58794 63.6991 4.57422 63.6992Z",
  "M36.5977 63.6992H18.7988V37.251H36.5977C37.584 37.2511 38.3848 38.0517 38.3848 39.0381V61.9121C38.3846 62.8984 37.5839 63.6991 36.5977 63.6992Z",
  "M4.57422 100.297H22.373V73.8486H4.57422C3.58785 73.8488 2.78711 74.6493 2.78711 75.6357V98.5098C2.78725 99.496 3.58794 100.297 4.57422 100.297Z",
  "M36.5977 100.297H18.7988V73.8486H36.5977C37.584 73.8488 38.3848 74.6493 38.3848 75.6357V98.5098C38.3846 99.496 37.5839 100.297 36.5977 100.297Z",
  "M4.57422 136.896H22.373V110.447H4.57422C3.58785 110.447 2.78711 111.248 2.78711 112.234V135.108C2.78725 136.095 3.58794 136.895 4.57422 136.896Z",
  "M36.5977 136.896H18.7988V110.447H36.5977C37.584 110.447 38.3848 111.248 38.3848 112.234V135.108C38.3846 136.095 37.5839 136.895 36.5977 136.896Z",
  "M22.873 173.493H40.6719V147.045H22.873C21.8867 147.045 21.0859 147.846 21.0859 148.832V171.706C21.0861 172.692 21.8868 173.493 22.873 173.493Z",
  "M37.0967 173.493V147.045H58.9707V173.493H37.0967Z",
  "M55.3955 173.493V147.045H77.2695V173.493H55.3955Z",
  "M91.4941 173.493H73.6953V147.045H91.4941C92.4805 147.045 93.2812 147.846 93.2812 148.832V171.706C93.2811 172.692 92.4804 173.493 91.4941 173.493Z",
  "M77.7695 136.896H95.5684V110.447H77.7695C76.7832 110.447 75.9824 111.248 75.9824 112.234V135.108C75.9826 136.095 76.7833 136.895 77.7695 136.896Z",
  "M109.793 136.896H91.9941V110.447H109.793C110.779 110.447 111.58 111.248 111.58 112.234V135.108C111.58 136.095 110.779 136.895 109.793 136.896Z",
  "M22.873 27.1006H40.6719V0.652344H22.873C21.8867 0.652488 21.0859 1.45305 21.0859 2.43945V25.3135C21.0861 26.2998 21.8868 27.1004 22.873 27.1006Z",
  "M37.0967 27.1006V0.652344H58.9707V27.1006H37.0967Z",
  "M55.3955 27.1006V0.652344H77.2695V27.1006H55.3955Z",
  "M73.6963 27.1006V0.652344H95.5703V27.1006H73.6963Z",
  "M109.793 27.1006H91.9941V0.652344H109.793C110.779 0.652488 111.58 1.45305 111.58 2.43945V25.3135C111.58 26.2998 110.779 27.1004 109.793 27.1006Z",
  "M77.7695 63.6992H95.5684V37.251H77.7695C76.7832 37.2511 75.9824 38.0517 75.9824 39.0381V61.9121C75.9826 62.8984 76.7833 63.6991 77.7695 63.6992Z",
  "M109.793 63.6992H91.9941V37.251H109.793C110.779 37.2511 111.58 38.0517 111.58 39.0381V61.9121C111.58 62.8984 110.779 63.6991 109.793 63.6992Z",
] as const;

function ClaudeCodeMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.CLAUDE_CODE}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={CLAUDE_CODE_PATH} />
    </svg>
  );
}

function CodexMark({ className }: MarkProps): React.JSX.Element {
  // The Codex mark is a vertical gradient rather than a flat colour, so it needs
  // its own paint server. `useId` keeps the reference unique when several rows
  // render the mark at once.
  const gradientId = `codex-mark-${useId()}`;

  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.CODEX}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="12"
          x2="12"
          y1="3"
          y2="21"
        >
          <stop stopColor="var(--mark-codex-top, #b1a7ff)" />
          <stop offset="0.5" stopColor="var(--mark-codex-middle, #7a9dff)" />
          <stop offset="1" stopColor="var(--mark-codex-bottom, #3941ff)" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradientId})`} fillRule="evenodd" clipRule="evenodd" d={CODEX_PATH} />
    </svg>
  );
}

function ConductorMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.CONDUCTOR}
      viewBox="0 0 115 174"
      aria-hidden="true"
      focusable="false"
    >
      {CONDUCTOR_MARK_PATHS.map((path) => (
        <path fill="currentColor" d={path} key={path} />
      ))}
    </svg>
  );
}

function CursorMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.CURSOR}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={CURSOR_PATH} />
    </svg>
  );
}

function DevinMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.DEVIN}
      viewBox="0 0 425 425"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={DEVIN_PATH} />
    </svg>
  );
}

/** Drawn here, not a brand: a provider Luke has no mark for still needs a slot. */
function UnknownProviderMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </svg>
  );
}

const PROVIDER_MARKS = new Map<string, (props: MarkProps) => React.JSX.Element>([
  [PROVIDER_ID.CLAUDE_CODE, ClaudeCodeMark],
  [PROVIDER_ID.CODEX, CodexMark],
  [PROVIDER_ID.CONDUCTOR, ConductorMark],
  [PROVIDER_ID.CURSOR, CursorMark],
  [PROVIDER_ID.DEVIN, DevinMark],
]);

export function ProviderMark({
  providerId,
  className,
}: MarkProps & { providerId: string }): React.JSX.Element {
  const Mark = PROVIDER_MARKS.get(providerId) ?? UnknownProviderMark;
  return <Mark className={className ? `provider-mark ${className}` : "provider-mark"} />;
}

/**
 * Two small puffs and one large one over a flat base, traced as a single
 * outline: drawn as overlapping shapes instead, a fill this translucent doubles
 * where they cross and every seam inside the cloud shows.
 */
const CLOUD_PATH = "M4.5 14a4.5 4.5 0 0 1-1.259-8.82 7 7 0 0 1 13.518 0A4.5 4.5 0 0 1 15.5 14z";

/**
 * Rides the bottom-right corner of a provider mark to say the work is not
 * happening on this machine. It is ours rather than a brand mark, so it is
 * drawn filled in the text palette: at this size a stroked outline closes up,
 * and a second brand colour beside the provider's own would read as part of the
 * mark. It takes the mark's corner in every place a mark is shown, and each of
 * those places sizes it against the mark it annotates.
 */
export function CloudBadge(): React.JSX.Element {
  return (
    <span className="cloud-badge" role="img" aria-label="Runs in the cloud">
      {/* The box is the cloud's own proportions rather than the square the
          other glyphs use, so at this size the shape spends every pixel it has
          on itself rather than on margin. */}
      <svg viewBox="0 0 20 14" fill="currentColor" aria-hidden="true" focusable="false">
        <path d={CLOUD_PATH} />
      </svg>
    </span>
  );
}
