import {
  AttachmentChip,
  BUTTON_SHAPE,
  BUTTON_VARIANT,
  Button,
  CALL_DEVICE,
  CALL_STAGE,
  CallLive,
  CallMute,
  COMPOSER_ELEMENT,
  COMPOSER_LOOK,
  ComposerBody,
  ComposerFoot,
  ComposerFootSkeleton,
  ComposerFrame,
  type ComposerLook,
  EndCallButton,
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
import type { ComponentProps, ReactNode } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * composer-foots.tsx -- a message box's foot in each state: empty, with its
 * Send unavailable; holding files, which stand over its words; near its limit, the counter showing;
 * sending; Stop in the send's place, and stopping; with a cut paste's note,
 * a refused send's Retry, and a closed box's mend under its note; in a call,
 * and dictating in a call; then at a field's and a bare frame's inset, and
 * still loading.
 */

const ignore = () => undefined;

/** How many characters the catalog's boxes take. */
const LIMIT = 4000;

/** A synthetic picture drawn in place, so the catalog renders offline. */
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#7aa7f4"/><stop offset="1" stop-color="#3d5ac8"/></linearGradient></defs><rect width="64" height="48" fill="url(#g)"/><path d="M0 40l18-14 12 10 14-12 20 16v8H0z" fill="#fff8"/></svg>',
)}`;

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

/** When the catalog's call started, and the moment its count stands still at: 2m 14s in. */
const CALL_STARTED_AT = Date.UTC(2026, 9, 24, 15, 0, 0);
const CALL_NOW = CALL_STARTED_AT + 134_000;

/** A call's status and its controls, as an agent's box shows them while a call into it stands. */
function CallStatus(): React.JSX.Element {
  return (
    <>
      <CallLive stage={CALL_STAGE.LIVE} startedAt={CALL_STARTED_AT} muted={false} now={CALL_NOW} />
      <CallMute
        device={CALL_DEVICE.SPEAKER}
        shape={BUTTON_SHAPE.SQUARE}
        muted={false}
        onPress={ignore}
      />
      <CallMute
        device={CALL_DEVICE.MICROPHONE}
        shape={BUTTON_SHAPE.SQUARE}
        muted={false}
        onPress={ignore}
      />
      <EndCallButton onPress={ignore} />
    </>
  );
}

/** A box's words, under its `files` where it holds any, over its foot, at `look`. */
function Box({
  look = COMPOSER_LOOK.CARD,
  words,
  files,
  ...foot
}: Partial<ComponentProps<typeof ComposerFoot>> & {
  look?: ComposerLook;
  words: string;
  files?: ReactNode;
}): React.JSX.Element {
  return (
    <ComposerFrame
      as={COMPOSER_ELEMENT.FORM}
      look={look}
      onSubmit={(event) => event.preventDefault()}
    >
      <ComposerBody files={files}>
        <div className="catalog-composer">
          <Text tone={TEXT_TONE.MUTED}>{words}</Text>
        </div>
      </ComposerBody>
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
                  <AttachmentChip
                    name="inbox.png"
                    image={PICTURE}
                    icon={<GLYPH.FILE />}
                    onRemove={ignore}
                  />
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
              words="Message Ada"
              send={{ label: "Send", empty: true }}
              stop={{ label: "Stop", onStop: ignore }}
            />
            <Box
              words="Message Ada"
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
