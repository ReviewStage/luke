import {
  AttachmentChip,
  BUTTON_VARIANT,
  Button,
  COMPOSER_ELEMENT,
  COMPOSER_LOOK,
  ComposerFoot,
  ComposerFootSkeleton,
  ComposerFrame,
  type ComposerLook,
  GAP,
  IconButton,
  SKELETON_SHAPE,
  Skeleton,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { AtSign, GLYPH, Mic } from "@luke/ui/icons";
import type { ComponentProps } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * composer-foots.tsx -- a message box's foot in each state: empty, with its
 * Send unavailable; holding files; near its limit, the counter showing;
 * sending; Stop in the send's place, and stopping; with a cut paste's note,
 * a refused send's Retry, and a closed box's mend under its note; in a call,
 * and dictating in a call; then at a field's and a bare frame's inset, and
 * still loading.
 */

const ignore = () => undefined;

/** How many characters the catalog's boxes take. */
const LIMIT = 4000;

/** The tools at a box's start: attach, mention, skill. */
function Tools(): React.JSX.Element {
  return (
    <>
      <IconButton label="Attach files" icon={<GLYPH.ADD />} onClick={ignore} />
      <IconButton label="Mention" icon={<AtSign />} onClick={ignore} />
      <IconButton label="Use a skill" icon={<GLYPH.SKILL />} onClick={ignore} />
    </>
  );
}

/** A call's status, as the composer shows it while one stands. */
function CallStatus(): React.JSX.Element {
  return (
    <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      On a call · 2:14
    </Text>
  );
}

/** A box's words over its foot, at `look`. */
function Box({
  look = COMPOSER_LOOK.CARD,
  words,
  ...foot
}: Partial<ComponentProps<typeof ComposerFoot>> & {
  look?: ComposerLook;
  words: string;
}): React.JSX.Element {
  return (
    <ComposerFrame
      as={COMPOSER_ELEMENT.FORM}
      look={look}
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="catalog-composer">
        <Text tone={TEXT_TONE.MUTED}>{words}</Text>
      </div>
      <ComposerFoot
        tools={<Tools />}
        actions={<IconButton label="Dictate" icon={<Mic />} onClick={ignore} />}
        send={{ label: "Send", empty: false }}
        {...foot}
      />
    </ComposerFrame>
  );
}

/** A box still loading: its foot's placeholders, a tool's and a press's, and the send's disc. */
function BoxSkeleton(): React.JSX.Element {
  return (
    <ComposerFrame look={COMPOSER_LOOK.CARD}>
      <ComposerFootSkeleton
        tools={<Skeleton shape={SKELETON_SHAPE.CIRCLE} />}
        actions={<Skeleton shape={SKELETON_SHAPE.CONTROL} />}
      />
    </ComposerFrame>
  );
}

function ComposerFoots(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="composer-foot-states" title="States">
        <div className="catalog-column">
          <Stack gap={GAP.FIELD}>
            <Box words="Ask Luke to change something…" send={{ label: "Send", empty: true }} />
            <Box
              words="Here are the two screens."
              files={
                <>
                  <AttachmentChip name="inbox.png" icon={<GLYPH.FILE />} onRemove={ignore} />
                  <AttachmentChip name="plan.pdf" icon={<GLYPH.FILE />} onRemove={ignore} />
                </>
              }
            />
            <Box
              words="A long message, near the box's limit."
              counter={{ length: 3420, limit: LIMIT }}
            />
            <Box
              words="Sending this one."
              send={{ label: "Send", empty: false, busy: true, busyLabel: "Sending" }}
            />
            <Box
              words="Ask to make changes"
              send={{ label: "Send", empty: true }}
              stop={{ label: "Stop", onStop: ignore }}
            />
            <Box
              words="Ask to make changes"
              send={{ label: "Send", empty: true }}
              stop={{ label: "Stop", onStop: ignore, busy: true, busyLabel: "Stopping…" }}
            />
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="composer-foot-notes" title="Notes">
        <div className="catalog-column">
          <Stack gap={GAP.FIELD}>
            <Box
              words="The start of a long paste."
              counter={{ length: LIMIT, limit: LIMIT }}
              note={{ words: "Only the first 4,000 characters were pasted." }}
            />
            <Box
              words="Can you take a look?"
              note={{ words: "The message could not be sent.", onRetry: ignore }}
            />
            <Box
              words=""
              send={{ label: "Send", empty: true, held: true }}
              note={{
                words: "The agent takes no more messages.",
                mends: (
                  <Button variant={BUTTON_VARIANT.OUTLINE} onClick={ignore}>
                    Continue in new agent
                  </Button>
                ),
              }}
            />
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="composer-foot-call" title="In a call">
        <div className="catalog-column">
          <Stack gap={GAP.FIELD}>
            <Box words="Ask Luke while you talk…" call={<CallStatus />} />
            <Box
              words="Dictating…"
              call={<CallStatus />}
              strip={
                <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  Listening · 0:04
                </Text>
              }
            />
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="composer-foot-looks" title="Looks">
        <div className="catalog-column">
          <Stack gap={GAP.FIELD}>
            <Box look={COMPOSER_LOOK.FIELD} words="Reply…" send={{ label: "Reply", empty: true }} />
            <Box
              look={COMPOSER_LOOK.BARE}
              words="Comment…"
              send={{ label: "Comment", empty: false }}
            />
            <BoxSkeleton />
          </Stack>
        </div>
      </CatalogSection>
    </>
  );
}

export const COMPOSER_FOOTS_EXAMPLE: Example = {
  id: "composer-foots",
  title: "Composer foots",
  Render: ComposerFoots,
};
