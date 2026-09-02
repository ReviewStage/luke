import { PRODUCT_ASK_OUTCOME, PRODUCT_SURFACE_EVENT } from "@sidecar/analytics";
import { REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useCallback, useRef, useState } from "react";
import { FOCUS_FRAME_LIMIT } from "./credential-entry";
import { Keycaps } from "./keycaps";
import { SendIcon } from "./settings-icons";

/**
 * What the field is for, in the fewest words that say it. "Ask" rather than
 * "message": Luke answers rather than receives, and the reply arrives out
 * loud with its words landing right below the field.
 */
const ASK_PLACEHOLDER = "Ask Luke…";

/**
 * How the ask field is found from outside the component, the way the options
 * sheet is found by its id: the ask key is answered at the app level, where
 * the panel it may have to open lives, and the field it lands in is here.
 */
export const ASK_LUKE_INPUT_ID = "ask-luke-input";

/**
 * Puts the caret in the ask field, waiting out the panel's arrival on the way.
 *
 * The ask key can arrive with the panel closed or with Settings showing, so
 * the field it is reaching for may not be drawn until React has answered —
 * and a hidden stage refuses focus outright, the same trap `focusWhenVisible`
 * waits out. So this seeks by id, frame by frame, until the field exists and
 * is visible, and gives up on the same backstop rather than holding an
 * intention forever.
 */
export function focusAskField(): () => void {
  let frame = 0;
  let frames = 0;
  const take = () => {
    const element = document.getElementById(ASK_LUKE_INPUT_ID);
    if (element && getComputedStyle(element).visibility === "visible") {
      element.focus({ preventScroll: true });
      return;
    }
    if (frames++ > FOCUS_FRAME_LIMIT) return;
    frame = requestAnimationFrame(take);
  };
  take();
  return () => cancelAnimationFrame(frame);
}

/**
 * Carries one typed ask to the conversation. Answers with why it could not be
 * sent, or with nothing when it was. The reason has already been drawn by the
 * conversation itself — on the caption strip, where the reply would have
 * landed — so the composer reads the answer only to decide whether the draft
 * stays.
 */
export type AskHandler = (text: string) => Promise<string | undefined>;

/**
 * Why an ask could not be opened, said in one sentence the field can show.
 *
 * The refusal is diagnosed from the same fact the settings rows draw — how
 * far the voice loop got — so the sentence on the strip and the rows in
 * settings can never tell two different stories. The microphone permission
 * has no say here: typing opens no capture device, and the reply arrives on
 * the call's receiving half, so a typed ask goes whether or not the system
 * would let a press capture. A failure's own message is not repeated here:
 * it lands on the caption strip directly below, where the reply would have.
 *
 * `unavailableNote` lets a hosted refusal stay neutral instead of sending a
 * signed-in developer to connect a key they do not need.
 */
export function askRefusal(status: RealtimeStatus, unavailableNote?: string): string {
  if (status === REALTIME_STATUS.LISTENING) {
    return "The microphone is open. Finish saying it.";
  }
  if (status === REALTIME_STATUS.UNAVAILABLE) {
    return unavailableNote ?? "Sign in, or connect an OpenAI key, in Settings.";
  }
  if (status === REALTIME_STATUS.CONNECTING) {
    return "Still connecting. Ask again in a moment.";
  }
  if (status === REALTIME_STATUS.FAILED) {
    return "The conversation could not be opened.";
  }
  return "Luke could not take that just now.";
}

/**
 * The panel's own composer: one pill at the foot of the sessions list and of
 * the History thread alike, addressed to Luke rather than to any session.
 * Typing is the developer's half of the conversation, so the pill answers in
 * their green — the colour the meter gives their voice — and the reply lands
 * as Luke's spoken words, captioned at the panel's foot directly below the
 * field that asked, and as a bubble in the thread the History tab draws.
 *
 * Sending is deliberately quiet. A sent ask clears the field and nothing else:
 * the reply beginning is the confirmation, and a line saying "sent" would sit
 * between the question and its answer. Only a refusal earns a sentence, and
 * that sentence is not the pill's to draw: the conversation lands it on the
 * caption strip directly below, in the notice tone — the reply's own place,
 * so a refusal reads like every other answer. The draft stays through one,
 * because a refused ask is still the developer's words.
 *
 * The field wraps rather than scrolls sideways: an ask long enough to re-read
 * is worth seeing whole, so the pill grows a line at a time — each new line an
 * instant layout change the surface answers with one spring — up to the
 * stylesheet's cap, where the field starts scrolling instead. Enter still
 * sends; Shift-Enter breaks the line.
 */
export function AskLuke({
  ask,
  onEngagedChange,
  rowIndex,
  shortcut,
}: {
  ask: AskHandler;
  /**
   * Whether someone is part-way through an ask, which is what holds the panel
   * open against the pointer wandering off — the same hold a half-typed
   * credential has. The caret is the signal: a draft someone walked away from
   * is not a reason to pin the panel forever.
   */
  onEngagedChange: (engaged: boolean) => void;
  /** Where the field stands in the panel's arrival stack, after the rows. */
  rowIndex: number;
  /**
   * The accelerator the main process actually registered for summoning this
   * field, absent when every candidate was refused. The pill teaches only a
   * key that answers — a hint for a chord another app owns would be a lie.
   */
  shortcut?: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  /**
   * One ask at a time, as a ref rather than state for the same reason the row
   * composer holds one: disabling only lands with the next render, and a
   * second Enter inside that window would ask the same question twice.
   */
  const askInFlight = useRef(false);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || askInFlight.current) return;
    askInFlight.current = true;
    setAsking(true);
    try {
      // A refusal keeps the draft — a refused ask is still the developer's
      // words — and needs nothing drawn here: the conversation has already
      // landed the sentence on the caption strip below.
      const reason = await ask(text);
      // What the ask carried never travels; whether it reached a conversation
      // at all does, because a field people type into and are refused by is
      // indistinguishable from one nobody uses without it.
      window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.ASK_SUBMIT, {
        ask_outcome: reason ? PRODUCT_ASK_OUTCOME.REFUSED : PRODUCT_ASK_OUTCOME.SENT,
      });
      if (!reason) {
        // The ask has become the conversation's; the field empties for the
        // next one, and the caret stays for it.
        setDraft("");
      }
    } finally {
      askInFlight.current = false;
      setAsking(false);
    }
  }, [ask, draft]);

  return (
    <div className="ask-luke-row" style={cssCustomProperties({ "--row-index": rowIndex })}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only by design — the keyboard already lands in the field by tabbing, and the click handler only places the caret. */}
      <form
        className="ask-luke"
        data-asking={String(asking)}
        data-draft={String(draft.length > 0)}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        // The whole pill is the field: a press on its padding or its glow is
        // someone reaching for the caret, so the caret is what they get.
        onClick={() => field.current?.focus()}
      >
        <textarea
          ref={field}
          id={ASK_LUKE_INPUT_ID}
          className="ask-luke-input"
          aria-label="Ask Luke"
          {...(shortcut ? { "aria-keyshortcuts": shortcut } : undefined)}
          placeholder={ASK_PLACEHOLDER}
          autoComplete="off"
          spellCheck={false}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            // The panel can be showing without its window being key, and a
            // field that cannot be typed into is worse than no field.
            window.sidecar.focusPanel();
            onEngagedChange(true);
          }}
          onBlur={() => onEngagedChange(false)}
          onKeyDown={(event) => {
            // Escape lets go of the field rather than closing the panel
            // behind it. The draft survives: the field is not going anywhere.
            if (event.key === "Escape") {
              event.stopPropagation();
              event.currentTarget.blur();
              return;
            }
            // Enter is the send a one-line field taught, kept though the field
            // wraps; Shift-Enter is the line break, the way every chat
            // composer splits the two. A textarea's Enter does not submit
            // the form on its own, so the send is asked for here — but not
            // mid-composition: an IME's Enter is choosing a character, not
            // taking a turn.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {/* How the reach is learned: the keycaps surface under a hovering
            pointer and stand down once the caret is in or a draft holds the
            field — whoever they could teach already knows. Drawn only for a key
            the system actually granted, as the separate keys a hand presses.
            Left readable: a reader announcing the caps agrees with
            aria-keyshortcuts. */}
        {shortcut ? <Keycaps className="ask-luke-hint" accelerator={shortcut} /> : null}
        <button
          type="submit"
          className="ask-luke-send"
          aria-label="Ask Luke"
          title="Ask Luke"
          disabled={asking || !draft.trim()}
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
