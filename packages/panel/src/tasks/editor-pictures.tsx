import { PICTURE_BOUNDS } from "@repo/features/picture-wire";
import {
  descriptionAttachmentAddress,
  descriptionAttachmentOf,
} from "@repo/features/description-attachment-link";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { PICTURE_KEEP_FAILURE } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BUTTON_VARIANT,
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_PADDING,
  Card,
  ErrorState,
  FoldingButton,
  FormField,
  isVideoDataUrl,
  MENU_SURFACE_ELEMENT,
  MENU_SURFACE_FLOW,
  MenuSurface,
  Spinner,
  TextField,
  useFilePicker,
} from "@repo/ui";
import { CaptionsIcon, GLYPH, Maximize2Icon, TextCursorInputIcon } from "@repo/ui/icons";
import { PICTURE_STATE, usePicture } from "@repo/ui/picture-read";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { actMutation } from "../act-mutations.js";
import { useAppCommand } from "../app-commands.js";
import { failureShown, pictureUnread } from "../failure-report.js";
import { encodeImage } from "../feedback-images.js";
import {
  PICTURE_BLOCK_CLASS,
  PICTURE_FRAME_CLASS,
  PICTURE_IMAGE_CLASS,
  PICTURE_PENDING_CLASS,
  PictureBlock,
} from "../picture-block.js";
import { keepPictureRead, pictureQuery } from "../picture-query.js";
import type {
  PictureNode,
  PictureNodeDoors,
  PictureTaken,
  DescriptionEditorHandle,
  DescriptionEditorPictures,
} from "../description-editor/contract.js";
import { documentScrollerOf } from "./document-frame.js";
import {
  type DescriptionPicturesDoor,
  useDescriptionPicturesDoor,
} from "./description-pictures.js";

const UPLOAD_WORDS = {
  SENDING: "Uploading",
  NOT_A_PICTURE: "This file is not a picture a description can keep.",
  TOO_MANY: "This description already holds as many pictures as it can.",
  TOO_MANY_VIDEOS: "This description already holds as many videos as it can.",
  NOT_COPIED: "The picture could not be read from its description.",
  FAILED: "The image could not be uploaded.",
} as const;

const TOOL = {
  ALT: "Alt text",
  CAPTION: "Caption",
  ENLARGE: "Enlarge",
  DELETE: "Delete",
} as const;

const DESCRIBING = {
  ALT: { label: TOOL.ALT },
  CAPTION: { label: TOOL.CAPTION },
} as const;

type Describing = (typeof DESCRIBING)[keyof typeof DESCRIBING];

const TOOLS_WORDED_PX = 360;

const TOOLS_ROOM_PX = 44;

interface PictureTool {
  readonly label: string;
  readonly icon: ReactNode;
  readonly run: () => void;
  readonly danger?: boolean;
}

const CHOSEN_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/heic";

const UPLOAD = { SENDING: "sending", FAILED: "failed" } as const;

type Upload =
  | { readonly kind: typeof UPLOAD.SENDING; readonly url?: string | undefined }
  | {
      readonly kind: typeof UPLOAD.FAILED;
      readonly url?: string | undefined;
      readonly reason: string;
      readonly taken: PictureTaken;
    };

interface DrawnPicture {
  readonly key: number;
  readonly element: HTMLElement;
  readonly picture: PictureNode;
  readonly selected: boolean;
  readonly doors: PictureNodeDoors;
}

function keepFailedWords(failure: string | undefined): string {
  if (failure === PICTURE_KEEP_FAILURE.TOO_MANY) return UPLOAD_WORDS.TOO_MANY;
  if (failure === PICTURE_KEEP_FAILURE.TOO_MANY_VIDEOS) return UPLOAD_WORDS.TOO_MANY_VIDEOS;
  return UPLOAD_WORDS.FAILED;
}

function dataUrlOf(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

async function encodedUrl(file: File): Promise<string | undefined> {
  const encoded = await encodeImage(file, PICTURE_BOUNDS.MAX_BYTES);
  return encoded === undefined ? undefined : dataUrlOf(encoded.mediaType, encoded.base64);
}

function UploadingPicture({
  upload,
  alt,
  onRetry,
  onRemove,
}: {
  upload: Upload | undefined;
  alt: string;
  onRetry: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const url = upload?.url;
  return (
    <span className={PICTURE_BLOCK_CLASS} data-upload={upload?.kind ?? UPLOAD.FAILED}>
      <Card
        as={CARD_ELEMENT.SPAN}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.FLUSH}
        className={PICTURE_FRAME_CLASS}
      >
        {url === undefined || isVideoDataUrl(url) ? (
          <span className={PICTURE_PENDING_CLASS} />
        ) : (
          <img
            className={`${PICTURE_IMAGE_CLASS} opacity-50`}
            src={url}
            alt={alt}
            draggable={false}
          />
        )}
      </Card>
      {upload?.kind === UPLOAD.SENDING ? (
        <span className="picture-status mt-item-gap flex items-center gap-item-gap text-caption text-muted-foreground">
          <Spinner delay label={UPLOAD_WORDS.SENDING} />
          <span>{UPLOAD_WORDS.SENDING}</span>
        </span>
      ) : (
        <span className="mt-item-gap block">
          <ErrorState
            failure={failureShown({
              surface: FAILURE_SURFACE.PICTURE_KEEP,
              cause: upload ?? FAILURE_CONDITION.NOT_KEPT,
              ...(upload?.kind === UPLOAD.FAILED ? { refused: true } : undefined),
            })}
            onRetry={upload?.kind === UPLOAD.FAILED ? onRetry : undefined}
            onRemove={onRemove}
          >
            {upload?.kind === UPLOAD.FAILED ? upload.reason : UPLOAD_WORDS.FAILED}
          </ErrorState>
        </span>
      )}
    </span>
  );
}

function DescribeField({
  describing,
  value,
  onSave,
  onClose,
}: {
  describing: Describing;
  value: string;
  onSave: (words: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [words, setWords] = useState(value);
  const keep = () => {
    onSave(words.trim());
    onClose();
  };
  return (
    <span className="mx-0 mt-item-gap mb-block-gap grid w-picture-describe">
      <FormField label={describing.label} optional>
        {(field) => (
          <TextField
            field={field}
            value={words}
            autoFocus
            onChange={setWords}
            onEnter={keep}
            onEscape={onClose}
            onBlur={keep}
          />
        )}
      </FormField>
    </span>
  );
}

interface ToolsLayout {
  readonly worded: boolean;
  readonly above: boolean;
}

function useToolsLayout(column: HTMLElement): ToolsLayout {
  const [layout, setLayout] = useState<ToolsLayout>({ worded: true, above: true });
  useLayoutEffect(() => {
    const scroller = documentScrollerOf(column);
    const measure = () => {
      const box = column.getBoundingClientRect();
      if (box.width <= 0) return;
      const top = column.querySelector(".picture-frame")?.getBoundingClientRect().top ?? box.top;
      const room = top - (scroller?.getBoundingClientRect().top ?? -Infinity);
      const next = { worded: box.width >= TOOLS_WORDED_PX, above: room >= TOOLS_ROOM_PX };
      setLayout((was) => (was.worded === next.worded && was.above === next.above ? was : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    scroller?.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      scroller?.removeEventListener("scroll", measure);
    };
  }, [column]);
  return layout;
}

function PictureTools({
  column,
  tools,
}: {
  column: HTMLElement;
  tools: readonly PictureTool[];
}): React.JSX.Element {
  const { worded, above } = useToolsLayout(column);
  return (
    <MenuSurface
      as={MENU_SURFACE_ELEMENT.SPAN}
      flow={MENU_SURFACE_FLOW.TOOLBAR}
      className="picture-tools absolute top-0 left-0 z-1 -translate-y-[calc(100%+var(--ui-space-8))] data-[above=false]:top-ui-8 data-[above=false]:left-ui-8 data-[above=false]:translate-none data-[worded=false]:[--ui-fold:folded]"
      role="toolbar"
      aria-label="Picture"
      data-worded={String(worded)}
      data-above={String(above)}
    >
      {tools.map(({ label, icon, run, danger = false }) => (
        <FoldingButton
          key={label}
          label={label}
          icon={icon}
          variant={danger ? BUTTON_VARIANT.DANGER : BUTTON_VARIANT.QUIET}
          onClick={(event) => {
            event.stopPropagation();
            run();
          }}
        />
      ))}
    </MenuSurface>
  );
}

function KeptPicture({
  drawn,
  door,
}: {
  drawn: DrawnPicture;
  door: DescriptionPicturesDoor;
}): React.JSX.Element {
  const { picture, selected, doors } = drawn;
  const named = descriptionAttachmentOf(picture.src);
  const state = usePicture(
    pictureQuery(named?.taskId ?? "", named?.attachmentId ?? "", door.read),
    pictureUnread,
  );
  const [describing, setDescribing] = useState<Describing | undefined>(undefined);
  const own = named?.taskId === door.taskId;
  const tools: PictureTool[] = [
    {
      label: TOOL.ALT,
      icon: <TextCursorInputIcon aria-hidden="true" />,
      run: () => setDescribing(DESCRIBING.ALT),
    },
    {
      label: TOOL.CAPTION,
      icon: <CaptionsIcon aria-hidden="true" />,
      run: () => setDescribing(DESCRIBING.CAPTION),
    },
    ...(own && named !== undefined
      ? [
          {
            label: TOOL.ENLARGE,
            icon: <Maximize2Icon aria-hidden="true" />,
            run: () => door.open(named.attachmentId),
          },
        ]
      : []),
    {
      label: TOOL.DELETE,
      icon: <GLYPH.DELETE />,
      run: doors.remove,
      danger: true,
    },
  ];
  return (
    <span
      className="editor-picture-drawn relative mt-block-gap block w-fit max-w-full"
      data-selected={String(selected)}
    >
      <PictureBlock
        state={named === undefined ? { kind: PICTURE_STATE.MISSING } : state}
        alt={picture.alt}
        caption={picture.title === "" ? undefined : picture.title}
      />
      {selected ? <PictureTools column={drawn.element} tools={tools} /> : null}
      {describing === undefined ? null : (
        <DescribeField
          describing={describing}
          value={describing === DESCRIBING.ALT ? picture.alt : picture.title}
          onSave={(words) =>
            doors.describe(describing === DESCRIBING.ALT ? { alt: words } : { title: words })
          }
          onClose={() => setDescribing(undefined)}
        />
      )}
    </span>
  );
}

export interface EditorPictures {
  readonly pictures: DescriptionEditorPictures | undefined;
  readonly drawn: ReactNode;
  readonly sending: boolean;
  readonly choose: (() => void) | undefined;
}

export function useEditorPictures(
  taskId: string,
  workspace: string | undefined,
  handle: React.RefObject<DescriptionEditorHandle | undefined>,
): EditorPictures {
  const { mutateAsync: sendKeep } = useMutation(actMutation(ACT_KIND.TASKS_PICTURE_KEEP));
  const queryClient = useQueryClient();
  const door = useDescriptionPicturesDoor();
  const [drawn, setDrawn] = useState<readonly DrawnPicture[]>([]);
  const [uploads, setUploads] = useState<ReadonlyMap<string, Upload>>(new Map());
  const counted = useRef(0);
  const settled = useCallback(
    (upload: string, next: Upload | undefined) =>
      setUploads((was) => {
        const now = new Map(was);
        if (next === undefined) now.delete(upload);
        else now.set(upload, next);
        return now;
      }),
    [],
  );
  const keep = useCallback(
    async (taken: PictureTaken, url: string | undefined) => {
      if (workspace === undefined || url === undefined) return;
      settled(taken.upload, { kind: UPLOAD.SENDING, url });
      const failed = (reason: string) =>
        settled(taken.upload, { kind: UPLOAD.FAILED, url, reason, taken });
      const kept = await sendKeep({ planId: taskId, picture: url }).catch(() => undefined);
      if (kept === undefined || "failure" in kept) return failed(keepFailedWords(kept?.failure));
      keepPictureRead(queryClient, taskId, kept.id, url);
      handle.current?.settlePicture(
        taken.upload,
        descriptionAttachmentAddress({ taskId, attachmentId: kept.id }, workspace),
      );
      settled(taken.upload, undefined);
    },
    [sendKeep, queryClient, handle, taskId, settled, workspace],
  );
  const begin = useCallback(
    async (taken: PictureTaken) => {
      settled(taken.upload, { kind: UPLOAD.SENDING });
      if ("file" in taken) {
        const url = await encodedUrl(taken.file);
        if (url === undefined) {
          return settled(taken.upload, {
            kind: UPLOAD.FAILED,
            reason: UPLOAD_WORDS.NOT_A_PICTURE,
            taken,
          });
        }
        return keep(taken, url);
      }
      const named = descriptionAttachmentOf(taken.from);
      const read =
        named === undefined || door === undefined
          ? undefined
          : await queryClient
              .fetchQuery(pictureQuery(named.taskId, named.attachmentId, door.read))
              .catch(() => undefined);
      if (read?.kind !== PICTURE_STATE.READY) {
        return settled(taken.upload, {
          kind: UPLOAD.FAILED,
          reason: UPLOAD_WORDS.NOT_COPIED,
          taken,
        });
      }
      return keep(taken, read.url);
    },
    [door, keep, settled, queryClient],
  );
  const beginning = useRef(begin);
  beginning.current = begin;
  const pictures = useRef<DescriptionEditorPictures | undefined>(undefined);
  if (pictures.current === undefined && workspace !== undefined) {
    pictures.current = {
      draw: (element, picture, doors) => {
        counted.current += 1;
        const key = counted.current;
        setDrawn((was) => [...was, { key, element, picture, doors, selected: false }]);
        return {
          redraw: (next, selected) =>
            setDrawn((was) =>
              was.map((each) => (each.key === key ? { ...each, picture: next, selected } : each)),
            ),
          undraw: () => setDrawn((was) => was.filter((each) => each.key !== key)),
        };
      },
      take: (taken) => {
        for (const each of taken) beginning.current(each);
      },
      copies: (src) => {
        const named = descriptionAttachmentOf(src);
        return named !== undefined && named.taskId !== taskId;
      },
    };
  }
  const chooser = useFilePicker({
    accept: CHOSEN_TYPES,
    multiple: true,
    onFiles: (files) => handle.current?.insertPictures([...files]),
  });
  const choose = workspace === undefined ? undefined : chooser.open;
  useAppCommand(APP_COMMAND.INSERT_PICTURE, choose);
  const portals = drawn.map((each) =>
    createPortal(
      each.picture.upload === "" ? (
        door === undefined ? null : (
          <KeptPicture drawn={each} door={door} />
        )
      ) : (
        <UploadingPicture
          upload={uploads.get(each.picture.upload)}
          alt={each.picture.alt}
          onRetry={() => {
            const upload = uploads.get(each.picture.upload);
            if (upload?.kind === UPLOAD.FAILED) beginning.current(upload.taken);
          }}
          onRemove={() => {
            handle.current?.removePicture(each.picture.upload);
            settled(each.picture.upload, undefined);
          }}
        />
      ),
      each.element,
      each.key,
    ),
  );
  return {
    pictures: pictures.current,
    sending: [...uploads.values()].some((upload) => upload.kind === UPLOAD.SENDING),
    choose,
    drawn: (
      <>
        {portals}
        {chooser.input}
      </>
    ),
  };
}
