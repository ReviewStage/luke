import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  Button,
  cssCustomProperties,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  Fill,
  MENU_SURFACE_FLOW,
  MenuSurface,
  ScrollArea,
  type ScrollOverscroll,
  SpinnerRegion,
  TooltipPill,
  useHintRest,
  usePressAway,
} from "@repo/ui";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { Cause } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { MessageSquarePlusIcon } from "lucide-react";
import {
  createContext,
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { DIFF_LOAD_FAILED, useSideBundles } from "../bundle-loader.js";
import {
  type DiffAnnotation,
  type DiffFileTexts,
  type DiffLineRange,
  type DiffListFile,
  type DiffListHandle,
  type DiffListProps,
  type DiffListSelection,
  type DiffLook,
  type DiffSelection,
  type DiffTextSelection,
  GAP_CONTROL_ATTRIBUTE,
  sameLines,
  sameListSelection,
  sameLook,
  sameNotes,
} from "../diff-view/contract.js";
import { failureShown } from "../failure-report.js";
import { CHANGES_WORDS } from "./changes-model.js";

export interface DiffNote extends DiffAnnotation {
  readonly content: ReactNode;
}

export interface DiffListEntry {
  readonly path: string;
  readonly patch: string;
  readonly collapsed: boolean;
  readonly lead: boolean;
  readonly expandable: boolean;
  readonly whole?: DiffFileTexts | undefined;
  readonly hidden?: readonly number[] | undefined;
  readonly header: ReactNode;
  readonly notes: readonly DiffNote[];
}

export interface DiffListDoor {
  readonly reveal: (path: string) => void;
}

export interface DiffListReveal {
  readonly ask: number;
  readonly path: string;
  readonly at?: { readonly side: DiffSelection["side"]; readonly line: number } | undefined;
}

export interface DiffListFlash {
  readonly ask: number;
  readonly range: DiffLineRange;
}

interface GapHint {
  readonly anchor: HTMLElement;
  readonly label: string;
}

export const DiffListTopRoomContext = createContext(0);

function gapHintOf(path: readonly EventTarget[]): GapHint | undefined {
  const anchor = path.find(
    (target): target is HTMLElement =>
      target instanceof HTMLElement && target.hasAttribute(GAP_CONTROL_ATTRIBUTE),
  );
  const label = anchor?.getAttribute("aria-label");
  return anchor === undefined || label == null ? undefined : { anchor, label };
}

const OFFER_WORDS = {
  COMMENT: "Comment",
  on: (lines: string) => `Comment on ${lines}`,
} as const;

const OFFER_INSET = 64;

const OFFER_ROOM = 40;

interface TextOffer {
  readonly picked: DiffListSelection;
  readonly lines: string;
  readonly x: number;
  readonly y: number;
  readonly below: boolean;
}

function offerAt(selected: DiffTextSelection, lines: string, box: DOMRect): TextOffer {
  const { rect } = selected;
  const middle = (rect.left + rect.right) / 2 - box.left;
  const x = Math.min(Math.max(middle, OFFER_INSET), Math.max(OFFER_INSET, box.width - OFFER_INSET));
  const below = rect.top - box.top < OFFER_ROOM;
  return {
    picked: selected.picked,
    lines,
    x,
    y: (below ? rect.bottom : rect.top) - box.top,
    below,
  };
}

function placeOf({ key, side, line }: DiffAnnotation): DiffAnnotation {
  return { key, side, line };
}

const LIST_FILES = new WeakMap<DiffListEntry, DiffListFile>();

function listFileOf(entry: DiffListEntry): DiffListFile {
  const kept = LIST_FILES.get(entry);
  if (kept !== undefined) return kept;
  const file = {
    path: entry.path,
    patch: entry.patch,
    collapsed: entry.collapsed,
    lead: entry.lead,
    expandable: entry.expandable,
    whole: entry.whole,
    hidden: entry.hidden,
    annotations: entry.notes.map(placeOf),
  };
  LIST_FILES.set(entry, file);
  return file;
}

function sameFiles(a: readonly DiffListFile[], b: readonly DiffListFile[]): boolean {
  return (
    a.length === b.length &&
    a.every((file, at) => {
      const other = b[at];
      return (
        file === other ||
        (other !== undefined &&
          file.path === other.path &&
          file.patch === other.patch &&
          file.collapsed === other.collapsed &&
          file.lead === other.lead &&
          file.expandable === other.expandable &&
          file.whole === other.whole &&
          sameLines(file.hidden ?? NO_LINES, other.hidden ?? NO_LINES) &&
          sameNotes(file.annotations, other.annotations))
      );
    })
  );
}

const NO_LINES: readonly number[] = [];

const HEAD_SLOT = "diff-list-head-slot";

function keptElement(held: Map<string, HTMLDivElement>, key: string, className: string) {
  const kept = held.get(key);
  if (kept !== undefined) return kept;
  const element = document.createElement("div");
  element.className = className;
  held.set(key, element);
  return element;
}

export function PierreDiffList({
  entries,
  look,
  door,
  onTopFile,
  boxRef,
  onComment,
  commentOn,
  selected,
  readTexts,
  reveal,
  onDrawn,
  flash,
  overscroll,
}: {
  entries: readonly DiffListEntry[];
  look: DiffLook;
  door: RefObject<DiffListDoor | null>;
  onTopFile: (path: string) => void;
  boxRef: (element: HTMLDivElement | null) => void;
  onComment?: ((picked: DiffListSelection) => void) | undefined;
  commentOn?: ((picked: DiffListSelection) => string | undefined) | undefined;
  selected?: DiffListSelection | undefined;
  readTexts?: ((path: string) => Promise<DiffFileTexts | undefined>) | undefined;
  reveal?: DiffListReveal | undefined;
  onDrawn?: ((path: string, lines: readonly number[]) => void) | undefined;
  flash?: DiffListFlash | undefined;
  overscroll?: ScrollOverscroll | undefined;
}): React.JSX.Element {
  const { diffView } = useSideBundles();
  const loaded = useAtomValue(diffView);
  const retry = useAtomRefresh(diffView);
  const [hint, setHint] = useState<GapHint | undefined>(undefined);
  const hintId = useId();
  const [hintDrawn, setHintDrawn] = useState<GapHint | undefined>(hint);
  if (hint !== undefined && hint !== hintDrawn) setHintDrawn(hint);
  const pill = useDisclosure(hint !== undefined);
  const { rest, stop } = useHintRest();
  const aimed = useRef<HTMLElement | undefined>(undefined);
  const hang = useCallback(
    (event: Event) => {
      const next = gapHintOf(event.composedPath());
      if (next?.anchor === aimed.current) return;
      aimed.current = next?.anchor;
      setHint(undefined);
      if (next === undefined) stop();
      else rest(() => setHint(next));
    },
    [rest, stop],
  );
  const letGoHint = useCallback(() => {
    aimed.current = undefined;
    stop();
    setHint(undefined);
  }, [stop]);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const holdBox = useCallback(
    (element: HTMLDivElement | null) => {
      box.current = element;
      boxRef(element);
    },
    [boxRef],
  );
  const [offer, setOffer] = useState<TextOffer | undefined>(undefined);
  const offerBox = useRef<HTMLDivElement>(null);
  const commentable = useRef(commentOn);
  commentable.current = commentOn;
  const tellText = useCallback((selected: DiffTextSelection | undefined) => {
    const lines = selected === undefined ? undefined : commentable.current?.(selected.picked);
    const area = box.current?.getBoundingClientRect();
    setOffer(
      selected === undefined || lines === undefined || area === undefined
        ? undefined
        : offerAt(selected, lines, area),
    );
  }, []);
  const handle = useRef<DiffListHandle | undefined>(undefined);
  const headers = useRef(new Map<string, HTMLDivElement>());
  const notes = useRef(new Map<string, Map<string, HTMLDivElement>>());
  const renderHeader = useCallback(
    (path: string) => keptElement(headers.current, path, HEAD_SLOT),
    [],
  );
  const renderAnnotation = useCallback((path: string, key: string) => {
    const file = notes.current.get(path) ?? new Map<string, HTMLDivElement>();
    notes.current.set(path, file);
    return keptElement(file, key, "diff-note");
  }, []);
  const topFile = useRef(onTopFile);
  topFile.current = onTopFile;
  const tellTop = useCallback((path: string) => topFile.current(path), []);
  const comment = useRef(onComment);
  comment.current = onComment;
  const tellComment = useCallback((picked: DiffListSelection) => comment.current?.(picked), []);
  const texts = useRef(readTexts);
  texts.current = readTexts;
  const askTexts = useCallback(
    (path: string) => texts.current?.(path) ?? Promise.resolve(undefined),
    [],
  );
  const files = entries.map(listFileOf);
  const topRoom = useContext(DiffListTopRoomContext);
  const props: DiffListProps = {
    files,
    look,
    renderHeader,
    renderAnnotation,
    onTopFile: tellTop,
    onComment: onComment === undefined ? undefined : tellComment,
    onSelectText: onComment === undefined ? undefined : tellText,
    selected,
    readTexts: readTexts === undefined ? undefined : askTexts,
    onDrawn,
    topRoom,
  };
  const drawn = useRef(props);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    drawn.current = latest.current;
    const mounted = module.mountList(element, latest.current);
    handle.current = mounted;
    door.current = { reveal: (path) => mounted.reveal(path) };
    return () => {
      door.current = null;
      handle.current = undefined;
      mounted.unmount();
    };
  }, [module, door]);

  const [filesDrawn, setFilesDrawn] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (module === undefined || element === null) return undefined;
    const look = (watch: MutationObserver) => {
      if (element.querySelector(`.${HEAD_SLOT}`) === null) return;
      watch.disconnect();
      setFilesDrawn(true);
    };
    const watch = new MutationObserver((_changes, self) => look(self));
    watch.observe(element, { childList: true, subtree: true });
    look(watch);
    return () => watch.disconnect();
  }, [module]);

  useEffect(() => {
    if (handle.current === undefined) return;
    const was = drawn.current;
    if (
      sameFiles(was.files, files) &&
      sameLook(was.look, look) &&
      sameListSelection(was.selected, selected) &&
      (was.onComment === undefined) === (onComment === undefined) &&
      (was.readTexts === undefined) === (readTexts === undefined) &&
      was.topRoom === topRoom
    )
      return;
    drawn.current = latest.current;
    handle.current.update(latest.current);
  });

  const revealed = useRef<number | undefined>(undefined);
  useEffect(() => {
    const mounted = handle.current;
    if (mounted === undefined || reveal === undefined || revealed.current === reveal.ask) return;
    const file = drawn.current.files.find((each) => each.path === reveal.path);
    if (file === undefined || file.collapsed) return;
    revealed.current = reveal.ask;
    if (reveal.at === undefined) mounted.reveal(reveal.path);
    else mounted.revealLine(reveal.path, reveal.at.side, reveal.at.line);
  });

  useEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    element.addEventListener("focusin", hang);
    element.addEventListener("focusout", letGoHint);
    element.addEventListener("keydown", letGoHint);
    return () => {
      element.removeEventListener("focusin", hang);
      element.removeEventListener("focusout", letGoHint);
      element.removeEventListener("keydown", letGoHint);
    };
  }, [hang, letGoHint]);

  const flashed = useRef<number | undefined>(undefined);
  useEffect(() => {
    const mounted = handle.current;
    if (mounted === undefined || flash === undefined || flashed.current === flash.ask) return;
    const file = drawn.current.files.find((each) => each.path === flash.range.path);
    if (file === undefined || file.collapsed) return;
    flashed.current = flash.ask;
    if (file.lead) mounted.reveal(flash.range.path);
    else mounted.revealLines(flash.range);
  });

  usePressAway(offerBox, () => undefined, {
    onPressAway: offer === undefined ? undefined : () => setOffer(undefined),
  });

  if (AsyncResult.isFailure(loaded)) {
    return (
      <ErrorState
        failure={failureShown({
          surface: FAILURE_SURFACE.DIFF_READ,
          cause: Cause.squash(loaded.cause),
        })}
        placement={ERROR_STATE_PLACEMENT.CENTERED}
        onRetry={retry}
      >
        {DIFF_LOAD_FAILED}
      </ErrorState>
    );
  }
  return (
    <Fill
      ref={holdBox}
      className="diff-view diff-list relative bg-ground select-text"
      data-diff-layout={look.layout}
      aria-busy={filesDrawn ? undefined : true}
      onPointerOver={(event) => hang(event.nativeEvent)}
      onPointerLeave={letGoHint}
      onPointerDown={letGoHint}
    >
      {module === undefined ? (
        <SpinnerRegion delay label={CHANGES_WORDS.READING} />
      ) : (
        <ScrollArea ref={host} overscroll={overscroll} data-diff-list-scroller="">
          {null}
        </ScrollArea>
      )}
      {offer === undefined || onComment === undefined ? null : (
        <MenuSurface
          ref={offerBox}
          flow={MENU_SURFACE_FLOW.TOOLBAR}
          className="diff-list-offer"
          data-below={offer.below || undefined}
          style={cssCustomProperties({
            "--diff-offer-x": `${offer.x}px`,
            "--diff-offer-y": `${offer.y}px`,
          })}
        >
          <Button
            icon={<MessageSquarePlusIcon aria-hidden="true" />}
            label={OFFER_WORDS.on(offer.lines)}
            keepFocus
            onClick={() => {
              setOffer(undefined);
              document.getSelection()?.removeAllRanges();
              onComment(offer.picked);
            }}
          >
            {OFFER_WORDS.COMMENT}
          </Button>
        </MenuSurface>
      )}
      {!pill.mounted || hintDrawn === undefined ? null : (
        <TooltipPill
          id={hintId}
          anchor={hintDrawn.anchor}
          label={hintDrawn.label}
          leaving={pill.leaving}
          ref={pill.ref}
        />
      )}
      {entries.map((entry) => (
        <Fragment key={entry.path}>
          {createPortal(entry.header, renderHeader(entry.path))}
          {entry.notes.map((note) =>
            createPortal(note.content, renderAnnotation(entry.path, note.key), note.key),
          )}
        </Fragment>
      ))}
    </Fill>
  );
}
