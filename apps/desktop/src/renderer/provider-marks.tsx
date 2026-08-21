import { GOOGLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials";
import { ISSUE_TRACKER_ID, type IssueTrackerId } from "@sidecar/issues";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  HOSTED_AGENT_ID,
  type HostedAgentId,
  PROVIDER_ID,
  type ProviderId,
  SESSION_APPLICATION_ID,
  type SessionApplicationId,
} from "@sidecar/session";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "@sidecar/superset/vocabulary";
import {
  APPLE_CALENDAR_MARK_LAYERS,
  CLAUDE_CODE_PATH,
  CLOUD_BADGE_PATH,
  CMUX_PATH,
  CODEX_PATH,
  CONDUCTOR_MARK_PATHS,
  COPILOT_PATH,
  CURSOR_PATH,
  DEEPSEEK_PATH,
  DEVIN_PATH,
  GEMINI_CLI_MARK_LAYERS,
  GEMINI_CLI_MARK_MASK_PATH,
  GOOGLE_CALENDAR_MARK_LAYERS,
  GROK_BUILD_ORBIT_PATH,
  GROK_BUILD_TAIL_PATH,
  JULES_PATH,
  LINEAR_PATH,
  OPENAI_PATH,
  OPENCODE_BLOCK_PATH,
  OPENCODE_FRAME_PATH,
  ORCA_PATH,
  PI_PATH,
  REPLICAS_PATH,
  SUPERSET_PATH,
} from "@sidecar/surface";
import { useId } from "react";
import { APPLE_CALENDAR_ID } from "#shared/apple-calendar";

/**
 * The provider marks, and the one badge that rides them.
 *
 * Path data is generated into `@sidecar/surface` from
 * `design/generate-surface-shared.mjs` so the marketing mock cannot ship a
 * different geometry. The React that traces it stays here: the desktop ships
 * marks the mock does not.
 *
 * Provider marks are inlined as path data rather than bundled image files, so
 * the renderer stays asset-free and the marks scale with the surface.
 *
 * Each is the provider's own mark, reproduced rather than redrawn — Claude Code
 * via Simple Icons (CC0-1.0, sourced from code.claude.com), cmux's chevron
 * verbatim from the icon cmux.com serves as its own site mark, keeping the
 * horizontal gradient the icon draws it with, Codex via
 * @lobehub/icons (MIT), Conductor's letter mark verbatim from the published
 * brand kit at https://www.conductor.build/brandkit, Copilot via Simple Icons
 * (MIT, sourced from https://primer.style/foundations/icons/copilot-24),
 * Cursor via Simple Icons (CC0-1.0, sourced from https://cursor.com/brand),
 * DeepSeek's whale via Simple Icons (CC0-1.0, sourced from
 * https://www.deepseek.com), Pi's pixel glyph verbatim from the inline SVG
 * https://pi.dev serves as its own site logo,
 * Devin's verbatim from the mark https://devin.ai serves as its own favicon
 * and site header, Gemini's aurora sparkle verbatim from the vector the
 * Gemini web app inlines at gemini.google.com (trademark of Google LLC),
 * keeping the masked, blurred colour field it is published with,
 * Google Calendar via Simple Icons (CC0-1.0, sourced from
 * https://developers.google.com/calendar), Grok Build's comet mark verbatim
 * from the favicon https://grok.com serves (a trademark of xAI),
 * Jules via Simple Icons (CC0-1.0, sourced from
 * https://jules.google), OpenAI via Simple Icons (CC0-1.0), Linear via Simple Icons (CC0-1.0, sourced from
 * https://linear.app), OpenCode's two-tone terminal mark verbatim from
 * the favicon https://opencode.ai serves, Orca's whale mark verbatim from the
 * logo the Orca repository publishes (stablyai/orca, MIT), Replicas' pixel R
 * verbatim from the site mark https://tryreplicas.com serves
 * (R-logo-new.svg), and Superset's bracket mark traced
 * from the pixel grid of the favicon https://superset.sh serves — the one
 * square mark Superset publishes — keeping the vertical metallic gradient the
 * favicon draws it with. Each keeps its own brand colour
 * (see the `--mark-*` custom properties), so a mark says which provider a
 * session belongs to while the chips and row tints say what state it is in.
 * Copilot, Cursor, Devin, and Grok Build each publish one silhouette rather
 * than a colour, so all four are drawn in the light form their brand uses on
 * a dark surface. They are trademarks of their respective owners. Do not restyle the
 * geometry or recolour them; swap the path in the generator if a provider
 * publishes an updated mark. Apple Calendar is the one exception to
 * "reproduced rather than redrawn": Apple distributes the Calendar icon only
 * as raster app artwork, so its flat anatomy — tile, red weekday line, and
 * the marketing icon's 17 — is drawn in the generator instead (a trademark
 * of Apple Inc.).
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
  // several rows render the mark at once.
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
  // of gaussian-blurred colour blobs, so like Google Calendar it carries its
  // own published colours — reproduced exactly, never recoloured to a theme —
  // and it needs a mask and one blur filter per layer. `useId` keeps every
  // reference unique when several rows render the mark at once.
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

function GrokBuildMark({ className }: MarkProps): React.JSX.Element {
  // The box crops the favicon's 512 canvas to the square the glyph fills edge
  // to edge, centred as published; the paths themselves are untouched.
  // Verbatim from the favicon https://grok.com serves: the orbit arcing
  // through the top-right streak, and the tail streaking away to the lower
  // left.
  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.GROK_BUILD}
      viewBox="56 56 400 400"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={GROK_BUILD_ORBIT_PATH} />
      <path fill="currentColor" d={GROK_BUILD_TAIL_PATH} />
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

function DeepSeekMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={HOSTED_AGENT_ID.DEEPSEEK}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={DEEPSEEK_PATH} />
    </svg>
  );
}

function PiMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={HOSTED_AGENT_ID.PI}
      viewBox="0 0 800 800"
      aria-hidden="true"
      focusable="false"
    >
      {/* Even-odd, as pi.dev publishes it: the glyph's counter is a hole. */}
      <path fill="currentColor" fillRule="evenodd" d={PI_PATH} />
    </svg>
  );
}

function ReplicasMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={PROVIDER_ID.REPLICAS}
      viewBox="0 0 225 300"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={REPLICAS_PATH} />
    </svg>
  );
}

function AppleCalendarMark({ className }: MarkProps): React.JSX.Element {
  // Drawn after the macOS Calendar app icon — white tile, red weekday line,
  // and the 17 Apple's marketing icon shows — in its own colours, because
  // Apple ships the icon only as raster app artwork; the generator owns the
  // geometry and the rationale.
  return (
    <svg
      className={className}
      data-mark={APPLE_CALENDAR_ID}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      {APPLE_CALENDAR_MARK_LAYERS.map((layer) => (
        <path fill={layer.fill} d={layer.path} key={layer.path} />
      ))}
    </svg>
  );
}

function GoogleCalendarMark({ className }: MarkProps): React.JSX.Element {
  // The one mark that carries its own colours: Google's flat product icon is
  // drawn as its published filled layers, offset the way the original artwork
  // is, and never recoloured to a theme.
  return (
    <svg
      className={className}
      data-mark={GOOGLE_CALENDAR_ID}
      viewBox="0 0 200 200"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(3.75 3.75)">
        {GOOGLE_CALENDAR_MARK_LAYERS.map((layer) => (
          <path fill={layer.fill} d={layer.path} key={layer.path} />
        ))}
      </g>
    </svg>
  );
}

function LinearMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={ISSUE_TRACKER_ID.LINEAR}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={LINEAR_PATH} />
    </svg>
  );
}

function OpenAiMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg
      className={className}
      data-mark={CREDENTIAL_PROVIDER_ID.OPENAI}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={OPENAI_PATH} />
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
      data-mark={SUPERSET_WORKSPACE_PROVIDER_ID}
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

/** Drawn here, not a brand: a provider Luke has no mark for still needs a slot. */
function UnknownProviderMark({ className }: MarkProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </svg>
  );
}

export type MarkId =
  | ProviderId
  | HostedAgentId
  | SessionApplicationId
  | IssueTrackerId
  | typeof APPLE_CALENDAR_ID
  | typeof GOOGLE_CALENDAR_ID
  | typeof CREDENTIAL_PROVIDER_ID.OPENAI
  | typeof SUPERSET_WORKSPACE_PROVIDER_ID
  | typeof CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID;

const PROVIDER_MARKS = {
  [APPLE_CALENDAR_ID]: AppleCalendarMark,
  [PROVIDER_ID.CLAUDE_CODE]: ClaudeCodeMark,
  [SESSION_APPLICATION_ID.CHATGPT]: ChatGptMark,
  [SESSION_APPLICATION_ID.CMUX]: CmuxMark,
  [PROVIDER_ID.CODEX]: CodexMark,
  [PROVIDER_ID.CONDUCTOR]: ConductorMark,
  // Local Conductor creation wears the same mark as the cloud provider: both
  // are Conductor making a workspace, told apart only by where it lands.
  [CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID]: ConductorMark,
  [PROVIDER_ID.COPILOT]: CopilotMark,
  [PROVIDER_ID.CURSOR]: CursorMark,
  // Cursor the app draws Cursor's own mark: the id differs from the agent's
  // only so the two filter chips can answer different questions.
  [SESSION_APPLICATION_ID.CURSOR]: CursorMark,
  [HOSTED_AGENT_ID.DEEPSEEK]: DeepSeekMark,
  [PROVIDER_ID.DEVIN]: DevinMark,
  [PROVIDER_ID.GEMINI_CLI]: GeminiCliMark,
  [GOOGLE_CALENDAR_ID]: GoogleCalendarMark,
  [PROVIDER_ID.GROK_BUILD]: GrokBuildMark,
  [PROVIDER_ID.JULES]: JulesMark,
  [ISSUE_TRACKER_ID.LINEAR]: LinearMark,
  [CREDENTIAL_PROVIDER_ID.OPENAI]: OpenAiMark,
  [PROVIDER_ID.OPENCODE]: OpenCodeMark,
  [SESSION_APPLICATION_ID.ORCA]: OrcaMark,
  [HOSTED_AGENT_ID.PI]: PiMark,
  [PROVIDER_ID.REPLICAS]: ReplicasMark,
  [SUPERSET_WORKSPACE_PROVIDER_ID]: SupersetMark,
} as const satisfies Readonly<Record<MarkId, (props: MarkProps) => React.JSX.Element>>;

function isMarkId(value: string): value is MarkId {
  return value in PROVIDER_MARKS;
}

export function ProviderMark({
  providerId,
  className,
}: MarkProps & { providerId: string }): React.JSX.Element {
  const Mark = isMarkId(providerId) ? PROVIDER_MARKS[providerId] : UnknownProviderMark;
  return <Mark className={className ? `provider-mark ${className}` : "provider-mark"} />;
}

/**
 * Two small puffs and one large one over a flat base, traced as a single
 * outline: drawn as overlapping shapes instead, a fill this translucent doubles
 * where they cross and every seam inside the cloud shows.
 *
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
        <path d={CLOUD_BADGE_PATH} />
      </svg>
    </span>
  );
}

/**
 * Rides the provider mark for a Codex realtime voice/delegation chat. The glyph
 * is Google's Material Symbols `graphic_eq` shape (Apache 2.0), used here as a
 * familiar, filled audio indicator rather than a bespoke line drawing. It uses
 * the same corner slot as the cloud badge; when both are present, the audio
 * mark shifts inward so both silhouettes remain legible while overlapping.
 */
export function AudioBadge(): React.JSX.Element {
  return (
    <span className="audio-badge" role="img" aria-label="Realtime voice chat">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M6 18q-.825 0-1.412-.587Q4 16.825 4 16V8q0-.825.588-1.412Q5.175 6 6 6t1.413.588Q8 7.175 8 8v8q0 .825-.587 1.413Q6.825 18 6 18Zm6 4q-.825 0-1.412-.587Q10 20.825 10 20V4q0-.825.588-1.412Q11.175 2 12 2t1.413.588Q14 3.175 14 4v16q0 .825-.587 1.413Q12.825 22 12 22Zm6-4q-.825 0-1.412-.587Q16 16.825 16 16V8q0-.825.588-1.412Q17.175 6 18 6t1.413.588Q20 7.175 20 8v8q0 .825-.587 1.413Q18.825 18 18 18Z" />
      </svg>
    </span>
  );
}
