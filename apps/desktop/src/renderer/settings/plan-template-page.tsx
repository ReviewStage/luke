import type { PlanTemplateAnswerView } from "@sidecar/hosted/coding-agent-view";
import {
  PLAN_TEMPLATE_BOUNDS,
  type PlanTemplateAnswer,
} from "@sidecar/hosted/plan-document-template";
import { PLAN_EDIT_REFUSAL } from "@sidecar/hosted/plan-edit";
import { PLAN_ACTOR, type Plan, type PlanLastEdit } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE, type PlanningEditAnswer } from "@sidecar/hosted/planning-view";
import { ResetIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { HistoryIcon, InfoIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { type ActHandle, useAct } from "../act";
import { PlanBody } from "../planning/plan-body";
import type { PlanEditDoor } from "../planning/use-plan-editing";
import { RetryButton } from "../retry-button";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { TOAST_TONE, useToast } from "../toast";
import { Tooltip } from "../tooltip";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "./confirm-dialog";

/**
 * plan-template-page.tsx -- Settings › Plan template: the Markdown every new plan starts as a copy of, drawn and edited as a plan is.
 *
 * The template is a plan's text before it is a plan, so the page is a plan's
 * page beside Settings' page list: the toolbar names it and opens its
 * version history, as the "Edited by" line over the document does
 * (`plan-template-history.tsx`), and the document is
 * the plan's own (`../planning/plan-body.tsx`), at the plan's width and in
 * its type, read as sections until a click or Return opens the same editor
 * on the same words with the same keyboard. Its title is the page's name,
 * which is no name of the account's to change, so it is drawn and never
 * edited. A quiet note over the document, placed as an archived plan's
 * banner is, says what the template is for, and offers Reset to default
 * while the account holds a template of its own; the reset asks first,
 * since it replaces every word of the account's, kept since only in the
 * template's history, and waits for a save already out so the default
 * lands last.
 *
 * The template is the account's, kept on the service, so the page reads it
 * afresh as it opens and every Mac the account signs in on edits the same
 * one. The document saves the words as the developer pauses and as they
 * leave the editor (`../planning/use-plan-editing.ts`), here as a write of
 * the whole template, which is the developer's alone and so never meets
 * words of Luke's to merge. A save that failed says so under the editor
 * with a Retry, or, once the page has gone, in a toast whose Retry sends the
 * same words; a template past its bound is refused before it is sent. With
 * no account signed in there is no template to show, and the page says so.
 * The document stands under `ph-no-capture`, so the session recording keeps
 * neither the words nor the rhythm of the typing.
 */

/** The page's name, which the template is drawn under as a plan's title, and its versions too. */
export const TEMPLATE_TITLE = "Plan template";

/** What the page says. */
const PAGE_LINE = {
  NOTE: "New plans start as a copy of this template.",
  NOTE_DETAIL: "Editing it doesn't change existing plans.",
  SIGNED_OUT: "Sign in to edit the template your new plans start from.",
  READ_FAILED: "The template could not be read.",
  LEFT_UNSAVED: "Your plan template could not be saved.",
  RESET_FAILED: "The template could not be reset. Try again.",
} as const;

/** The id the template is drawn under as a plan's document, which names no plan of the account's. */
export const TEMPLATE_DOCUMENT_ID = "plan-template";

/** What the toolbar's button that opens the template's version history says, as a plan's menu item says it. */
const HISTORY_LABEL = "Version history";

/** Where the page stands with the service's template. */
const TEMPLATE_READ = {
  READING: "reading",
  FAILED: "failed",
  READ: "read",
} as const;

type TemplateRead = (typeof TEMPLATE_READ)[keyof typeof TEMPLATE_READ];

const RESET_QUESTION: DialogQuestion = {
  title: "Reset plan template?",
  body: "Your template is replaced by the default. Existing plans don't change, and your template stays in its version history, so you can restore it.",
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
function templateDocument(text: string, lastEdit: PlanLastEdit | undefined): Plan {
  return {
    id: TEMPLATE_DOCUMENT_ID,
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
    setLastEdit(edited);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setRead(TEMPLATE_READ.READING);
    // The newest revision is read beside the template, so its "Edited by" line stands as the document does rather than a beat after.
    const newest = act(ACT_KIND.PLAN_TEMPLATE_REVISIONS, {})
      .then((page) => ("failure" in page ? undefined : page.revisions[0]?.lastEdit))
      .catch((): PlanLastEdit | undefined => undefined);
    const template = act(ACT_KIND.PLAN_TEMPLATE_READ).catch(
      (): PlanTemplateAnswerView | undefined => undefined,
    );
    Promise.all([template, newest]).then(([answer, edited]) => {
      if (!live) return;
      const failed = answer === undefined || "failure" in answer;
      if (!failed) take(answer, edited);
      setRead(failed ? TEMPLATE_READ.FAILED : TEMPLATE_READ.READ);
    });
    return () => {
      live = false;
    };
  }, [act, signedIn, attempt, take]);

  const save = (words: string): Promise<PlanningEditAnswer> => {
    const writes = held.current;
    writes.failed = undefined;
    if (words.length > PLAN_TEMPLATE_BOUNDS.MAX_CHARS) {
      return Promise.resolve({ failure: PLAN_EDIT_REFUSAL.TOO_LONG });
    }
    const sent = written(act, words).then((answer): PlanningEditAnswer => {
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
      return { failure: PLAN_CALL_FAILURE.UNANSWERED };
    });
    writes.flight = sent;
    return sent;
  };

  // The page going sends words whose save failed a turn later, once the document's own leaving has sent anything newer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the page going is what sends them, through the door it held.
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
 * The note over the template, placed as an archived plan's banner is: what
 * the template is for, and its reset while the account holds its own. It is
 * what a settings search for the template lands on.
 */
function TemplateNote({
  custom,
  onReset,
}: {
  custom: boolean;
  onReset: () => void;
}): React.JSX.Element {
  return (
    <section
      className="document-banner template-note"
      aria-label={PAGE_LINE.NOTE}
      {...searchAnchorProps(SETTINGS_SEARCH_ROW.PLAN_TEMPLATE)}
    >
      <span className="document-banner-glyph" aria-hidden="true">
        <InfoIcon />
      </span>
      <div className="document-banner-words">
        <p className="document-banner-title">{PAGE_LINE.NOTE}</p>
        <p className="document-banner-detail">{PAGE_LINE.NOTE_DETAIL}</p>
      </div>
      {custom ? (
        <button type="button" className="toolbar-button" onClick={onReset}>
          <ResetIcon />
          Reset to default
        </button>
      ) : null}
    </section>
  );
}

/** The template read: the note, the template as a plan's document, and the reset's question. */
function TemplateDocument({
  template,
  onShowHistory,
}: {
  template: TemplateControl;
  onShowHistory: () => void;
}): React.JSX.Element {
  const reset = useConfirmDialog({ subject: template.custom, surfaceOpen: true }, template.reset);
  return (
    <>
      <TemplateNote custom={template.custom} onReset={reset.ask} />
      <div className="desktop-document ph-no-capture">
        <PlanBody
          plan={templateDocument(template.text, template.lastEdit)}
          live={false}
          onEdit={template.edit}
          onShowHistory={onShowHistory}
        />
      </div>
      <ConfirmDialog confirm={reset} question={RESET_QUESTION} />
    </>
  );
}

/** What stands in the document's place: no account, the read under way, or the read failed with its Retry. */
function TemplateState({
  signedIn,
  template,
}: {
  signedIn: boolean;
  template: TemplateControl;
}): React.JSX.Element {
  if (!signedIn) {
    return (
      <div className="desktop-empty">
        <p>{PAGE_LINE.SIGNED_OUT}</p>
      </div>
    );
  }
  if (template.read === TEMPLATE_READ.FAILED) {
    return (
      <div className="desktop-empty">
        <p role="alert">{PAGE_LINE.READ_FAILED}</p>
        <RetryButton onRetry={template.retry} />
      </div>
    );
  }
  return (
    <div className="desktop-empty">
      <Spinner label="Loading your template" size={SPINNER_SIZE.REGION} />
    </div>
  );
}

/**
 * Settings › Plan template beside Settings' page list: its toolbar, with
 * the button that opens the template's version history where there is a
 * template to have one, then the template as a plan's document.
 * `onShowHistory` opens the history, from the button or the "Edited by"
 * line, a section's opening it on the template as it stands.
 */
export function PlanTemplatePage({
  signedIn,
  onShowHistory,
}: {
  signedIn: boolean;
  onShowHistory: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const template = useTemplate(signedIn, act);
  const drawn = signedIn && template.read === TEMPLATE_READ.READ;
  return (
    <section className="settings-page" aria-label={TEMPLATE_TITLE}>
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">{TEMPLATE_TITLE}</h1>
        </div>
        {drawn ? (
          <div className="desktop-toolbar-actions">
            <Tooltip label={HISTORY_LABEL}>
              <button
                type="button"
                className="icon-button"
                aria-label={HISTORY_LABEL}
                onClick={onShowHistory}
              >
                <HistoryIcon />
              </button>
            </Tooltip>
          </div>
        ) : null}
      </header>
      {drawn ? (
        <TemplateDocument template={template} onShowHistory={() => onShowHistory()} />
      ) : (
        <TemplateState signedIn={signedIn} template={template} />
      )}
    </section>
  );
}
