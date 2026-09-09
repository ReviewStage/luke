import { CheckIcon, PencilIcon, RefreshIcon, TrashIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { searchAnchorProps } from "../settings-anchors";
import { useConfirm } from "./confirm-state";
import { ConfirmSwap } from "./confirm-swap";
import {
  CONNECTION_CONTROL,
  CONNECTION_LAYOUT,
  type ConnectionAction,
  type ConnectionInput,
  type ConnectionSpec,
} from "./connection-schema";

/** The glyph each control wears, which is what says how it reads on the line. */
const CONTROL_GLYPH = {
  [CONNECTION_CONTROL.EDIT]: <PencilIcon />,
  [CONNECTION_CONTROL.REFRESH]: <RefreshIcon />,
  [CONNECTION_CONTROL.TRASH]: <TrashIcon />,
};

/** The class each control wears, beside the glyph. */
const CONTROL_CLASS = {
  [CONNECTION_CONTROL.WORD]: "quiet-button",
  [CONNECTION_CONTROL.EDIT]: "icon-button",
  [CONNECTION_CONTROL.REFRESH]: "icon-button",
  [CONNECTION_CONTROL.TRASH]: "icon-button credential-remove",
};

function ConnectionControl({
  action,
  onPress,
}: {
  action: ConnectionAction;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={CONTROL_CLASS[action.control]}
      disabled={action.disabled ?? false}
      aria-label={action.label}
      {...(action.title !== undefined ? { title: action.title } : undefined)}
      {...(action.spinning !== undefined
        ? { "data-spinning": String(action.spinning) }
        : undefined)}
      onClick={onPress}
    >
      {action.control === CONNECTION_CONTROL.WORD ? action.word : CONTROL_GLYPH[action.control]}
    </button>
  );
}

/**
 * One connection Luke can hold, one line: its mark, its name, whether it is
 * connected, and what can be done about that.
 *
 * Every connection is drawn by this and nothing else, so five integrations
 * cannot describe themselves five ways, and a connection this build cannot
 * offer draws no row rather than a row whose one action cannot run. What each
 * one is, and every action it offers, is its entry in `CONNECTION_SCHEMA`; what
 * a connected connection reads as — the check, the words beside it, where the
 * refusal lands — is here, once.
 *
 * The action that cannot be undone from inside the panel asks first, through
 * the one `<ConfirmSwap>`. A row offers at most one such action, because both
 * layers of the swap share one grid cell and a second question would have
 * nowhere to be asked.
 */
export function ConnectionRow({
  spec,
  input,
}: {
  spec: ConnectionSpec;
  input: ConnectionInput;
}): React.JSX.Element | null {
  const offered = spec.offered(input.visibility) || (spec.alsoDrawn?.(input) ?? false);
  const actions = offered ? spec.actions(input) : [];
  const confirming = actions.find((action) => action.confirm !== undefined);
  // The question's subject is the action itself: a row that has stopped
  // offering the delete has nothing left to confirm, which is the same rule as
  // a key that has gone.
  const confirm = useConfirm(
    { subject: confirming !== undefined, surfaceOpen: input.panelOpen },
    async () => (await confirming?.confirm?.act()) ?? { status: ACTION_RESULT_STATUS.ACCEPTED },
  );

  if (!offered) return null;

  const status = spec.status(input);
  const question = confirming?.confirm;
  const controls =
    actions.length > 0 ? (
      <ConfirmSwap
        {...(question
          ? {
              question: question.question,
              stage: confirm.stage,
              verb: question.verb,
              running: question.running,
              onKeep: confirm.keep,
              onAct: confirm.run,
            }
          : undefined)}
      >
        {actions.map((action) => (
          <ConnectionControl
            key={action.label}
            action={action}
            onPress={action === confirming ? confirm.ask : (action.run ?? (() => undefined))}
          />
        ))}
      </ConfirmSwap>
    ) : null;

  const identity =
    spec.layout === CONNECTION_LAYOUT.NESTED ? (
      <span className="calendar-account-name">{spec.name(input.visibility)}</span>
    ) : (
      <span className="credential-identity">
        <span className="credential-mark">{spec.mark}</span>
        <span className="credential-name">{spec.name(input.visibility)}</span>
        {status.connected ? <CheckIcon /> : null}
      </span>
    );

  // An answer to something a hand asked for, else whatever the latest pass
  // reported about the connection — which surfaces on its own row rather than
  // in a log, but never over a refusal somebody is waiting on.
  const answered = confirm.rejection ?? spec.refusal?.(input);
  const reported = answered ?? spec.note?.(input);
  const rejection = reported ? (
    <p className="error-message" {...(answered ? { role: "alert" } : undefined)}>
      {reported}
    </p>
  ) : null;

  const line = (
    <div
      className={
        spec.layout === CONNECTION_LAYOUT.NESTED ? "calendar-account-row" : "credential-row"
      }
      {...(spec.layout === CONNECTION_LAYOUT.LINE ? searchAnchorProps(spec.id) : undefined)}
    >
      {identity}
      {/* The check says connected and the controls say what can be done about
          it, so the words are kept for the one thing neither can say: a key
          read from the environment, a CLI signed out, a grant withdrawn. */}
      {status.words !== undefined ? (
        <span className="credential-status">{status.words}</span>
      ) : null}
      {controls}
    </div>
  );

  const children = spec.children?.(input);
  const nested = spec.nested?.(input) ?? [];
  const body = (
    <>
      {line}
      {spec.body?.(input)}
      {rejection}
      {children}
      {nested.map((child) => (
        <ConnectionRow key={child.id} spec={child} input={input} />
      ))}
    </>
  );

  if (spec.layout === CONNECTION_LAYOUT.LINE) return body;
  return (
    <div
      className={spec.layout === CONNECTION_LAYOUT.NESTED ? "calendar-account" : "credential"}
      {...(spec.layout === CONNECTION_LAYOUT.BLOCK ? searchAnchorProps(spec.id) : undefined)}
    >
      {body}
    </div>
  );
}
