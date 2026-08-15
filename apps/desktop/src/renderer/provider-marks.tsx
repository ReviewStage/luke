import {
  CLAUDE_CODE_PATH,
  CLOUD_BADGE_PATH,
  CODEX_PATH,
  CONDUCTOR_MARK_PATHS,
  COPILOT_PATH,
  CURSOR_PATH,
  DEVIN_PATH,
  ISSUE_TRACKER_ID,
  JULES_PATH,
  LINEAR_PATH,
  OPENAI_PATH,
  OPENCODE_BLOCK_PATH,
  OPENCODE_FRAME_PATH,
  PROVIDER_ID,
} from "@sidecar/core";
import { useId } from "react";
import { CREDENTIAL_PROVIDER_ID } from "../shared/credential-providers";

/**
 * The provider marks, and the one badge that rides them.
 *
 * Path data is generated into `@sidecar/core` from
 * `design/generate-surface-shared.mjs` so the marketing mock cannot ship a
 * different geometry. The React that traces it stays here: the desktop ships
 * marks the mock does not.
 *
 * Provider marks are inlined as path data rather than bundled image files, so
 * the renderer stays asset-free and the marks scale with the surface.
 *
 * Each is the provider's own mark, reproduced rather than redrawn — Claude Code
 * via Simple Icons (CC0-1.0, sourced from code.claude.com), Codex via
 * @lobehub/icons (MIT), Conductor's letter mark verbatim from the published
 * brand kit at https://www.conductor.build/brandkit, Copilot via Simple Icons
 * (MIT, sourced from https://primer.style/foundations/icons/copilot-24),
 * Cursor via Simple Icons (CC0-1.0, sourced from https://cursor.com/brand),
 * Devin's verbatim from the mark https://devin.ai serves as its own favicon
 * and site header, Jules via Simple Icons (CC0-1.0, sourced from
 * https://jules.google), OpenAI via Simple Icons (CC0-1.0), Linear via Simple Icons (CC0-1.0, sourced from
 * https://linear.app), and OpenCode's two-tone terminal mark verbatim from
 * the favicon https://opencode.ai serves. Each keeps its own brand colour
 * (see the `--mark-*` custom properties), so a mark says which provider a
 * session belongs to while the chips and row tints say what state it is in.
 * Copilot, Cursor, and Devin each publish one silhouette rather than a
 * colour, so all three are drawn in the light form their brand uses on a dark
 * surface. They are trademarks of their respective owners. Do not restyle the
 * geometry or recolour them; swap the path in the generator if a provider
 * publishes an updated mark.
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
  [PROVIDER_ID.COPILOT, CopilotMark],
  [PROVIDER_ID.CURSOR, CursorMark],
  [PROVIDER_ID.DEVIN, DevinMark],
  [PROVIDER_ID.JULES, JulesMark],
  [ISSUE_TRACKER_ID.LINEAR, LinearMark],
  [CREDENTIAL_PROVIDER_ID.OPENAI, OpenAiMark],
  [PROVIDER_ID.OPENCODE, OpenCodeMark],
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
