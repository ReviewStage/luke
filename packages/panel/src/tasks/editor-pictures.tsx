import { PICTURE_BOUNDS } from "@luke/features/picture-wire";
import { planAttachmentAddress, planAttachmentOf } from "@luke/features/plan-attachment-link";
import { PICTURE_KEEP_FAILURE } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { BUTTON_VARIANT, ErrorState, FormField, TextField } from "@luke/ui";
import { keepPictureRead, PICTURE_STATE, usePicture } from "@luke/ui/picture-cache";
import { CaptionsIcon, Maximize2Icon, TextCursorInputIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAct } from "../act.js";
import { useAppCommand } from "../app-commands.js";
import { encodeImage } from "../feedback-images.js";
import { FoldingButton } from "../folding-button.js";
import { PictureBlock } from "../picture-block.js";
import type {
  PictureNode,
  PictureNodeDoors,
  PictureTaken,
  PlanEditorHandle,
  PlanEditorPictures,
} from "../plan-editor/contract.js";
import { Spinner } from "../spinner.js";
import { documentScrollerOf } from "./document-frame.js";
import { type PlanPicturesDoor, usePlanPicturesDoor } from "./plan-pictures.js";

/**
 * editor-pictures.tsx -- a plan's pictures in its editor: laid in from a paste, a drop, or Insert image, kept on the service as they wait, and drawn in each picture's node with its tools.
 *
 * A picture laid in waits on its upload: the Mac re-encodes it to at most
 * `PICTURE_BOUNDS.MAX_BYTES` (`encodeImage`), shows it at once from those
 * bytes at half strength with the window's spinner and "Uploading" where
 * its caption will stand, and keeps it on the plan (`planning.pictureKeep`).
 * Kept, the picture takes its address and the text writes its line; until
 * then the text writes nothing of it. A keep that fails says so in the same
 * place, as every failure is said (`@luke/ui`'s `ErrorState`): its sentence, then
 * Retry and Remove. A picture of another plan pasted in is read as that
 * plan's and kept again on this one, so this plan's readers can see it.
 * Selected, a picture offers its tools: Alt text and Caption, each a field
 * under it, Enlarge, and Delete. They hang above the picture from its left
 * edge, as wide as their own names, so a skinny picture neither squeezes
 * them nor sits under them, unless the plan's scroller would cut them off
 * there, when they stand inside its top edge; in a column too narrow for
 * their names each is its glyph, named by its tooltip. Insert image (⌥⌘I, ⌘K, the Edit menu)
 * chooses files while the text is edited.
 */

/** What a picture's upload says, and what a failed one says by why. */
const UPLOAD_WORDS = {
  SENDING: "Uploading",
  NOT_A_PICTURE: "This file is not a picture Luke can keep.",
  TOO_MANY: "This plan already holds as many pictures as it can.",
  NOT_COPIED: "The picture could not be read from its plan.",
  FAILED: "The image could not be uploaded.",
} as const;

/** What each of a selected picture's tools is called. */
const TOOL = {
  ALT: "Alt text",
  CAPTION: "Caption",
  ENLARGE: "Enlarge",
  DELETE: "Delete",
} as const;

/** What a field under a picture describes. */
const DESCRIBING = {
  ALT: { label: TOOL.ALT },
  CAPTION: { label: TOOL.CAPTION },
} as const;

type Describing = (typeof DESCRIBING)[keyof typeof DESCRIBING];

/** The narrowest column a selected picture's tools say their names in; narrower, each is its glyph. */
const TOOLS_WORDED_PX = 360;

/** The room above a picture, inside the plan's scroller, its tools need to stand above it: their height and their gap. */
const TOOLS_ROOM_PX = 44;

/** One of a selected picture's tools: its name, its glyph, what a press does, and whether it destroys. */
interface PictureTool {
  readonly label: string;
  readonly icon: ReactNode;
  readonly run: () => void;
  readonly danger?: boolean;
}

/** The image types Insert image offers to choose. */
const CHOSEN_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/heic";

/** Where an upload stands: sending, or failed with why, each with the Mac's own bytes once it has them. */
const UPLOAD = { SENDING: "sending", FAILED: "failed" } as const;

type Upload =
  | { readonly kind: typeof UPLOAD.SENDING; readonly url?: string | undefined }
  | {
      readonly kind: typeof UPLOAD.FAILED;
      readonly url?: string | undefined;
      readonly reason: string;
      readonly taken: PictureTaken;
    };

/** A picture's node the panel draws into. */
interface DrawnPicture {
  readonly key: number;
  readonly element: HTMLElement;
  readonly picture: PictureNode;
  readonly selected: boolean;
  readonly doors: PictureNodeDoors;
}

/** A `data:` URL of bytes the Mac encoded. */
function dataUrlOf(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

/** The picture a file is, re-encoded within the bound, as a `data:` URL; nothing for a file that is no picture. */
async function encodedUrl(file: File): Promise<string | undefined> {
  const encoded = await encodeImage(file, PICTURE_BOUNDS.MAX_BYTES);
  return encoded === undefined ? undefined : dataUrlOf(encoded.mediaType, encoded.base64);
}

/** A picture waiting on its upload: the Mac's bytes at half strength, and the wait or its failure where its caption will stand. */
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
    <span className="picture-block ph-no-capture" data-upload={upload?.kind ?? UPLOAD.FAILED}>
      <span className="picture-frame">
        {url === undefined ? (
          <span className="picture-pending" />
        ) : (
          <img className="picture-image" src={url} alt={alt} draggable={false} />
        )}
      </span>
      {upload?.kind === UPLOAD.SENDING ? (
        <span className="picture-status">
          <Spinner label={UPLOAD_WORDS.SENDING} />
          <span>{UPLOAD_WORDS.SENDING}</span>
        </span>
      ) : (
        <span className="picture-failure">
          <ErrorState
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

/** The field under a picture that describes it anew: its words saved on Return, let go on Escape. */
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
    <span className="picture-describe">
      <FormField label={describing.label}>
        {(field) => (
          <TextField
            field={field}
            value={words}
            // Note that the field opens on a press of its own tool, which is where the keyboard is going.
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

/** How a selected picture's tools stand: with their names or as glyphs, and above the picture or inside its top edge. */
interface ToolsLayout {
  readonly worded: boolean;
  readonly above: boolean;
}

/**
 * How a selected picture's tools stand, as the window lays the column out:
 * named where the column has room for their names, and above the picture
 * unless the plan's scroller would cut them off there, as it would a
 * picture scrolled to its top. A column not laid out measures nothing and
 * keeps them named and above.
 */
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

/** A selected picture's tools, above it or inside its top edge where there is no room above: each its glyph and its name, or its glyph and a tooltip where the column is too narrow. */
function PictureTools({
  column,
  tools,
}: {
  column: HTMLElement;
  tools: readonly PictureTool[];
}): React.JSX.Element {
  const { worded, above } = useToolsLayout(column);
  return (
    <span
      className="picture-tools"
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
    </span>
  );
}

/** A kept picture in the editor: drawn as the document draws it, its tools above it while selected. */
function KeptPicture({
  drawn,
  door,
}: {
  drawn: DrawnPicture;
  door: PlanPicturesDoor;
}): React.JSX.Element {
  const { picture, selected, doors } = drawn;
  const named = planAttachmentOf(picture.src);
  const state = usePicture(named?.taskId ?? "", named?.attachmentId ?? "", door.read);
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
      icon: <Trash2Icon aria-hidden="true" />,
      run: doors.remove,
      danger: true,
    },
  ];
  return (
    <span className="editor-picture-drawn" data-selected={String(selected)}>
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

/** What the editor's pictures hand the document: the editor's doors, the pictures drawn into their nodes, the chooser Insert image opens, and whether one is still being sent. */
export interface EditorPictures {
  readonly pictures: PlanEditorPictures | undefined;
  readonly drawn: ReactNode;
  /** Whether a picture laid in is still on its way to being kept, which the editor stays open for, since only it can lay in the address that comes back. */
  readonly sending: boolean;
}

/**
 * The plan's pictures in its editor: drawn into each node, kept as they are
 * laid in, and chosen by Insert image while the text is edited. None where
 * the place names no workspace to address them under, as the template does.
 */
export function useEditorPictures(
  taskId: string,
  workspace: string | undefined,
  handle: React.RefObject<PlanEditorHandle | undefined>,
): EditorPictures {
  const { act } = useAct();
  const door = usePlanPicturesDoor();
  const [drawn, setDrawn] = useState<readonly DrawnPicture[]>([]);
  const [uploads, setUploads] = useState<ReadonlyMap<string, Upload>>(new Map());
  const counted = useRef(0);
  const chooser = useRef<HTMLInputElement>(null);
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
      const kept = await act(ACT_KIND.TASKS_PICTURE_KEEP, { planId: taskId, picture: url }).catch(
        () => undefined,
      );
      if (kept === undefined || "failure" in kept) {
        return failed(
          kept?.failure === PICTURE_KEEP_FAILURE.TOO_MANY
            ? UPLOAD_WORDS.TOO_MANY
            : UPLOAD_WORDS.FAILED,
        );
      }
      keepPictureRead(taskId, kept.id, url);
      handle.current?.settlePicture(
        taken.upload,
        planAttachmentAddress({ taskId, attachmentId: kept.id }, workspace),
      );
      settled(taken.upload, undefined);
    },
    [act, handle, taskId, settled, workspace],
  );
  // Note that a picture of another plan is read as that plan's before it is kept again.
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
      const named = planAttachmentOf(taken.from);
      const read =
        named === undefined || door === undefined
          ? undefined
          : await door.read(named.taskId, named.attachmentId).catch(() => undefined);
      if (read === undefined || "failure" in read) {
        return settled(taken.upload, {
          kind: UPLOAD.FAILED,
          reason: UPLOAD_WORDS.NOT_COPIED,
          taken,
        });
      }
      return keep(taken, dataUrlOf(read.contentType, read.base64));
    },
    [door, keep, settled],
  );
  // Note that the doors handed the editor once read the newest of these as they run.
  const beginning = useRef(begin);
  beginning.current = begin;
  const pictures = useRef<PlanEditorPictures | undefined>(undefined);
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
        const named = planAttachmentOf(src);
        return named !== undefined && named.taskId !== taskId;
      },
    };
  }
  useAppCommand(
    APP_COMMAND.INSERT_PICTURE,
    workspace === undefined ? undefined : () => chooser.current?.click(),
  );
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
    drawn: (
      <>
        {portals}
        <input
          ref={chooser}
          type="file"
          accept={CHOSEN_TYPES}
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            handle.current?.insertPictures(files);
          }}
        />
      </>
    ),
  };
}
