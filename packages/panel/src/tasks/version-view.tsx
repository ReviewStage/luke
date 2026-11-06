import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { dayAndTimeText, momentText } from "@repo/features/time-format";
import { readFailedWords } from "@repo/features/words";
import {
  BUTTON_VARIANT,
  Button,
  ErrorState,
  Fill,
  ONE_LINE_ELEMENT,
  ONE_LINE_END,
  OneLine,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  STATUS_TONE,
  Toolbar,
  Tooltip,
} from "@repo/ui";
import { RotateCcwIcon } from "@repo/ui/icons";
import { MARKDOWN_CLASS, markdownClass } from "@repo/ui/markdown-class";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { useRef, useState } from "react";
import type { Kept } from "../act.js";
import type { MenuEntry } from "../desktop/action-menu.js";
import { PhoneHead, PlaceMore, phoneFindGroups } from "../desktop/phone-head.js";
import { unreadShown } from "../failure-report.js";
import { MarkdownMessage } from "../markdown-message.js";
import { TOAST_HOLD, type ToastNotice, undoToast, useToast } from "../toast.js";
import { DocumentScroll } from "./document-frame.js";
import { VERSION_CHANGE, type VersionDiff, versionDiff } from "./description-history-model.js";
import { DescriptionPictures, useDescriptionPictureDrawer } from "./description-pictures.js";
import { type MentionedTask, useMentionLink } from "./task-mentions.js";
import { TextTitle } from "./task-title.js";
import { useOpenLink } from "./use-open-link.js";
import {
  HISTORY_READ,
  type DescriptionHistoryControl,
  type ViewedVersion,
} from "./use-description-history.js";

const VERSION_NOTE = "version-note mt-0 mb-section-gap text-body text-muted-foreground";

const NO_CHANGE_LINE = "This version changed nothing from the one before it.";

const PAGE_SKELETON = [
  { heading: "42%", lines: ["100%", "96%", "88%", "54%"] },
  { heading: "30%", lines: ["100%", "91%", "72%"] },
] as const;

const SECTION_LEVEL = "2";

const BAR_SKELETON = {
  MOMENT: "160px",
  RESTORE: "148px",
} as const;

const VERSION_RESTORED_NOTE = "Version restored";
const RESTORE_UNDO_REFUSED_NOTE = "The restore could not be undone. Try again.";

const CURRENT_HINT = "This version is already current";

const RESTORE_LABEL = "Restore this version";

const VERSION_THING = "Version";

const RESTORING = "Restoring";

const CHANGE_CLASS = {
  [VERSION_CHANGE.SAME]: "",
  [VERSION_CHANGE.ADDED]: " version-added",
  [VERSION_CHANGE.REMOVED]: " version-removed",
  [VERSION_CHANGE.CHANGED]: " version-changed",
} as const;

function VersionText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="description-body">{children}</div>;
}

function NoteUnit({
  heading,
  children,
}: {
  heading: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={markdownClass("description-unit")}>
      <p className={MARKDOWN_CLASS.HEADING} data-level={SECTION_LEVEL}>
        {heading}
      </p>
      {children}
    </div>
  );
}

function VersionBody({
  diff,
  title,
  section,
  task,
}: {
  diff: VersionDiff;
  title: string | undefined;
  section: number | undefined;
  task: MentionedTask | undefined;
}): React.JSX.Element {
  const units = section === undefined ? diff.units : diff.units.slice(section, section + 1);
  const link = useMentionLink(task);
  const openLink = useOpenLink();
  const picture = useDescriptionPictureDrawer();
  return (
    <VersionText>
      {title === undefined || section !== undefined ? null : <TextTitle name={title} />}
      {units.map((unit, at) => (
        <MarkdownMessage
          key={at}
          words={unit.words}
          className={`description-unit${CHANGE_CLASS[unit.change]}`}
          edit={unit.marks.length === 0 ? undefined : { marks: unit.marks }}
          link={link}
          openLink={openLink}
          diagrams
          picture={picture}
        />
      ))}
    </VersionText>
  );
}

function VersionSkeleton({
  title,
  section,
}: {
  title: string | undefined;
  section: number | undefined;
}): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading the version…">
      <VersionText>
        {title === undefined || section !== undefined ? null : <TextTitle name={title} />}
        {PAGE_SKELETON.map((unit) => (
          <NoteUnit key={unit.heading} heading={<Skeleton width={unit.heading} />}>
            {unit.lines.map((width, at) => (
              <Skeleton key={at} width={width} />
            ))}
          </NoteUnit>
        ))}
      </VersionText>
    </SkeletonRegion>
  );
}

export const VERSION_FAILED = readFailedWords("the version");

function VersionContent({
  viewing,
  title,
  section,
  task,
  onRetry,
}: {
  viewing: ViewedVersion;
  title: string | undefined;
  section: number | undefined;
  task: MentionedTask | undefined;
  onRetry: () => void;
}): React.JSX.Element {
  const { read } = viewing;
  if (read.kind === HISTORY_READ.READING)
    return <VersionSkeleton title={title} section={section} />;
  if (read.kind === HISTORY_READ.FAILED) {
    return (
      <div className={VERSION_NOTE}>
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.DESCRIPTION_VERSION_READ)}
          onRetry={onRetry}
        >
          {VERSION_FAILED}
        </ErrorState>
      </div>
    );
  }
  const diff = versionDiff(read.previous, read.document);
  const unchanged = read.previous !== null && !diff.changed;
  return (
    <>
      {unchanged ? <p className={VERSION_NOTE}>{NO_CHANGE_LINE}</p> : null}
      {task === undefined ? (
        <VersionBody diff={diff} title={title} section={section} task={task} />
      ) : (
        <DescriptionPictures
          taskId={task.taskId}
          text={`${read.document.body}\n${read.previous?.body ?? ""}`}
        >
          <VersionBody diff={diff} title={title} section={section} task={task} />
        </DescriptionPictures>
      )}
    </>
  );
}

export interface VersionRestore {
  readonly busy: boolean;
  readonly onRestore: (seq?: number) => void;
}

export function useVersionRestore(
  history: Pick<DescriptionHistoryControl, "onRestore">,
  onRestored: () => void,
): VersionRestore {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const restoring = useRef(false);
  const onRestore = (seq?: number) => {
    if (restoring.current) return;
    restoring.current = true;
    setBusy(true);
    history.onRestore(seq).then((result) => {
      restoring.current = false;
      setBusy(false);
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) onRestored();
      else {
        toast({
          replayUnmasked: true,
          words: result.reason,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.DESCRIPTION_RESTORE, cause: result },
        });
      }
    });
  };
  return { busy, onRestore };
}

export function sayRestored(
  toast: (notice: ToastNotice) => void,
  undo: (() => Promise<Kept>) | undefined,
): void {
  if (undo === undefined) {
    toast({
      replayUnmasked: true,
      words: VERSION_RESTORED_NOTE,
      tone: STATUS_TONE.COMPLETE,
      hold: TOAST_HOLD.DONE,
    });
    return;
  }
  toast({
    replayUnmasked: true,
    ...undoToast(VERSION_RESTORED_NOTE, () => {
      undo().then((undone) => {
        if (undone.kept) return;
        toast({
          replayUnmasked: true,
          words: RESTORE_UNDO_REFUSED_NOTE,
          failure: { surface: FAILURE_SURFACE.DESCRIPTION_RESTORE, cause: undone.cause },
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
        });
      });
    }),
  });
}

function VersionPageFrame({
  lead,
  title,
  actions,
  phoneGroups,
  children,
}: {
  lead?: React.ReactNode;
  title: React.ReactNode;
  actions: React.ReactNode;
  phoneGroups?: (() => readonly (readonly MenuEntry[])[]) | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const titled = (
    <OneLine as={ONE_LINE_ELEMENT.H1} end={ONE_LINE_END.ELLIPSIS} className="ui-toolbar-title">
      {title}
    </OneLine>
  );
  return (
    <>
      {lead === undefined ? (
        <Toolbar title={titled} actions={actions} />
      ) : (
        <PhoneHead
          place="version"
          start={lead}
          title={titled}
          end={
            phoneGroups === undefined ? (
              actions
            ) : (
              <PlaceMore thing={VERSION_THING} shown groups={phoneGroups} />
            )
          }
        />
      )}
      <Fill className="desktop-document @container/description-document">
        <DocumentScroll>{children}</DocumentScroll>
      </Fill>
    </>
  );
}

export function VersionView({
  viewing,
  restore,
  title,
  section,
  task,
  lead,
  onRetry,
}: {
  viewing: ViewedVersion;
  restore: VersionRestore;
  title?: string | undefined;
  section?: number | undefined;
  task?: MentionedTask | undefined;
  lead?: React.ReactNode;
  onRetry: () => void;
}): React.JSX.Element {
  const { line } = viewing;
  return (
    <VersionPageFrame
      lead={lead}
      title={
        <Tooltip label={momentText(line.lastEdit.at)}>
          <time dateTime={new Date(line.lastEdit.at).toISOString()}>
            {dayAndTimeText(line.lastEdit.at)}
          </time>
        </Tooltip>
      }
      actions={
        <Tooltip label={viewing.current ? CURRENT_HINT : undefined}>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={viewing.current}
            focusableWhenDisabled
            busy={restore.busy}
            busyLabel={RESTORING}
            onClick={() => restore.onRestore()}
          >
            {RESTORE_LABEL}
          </Button>
        </Tooltip>
      }
      phoneGroups={() => [
        [
          {
            label: RESTORE_LABEL,
            icon: <RotateCcwIcon />,
            disabled: viewing.current || restore.busy,
            detail: viewing.current ? CURRENT_HINT : undefined,
            onSelect: () => restore.onRestore(),
          },
        ],
        ...phoneFindGroups(),
      ]}
    >
      <VersionContent
        viewing={viewing}
        title={title}
        section={section}
        task={task}
        onRetry={onRetry}
      />
    </VersionPageFrame>
  );
}

export function VersionPageSkeleton({
  lead,
  title,
  section,
}: {
  lead?: React.ReactNode;
  title: string | undefined;
  section: number | undefined;
}): React.JSX.Element {
  return (
    <VersionPageFrame
      lead={lead}
      title={<Skeleton width={BAR_SKELETON.MOMENT} />}
      actions={<Skeleton shape={SKELETON_SHAPE.CONTROL} width={BAR_SKELETON.RESTORE} />}
    >
      <VersionSkeleton title={title} section={section} />
    </VersionPageFrame>
  );
}
