import {
  BANNER_GLYPH,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  COPY_FIELD_PROMPT,
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
import { useBusyPress } from "../settings/busy-press.js";

/**
 * github-sign-in-card.tsx -- the card a transcript ends on where a Mac could not start its agent because the Mac's own GitHub sign-in cannot reach the repository: the command that signs in, to copy, then Retry, and Move to cloud where Move to would offer it.
 *
 * A repository reached on the member's own token runs on a Mac through that
 * Mac's own git and gh login, which its host checks before it clones; where
 * the login cannot reach the repository the launch settles unstarted with
 * `DEVICE_LAUNCH_UNSTARTED.GITHUB_SIGN_IN`, and this card stands in place of
 * the end line's sentence. It names the Mac and the repository where the tab
 * knows them, else "This Mac" and "the repository". Retry asks the service
 * to send again, as the failed end line's Try again does: the lines the
 * launch never took, or, where none was lost, a line of the developer's own
 * (`RETRY_LINE`), so the same agent launches anew with its first message;
 * the press holds off a second send while it is out, and a refused one is
 * offered again. Move to cloud is Move to's Cloud (`move-agent.tsx`), wearing
 * its cloud. The failure is marked as a failed turn's end line marks one,
 * the bare failed glyph in the danger ink (`BANNER_GLYPH.MARK`).
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
  RETRYING: "Retrying",
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
  /** Sends the agent again what its launch lost, launching it anew; answers whether the service took it. */
  readonly onRetry: () => Promise<boolean>;
  /** Moves the agent to the cloud; none where Move to would not offer it. */
  readonly onMoveToCloud: (() => void) | undefined;
  /** Puts the command on the clipboard; a rejection is a refused copy. */
  readonly copy: (text: string) => Promise<void>;
}

/** The card, its Retry pressed once until what it sent takes its place, or the service refuses it. */
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
  const retry = useBusyPress(() => {
    if (pressed.current) return undefined;
    pressed.current = true;
    return onRetry().then((took) => {
      pressed.current = took;
      setRetried(took);
    });
  });
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      tone={STATUS_TONE.DANGER}
      glyph={<GLYPH.FAILED />}
      glyphLook={BANNER_GLYPH.MARK}
      actions={
        <>
          {onMoveToCloud === undefined ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} icon={<GLYPH.CLOUD />} onClick={onMoveToCloud}>
              {GITHUB_SIGN_IN_WORDS.MOVE_TO_CLOUD}
            </Button>
          )}
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            busy={retry.busy}
            busyLabel={GITHUB_SIGN_IN_WORDS.RETRYING}
            disabled={retried}
            onClick={retry.onPress}
          >
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
        prompt={COPY_FIELD_PROMPT.SHELL}
      />
    </Banner>
  );
}
