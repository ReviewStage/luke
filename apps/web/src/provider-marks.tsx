import { PROVIDER_ID, SESSION_APPLICATION_ID } from "@sidecar/session";
import {
  CLAUDE_CODE_PATH,
  CLOUD_BADGE_PATH,
  CMUX_PATH,
  CODEX_PATH,
  CONDUCTOR_MARK_PATHS,
  COPILOT_PATH,
  CURSOR_PATH,
  DEVIN_PATH,
  GEMINI_CLI_MARK_LAYERS,
  GEMINI_CLI_MARK_MASK_PATH,
  JULES_PATH,
  OPENAI_PATH,
  OPENCODE_BLOCK_PATH,
  OPENCODE_FRAME_PATH,
  ORCA_PATH,
  SUPERSET_PATH,
} from "@sidecar/surface";
import { useId } from "react";

/**
 * The provider marks the page draws — the five the hero mock's smoke fixture
 * uses, and the full agent-and-app roster the works-with section shows — plus
 * the badge that rides them. Path data is generated into `@sidecar/surface`
 * from `design/generate-surface-shared.mjs`, the same table the desktop
 * renderer reads, so a provider publishing an updated mark cannot land in one
 * surface and not the other. The React that traces it stays here: the desktop
 * ships marks the page does not, like the calendars and the tracker.
 *
 * Each is the provider's own mark, reproduced rather than redrawn — Claude
 * Code via Simple Icons (CC0-1.0, sourced from code.claude.com), cmux's
 * chevron verbatim from the icon cmux.com serves as its own site mark, keeping
 * the horizontal gradient the icon draws it with, Codex via @lobehub/icons
 * (MIT), Conductor's letter mark verbatim from the published brand kit at
 * https://www.conductor.build/brandkit, Copilot via Simple Icons (MIT, sourced
 * from https://primer.style/foundations/icons/copilot-24), Cursor via Simple
 * Icons (CC0-1.0, sourced from https://cursor.com/brand), Devin's verbatim
 * from the mark https://devin.ai serves as its own favicon and site header,
 * Gemini's aurora sparkle verbatim from the vector the Gemini web app inlines
 * at gemini.google.com (trademark of Google LLC), keeping the masked, blurred
 * colour field it is published with, Jules via Simple Icons (CC0-1.0, sourced
 * from https://jules.google), OpenAI via Simple Icons (CC0-1.0), OpenCode's
 * two-tone terminal mark verbatim from the favicon https://opencode.ai
 * serves, Orca's whale mark verbatim from the logo the Orca repository
 * publishes (stablyai/orca, MIT), and Superset's bracket mark traced from the
 * pixel grid of the favicon https://superset.sh serves, keeping the vertical
 * metallic gradient the favicon draws it with. Each keeps its own brand
 * colour (see the `--mark-*` custom properties). Copilot, Cursor, Devin,
 * OpenCode, and Orca publish one silhouette rather than a colour, so each is
 * drawn in the light form its brand uses on a dark surface. They are
 * trademarks of their respective owners. Do not restyle the geometry or
 * recolour them; swap the path in the generator if a provider publishes an
 * updated mark.
 */
interface MarkProps {
  className?: string;
}

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

function CmuxMark({ className }: MarkProps): React.JSX.Element {
  // cmux's chevron is a horizontal gradient rather than a flat colour, so it
  // needs its own paint server. `useId` keeps the reference unique when
  // several tiles render the mark at once.
  const gradientId = `cmux-mark-${useId()}`;

  return (
    <svg
      className={className}
      data-mark={SESSION_APPLICATION_ID.CMUX}
      viewBox="0 0 256 256"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="91"
          x2="179"
          y1="128"
          y2="128"
        >
          <stop stopColor="var(--mark-cmux-left, #12c7f5)" />
          <stop offset="0.52" stopColor="var(--mark-cmux-middle, #2d8cff)" />
          <stop offset="1" stopColor="var(--mark-cmux-right, #6c5cff)" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradientId})`} d={CMUX_PATH} />
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
  /* Conductor publishes a letter mark rather than a glyph, so it is taller than
     it is wide; the box below fits it by height like any other mark. */
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

function CopilotMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.COPILOT}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={COPILOT_PATH} />
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

function GeminiCliMark({ className }: MarkProps): React.JSX.Element {
  // The aurora sparkle is not a filled path: the rounded star masks a field
  // of gaussian-blurred colour blobs, so it carries its own published colours
  // — reproduced exactly, never recoloured to a theme — and it needs a mask
  // and one blur filter per layer. `useId` keeps every reference unique when
  // several tiles render the mark at once.
  const idPrefix = `gemini-cli-mark-${useId()}`;
  const maskId = `${idPrefix}-mask`;

  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.GEMINI_CLI}
      viewBox="0 0 65 65"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="65" height="65">
          <path fill="#ffffff" d={GEMINI_CLI_MARK_MASK_PATH} />
        </mask>
        {GEMINI_CLI_MARK_LAYERS.map((layer, index) => (
          <filter
            // The published artwork stacks one blob twice, so the layer list
            // holds duplicates and only the position names a layer.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={index}
            id={`${idPrefix}-blur-${index}`}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
            x={layer.region.x}
            y={layer.region.y}
            width={layer.region.width}
            height={layer.region.height}
          >
            <feGaussianBlur stdDeviation={layer.blur} />
          </filter>
        ))}
      </defs>
      <g mask={`url(#${maskId})`}>
        {GEMINI_CLI_MARK_LAYERS.map((layer, index) => (
          <g
            // biome-ignore lint/suspicious/noArrayIndexKey: same duplicate-layer list as above
            key={index}
            filter={`url(#${idPrefix}-blur-${index})`}
          >
            <path fill={layer.fill} d={layer.path} />
          </g>
        ))}
      </g>
    </svg>
  );
}

function JulesMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.JULES}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={JULES_PATH} />
    </svg>
  );
}

function ChatGptMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={SESSION_APPLICATION_ID.CHATGPT}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={OPENAI_PATH} />
    </svg>
  );
}

function OpenCodeMark({ className }: MarkProps): React.JSX.Element {
  // The box crops the favicon's 512 canvas to a square the glyph fills top to
  // bottom, centred as published; the paths themselves are untouched. Verbatim
  // from the favicon https://opencode.ai serves: a frame open at the top, and
  // the block that sits inside the opening. The block is part of the published
  // two-tone mark — OpenCode draws it in its own gray on every surface — so it
  // keeps its brand colour rather than taking the frame's.
  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.OPENCODE}
      viewBox="96 96 320 320"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="var(--mark-opencode-block, #5a5858)" d={OPENCODE_BLOCK_PATH} />
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d={OPENCODE_FRAME_PATH} />
    </svg>
  );
}

function OrcaMark({ className }: MarkProps): React.JSX.Element {
  // The box reproduces the published artwork's group offset — the path is
  // drawn 6.67 right and 70.67 down of the origin — so the path itself stays
  // verbatim from the logo the Orca repository publishes.
  return (
    <svg
      className={className}
      data-mark={SESSION_APPLICATION_ID.ORCA}
      viewBox="6.6666669 70.666669 318.60232 202.66667"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={ORCA_PATH} />
    </svg>
  );
}

function SupersetMark({ className }: MarkProps): React.JSX.Element {
  // Superset's favicon draws its bracket mark in a vertical metallic gradient
  // rather than a flat colour, so like Codex it needs its own paint server.
  const gradientId = `superset-mark-${useId()}`;

  return (
    <svg
      className={className}
      data-mark={SESSION_APPLICATION_ID.SUPERSET}
      viewBox="0 0 180 72"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="90"
          x2="90"
          y1="0"
          y2="72"
        >
          <stop stopColor="var(--mark-superset-top, #b9b7b5)" />
          <stop offset="1" stopColor="var(--mark-superset-bottom, #858483)" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradientId})`} d={SUPERSET_PATH} />
    </svg>
  );
}

/** Drawn here, not a brand: a provider the mock has no mark for still needs a slot. */
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
  [SESSION_APPLICATION_ID.CHATGPT, ChatGptMark],
  [SESSION_APPLICATION_ID.CMUX, CmuxMark],
  [PROVIDER_ID.CODEX, CodexMark],
  [PROVIDER_ID.CONDUCTOR, ConductorMark],
  [PROVIDER_ID.COPILOT, CopilotMark],
  [PROVIDER_ID.CURSOR, CursorMark],
  // Cursor the app draws Cursor's own mark: the id differs from the agent's
  // only so the desktop's two filter chips can answer different questions.
  [SESSION_APPLICATION_ID.CURSOR, CursorMark],
  [PROVIDER_ID.DEVIN, DevinMark],
  [PROVIDER_ID.GEMINI_CLI, GeminiCliMark],
  [PROVIDER_ID.JULES, JulesMark],
  [PROVIDER_ID.OPENCODE, OpenCodeMark],
  [SESSION_APPLICATION_ID.ORCA, OrcaMark],
  [SESSION_APPLICATION_ID.SUPERSET, SupersetMark],
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
 * outline. Ours rather than a brand mark, drawn filled in the text palette:
 * it rides a provider mark's corner to say the work runs somewhere else.
 */
export function CloudBadge(): React.JSX.Element {
  return (
    <span className="cloud-badge">
      <svg viewBox="0 0 20 14" fill="currentColor" aria-hidden="true" focusable="false">
        <path d={CLOUD_BADGE_PATH} />
      </svg>
    </span>
  );
}
