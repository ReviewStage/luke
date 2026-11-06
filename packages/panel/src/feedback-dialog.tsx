import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import {
  FEEDBACK_KIND,
  FEEDBACK_LIMITS,
  type FeedbackImage,
  type FeedbackKind,
  type FeedbackSubmission,
} from "@repo/features/feedback";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { pasteCutWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENTS, type Experiment } from "@repo/settings";
import {
  ALIGN,
  AttachmentChip,
  CHOICE_BAR_LOOK,
  Checkbox,
  ChoiceBar,
  ComposerBody,
  ComposerFoot,
  ComposerFrame,
  type ComposerNote,
  DIALOG_SIZE,
  Dialog,
  GAP,
  Inline,
  LAYOUT_ELEMENT,
  LIST_MOTION_WAY,
  ListMotion,
  TEXT_AREA_LOOK,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  useLeaving,
} from "@repo/ui";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { useStateWithRef } from "@repo/ui/use-state-with-ref";
import { useMutation } from "@tanstack/react-query";
import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { actMutation } from "./act-mutations.js";
import { enterKeyHint, enterSubmitKey } from "./enter-sends.js";
import { failureShown } from "./failure-report.js";
import { encodeImage, imageFiles } from "./feedback-images.js";
import { AttachFilesButton } from "./tasks/attach-files-button.js";
import { DROP_LEAVE, useFileDrop } from "./use-file-drop.js";

const DIALOG_TITLE = "Send feedback";

const FEEDBACK_COPY = {
  [FEEDBACK_KIND.FEEDBACK]: {
    field: "Feedback",
    placeholder: "What happened, and what did you expect?",
  },
  [FEEDBACK_KIND.PROMPT]: {
    field: "Prompt",
    placeholder: `Write a prompt for what you would want built into ${PRODUCT_NAME}`,
  },
} as const;

const ATTACH_SCREENSHOTS = "Attach screenshots";

const UNSIGNED = "Sent without your name or email";

const IMAGE_REFUSAL = {
  UNREADABLE: "That file could not be attached.",
  FULL: `You can attach up to ${FEEDBACK_LIMITS.MAX_IMAGES} screenshots.`,
} as const;

const IMAGE_REFUSALS: ReadonlySet<string> = new Set(Object.values(IMAGE_REFUSAL));

const SEND_REFUSAL = "Could not send that. Try again.";

const SEND = "Send";
const SENDING = "Sending";

const KIND_CHOICES = [
  { value: FEEDBACK_KIND.FEEDBACK, label: "Feedback" },
  { value: FEEDBACK_KIND.PROMPT, label: "Prompt" },
] as const;

const MESSAGE_ROWS = 5;

interface FeedbackDraft {
  message: string;
  images: readonly FeedbackImage[];
  signed: boolean;
}

const FRESH_DRAFT: FeedbackDraft = { message: "", images: [], signed: true };

type FeedbackDrafts = Readonly<Record<FeedbackKind, FeedbackDraft>>;

const FRESH_DRAFTS = {
  [FEEDBACK_KIND.FEEDBACK]: FRESH_DRAFT,
  [FEEDBACK_KIND.PROMPT]: FRESH_DRAFT,
} satisfies FeedbackDrafts;

interface FeedbackSignature {
  name?: string;
  email: string;
}

function accountSignature(account: AccountSnapshot | undefined): FeedbackSignature | undefined {
  if (account?.status !== ACCOUNT_STATUS.SIGNED_IN) return undefined;
  return { ...(account.name ? { name: account.name } : undefined), email: account.email };
}

function hasWords(draft: FeedbackDraft): boolean {
  return draft.message.trim().length > 0;
}

function draftSubmission(
  kind: FeedbackKind,
  draft: FeedbackDraft,
  signature: FeedbackSignature | undefined,
  about: Experiment | undefined,
): FeedbackSubmission {
  const credit = draft.signed ? signature : undefined;
  return {
    kind,
    message: draft.message.trim(),
    ...(credit?.name ? { name: credit.name } : undefined),
    ...(credit ? { email: credit.email } : undefined),
    images: draft.images,
    ...(about === undefined ? undefined : { experiment: about }),
  };
}

function dialogTitle(about: Experiment | undefined): string {
  const experiment = EXPERIMENTS.find((entry) => entry.key === about);
  return experiment ? `Feedback on ${experiment.name}` : DIALOG_TITLE;
}

function feedbackImageUrl(image: FeedbackImage): string {
  return `data:${image.mediaType};base64,${image.base64}`;
}

function FeedbackImageRow({
  row,
  images,
  busy,
  onRemove,
}: {
  row: RefObject<HTMLUListElement | null>;
  images: readonly FeedbackImage[];
  busy: boolean;
  onRemove: (image: FeedbackImage) => void;
}): React.JSX.Element | null {
  const [ids] = useState(() => new WeakMap<FeedbackImage, string>());
  const minted = useRef(0);
  const idOf = (image: FeedbackImage): string => {
    const known = ids.get(image);
    if (known !== undefined) return known;
    minted.current += 1;
    const id = String(minted.current);
    ids.set(image, id);
    return id;
  };
  const drawn = useLeaving(images, idOf);
  if (drawn.length === 0) return null;
  return (
    <Inline
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.CONTROL}
      align={ALIGN.STRETCH}
      ref={row}
      className="feedback-dialog-images"
      aria-label="Screenshots"
      moves
    >
      {drawn.map(({ key, value: image, leaving }) => (
        <AttachmentChip
          key={key}
          motionKey={key}
          name={image.name}
          image={feedbackImageUrl(image)}
          removeDisabled={busy || leaving}
          onRemove={() => onRemove(image)}
        />
      ))}
    </Inline>
  );
}

function FeedbackImages({
  kind,
  ...props
}: {
  kind: FeedbackKind;
  images: readonly FeedbackImage[];
  busy: boolean;
  onRemove: (image: FeedbackImage) => void;
}): React.JSX.Element {
  const row = useRef<HTMLUListElement | null>(null);
  return (
    <ListMotion root={row} way={LIST_MOTION_WAY.SCALE} scene={kind}>
      <FeedbackImageRow row={row} {...props} />
    </ListMotion>
  );
}

async function takenImages(
  files: readonly File[],
  room: number,
): Promise<{ images: FeedbackImage[]; refusal?: string }> {
  const images: FeedbackImage[] = [];
  let unreadable = false;
  for (const file of files.slice(0, Math.max(0, room))) {
    const image = await encodeImage(file);
    if (image) images.push(image);
    else unreadable = true;
  }
  if (unreadable) return { images, refusal: IMAGE_REFUSAL.UNREADABLE };
  if (files.length > room) return { images, refusal: IMAGE_REFUSAL.FULL };
  return { images };
}

function composerNote(rejection: string | undefined, cut: boolean): ComposerNote | undefined {
  if (rejection !== undefined) {
    return {
      words: rejection,
      failure: IMAGE_REFUSALS.has(rejection)
        ? UNREPORTED.INPUT
        : failureShown({
            surface: FAILURE_SURFACE.FEEDBACK_SEND,
            cause: FAILURE_CONDITION.REFUSED,
            refused: true,
          }),
    };
  }
  return cut
    ? { words: pasteCutWords(FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH), failure: UNREPORTED.INPUT }
    : undefined;
}

export function FeedbackDialog({
  kind,
  about,
  account,
  onKind,
  onClose,
}: {
  kind: FeedbackKind | undefined;
  about?: Experiment | undefined;
  account: AccountSnapshot | undefined;
  onKind: (kind: FeedbackKind) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const { mutateAsync: sendFeedback } = useMutation(actMutation(ACT_KIND.FEEDBACK_SEND));
  const [drafts, setDrafts, latestDrafts] = useStateWithRef<FeedbackDrafts>(FRESH_DRAFTS);
  const discards = useRef<Record<FeedbackKind, number>>({
    [FEEDBACK_KIND.FEEDBACK]: 0,
    [FEEDBACK_KIND.PROMPT]: 0,
  });
  const shownKind = useRef(kind);
  shownKind.current = kind;
  const [busy, setBusy, latestBusy] = useStateWithRef(false);
  const [rejection, setRejection] = useState<string>();
  const [cutWords, setCutWords] = useState<string>();
  const fileDrop = useFileDrop((files) => void attach(imageFiles(files)), {
    leave: DROP_LEAVE.WINDOW,
  });
  const open = kind !== undefined;
  const field = useRef<HTMLTextAreaElement | null>(null);
  const signatureId = useId();
  const signature = accountSignature(account);

  const draftAbout = useRef<Record<FeedbackKind, Experiment | undefined>>({
    [FEEDBACK_KIND.FEEDBACK]: undefined,
    [FEEDBACK_KIND.PROMPT]: undefined,
  });
  useLayoutEffect(() => {
    if (kind === undefined || draftAbout.current[kind] === about) return;
    draftAbout.current[kind] = about;
    discards.current[kind] += 1;
    setDrafts({ ...latestDrafts(), [kind]: FRESH_DRAFT });
  }, [kind, about, latestDrafts, setDrafts]);

  useEffect(() => {
    if (!open) fileDrop.clear();
  }, [open]);

  const draft = drafts[kind ?? FEEDBACK_KIND.FEEDBACK];

  const writeDraft = (of: FeedbackKind, next: FeedbackDraft) => {
    setDrafts({ ...latestDrafts(), [of]: next });
  };

  const discardDraft = (of: FeedbackKind) => {
    discards.current[of] += 1;
    writeDraft(of, FRESH_DRAFT);
  };

  const changeDraft = (next: Partial<FeedbackDraft>) => {
    if (kind === undefined) return;
    writeDraft(kind, { ...latestDrafts()[kind], ...next });
    setRejection(undefined);
  };

  const noteCutPaste = (box: HTMLTextAreaElement, pasted: string) => {
    const kept = box.value.slice(0, box.selectionStart) + box.value.slice(box.selectionEnd);
    const room = FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH - kept.length;
    const text = pasted.replaceAll("\r\n", "\n");
    if (text.length <= room) return;
    setCutWords(
      box.value.slice(0, box.selectionStart) +
        text.slice(0, room) +
        box.value.slice(box.selectionEnd),
    );
  };

  const close = () => {
    if (kind === undefined || latestBusy()) return;
    if (!hasWords(latestDrafts()[kind])) discardDraft(kind);
    setRejection(undefined);
    onClose();
  };

  const attach = async (files: readonly File[]) => {
    if (kind === undefined || files.length === 0 || latestBusy()) return;
    const of = kind;
    const discarded = discards.current[of];
    const taken = await takenImages(
      files,
      FEEDBACK_LIMITS.MAX_IMAGES - latestDrafts()[of].images.length,
    );
    if (discards.current[of] !== discarded || latestBusy()) return;
    const current = latestDrafts()[of];
    writeDraft(of, {
      ...current,
      images: [...current.images, ...taken.images].slice(0, FEEDBACK_LIMITS.MAX_IMAGES),
    });
    if (shownKind.current === of) setRejection(taken.refusal);
  };

  const send = async () => {
    if (kind === undefined) return;
    const current = latestDrafts()[kind];
    if (latestBusy() || !hasWords(current)) return;
    setBusy(true);
    setRejection(undefined);
    const refusal = await sendFeedback({
      submission: draftSubmission(kind, current, signature, about),
    }).then(
      (result) => (result.delivered ? undefined : (result.reason ?? SEND_REFUSAL)),
      () => SEND_REFUSAL,
    );
    setBusy(false);
    if (refusal !== undefined) {
      setRejection(refusal);
      return;
    }
    discardDraft(kind);
    onClose();
  };

  const standing = useRef<
    { kind: FeedbackKind; about: Experiment | undefined; draft: FeedbackDraft } | undefined
  >(undefined);
  if (kind !== undefined) standing.current = { kind, about, draft };
  const shown = standing.current;

  const full = draft.images.length >= FEEDBACK_LIMITS.MAX_IMAGES;

  return shown === undefined ? null : (
    <Dialog
      open={open}
      size={DIALOG_SIZE.WIDE}
      title={dialogTitle(shown.about)}
      busy={busy}
      refused={rejection !== undefined}
      holding={hasWords(draft)}
      initialFocus={field}
      onDismiss={close}
      dropping={fileDrop.dropping}
      dropTarget={fileDrop.target}
    >
      <div className="feedback-dialog ph-no-capture flex min-h-0 flex-col gap-block-gap">
        {shown.about === undefined ? (
          <ChoiceBar<FeedbackKind>
            label="Kind of note"
            items={KIND_CHOICES}
            value={shown.kind}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            disabled={busy}
            onChange={onKind}
          />
        ) : null}
        <ComposerFrame
          className="feedback-dialog-composer flex min-w-0 flex-col"
          dropping={fileDrop.dropping}
        >
          <ComposerBody
            files={
              <FeedbackImages
                kind={shown.kind}
                images={shown.draft.images}
                busy={busy}
                onRemove={(image) =>
                  changeDraft({
                    images: latestDrafts()[shown.kind].images.filter((held) => held !== image),
                  })
                }
              />
            }
          >
            <div className="feedback-dialog-field px-ui-12 pt-ui-12">
              <TextArea
                ref={field}
                label={FEEDBACK_COPY[shown.kind].field}
                look={TEXT_AREA_LOOK.BARE}
                placeholder={FEEDBACK_COPY[shown.kind].placeholder}
                maxLength={FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH}
                value={shown.draft.message}
                disabled={busy}
                rows={MESSAGE_ROWS}
                grow
                enterKeyHint={enterKeyHint()}
                submitKey={enterSubmitKey()}
                onSubmit={() => void send()}
                onChange={(message) => changeDraft({ message })}
                onPaste={(event) => {
                  const pasted = imageFiles(event.clipboardData.files);
                  if (pasted.length === 0) {
                    noteCutPaste(event.currentTarget, event.clipboardData.getData("text"));
                    return;
                  }
                  event.preventDefault();
                  void attach(pasted);
                }}
              />
            </div>
          </ComposerBody>
          <ComposerFoot
            tools={
              <AttachFilesButton
                label={ATTACH_SCREENSHOTS}
                accept="image/*"
                disabled={busy || full}
                onFiles={(picked) => void attach(imageFiles(picked))}
              />
            }
            counter={{
              length: shown.draft.message.length,
              limit: FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH,
            }}
            send={{
              label: SEND,
              empty: !hasWords(draft),
              onSend: () => void send(),
              busy,
              busyLabel: SENDING,
            }}
            note={composerNote(rejection, cutWords === shown.draft.message)}
          />
        </ComposerFrame>
        {signature ? (
          <Checkbox
            checked={shown.draft.signed}
            disabled={busy}
            aria-describedby={signatureId}
            onChange={(signed) => changeDraft({ signed })}
            detail={
              <Text
                as={TEXT_ELEMENT.SPAN}
                variant={TEXT_VARIANT.CAPTION}
                tone={TEXT_TONE.MUTED}
                truncate
                id={signatureId}
              >
                {shown.draft.signed
                  ? [signature.name, signature.email].filter(Boolean).join(" · ")
                  : UNSIGNED}
              </Text>
            }
          >
            Include my name and email
          </Checkbox>
        ) : null}
      </div>
    </Dialog>
  );
}
