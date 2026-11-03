import { PRODUCT_NAME } from "@repo/features/product-name";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { AuthMark } from "./auth-mark.js";
import { AuthPage } from "./auth-page.js";

/**
 * consent-card.tsx -- the consent an OAuth client that is not trusted waits on: who is asking, as which account, what it will be able to do, where the answer goes, and Allow or Deny.
 *
 * The card knows nothing of the auth client. A caller hands it the client's
 * name as it registered, the account the browser is signed in as, one line
 * for each scope asked, and where the answer goes, already in words
 * (`@repo/features/oauth-consent`), and hears which answer the member gave.
 * One answer goes out at a time, so both stand unavailable while one does.
 *
 * It opens on the app's own mark and never on a picture the client names,
 * since fetching one would tell the client who looked. It draws nothing of
 * its own but the list: the card is the AuthPage's, the answers are
 * `Button`s, Deny then Allow, in the foot, each half the card's width.
 */

/** The member's answer to a client's request. */
export const CONSENT_ANSWER = {
  ALLOW: "allow",
  DENY: "deny",
} as const;

export type ConsentAnswer = (typeof CONSENT_ANSWER)[keyof typeof CONSENT_ANSWER];

/** Each answer's words, and what a reader hears while it goes out. */
const ANSWER_WORDS = {
  [CONSENT_ANSWER.ALLOW]: { label: "Allow", busy: "Allowing" },
  [CONSENT_ANSWER.DENY]: { label: "Deny", busy: "Denying" },
} as const satisfies Record<ConsentAnswer, { label: string; busy: string }>;

/** One answer's button, out while it goes and unavailable while the other does. */
function AnswerButton({
  answer,
  answering,
  onAnswer,
}: {
  answer: ConsentAnswer;
  answering: ConsentAnswer | undefined;
  onAnswer: (answer: ConsentAnswer) => void;
}): React.JSX.Element {
  const words = ANSWER_WORDS[answer];
  return (
    <Button
      variant={answer === CONSENT_ANSWER.ALLOW ? BUTTON_VARIANT.PRIMARY : BUTTON_VARIANT.OUTLINE}
      busy={answering === answer}
      busyLabel={words.busy}
      disabled={answering !== undefined && answering !== answer}
      onClick={() => onAnswer(answer)}
    >
      {words.label}
    </Button>
  );
}

/** A client's request for `account`, its `abilities` listed, answered Allow or Deny. */
export function ConsentCard({
  client,
  account,
  abilities,
  destination,
  answering,
  onAnswer,
}: {
  /** The client's name as it registered. */
  client: string;
  /** The account the browser is signed in as, which the client would act for. */
  account: string;
  /** What the client will be able to do, one line for each scope it asks. */
  abilities: readonly string[];
  /** Where the answer goes: the host of the client's redirect, or an app on this computer. */
  destination: string;
  /** The answer under way, if one is. */
  answering: ConsentAnswer | undefined;
  onAnswer: (answer: ConsentAnswer) => void;
}): React.JSX.Element {
  return (
    <AuthPage
      mark={<AuthMark />}
      title={`${client} wants to use your ${PRODUCT_NAME} account`}
      description={`Signed in as ${account}`}
      footnote={`Your answer goes to ${destination}.`}
      foot={
        <div className="ui-consent-answers grid grid-cols-2 gap-control-gap">
          <AnswerButton answer={CONSENT_ANSWER.DENY} answering={answering} onAnswer={onAnswer} />
          <AnswerButton answer={CONSENT_ANSWER.ALLOW} answering={answering} onAnswer={onAnswer} />
        </div>
      }
    >
      <p className="ui-consent-lead m-0 text-muted-foreground text-label">It will be able to:</p>
      <ul className="ui-consent-abilities m-0 ps-ui-20 flex flex-col gap-ui-6 list-disc marker:text-muted-foreground">
        {abilities.map((ability) => (
          <li key={ability}>{ability}</li>
        ))}
      </ul>
    </AuthPage>
  );
}
