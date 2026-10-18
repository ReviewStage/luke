import { CHANGED_FILE_STATUS, type CodingAgentChangedFile } from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { PICTURE_STATE, type PictureState, usePicture } from "@luke/ui/picture-cache";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act";
import { Segmented } from "../segmented";

/**
 * image-diff.tsx -- a changed image as Files changed draws it: the picture before and after, side by side, swiped, or one faded over the other, in place of "binary file".
 *
 * Each side is the file of the agent's own repository at a commit, read by
 * the service through the repository's contents on the App's token, as the
 * Pull request tab reads any picture its pull request names
 * (`@luke/features/github-image`'s raw-file address, the act
 * `CODING_AGENTS_GITHUB_IMAGE`): the before at the merge base GitHub counts
 * the changes from, the after at the head. So the window asks GitHub nothing
 * itself, holds no token, and draws each from a `data:` URL of its own
 * making, which the panel's policy admits; a side the service will not
 * answer, an image past its bound or no image at all, says so. A side is
 * read only once its file is open and Pierre has drawn it near the view,
 * and kept for the window's life (`@luke/ui/picture-cache`), so a list of a
 * hundred images reads only the ones looked at. An image added has no
 * before and one deleted no after; a before whose merge base the service
 * could not read is not drawn at all rather than drawn wrong, and the after
 * stands alone, saying so.
 */

/** How an image's two sides are set against each other: beside each other, the after swiped over the before, or faded over it. */
const IMAGE_COMPARE = {
  SIDE_BY_SIDE: "side-by-side",
  SWIPE: "swipe",
  ONION_SKIN: "onion-skin",
} as const;

type ImageCompare = (typeof IMAGE_COMPARE)[keyof typeof IMAGE_COMPARE];

const COMPARE_OPTIONS = [
  { value: IMAGE_COMPARE.SIDE_BY_SIDE, label: "2-up" },
  { value: IMAGE_COMPARE.SWIPE, label: "Swipe" },
  { value: IMAGE_COMPARE.ONION_SKIN, label: "Onion skin" },
] as const satisfies readonly { readonly value: ImageCompare; readonly label: string }[];

/** What a changed image's place says. */
const IMAGE_WORDS = {
  BEFORE: "Before",
  AFTER: "After",
  ADDED: "Added",
  DELETED: "Deleted",
  READING: "Reading the image…",
  MISSING: "This image could not be shown.",
  NO_BEFORE: "Previous version unavailable",
  COMPARE: "Compare images",
  SWIPE: "Swipe between the two",
  FADE: "Fade the after over the before",
} as const;

/** How far into the before the swipe or the fade starts, in percent. */
const HALFWAY = 50;

/** Where an image's sides are read: the agent whose repository they are in, the repository as `owner/name`, and the commits each side stands at. */
export interface ImageSides {
  readonly agentId: string;
  readonly repository: string;
  readonly headSha: string | undefined;
  readonly baseSha: string | undefined;
}

/** The raw file of the repository at a commit, the address the service reads a repository's picture by. */
function rawAddress(repository: string, sha: string, path: string): string {
  const segments = [...repository.split("/"), sha, ...path.split("/")];
  return `https://raw.githubusercontent.com/${segments.map(encodeURIComponent).join("/")}`;
}

/** Reads a picture of the agent's repository through the service. */
function useImageRead() {
  const { act } = useAct();
  return useCallback(
    (agentId: string, address: string) =>
      act(ACT_KIND.CODING_AGENTS_GITHUB_IMAGE, { agentId, src: address }),
    [act],
  );
}

/** Whether `element` has come near the view, which it stays once it has; an element no document holds never does. */
function useNearView(element: HTMLElement | null): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (element === null || near) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, near]);
  return near;
}

/** One side as it stands: its picture, the words saying it is read, or that it cannot be shown. */
function SidePicture({ state, label }: { state: PictureState; label: string }) {
  if (state.kind === PICTURE_STATE.READY) {
    return <img className="image-diff-picture" src={state.url} alt={label} />;
  }
  const words = state.kind === PICTURE_STATE.READING ? IMAGE_WORDS.READING : IMAGE_WORDS.MISSING;
  return <p className="image-diff-note">{words}</p>;
}

/** One side alone, under the word for what it is, and a note under it where it stands for two. */
function OneSide({
  agentId,
  address,
  label,
  note,
}: {
  agentId: string;
  address: string;
  label: string;
  note?: string | undefined;
}): React.JSX.Element {
  const state = usePicture(agentId, address, useImageRead());
  return (
    <div className="image-diff-sides">
      <figure className="image-diff-side">
        <figcaption>{label}</figcaption>
        <SidePicture state={state} label={label} />
        {note === undefined ? null : <p className="image-diff-note">{note}</p>}
      </figure>
    </div>
  );
}

/** The after over the before, swiped or faded at `amount` percent, with the slider that moves it. */
function Stacked({
  before,
  after,
  compare,
}: {
  before: string;
  after: string;
  compare: typeof IMAGE_COMPARE.SWIPE | typeof IMAGE_COMPARE.ONION_SKIN;
}): React.JSX.Element {
  const [amount, setAmount] = useState(HALFWAY);
  const swipe = compare === IMAGE_COMPARE.SWIPE;
  // Note that the after is cut or faded through the CSSOM (`style`), which the panel's policy admits where it refuses a style written as markup.
  const style = swipe ? { clipPath: `inset(0 0 0 ${amount}%)` } : { opacity: amount / 100 };
  return (
    <div className="image-diff-stacked">
      <div className="image-diff-stack">
        <img className="image-diff-picture" src={before} alt={IMAGE_WORDS.BEFORE} />
        <img className="image-diff-picture" src={after} alt={IMAGE_WORDS.AFTER} style={style} />
      </div>
      <input
        type="range"
        className="image-diff-slider"
        min={0}
        max={100}
        value={amount}
        aria-label={swipe ? IMAGE_WORDS.SWIPE : IMAGE_WORDS.FADE}
        onChange={(event) => setAmount(Number(event.target.value))}
      />
    </div>
  );
}

/** Both sides, as the comparison chosen sets them, once both are read; each side as it stands until then. */
function BothSides({
  agentId,
  before,
  after,
}: {
  agentId: string;
  before: string;
  after: string;
}): React.JSX.Element {
  const read = useImageRead();
  const beforeState = usePicture(agentId, before, read);
  const afterState = usePicture(agentId, after, read);
  const [compare, setCompare] = useState<ImageCompare>(IMAGE_COMPARE.SIDE_BY_SIDE);
  const ready =
    beforeState.kind === PICTURE_STATE.READY && afterState.kind === PICTURE_STATE.READY
      ? { before: beforeState.url, after: afterState.url }
      : undefined;
  return (
    <>
      <div className="image-diff-modes">
        <Segmented
          legend={IMAGE_WORDS.COMPARE}
          options={COMPARE_OPTIONS}
          value={compare}
          disabled={ready === undefined}
          onChange={setCompare}
        />
      </div>
      {ready === undefined || compare === IMAGE_COMPARE.SIDE_BY_SIDE ? (
        <div className="image-diff-sides">
          <figure className="image-diff-side">
            <figcaption>{IMAGE_WORDS.BEFORE}</figcaption>
            <SidePicture state={beforeState} label={IMAGE_WORDS.BEFORE} />
          </figure>
          <figure className="image-diff-side">
            <figcaption>{IMAGE_WORDS.AFTER}</figcaption>
            <SidePicture state={afterState} label={IMAGE_WORDS.AFTER} />
          </figure>
        </div>
      ) : (
        <Stacked before={ready.before} after={ready.after} compare={compare} />
      )}
    </>
  );
}

/** What of a changed image is drawn: both sides, one, or neither, by what became of it and which commits the service named. */
function sidesOf(file: CodingAgentChangedFile, sides: ImageSides) {
  const { repository, headSha, baseSha } = sides;
  const before =
    file.status === CHANGED_FILE_STATUS.ADDED || baseSha === undefined
      ? undefined
      : rawAddress(repository, baseSha, file.previousPath ?? file.path);
  const after =
    file.status === CHANGED_FILE_STATUS.DELETED || headSha === undefined
      ? undefined
      : rawAddress(repository, headSha, file.path);
  return { before, after };
}

/** Whether a changed image can be drawn at all: the commit of a side it has is known. */
export function imageDrawable(file: CodingAgentChangedFile, sides: ImageSides): boolean {
  const { before, after } = sidesOf(file, sides);
  return file.status === CHANGED_FILE_STATUS.DELETED ? before !== undefined : after !== undefined;
}

/** A changed image, read and drawn once it comes near the view: both sides for one changed, the one it has for one added or deleted. */
export function ImageDiff({
  file,
  sides,
}: {
  file: CodingAgentChangedFile;
  sides: ImageSides;
}): React.JSX.Element {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const near = useNearView(box);
  const { before, after } = sidesOf(file, sides);
  const { agentId } = sides;
  const drawn = (() => {
    if (before !== undefined && after !== undefined) {
      return <BothSides agentId={agentId} before={before} after={after} />;
    }
    if (after !== undefined) {
      const added = file.status === CHANGED_FILE_STATUS.ADDED;
      return (
        <OneSide
          agentId={agentId}
          address={after}
          label={added ? IMAGE_WORDS.ADDED : IMAGE_WORDS.AFTER}
          note={added ? undefined : IMAGE_WORDS.NO_BEFORE}
        />
      );
    }
    return before === undefined ? null : (
      <OneSide agentId={agentId} address={before} label={IMAGE_WORDS.DELETED} />
    );
  })();
  return (
    <div ref={setBox} className="image-diff">
      {near ? drawn : <p className="image-diff-note">{IMAGE_WORDS.READING}</p>}
    </div>
  );
}
