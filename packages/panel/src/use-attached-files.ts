import { CODING_AGENT_BOUNDS, type CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { useRef, useState } from "react";
import { imageFiles } from "./feedback-images.js";
import {
  ATTACH_TAKES,
  type AttachTakes,
  type FilesRead,
  filesTaken,
  readFiles,
  withFiles,
} from "./tasks/attached-files.js";
import { type FileDrop, useFileDrop } from "./use-file-drop.js";

/**
 * use-attached-files.ts -- the files a message box holds before it sends: the ones picked by its +, pasted, or dropped on it, read and taken after the ones it holds, and why any did not come.
 *
 * Every box that takes files takes them here, so a pick, a paste, and a
 * drop come the same way in each: read on this machine
 * (`tasks/attached-files.ts`), held to the box's count and to the bytes a
 * message carries together, and taken after whatever the box holds as the
 * read lands, so neither a read that landed first nor a chip taken off
 * meanwhile is undone. A paste takes the pictures on the clipboard alone,
 * so text pastes as it always does. The first file of a hand-off that
 * cannot come says why in the box's one note, and a hand-off that all came
 * takes a standing file note down. A box keeps its files where it keeps its
 * draft, or here where it keeps none.
 */

/** Where a box keeps its files: the files as it draws them, and a change handed what it holds as the change lands. */
interface AttachedFilesHolder {
  readonly attachments: readonly CodingAgentAttachment[];
  readonly update: (
    next: (was: readonly CodingAgentAttachment[]) => readonly CodingAgentAttachment[],
  ) => void;
}

/** What a box takes and where its files and its note go. */
export interface AttachedFilesOptions {
  /** Says the box's note: why the last files handed did not all come, or nothing once they did. */
  readonly onRefusal: (words: string | undefined) => void;
  /** Where the box keeps its files, its draft for one; the hook's own state where none is given. */
  readonly holder?: AttachedFilesHolder | undefined;
  /** What the box carries; any file a message to an agent takes where none is given. */
  readonly takes?: AttachTakes | undefined;
  /** The most files the box carries; a message to an agent's where none is given. */
  readonly most?: number | undefined;
  /** Whether the box takes no files now, as the agent box while a send holds it. */
  readonly held?: boolean | undefined;
  /** What the files land on, and what is said where a read lands once the box writes elsewhere, as an Inbox item its agent revised. */
  readonly place?: { readonly key: unknown; readonly moved: string } | undefined;
}

/** The files a box holds and the ways it takes more and lets them go. */
export interface AttachedFiles {
  readonly attachments: readonly CodingAgentAttachment[];
  /** Whether files handed to the box are still being read, which a send waits on. */
  readonly reading: boolean;
  /** Takes files picked or handed to the box, in order. */
  readonly attach: (files: readonly File[]) => void;
  /** Takes the pictures among pasted files, answering whether there were any, so text pastes as it always does. */
  readonly paste: (files: readonly File[]) => boolean;
  readonly remove: (index: number) => void;
  /** The files the box holds this moment, for a callback that outlives the render it was made in. */
  readonly now: () => readonly CodingAgentAttachment[];
  /** Sets the files the box holds outright, as a send empties it and a send that failed puts them back. */
  readonly set: (attachments: readonly CodingAgentAttachment[]) => void;
  /** The drop target the box's card spreads, and whether files are over it. */
  readonly drop: FileDrop;
}

/** The files a box holds, read as they are handed to it on the terms `options` sets. */
export function useAttachedFiles(options: AttachedFilesOptions): AttachedFiles {
  const [own, setOwn] = useState<readonly CodingAgentAttachment[]>([]);
  // The files held as of the last change, which a read landing late is taken after.
  const ownNow = useRef(own);
  const ownHolder: AttachedFilesHolder = {
    attachments: own,
    update: (next) => {
      ownNow.current = next(ownNow.current);
      setOwn(ownNow.current);
    },
  };
  // Note that a read lands on the options as they stand when it lands, since the box may have drawn again meanwhile.
  const latest = useRef(options);
  latest.current = options;
  const holderNow = () => latest.current.holder ?? ownHolder;
  const heldNow = () => latest.current.holder?.attachments ?? ownNow.current;
  const [reading, setReading] = useState(0);

  const take = (refused: string | undefined, read: FilesRead) => {
    const { most = CODING_AGENT_BOUNDS.MAX_ATTACHMENTS, onRefusal } = latest.current;
    const taken = withFiles(heldNow(), read, most);
    holderNow().update((now) => withFiles(now, read, most).attachments);
    onRefusal(refused ?? taken.refusal);
  };
  const attach = (files: readonly File[]) => {
    if (files.length === 0 || latest.current.held === true) return;
    const handed = filesTaken(files, latest.current.takes ?? ATTACH_TAKES.FILES);
    if (handed.files.length === 0) {
      latest.current.onRefusal(handed.refusal);
      return;
    }
    const at = latest.current.place?.key;
    setReading((count) => count + 1);
    void readFiles(handed.files)
      .then((read) => {
        const { place, onRefusal } = latest.current;
        // Files read for a place the box no longer writes to land nowhere, as its words were let go.
        if (place !== undefined && !Object.is(place.key, at)) onRefusal(place.moved);
        else take(handed.refusal, read);
      })
      .finally(() => setReading((count) => count - 1));
  };
  const drop = useFileDrop((files) => attach(Array.from(files)), { over: options.held !== true });
  return {
    attachments: (options.holder ?? ownHolder).attachments,
    reading: reading > 0,
    attach,
    paste: (files) => {
      const pasted = imageFiles(files);
      if (pasted.length === 0) return false;
      attach(pasted);
      return true;
    },
    remove: (index) => {
      latest.current.onRefusal(undefined);
      holderNow().update((was) => was.filter((_, at) => at !== index));
    },
    now: heldNow,
    set: (next) => {
      latest.current.onRefusal(undefined);
      holderNow().update(() => next);
    },
    drop,
  };
}
