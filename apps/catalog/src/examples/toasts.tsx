/**
 * toasts.tsx -- the passing notices in each tone, stacked as the window stacks
 * them: a plain one that lets clicks through, one with a second line, and
 * ones carrying an action, whose × shows under the pointer or focus.
 */

import { TOAST_TONE, Toast, ToastActions, ToastStack, type ToastTone } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function noop(): void {}

/** A toast with an action, as an undoable change carries one. */
function Acting({
  tone,
  words,
  detail,
  label,
}: {
  tone: ToastTone;
  words: string;
  detail?: string;
  label: string;
}): React.JSX.Element {
  return (
    <Toast
      tone={tone}
      words={words}
      detail={detail}
      actions={
        <ToastActions label={label} onPress={noop} dismissLabel="Dismiss" onDismiss={noop} />
      }
    />
  );
}

function Toasts(): React.JSX.Element {
  return (
    <CatalogSection id="toast-stack" title="Stacked in the corner">
      {/* A transform makes this box the containing block of the stack's fixed corner. */}
      <div className="catalog-toast-stage">
        <ToastStack
          label="Notifications"
          polite="Link copied. Task archived. Should withdrawn invitations count?"
          alert="Couldn't save the plan"
        >
          <Toast tone={TOAST_TONE.DONE} words="Link copied" />
          <Toast
            tone={TOAST_TONE.FAILED}
            words="Couldn't save the plan"
            detail="Your change is kept here until you are back online."
          />
          <Acting tone={TOAST_TONE.DONE} words="Task archived" label="Undo" />
          <Acting
            tone={TOAST_TONE.ASK}
            words="Should withdrawn invitations count?"
            detail="Relay · Retry the webhook"
            label="View"
          />
        </ToastStack>
      </div>
    </CatalogSection>
  );
}

export const TOASTS_EXAMPLE: Example = { id: "toasts", title: "Toasts", Render: Toasts };
