import { formatCount } from "@luke/features/number-format";
import { GLYPH } from "../../icons/glyph-registry.js";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_LOOK, CARD_PADDING, Card } from "../card/card.js";
import { CountParts, linesCount } from "../choice/count-part.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { ALIGN, GAP, Inline, Stack } from "../layout/layout.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * commit-card.tsx -- a commit an agent made, as a card under the command that made it: its message, short hash, branch, and the files and lines it changed.
 *
 * Modeled on AI Elements' commit (`vercel/ai-elements`), restyled on the
 * window's tokens: the message is the card's line, in the label role, behind
 * the commit's glyph; under it the short hash in the code face, the branch
 * behind its glyph, how many files changed, and the lines added and removed,
 * always green and red (`linesCount`). Git's own summary of a commit names no
 * file's lines, so the card counts the whole commit, as git does; nothing in
 * it is pressed. The card's frame is a transcript's: an edge alone at a
 * control's corner, so it reads as part of the call over it.
 */

/** A commit as git summarizes it on making one. */
export interface CommitSummary {
  /** The hash, as short as git printed it. */
  readonly hash: string;
  /** The branch it was made on, or what git names in its place ("detached HEAD"). */
  readonly branch: string;
  /** The message's first line. */
  readonly message: string;
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
}

/** What the card is named, for a reader moving by landmarks. */
const COMMIT_LABEL = "Commit";

/** How many files a commit changed, in git's words. */
function filesWords(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "file" : "files"} changed`;
}

/** A commit's message, then its hash, branch, files, and lines on one wrapping line. */
export function CommitCard({ commit }: { commit: CommitSummary }): React.JSX.Element {
  return (
    <Card
      as={CARD_ELEMENT.SECTION}
      look={CARD_LOOK.OUTLINE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.COMPACT}
      aria-label={COMMIT_LABEL}
    >
      <Stack gap={GAP.TIGHT}>
        <Inline gap={GAP.ICON} align={ALIGN.START} wrap={false}>
          <GlyphSlot size={ICON_SIZE.MEDIUM} line>
            <GLYPH.COMMIT />
          </GlyphSlot>
          <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
            {commit.message}
          </Text>
        </Inline>
        <Inline gap={GAP.CONTROL}>
          <Text
            variant={TEXT_VARIANT.CAPTION}
            as={TEXT_ELEMENT.SPAN}
            font={TEXT_FONT.MONO}
            tone={TEXT_TONE.MUTED}
          >
            {commit.hash}
          </Text>
          <Inline gap={GAP.TIGHT} wrap={false}>
            <GlyphSlot size={ICON_SIZE.SMALL}>
              <GLYPH.BRANCH />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN} font={TEXT_FONT.MONO}>
              {commit.branch}
            </Text>
          </Inline>
          <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
            {filesWords(commit.filesChanged)}
          </Text>
          <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN}>
            <CountParts parts={linesCount(commit.insertions, commit.deletions)} />
          </Text>
        </Inline>
      </Stack>
    </Card>
  );
}
