import type { PlanTemplateAnswerView } from "@sidecar/hosted/coding-agent-view";
import {
  PLAN_TEMPLATE_BOUNDS,
  type PlanTemplateAnswer,
} from "@sidecar/hosted/plan-document-template";
import { PLAN_EDIT_REFUSAL } from "@sidecar/hosted/plan-edit";
import { PLAN_ACTOR, type Plan } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE, type PlanningEditAnswer } from "@sidecar/hosted/planning-view";
import { ResetIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { InfoIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { type ActHandle, useAct } from "../act";
import { PlanBody } from "../planning/plan-body";
import type { PlanEditDoor } from "../planning/use-plan-editing";
import { RetryButton } from "../retry-button";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { TOAST_TONE, useToast } from "../toast";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "./confirm-dialog";

/**
 * plan-template-page.tsx -- Settings › Plan template: the Markdown every new plan starts as a copy of, drawn and edited as a plan is.
 *
 * The template is a plan's text before it is a plan, so the page is a plan's
 * page beside Settings' page list: the toolbar names it, and the document is
 * the plan's own (`../planning/plan-body.tsx`), at the plan's width and in
 * its type, read as sections until a click or Return opens the same editor
 * on the same words with the same keyboard. Its title is the page's name,
 * which is no name of the account's to change, so it is drawn and never
 * edited. A quiet note over the document, placed as an archived plan's
 * banner is, says what the template is for, and offers Reset to default
 * while the account holds a template of its own; the reset asks first,
 * since the words it replaces are kept nowhere, and waits for a save
 * already out so the default lands last.
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

/** What the page says. */
const PAGE_LINE = {
  TITLE: "Plan template",
  NOTE: "New plans start as a copy of this template.",
  NOTE_DETAIL: "Editing it doesn't change existing plans.",
  SIGNED_OUT: "Sign in to edit the template your new plans start from.",
  READ_FAILED: "The template could not be read.",
  LEFT_UNSAVED: "Your plan template could not be saved.",
  RESET_FAILED: "The template could not be reset. Try again.",
} as const;

/** The id the template is drawn under as a plan's document, which names no plan of the account's. */
const TEMPLATE_DOCUMENT_ID = "plan-template";

/** Where the page stands with the service's template. */
const TEMPLATE_READ = {
  READING: "reading",
  FAILED: "failed",
  READ: "read",
} as const;

type TemplateRead = (typeof TEMPLATE_READ)[keyof typeof TEMPLATE_READ];

const RESET_QUESTION: DialogQuestion = {
  title: "Reset plan template?",
  body: "Your template is replaced by the default, and your edits to it are lost. Existing plans don't change. This can't be undone.",
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
 * title, the template as its text, and, once the developer has changed it
 * here, their edit as its last, so the document takes their own words in at
 * once as it takes a plan's, rather than typing them in again.
 */
function templateDocument(text: string, editedAt: number | undefined): Plan {
  return {
    id: TEMPLATE_DOCUMENT_ID,
    name: PAGE_LINE.TITLE,
    createdAt: 0,
    updatedAt: 0,
    repository: null,
    document: { body: text, assumptions: [] },
    ...(editedAt === undefined
      ? undefined
      : { lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: editedAt, duringCall: false } }),
  };
}

/** The template as the page holds it, and its doors. */
interface TemplateControl {
  read: TemplateRead;
  retry: () => void;
  text: string;
  custom: boolean;
  /** When the developer last changed it on this page; none until they do. */
  editedAt: number | undefined;
  edit: PlanEditDoor;
  reset: () => Promise<ActionResult>;
}

/**
 * The service's template, read as the page opens and again on Retry, and
 * written through the document's edit door. Note that the write out is held
 * in a ref, because a reset must wait for it however many renders stand
 * between them, and whether the page still stands is too, because a save
 * the document sends as the page goes answers after it has.
 */
function useTemplate(signedIn: boolean, act: ActHandle["act"]): TemplateControl {
  const [read, setRead] = useState<TemplateRead>(TEMPLATE_READ.READING);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");
  const [custom, setCustom] = useState(false);
  const [editedAt, setEditedAt] = useState<number | undefined>(undefined);
  const flight = useRef<Promise<unknown> | undefined>(undefined);
  const standing = useRef(true);
  const toast = useToast();

  const take = useCallback((answer: PlanTemplateAnswer, edited: number | undefined) => {
    setText(answer.template);
    setCustom(answer.custom);
    setEditedAt(edited);
  }, []);

  useEffect(() => {
    standing.current = true;
    return () => {
      standing.current = false;
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setRead(TEMPLATE_READ.READING);
    act(ACT_KIND.PLAN_TEMPLATE_READ)
      .catch((): PlanTemplateAnswerView | undefined => undefined)
      .then((answer) => {
        if (!live) return;
        const failed = answer === undefined || "failure" in answer;
        if (!failed) take(answer, undefined);
        setRead(failed ? TEMPLATE_READ.FAILED : TEMPLATE_READ.READ);
      });
    return () => {
      live = false;
    };
  }, [act, signedIn, attempt, take]);

  // Note that words the page left unsaved as it went are said in a toast,
  // because the page and its Retry are gone with them.
  const save = (words: string): Promise<PlanningEditAnswer> => {
    if (words.length > PLAN_TEMPLATE_BOUNDS.MAX_CHARS) {
      return Promise.resolve({ failure: PLAN_EDIT_REFUSAL.TOO_LONG });
    }
    const sent = written(act, words).then((answer): PlanningEditAnswer => {
      if (answer !== undefined) {
        if (standing.current) take(answer, Date.now());
        return { saved: true };
      }
      if (!standing.current) {
        toast({
          words: PAGE_LINE.LEFT_UNSAVED,
          tone: TOAST_TONE.FAILED,
          persists: true,
          action: { label: "Retry", onPress: () => save(words) },
        });
      }
      return { failure: PLAN_CALL_FAILURE.UNANSWERED };
    });
    flight.current = sent;
    return sent;
  };

  return {
    read,
    retry: () => setAttempt((count) => count + 1),
    text,
    custom,
    editedAt,
    edit: (request) => save(request.document.value),
    reset: async (): Promise<ActionResult> => {
      // The write already out lands before the null is sent, so the default is what the service keeps.
      await flight.current;
      const answer = await written(act, null);
      if (answer === undefined) {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: PAGE_LINE.RESET_FAILED };
      }
      take(answer, Date.now());
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
function TemplateDocument({ template }: { template: TemplateControl }): React.JSX.Element {
  const reset = useConfirmDialog({ subject: template.custom, surfaceOpen: true }, template.reset);
  return (
    <>
      <TemplateNote custom={template.custom} onReset={reset.ask} />
      <div className="desktop-document ph-no-capture">
        <PlanBody
          plan={templateDocument(template.text, template.editedAt)}
          live={false}
          onEdit={template.edit}
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

/** Settings › Plan template beside Settings' page list: its toolbar, then the template as a plan's document. */
export function PlanTemplatePage({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const { act } = useAct();
  const template = useTemplate(signedIn, act);
  return (
    <section className="settings-page" aria-label={PAGE_LINE.TITLE}>
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">{PAGE_LINE.TITLE}</h1>
        </div>
      </header>
      {signedIn && template.read === TEMPLATE_READ.READ ? (
        <TemplateDocument template={template} />
      ) : (
        <TemplateState signedIn={signedIn} template={template} />
      )}
    </section>
  );
}
