import type { PlanTemplateAnswerView } from "@luke/features/coding-agent-view";
import {
  PLAN_TEMPLATE_BOUNDS,
  type PlanTemplateAnswer,
} from "@luke/features/plan-document-template";
import { PLAN_EDIT_REFUSAL } from "@luke/features/plan-edit";
import { PLAN_ACTOR, type PlanLastEdit, type Task } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE, type TasksEditAnswer } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  ConfirmDialog,
  type DialogQuestion,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  Fill,
  GAP,
  IconButton,
  ResetIcon,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useConfirmDialog,
} from "@luke/ui";
import type { PersonActor } from "@luke/ui/actor-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { HistoryIcon, InfoIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ActHandle, useAct } from "../act.js";
import { PhoneBack, type PhoneBackDoor, PhoneHead, PlaceMore } from "../desktop/phone-head.js";
import { DocumentScroll } from "../tasks/document-frame.js";
import type { TaskReader } from "../tasks/edit-ref.js";
import { PlanBody, PlanBodyColumn, PlanPageHead } from "../tasks/plan-body.js";
import type { PlanEditDoor } from "../tasks/use-plan-editing.js";
import { TOAST_TONE, useToast } from "../toast.js";

/**
 * plan-template-page.tsx -- Settings › Plan template: the Markdown every new plan starts as a copy of, drawn and edited as a plan is.
 *
 * The template is a plan's text before it is a plan, so the page is a plan's
 * page beside Settings' page list, with no top bar: the document is the
 * plan's own (`../tasks/plan-body.tsx`), at the Settings pages' width and
 * in a plan's type, read as sections until a click or Return opens the same
 * editor on the same words with the same keyboard. Its title is the page's
 * name, at a page title's place and size, which is
 * no name of the account's to change, so it is drawn and never edited, and
 * the page's actions stand at the end of its line: the version history
 * (`plan-template-history.tsx`), which the "Edited by" line under the
 * title opens too, and Reset to default while the account holds a
 * template of its own. The reset asks first, since it replaces every word of
 * the account's, kept since only in the template's history, and waits for a
 * save already out so the default lands last. A quiet note under the
 * title, drawn as an archived task's banner is, says what the template is
 * for.
 *
 * The template is the account's, kept on the service, so the page reads it
 * afresh as it opens and every Mac the account signs in on edits the same
 * one. The document saves the words as the developer pauses and as they
 * leave the editor (`../tasks/use-plan-editing.ts`), here as a write of
 * the whole template, which is the developer's alone and so never meets
 * words of Luke's to merge. A save that failed says so under the editor
 * with a Retry, or, once the page has gone, in a toast whose Retry sends the
 * same words; a template past its bound is refused before it is sent. With
 * no account signed in there is no template to show, and the page says so.
 * The document stands under `ph-no-capture`, so the session recording keeps
 * neither the words nor the rhythm of the typing.
 *
 * On a phone the page is headed as a phone heads every page
 * (`../desktop/phone-head.tsx`): the way back to the page list, the page's
 * name, and a ⋯ holding the page's actions, which leave the title's line.
 */

/** The page's name, which the template is drawn under as a task's title, and its versions too. */
export const TEMPLATE_TITLE = "Plan template";

/** What the page says. */
const PAGE_LINE = {
  NOTE: "New plans start as a copy of this template.",
  NOTE_DETAIL: "Editing it doesn't change existing plans.",
  SIGNED_OUT: "Sign in to edit the template your new plans start from.",
  READ_FAILED: "The template could not be read.",
  READING: "Loading your plan template",
  LEFT_UNSAVED: "Your plan template could not be saved.",
  RESET_FAILED: "The template could not be reset. Try again.",
} as const;

/** The id the template is drawn under as a plan's document, which names no task of the account's. */
export const TEMPLATE_DOCUMENT_ID = "plan-template";

/** The workspace the template's document names: none, since the template is the account's own and stands in no workspace. */
const TEMPLATE_WORKSPACE_ID = "plan-template";

/** What the title line's button that opens the template's version history says, as a task's menu item says it. */
const HISTORY_LABEL = "Version history";

/** What the page's reset says. */
const RESET_LABEL = "Reset to default";

/** How wide the placeholder's headings and the lines under each stand, as shares of their lines, a plan's sections in the body's type. */
const TEMPLATE_SKELETON = [
  { heading: "28%", lines: ["100%", "94%", "62%"] },
  { heading: "36%", lines: ["100%", "88%", "96%", "48%"] },
  { heading: "22%", lines: ["100%", "70%"] },
] as const;

/** Where the page stands with the service's template. */
const TEMPLATE_READ = {
  READING: "reading",
  FAILED: "failed",
  READ: "read",
} as const;

type TemplateRead = (typeof TEMPLATE_READ)[keyof typeof TEMPLATE_READ];

const RESET_QUESTION: DialogQuestion = {
  title: "Reset plan template?",
  body: "Your current template stays in its version history.",
  verb: "Reset",
  running: "Resetting",
};

/** One write of the template, read as the template kept or nothing at all. */
function written(
  act: ActHandle["act"],
  template: string | null,
): Promise<PlanTemplateAnswer | undefined> {
  return act(ACT_KIND.PLAN_TEMPLATE_WRITE, { template })
    .catch((): PlanTemplateAnswerView | undefined => undefined)
    .then((answer) => (answer === undefined || "failure" in answer ? undefined : answer));
}

/**
 * The template as the plan's document draws it: the page's name as its
 * title, the template as its text, and its newest revision as its last
 * edit, which the "Edited by" line over it says, and which the developer's
 * own edit here moves on, so the document takes their words in at once as
 * it takes a plan's, rather than typing them in again.
 */
function templateDocument(text: string, lastEdit: PlanLastEdit | undefined): Task {
  return {
    id: TEMPLATE_DOCUMENT_ID,
    workspaceId: TEMPLATE_WORKSPACE_ID,
    name: TEMPLATE_TITLE,
    createdAt: 0,
    updatedAt: 0,
    repository: null,
    document: { body: text, assumptions: [] },
    ...(lastEdit === undefined ? undefined : { lastEdit }),
  };
}

/** The developer's edit of the template here, now, as the document's last. */
function editedNow(): PlanLastEdit {
  return { actor: PLAN_ACTOR.DEVELOPER, at: Date.now(), duringCall: false };
}

/** The template as the page holds it, and its doors. */
interface TemplateControl {
  read: TemplateRead;
  retry: () => void;
  text: string;
  custom: boolean;
  /** Its newest revision, or the developer's edit here since; none for a template never edited. */
  lastEdit: PlanLastEdit | undefined;
  edit: PlanEditDoor;
  reset: () => Promise<ActionResult>;
}

/**
 * What the page's writes read and change as they land, which no render
 * stands between: the template as the service last kept it, which every
 * edit the document sends was written from; the write out; whether a reset
 * is under way; words whose save failed while the page stood, until another
 * save is sent; and whether the page still stands.
 */
interface HeldWrites {
  kept: string;
  flight: Promise<unknown> | undefined;
  resetting: boolean;
  failed: string | undefined;
  standing: boolean;
}

/**
 * The service's template, read as the page opens and again on Retry, and
 * written through the document's edit door. Note that an edit written from
 * a template the service no longer keeps is dropped, because it was queued
 * behind a reset the developer confirmed, and landing after the reset it
 * would undo it. Words whose save failed are sent once more as the
 * page goes, because the editor holds a failed save back from its own
 * leaving; and a save that fails once the page has gone is said in a toast
 * whose Retry sends the same words, because the page and its Retry are gone
 * with them.
 */
function useTemplate(signedIn: boolean, act: ActHandle["act"]): TemplateControl {
  const [read, setRead] = useState<TemplateRead>(TEMPLATE_READ.READING);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");
  const [custom, setCustom] = useState(false);
  const [lastEdit, setLastEdit] = useState<PlanLastEdit | undefined>(undefined);
  const held = useRef<HeldWrites>({
    kept: "",
    flight: undefined,
    resetting: false,
    failed: undefined,
    standing: true,
  });
  const toast = useToast();

  const take = useCallback((answer: PlanTemplateAnswer, edited: PlanLastEdit | undefined) => {
    held.current.kept = answer.template;
    setText(answer.template);
    setCustom(answer.custom);
    // Note that a read names no edit, because the history read beside it may already have named one.
    if (edited !== undefined) setLastEdit(edited);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    // Each read names the newest edit afresh: the page is not drawn while it is out, and an earlier attempt's may be stale.
    setRead(TEMPLATE_READ.READING);
    setLastEdit(undefined);
    act(ACT_KIND.PLAN_TEMPLATE_READ)
      .catch((): PlanTemplateAnswerView | undefined => undefined)
      .then((answer) => {
        if (!live) return;
        const failed = answer === undefined || "failure" in answer;
        if (!failed) take(answer, undefined);
        setRead(failed ? TEMPLATE_READ.FAILED : TEMPLATE_READ.READ);
      });
    // The newest revision names the "Edited by" line, read beside the template and never waited on, unless an edit here has named it since.
    act(ACT_KIND.PLAN_TEMPLATE_REVISIONS, {})
      .then((page) => ("failure" in page ? undefined : page.revisions[0]?.lastEdit))
      .catch((): PlanLastEdit | undefined => undefined)
      .then((edited) => {
        if (live && edited !== undefined) setLastEdit((held) => held ?? edited);
      });
    return () => {
      live = false;
    };
  }, [act, signedIn, attempt, take]);

  const save = (words: string): Promise<TasksEditAnswer> => {
    const writes = held.current;
    writes.failed = undefined;
    if (words.length > PLAN_TEMPLATE_BOUNDS.MAX_CHARS) {
      return Promise.resolve({ failure: PLAN_EDIT_REFUSAL.TOO_LONG });
    }
    const sent = written(act, words).then((answer): TasksEditAnswer => {
      if (answer !== undefined) {
        if (writes.standing) take(answer, editedNow());
        return { saved: true };
      }
      if (writes.standing) {
        writes.failed = words;
      } else {
        toast({
          words: PAGE_LINE.LEFT_UNSAVED,
          tone: TOAST_TONE.FAILED,
          persists: true,
          action: { label: "Retry", onPress: () => save(words) },
        });
      }
      return { failure: TASK_CALL_FAILURE.UNANSWERED };
    });
    writes.flight = sent;
    return sent;
  };

  // The page going sends words whose save failed a turn later, once the document's own leaving has sent anything newer.
  useEffect(() => {
    const writes = held.current;
    writes.standing = true;
    return () => {
      writes.standing = false;
      Promise.resolve().then(() => {
        if (writes.failed !== undefined) save(writes.failed);
      });
    };
  }, []);

  return {
    read,
    retry: () => setAttempt((count) => count + 1),
    text,
    custom,
    lastEdit,
    edit: (request) => {
      const writes = held.current;
      if (writes.resetting || request.document.base !== writes.kept) {
        return Promise.resolve({ saved: true });
      }
      return save(request.document.value);
    },
    reset: async (): Promise<ActionResult> => {
      // The write already out lands before the null is sent, so the default is what the service keeps.
      const writes = held.current;
      writes.resetting = true;
      writes.failed = undefined;
      await writes.flight;
      const answer = await written(act, null);
      writes.resetting = false;
      if (answer === undefined) {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: PAGE_LINE.RESET_FAILED };
      }
      take(answer, editedNow());
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    },
  };
}

/**
 * The note under the template's title, drawn as an archived task's banner
 * is: what the template is for. It is what a settings search for the
 * template lands on.
 */
function TemplateNote(): React.JSX.Element {
  return (
    <div className="template-note" {...searchAnchorProps(SETTINGS_SEARCH_ROW.PLAN_TEMPLATE)}>
      <Banner look={BANNER_LOOK.CARD} glyph={<InfoIcon />}>
        <Text variant={TEXT_VARIANT.SECTION}>{PAGE_LINE.NOTE}</Text>
        <Text tone={TEXT_TONE.MUTED}>{PAGE_LINE.NOTE_DETAIL}</Text>
      </Banner>
    </div>
  );
}

/** Where the page's actions stand, at the end of its title line. */
function TitleActionsLine({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="task-title-actions">{children}</span>;
}

/** The template's document as the page draws it, in a plan's type and kept out of a recording. */
function TemplateFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Fill className="desktop-document template-document ph-no-capture">{children}</Fill>;
}

/**
 * The page's actions at the right end of its title line, as every Settings
 * page carries its own: the version history, and Reset to default while the
 * account holds a template of its own. They are `@luke/ui`'s quiet
 * `IconButton` and outline `Button`.
 */
function TitleActions({
  custom,
  onShowHistory,
  onReset,
}: {
  custom: boolean;
  onShowHistory: () => void;
  onReset: () => void;
}): React.JSX.Element {
  return (
    <TitleActionsLine>
      <Tooltip label={HISTORY_LABEL}>
        <IconButton icon={<HistoryIcon />} label={HISTORY_LABEL} onClick={onShowHistory} />
      </Tooltip>
      {custom ? (
        <Button variant={BUTTON_VARIANT.OUTLINE} icon={<ResetIcon />} onClick={onReset}>
          {RESET_LABEL}
        </Button>
      ) : null}
    </TitleActionsLine>
  );
}

/** The template read: the note, and the template as a plan's document, its title line carrying the page's actions where a header does not. */
function TemplateDocument({
  template,
  reader,
  onShowHistory,
  onReset,
  titled,
}: {
  template: TemplateControl;
  /** The account reading it, whose every edit it is. */
  reader: TaskReader;
  onShowHistory: () => void;
  onReset: () => void;
  /** Whether the title's line carries the page's actions, which a phone's header holds instead. */
  titled: boolean;
}): React.JSX.Element {
  return (
    <TemplateFrame>
      <PlanBody
        task={templateDocument(template.text, template.lastEdit)}
        live={false}
        reader={reader}
        onEdit={template.edit}
        onShowHistory={onShowHistory}
        page={{
          actions: titled ? (
            <TitleActions
              custom={template.custom}
              onShowHistory={onShowHistory}
              onReset={onReset}
            />
          ) : null,
          note: <TemplateNote />,
        }}
      />
    </TemplateFrame>
  );
}

/**
 * The template while it is read, drawn in the document's own frame: the
 * page's head as the document draws it, its name and note whole, since
 * neither waits on the read, and a block for its history's press; then
 * headings over their lines in the plan's own type, so the template lands
 * where the blocks stood.
 */
function TemplateSkeleton({ titled }: { titled: boolean }): React.JSX.Element {
  return (
    <TemplateFrame>
      <DocumentScroll>
        <PlanBodyColumn>
          <PlanPageHead
            name={TEMPLATE_TITLE}
            actions={
              titled ? (
                <TitleActionsLine>
                  <Skeleton shape={SKELETON_SHAPE.CONTROL} width="var(--luke-control-height)" />
                </TitleActionsLine>
              ) : null
            }
            note={<TemplateNote />}
          />
          <SkeletonRegion label={PAGE_LINE.READING}>
            <Stack gap={GAP.SECTION}>
              {TEMPLATE_SKELETON.map((section) => (
                <Stack key={section.heading} gap={GAP.TIGHT}>
                  <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.DIV}>
                    <Skeleton width={section.heading} />
                  </Text>
                  <div>
                    {section.lines.map((width, at) => (
                      // oxlint-disable-next-line react/no-array-index-key -- a placeholder's lines have nothing but their place.
                      <Skeleton key={at} width={width} />
                    ))}
                  </div>
                </Stack>
              ))}
            </Stack>
          </SkeletonRegion>
        </PlanBodyColumn>
      </DocumentScroll>
    </TemplateFrame>
  );
}

/** What stands in the document's place: no account, the read under way, or the read failed with its Retry. */
function TemplateState({
  signedIn,
  template,
  titled,
}: {
  signedIn: boolean;
  template: TemplateControl;
  /** Whether the document's title line carries the page's actions, as `TemplateDocument` takes it. */
  titled: boolean;
}): React.JSX.Element {
  if (!signedIn) {
    return (
      <Fill className="desktop-empty-region">
        <EmptyState>{PAGE_LINE.SIGNED_OUT}</EmptyState>
      </Fill>
    );
  }
  if (template.read === TEMPLATE_READ.FAILED) {
    return (
      <Fill className="desktop-empty-region">
        <ErrorState onRetry={template.retry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {PAGE_LINE.READ_FAILED}
        </ErrorState>
      </Fill>
    );
  }
  // While the read is out the page's head stands where the document's will, the template's blocks under it.
  return <TemplateSkeleton titled={titled} />;
}

/**
 * A phone's header over the page: the way back, the page's name, and a ⋯
 * holding its actions while the template is drawn, Version history and,
 * while the account holds a template of its own, Reset to default.
 */
function TemplateHead({
  back,
  drawn,
  custom,
  onShowHistory,
  onReset,
}: {
  back: PhoneBackDoor;
  drawn: boolean;
  custom: boolean;
  onShowHistory: () => void;
  onReset: () => void;
}): React.JSX.Element {
  return (
    <PhoneHead
      place="settings-page"
      start={<PhoneBack back={back} />}
      title={<h1 className="desktop-toolbar-title">{TEMPLATE_TITLE}</h1>}
      end={
        drawn ? (
          <PlaceMore
            shown
            groups={() => [
              [
                { label: HISTORY_LABEL, icon: <HistoryIcon />, onSelect: onShowHistory },
                ...(custom ? [{ label: RESET_LABEL, icon: <ResetIcon />, onSelect: onReset }] : []),
              ],
            ]}
          />
        ) : null
      }
    />
  );
}

/**
 * Settings › Plan template beside Settings' page list: the template as a
 * plan's document, its title line carrying the page's actions, or on a
 * phone under a header holding them. `onShowHistory` opens the history,
 * from the button or the "Edited by" line, a section's opening it on the
 * template as it stands.
 */
export function PlanTemplatePage({
  account,
  back,
  hidden,
  onShowHistory,
}: {
  /** The signed-in account, whose every edit of the template is; none while signed out. */
  account: PersonActor | undefined;
  /** The way back to the page list, which a phone's header leads with; none beside the list, where the window's drag strip heads the page. */
  back: PhoneBackDoor | undefined;
  /** Whether the page is hidden, as a narrow room hides it behind the page list. */
  hidden: boolean;
  onShowHistory: () => void;
}): React.JSX.Element {
  const signedIn = account !== undefined;
  const { act } = useAct();
  const template = useTemplate(signedIn, act);
  const drawn = account !== undefined && template.read === TEMPLATE_READ.READ;
  const reset = useConfirmDialog({ subject: template.custom, surfaceOpen: true }, template.reset);
  return (
    <section
      className="settings-page"
      aria-label={TEMPLATE_TITLE}
      aria-busy={signedIn && template.read === TEMPLATE_READ.READING ? true : undefined}
      hidden={hidden}
    >
      {/* Settings has no top bar but a phone's: the page's title and its actions stand in the page. */}
      {back === undefined ? (
        <div className="desktop-drag-strip" />
      ) : (
        <TemplateHead
          back={back}
          drawn={drawn}
          custom={template.custom}
          onShowHistory={onShowHistory}
          onReset={reset.ask}
        />
      )}
      {drawn ? (
        <TemplateDocument
          template={template}
          reader={{ readerId: account.userId, owner: account }}
          onShowHistory={() => onShowHistory()}
          onReset={reset.ask}
          titled={back === undefined}
        />
      ) : (
        <TemplateState signedIn={signedIn} template={template} titled={back === undefined} />
      )}
      <ConfirmDialog confirm={reset} question={RESET_QUESTION} />
    </section>
  );
}
