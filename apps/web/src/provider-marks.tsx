import {
  CLAUDE_CODE_PATH,
  CLOUD_BADGE_PATH,
  CODEX_PATH,
  CONDUCTOR_MARK_PATHS,
  CURSOR_PATH,
  DEVIN_PATH,
  PROVIDER_ID,
} from "@sidecar/core";
import { useId } from "react";

/**
 * The provider marks the hero mock draws. Path data is generated into
 * `@sidecar/core` from `design/generate-surface-shared.mjs`, the same table
 * the desktop renderer reads, so a provider publishing an updated mark cannot
 * land in one surface and not the other. The React that traces it stays here:
 * the mock only needs the five the smoke fixture uses, plus the badge that
 * rides them.
 *
 * Each is the provider's own mark, reproduced rather than redrawn — Claude
 * Code via Simple Icons (CC0-1.0, sourced from code.claude.com), Codex via
 * @lobehub/icons (MIT), Conductor's letter mark verbatim from the published
 * brand kit at https://www.conductor.build/brandkit, Cursor via Simple Icons
 * (CC0-1.0, sourced from https://cursor.com/brand), and Devin's verbatim from
 * the mark https://devin.ai serves as its own favicon and site header. Each
 * keeps its own brand colour (see the `--mark-*` custom properties). Cursor
 * and Devin publish one silhouette rather than a colour, so both are drawn in
 * the light form their brand uses on a dark surface. They are trademarks of
 * their respective owners. Do not restyle the geometry or recolour them; swap
 * the path in the generator if a provider publishes an updated mark.
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
