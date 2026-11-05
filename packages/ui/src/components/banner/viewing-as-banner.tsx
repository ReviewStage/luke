import { useState } from "react";
import { STATUS_TONE } from "../../status-tone.js";
import { AttentionMark } from "../attention-mark/attention-mark.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { BANNER_LOOK, Banner } from "./banner.js";

/**
 * viewing-as-banner.tsx -- the strip a maintainer signed in as a member reads on every web page while that sign-in stands: who they are viewing as, and Stop.
 *
 * It is the banner's strip in the attention tone, since the sign-in is a
 * temporary state that wants the maintainer's hand, and names the member by
 * name and email, so a maintainer never mistakes the member's account for
 * their own. Stop is the one press, busy while the sign-in ends; a stop that
 * lands leaves the page, so only a refusal comes back, said after the words
 * in the service's own words. Where it stands is its page's.
 */

/** The member a maintainer is signed in as: their name, where they have one, and their email. */
interface ViewedMember {
  readonly name?: string | undefined;
  readonly email: string;
}

/** What the strip says where Stop failed with no words of the service's. */
const STOP_FAILED = "The sign-in could not be stopped. Try again.";

/** The strip: whom it views as, and Stop. */
export function ViewingAsBanner({
  member,
  onStop,
}: {
  member: ViewedMember;
  /** Ends the sign-in and leaves the page; answers why not, where it was refused. */
  onStop: () => Promise<string | undefined>;
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const stop = () => {
    setStopping(true);
    setRefusal(undefined);
    void onStop()
      .catch(() => STOP_FAILED)
      .then((refused) => {
        setStopping(false);
        setRefusal(refused);
      });
  };
  const who = member.name ? `${member.name} (${member.email})` : member.email;
  return (
    <Banner
      look={BANNER_LOOK.STRIP}
      tone={STATUS_TONE.ATTENTION}
      glyph={<AttentionMark />}
      actions={
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          busy={stopping}
          busyLabel="Stopping"
          onClick={stop}
        >
          Stop
        </Button>
      }
    >
      Viewing as {who}
      {refusal === undefined ? null : ` · ${refusal}`}
    </Banner>
  );
}
