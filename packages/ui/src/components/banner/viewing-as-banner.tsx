import { STATUS_TONE } from "../../status-tone.js";
import { AttentionMark } from "../attention-mark/attention-mark.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { BANNER_LOOK, Banner } from "./banner.js";

interface ViewedMember {
  readonly name?: string | undefined;
  readonly email: string;
}

export interface StopWrite {
  readonly run: () => void;
  readonly busy: boolean;
  readonly refusal: string | undefined;
  readonly failed: boolean;
}

const STOP_FAILED = "The sign-in could not be stopped. Try again.";

export function ViewingAsBanner({
  member,
  stop,
}: {
  member: ViewedMember;
  stop: StopWrite;
}): React.JSX.Element {
  const refusal = stop.busy ? undefined : (stop.refusal ?? (stop.failed ? STOP_FAILED : undefined));
  const who = member.name ? `${member.name} (${member.email})` : member.email;
  return (
    <Banner
      look={BANNER_LOOK.STRIP}
      tone={STATUS_TONE.ATTENTION}
      glyph={<AttentionMark />}
      actions={
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          busy={stop.busy}
          busyLabel="Stopping"
          onClick={stop.run}
        >
          Stop
        </Button>
      }
    >
      Viewing as {who}
      {refusal === undefined ? null : <span role="alert">{` · ${refusal}`}</span>}
    </Banner>
  );
}
