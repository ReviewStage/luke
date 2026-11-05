import {
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  COPY_FIELD_WIDTH,
  CopyField,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useRef, useState } from "react";

/**
 * github-sign-in-card.tsx -- the card a transcript ends on where a Mac could not start its agent because the Mac's own GitHub sign-in cannot reach the repository: the command that signs in, to copy, then Retry, and Move to cloud where Move to would offer it.
 *
 * A repository reached on the member's own token runs on a Mac through that
 * Mac's own git and gh login, which its host checks before it clones; where
 * the login cannot reach the repository the launch settles unstarted with
 * `DEVICE_LAUNCH_UNSTARTED.GITHUB_SIGN_IN`, and this card stands in place of
 * the end line's sentence. It names the Mac and the repository where the tab
 * knows them, else "This Mac" and "the repository". Retry sends the agent a
 * line of the developer's own (`RETRY_LINE`) under a fresh key, as the
 * sentence it replaces told the developer to, so the same agent launches
 * anew and its first message with it; the transcript then draws the line
 * going in the card's place, and the press holds off a second send
 * meanwhile. Move to cloud is Move to's Cloud (`move-agent.tsx`).
 */

/** What the card says and presses. */
const GITHUB_SIGN_IN_WORDS = {
  UNNAMED_MAC: "This Mac",
  UNNAMED_REPOSITORY: "the repository",
  HOW: "Sign in on that Mac, then retry:",
  COMMAND: "gh auth login",
  COMMAND_LABEL: "Sign-in command",
  COMMAND_WHAT: "command",
  RETRY: "Retry",
  MOVE_TO_CLOUD: "Move to cloud",
} as const;

/** The line Retry sends the agent, which reads in the transcript as the developer's own. */
export const RETRY_LINE = "Try again";

/** What the card draws and presses: the Mac and the repository by name where known, and its acts. */
export interface GitHubSignInDoors {
  /** The Mac's own name; none where the tab does not know it. */
  readonly host: string | undefined;
  /** The repository as `owner/name`; none before it is read, or for an agent with none. */
  readonly repository: string | undefined;
  /** Sends the agent its line again, launching it anew. */
  readonly onRetry: () => void;
  /** Moves the agent to the cloud; none where Move to would not offer it. */
  readonly onMoveToCloud: (() => void) | undefined;
  /** Puts the command on the clipboard; a rejection is a refused copy. */
  readonly copy: (text: string) => Promise<void>;
}

/** The card, its Retry pressed once until the line it sent takes its place. */
export function GitHubSignInCard({
  host,
  repository,
  onRetry,
  onMoveToCloud,
  copy,
}: GitHubSignInDoors): React.JSX.Element {
  // Note that the press is kept in a ref as well as drawn, so a second press before the draw sends nothing.
  const pressed = useRef(false);
  const [retried, setRetried] = useState(false);
  const retry = () => {
    if (pressed.current) return;
    pressed.current = true;
    setRetried(true);
    onRetry();
  };
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      tone={STATUS_TONE.DANGER}
      glyph={<GLYPH.FAILED />}
      actions={
        <>
          {onMoveToCloud === undefined ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onMoveToCloud}>
              {GITHUB_SIGN_IN_WORDS.MOVE_TO_CLOUD}
            </Button>
          )}
          <Button variant={BUTTON_VARIANT.PRIMARY} disabled={retried} onClick={retry}>
            {GITHUB_SIGN_IN_WORDS.RETRY}
          </Button>
        </>
      }
    >
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.LABEL}>
        {host ?? GITHUB_SIGN_IN_WORDS.UNNAMED_MAC} can't reach{" "}
        {repository === undefined ? (
          GITHUB_SIGN_IN_WORDS.UNNAMED_REPOSITORY
        ) : (
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
            {repository}
          </Text>
        )}{" "}
        on GitHub.
      </Text>
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {GITHUB_SIGN_IN_WORDS.HOW}
      </Text>
      <CopyField
        label={GITHUB_SIGN_IN_WORDS.COMMAND_LABEL}
        value={GITHUB_SIGN_IN_WORDS.COMMAND}
        what={GITHUB_SIGN_IN_WORDS.COMMAND_WHAT}
        copy={copy}
        width={COPY_FIELD_WIDTH.FULL}
      />
    </Banner>
  );
}
