import { formatCount } from "@luke/features/number-format";
import { workingTime } from "@luke/features/time-format";
import { GLYPH } from "../../icons/glyph-registry.js";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { STATUS_TONE } from "../../status-tone.js";
import { Badge } from "../badge/badge.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_LOOK, CARD_PADDING, Card } from "../card/card.js";
import { GLYPH_INK, GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { ALIGN, GAP, Inline, JUSTIFY, LAYOUT_ELEMENT, Stack } from "../layout/layout.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * test-results-card.tsx -- a test run an agent made, as a card under the command that ran it: how many passed, failed, and were skipped, how long it took, and which failed and why.
 *
 * Modeled on AI Elements' test results (`vercel/ai-elements`), restyled on
 * the window's tokens: each count is a `Badge` in its status tone, its glyph
 * the state's own (`GLYPH.SETTLED`, `FAILED`, `DISMISSED`), so the colour only
 * repeats the words; a count of none is left out, but for the passed, which
 * a run of nothing but failures still says. The duration stands at the line's
 * end, and under it a strip is the counts' picture, the passed share in the
 * complete tone's ink and the failed in the danger's on the progress bar's
 * track, hidden from a screen reader, since the badges say it. Under those,
 * the failed tests by name in the code face, each with the first line of
 * its error, a few at most and a count of the rest. Nothing in it is
 * pressed; the run's whole output stays in the call's fold over it. The
 * card's frame is a transcript's: an edge alone at a control's corner.
 */

/** One failed test: its name as the runner gave it, and its error's first line where the output carried one. */
export interface TestFailure {
  readonly name: string;
  readonly error?: string | undefined;
}

/** A test run as its runner summarized it. */
export interface TestRun {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  /** How long the run took, in milliseconds, where the runner said. */
  readonly durationMs?: number | undefined;
  /** The failed tests the output named, in its order, which may be fewer than `failed` where the card was read from an output's two ends. */
  readonly failures: readonly TestFailure[];
}

/** What the card is named, for a reader moving by landmarks. */
const TEST_RESULTS_LABEL = "Test results";

/** How many failed tests the card names before it counts the rest. */
const FAILURES_SHOWN = 5;

/** A second and a minute, in milliseconds. */
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

/** How long a run took, as a runner prints it: "812ms", "1.81s", and past a minute as a turn's time ("1m 12s"). */
function durationWords(ms: number): string {
  if (ms < SECOND_MS) return `${Math.round(ms)}ms`;
  if (ms < MINUTE_MS) return `${(ms / SECOND_MS).toFixed(2)}s`;
  return workingTime(ms);
}

/** The counts' picture: the passed share, the failed, and the skipped left as the track's own. */
function TestStrip({ run }: { run: TestRun }): React.JSX.Element {
  return (
    <span
      className="luke-test-results-strip flex h-progress-height w-full overflow-hidden rounded-full bg-secondary"
      aria-hidden="true"
    >
      <span
        className="bg-tone-ink"
        data-tone={STATUS_TONE.COMPLETE}
        style={{ flexGrow: run.passed }}
      />
      <span
        className="bg-tone-ink"
        data-tone={STATUS_TONE.DANGER}
        style={{ flexGrow: run.failed }}
      />
      <span style={{ flexGrow: run.skipped }} />
    </span>
  );
}

/** One failed test: the failed glyph, its name, and its error under it. */
function FailureLine({ failure }: { failure: TestFailure }): React.JSX.Element {
  return (
    <li className="luke-test-results-failure min-w-0">
      <Inline gap={GAP.ICON} align={ALIGN.START} wrap={false}>
        <span className="inline-flex flex-none text-tone-ink" data-tone={STATUS_TONE.DANGER}>
          <GlyphSlot ink={GLYPH_INK.INHERIT} size={ICON_SIZE.SMALL} line>
            <GLYPH.FAILED />
          </GlyphSlot>
        </span>
        <Stack gap={GAP.NONE}>
          <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN} font={TEXT_FONT.MONO}>
            {failure.name}
          </Text>
          {failure.error === undefined ? null : (
            <Text
              variant={TEXT_VARIANT.CAPTION}
              as={TEXT_ELEMENT.SPAN}
              font={TEXT_FONT.MONO}
              tone={TEXT_TONE.MUTED}
            >
              {failure.error}
            </Text>
          )}
        </Stack>
      </Inline>
    </li>
  );
}

/** A run's counts and duration, its strip, and the tests that failed. */
export function TestResultsCard({ run }: { run: TestRun }): React.JSX.Element {
  const shown = run.failures.slice(0, FAILURES_SHOWN);
  // Note that the count of the rest is the larger of the failed count and the names, since a run read from its ends names fewer than it counts.
  const more = Math.max(run.failed, run.failures.length) - shown.length;
  return (
    <Card
      as={CARD_ELEMENT.SECTION}
      look={CARD_LOOK.OUTLINE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.COMPACT}
      aria-label={TEST_RESULTS_LABEL}
    >
      <Stack gap={GAP.BLOCK}>
        <Stack gap={GAP.ITEM}>
          <Inline gap={GAP.CONTROL} justify={JUSTIFY.BETWEEN}>
            <Inline gap={GAP.TIGHT}>
              <Badge tone={STATUS_TONE.COMPLETE} icon={<GLYPH.SETTLED aria-hidden="true" />}>
                {`${formatCount(run.passed)} passed`}
              </Badge>
              {run.failed === 0 ? null : (
                <Badge tone={STATUS_TONE.DANGER} icon={<GLYPH.FAILED aria-hidden="true" />}>
                  {`${formatCount(run.failed)} failed`}
                </Badge>
              )}
              {run.skipped === 0 ? null : (
                <Badge tone={STATUS_TONE.NEUTRAL} icon={<GLYPH.DISMISSED aria-hidden="true" />}>
                  {`${formatCount(run.skipped)} skipped`}
                </Badge>
              )}
            </Inline>
            {run.durationMs === undefined ? null : (
              <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
                {durationWords(run.durationMs)}
              </Text>
            )}
          </Inline>
          <TestStrip run={run} />
        </Stack>
        {shown.length === 0 ? null : (
          <Stack gap={GAP.ITEM} as={LAYOUT_ELEMENT.UL}>
            {shown.map((failure, at) => (
              // Note that a failure's place in the run is its identity: a runner may name one test twice.
              <FailureLine key={at} failure={failure} />
            ))}
          </Stack>
        )}
        {more <= 0 ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`and ${formatCount(more)} more failed`}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
