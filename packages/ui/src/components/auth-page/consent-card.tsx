import { PRODUCT_NAME } from "@repo/features/product-name";
import { CheckIcon } from "../../face/glyphs.js";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { GLYPH_INK, GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { AuthMark } from "./auth-mark.js";
import { AuthPage } from "./auth-page.js";

/**
 * consent-card.tsx -- the consent an outside MCP client waits on: who is asking, what it will be able to do, how to take it back, as which account, where the answer goes, and Allow or Deny.
 *
 * Every client that is not trusted is an outside agent that registered
 * itself to reach the member MCP server, so the card is drawn as the
 * connection pages are: the other party in the ring, the title saying what
 * is asked, and the line under it what that means, here that it acts as
 * the member until revoked in Settings › MCP. The card knows nothing of
 * the auth client. A caller hands it the client's name as it registered,
 * the account the browser is signed in as, one line for each scope asked,
 * and where the answer goes, already in words
 * (`@repo/features/oauth-consent`), and hears which answer the member gave.
 * One answer goes out at a time, so both stand unavailable while one does.
 *
 * It opens on the MCP glyph and never on a picture the client names, since
 * fetching one would tell the client who looked and its name is its own to
 * claim. It draws nothing of its own but the list, one checked row for each
 * ability in a well, named for a reader as what the client will be able to
 * do: the card is the AuthPage's, the answers are `Button`s, Deny then
 * Allow, in the foot, each half the card's width, and the account and where
 * the answer goes close it, as the invitation's account does.
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

/** What the card says under its title: what an Allow lets the client do, and where to take it back. */
const CONSENT_MEANING = "It acts as you until you revoke it in Settings › MCP.";

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
      mark={<AuthMark mcpClient />}
      title={`${client} wants to use your ${PRODUCT_NAME} account`}
      description={CONSENT_MEANING}
      footnote={`You'll allow it as ${account}. Your answer goes to ${destination}.`}
      foot={
        <div className="ui-consent-answers grid grid-cols-2 gap-control-gap">
          <AnswerButton answer={CONSENT_ANSWER.DENY} answering={answering} onAnswer={onAnswer} />
          <AnswerButton answer={CONSENT_ANSWER.ALLOW} answering={answering} onAnswer={onAnswer} />
        </div>
      }
    >
      <ul
        className="ui-consent-abilities m-0 p-0 list-none flex flex-col border border-border rounded-control bg-well text-label"
        aria-label={`What ${client} will be able to do`}
      >
        {abilities.map((ability) => (
          <li
            className="ui-consent-ability flex items-start gap-ui-8 px-ui-12 py-ui-8 not-first:border-t not-first:border-border"
            key={ability}
          >
            <GlyphSlot ink={GLYPH_INK.INHERIT} size={ICON_SIZE.SMALL} line>
              <CheckIcon />
            </GlyphSlot>
            <span>{ability}</span>
          </li>
        ))}
      </ul>
    </AuthPage>
  );
}
