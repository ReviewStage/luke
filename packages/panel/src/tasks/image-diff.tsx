import { type AgentChangedFile, CHANGED_FILE_STATUS } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  CHOICE_BAR_LOOK,
  ChoiceBar,
  NOTE_LINE_LOOK,
  NoteLine,
  PictureStandIn,
  Slider,
} from "@repo/ui";
import { PICTURE_STATE, type PictureState, usePicture } from "@repo/ui/picture-read";
import { useCallback, useEffect, useId, useState } from "react";
import { askAct } from "../act.js";
import { pictureUnread } from "../failure-report.js";
import { pictureQuery } from "../picture-query.js";

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

const IMAGE_WORDS = {
  BEFORE: "Before",
  AFTER: "After",
  ADDED: "Added",
  DELETED: "Deleted",
  NO_BEFORE: "Previous version unavailable",
  COMPARE: "Compare images",
  SWIPE: "Swipe between the two",
  FADE: "Fade the after over the before",
} as const;

const HALFWAY = 50;

export interface ImageSides {
  readonly agentId: string;
  readonly repository: string;
  readonly headSha: string | undefined;
  readonly baseSha: string | undefined;
  readonly read: number;
}

function rawAddress(repository: string, sha: string, path: string): string {
  const segments = [...repository.split("/"), sha, ...path.split("/")];
  return `https://raw.githubusercontent.com/${segments.map(encodeURIComponent).join("/")}`;
}

function useImageRead() {
  return useCallback(
    (agentId: string, address: string) =>
      askAct(ACT_KIND.AGENTS_GITHUB_IMAGE, { agentId, src: address }),
    [],
  );
}

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

function SidePicture({ state, label }: { state: PictureState; label: string }) {
  if (state.kind === PICTURE_STATE.READY) {
    return <img className="image-diff-picture" src={state.url} alt={label} />;
  }
  if (state.kind === PICTURE_STATE.FAILED) {
    return (
      <PictureStandIn failure={state.failure} state={state.kind} words="" onRetry={state.retry} />
    );
  }
  return <PictureStandIn state={state.kind} words="" />;
}

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
  const state = usePicture(pictureQuery(agentId, address, useImageRead()), pictureUnread);
  return (
    <div className="flex w-full flex-wrap justify-center gap-block-gap">
      <figure className="m-0 flex min-w-0 shrink grow basis-image-diff-side flex-col items-center gap-item-gap [&>figcaption]:text-caption-inline [&>figcaption]:text-muted-foreground">
        <figcaption>{label}</figcaption>
        <SidePicture state={state} label={label} />
        {note === undefined ? null : <NoteLine look={NOTE_LINE_LOOK.INSET}>{note}</NoteLine>}
      </figure>
    </div>
  );
}

interface Comparison {
  readonly compare: ImageCompare;
  readonly amount: number;
}

const FIRST_COMPARISON: Comparison = { compare: IMAGE_COMPARE.SIDE_BY_SIDE, amount: HALFWAY };

function Stacked({
  before,
  after,
  compare,
  amount,
  onAmount,
}: {
  before: string;
  after: string;
  compare: typeof IMAGE_COMPARE.SWIPE | typeof IMAGE_COMPARE.ONION_SKIN;
  amount: number;
  onAmount: (amount: number) => void;
}): React.JSX.Element {
  const swipe = compare === IMAGE_COMPARE.SWIPE;
  const style = swipe ? { clipPath: `inset(0 0 0 ${amount}%)` } : { opacity: amount / 100 };
  return (
    <div className="flex max-w-full flex-col items-center gap-control-gap">
      <div className="image-diff-stack">
        <img className="image-diff-picture" src={before} alt={IMAGE_WORDS.BEFORE} />
        <img className="image-diff-picture" src={after} alt={IMAGE_WORDS.AFTER} style={style} />
      </div>
      <Slider
        value={amount}
        onChange={onAmount}
        label={swipe ? IMAGE_WORDS.SWIPE : IMAGE_WORDS.FADE}
      />
    </div>
  );
}

function BothSides({
  agentId,
  before,
  after,
  comparison,
  onComparison,
}: {
  agentId: string;
  before: string;
  after: string;
  comparison: Comparison;
  onComparison: (comparison: Comparison) => void;
}): React.JSX.Element {
  const read = useImageRead();
  const beforeState = usePicture(pictureQuery(agentId, before, read), pictureUnread);
  const afterState = usePicture(pictureQuery(agentId, after, read), pictureUnread);
  const { compare, amount } = comparison;
  const ready =
    beforeState.kind === PICTURE_STATE.READY && afterState.kind === PICTURE_STATE.READY
      ? { before: beforeState.url, after: afterState.url }
      : undefined;
  const panelId = useId();
  const tabIds = {
    [IMAGE_COMPARE.SIDE_BY_SIDE]: useId(),
    [IMAGE_COMPARE.SWIPE]: useId(),
    [IMAGE_COMPARE.ONION_SKIN]: useId(),
  } satisfies Record<ImageCompare, string>;
  return (
    <>
      <div className="flex justify-center">
        <ChoiceBar<ImageCompare>
          label={IMAGE_WORDS.COMPARE}
          items={COMPARE_OPTIONS}
          value={compare}
          disabled={ready === undefined}
          onChange={(next) => onComparison({ compare: next, amount })}
          look={CHOICE_BAR_LOOK.SEGMENTED}
          panels={(each) => ({ tab: tabIds[each], panel: panelId })}
        />
      </div>
      <div
        className="flex w-full min-w-0 flex-col items-center"
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabIds[compare]}
      >
        {ready === undefined || compare === IMAGE_COMPARE.SIDE_BY_SIDE ? (
          <div className="flex w-full flex-wrap justify-center gap-block-gap">
            <figure className="m-0 flex min-w-0 shrink grow basis-image-diff-side flex-col items-center gap-item-gap [&>figcaption]:text-caption-inline [&>figcaption]:text-muted-foreground">
              <figcaption>{IMAGE_WORDS.BEFORE}</figcaption>
              <SidePicture state={beforeState} label={IMAGE_WORDS.BEFORE} />
            </figure>
            <figure className="m-0 flex min-w-0 shrink grow basis-image-diff-side flex-col items-center gap-item-gap [&>figcaption]:text-caption-inline [&>figcaption]:text-muted-foreground">
              <figcaption>{IMAGE_WORDS.AFTER}</figcaption>
              <SidePicture state={afterState} label={IMAGE_WORDS.AFTER} />
            </figure>
          </div>
        ) : (
          <Stacked
            before={ready.before}
            after={ready.after}
            compare={compare}
            amount={amount}
            onAmount={(next) => onComparison({ compare, amount: next })}
          />
        )}
      </div>
    </>
  );
}

function sidesOf(file: AgentChangedFile, sides: ImageSides) {
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

export function imageDrawable(file: AgentChangedFile, sides: ImageSides): boolean {
  const { before, after } = sidesOf(file, sides);
  return file.status === CHANGED_FILE_STATUS.DELETED ? before !== undefined : after !== undefined;
}

function ImageSidesNear({
  file,
  sides,
  comparison,
  onComparison,
}: {
  file: AgentChangedFile;
  sides: ImageSides;
  comparison: Comparison;
  onComparison: (comparison: Comparison) => void;
}): React.JSX.Element {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const near = useNearView(box);
  const { before, after } = sidesOf(file, sides);
  const { agentId } = sides;
  const drawn = (() => {
    if (before !== undefined && after !== undefined) {
      return (
        <BothSides
          agentId={agentId}
          before={before}
          after={after}
          comparison={comparison}
          onComparison={onComparison}
        />
      );
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
    <div
      ref={setBox}
      className="image-diff flex flex-col items-center gap-control-gap p-card-snug font-sans"
    >
      {near ? drawn : <PictureStandIn state={PICTURE_STATE.READING} words="" />}
    </div>
  );
}

export function ImageDiff({
  file,
  sides,
}: {
  file: AgentChangedFile;
  sides: ImageSides;
}): React.JSX.Element {
  const [comparison, setComparison] = useState(FIRST_COMPARISON);
  return (
    <ImageSidesNear
      key={sides.read}
      file={file}
      sides={sides}
      comparison={comparison}
      onComparison={setComparison}
    />
  );
}
