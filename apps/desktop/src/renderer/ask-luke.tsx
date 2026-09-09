import { PRODUCT_ASK_OUTCOME, PRODUCT_SURFACE_EVENT } from "@sidecar/analytics";
import { SendIcon, StopIcon } from "@sidecar/panel";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useCallback, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { tell } from "./act";
import { focusSeek } from "./focus-seek";
import { Keycaps } from "./keycaps";

/**
 * What the field is for, in the fewest words that say it. "Ask" rather than
 * "message": Luke answers rather than receives, and the reply arrives out
 * loud with its words landing right below the field.
 */
const ASK_PLACEHOLDER = "Ask Luke…";

/** The disc's two names: the field's own ask, and the stop of a run of Luke's still going. */
const SEND_LABEL = "Ask Luke";
export const STOP_LABEL = "Stop Luke's reply";

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
 * the field it is reaching for may not be drawn until React has answered — and
 * a hidden stage refuses focus outright, which is the trap every seek waits
 * out.
 */
export function focusAskField(): () => void {
  return focusSeek({
    find: () => document.getElementById(ASK_LUKE_INPUT_ID),
    act: (element) => element.focus({ preventScroll: true }),
  });
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
 * The panel's own composer: one pill at the foot of the sessions list and of
 * the Conversation thread alike, addressed to Luke rather than to any session.
 * Typing is the developer's half of the conversation, so the pill answers in
 * their green — the colour the meter gives their voice — and the reply lands
 * as Luke's spoken words, captioned at the panel's foot directly below the
 * field that asked, and as a bubble in the thread the Conversation tab draws.
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
 *
 * While a run of Luke's is still going, the disc is its stop: the same control
 * in the same place, changing colour and glyph rather than anything arriving
 * beside the field, and Escape in the field presses it. The disc is the one
 * element both tabs share, so a run opened from either tab or the ask key can
 * be stopped from wherever the hand already is. An ask typed meanwhile still
 * sends, and joins the turn under way as the brain's queue has it.
 */
export function AskLuke({
  ask,
  onEngagedChange,
  rowIndex,
  shortcut,
  thinking = false,
  onStop,
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
  /** Whether a run of Luke's is still going, which makes the disc its stop. */
  thinking?: boolean;
  /** Stops every run still going, at the disc's press or Escape in the field. */
  onStop?: () => void;
}): React.JSX.Element {
  const stopping = thinking && onStop !== undefined;
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
        data-turn={stopping ? "luke" : "you"}
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
            tell(ACT_KIND.WINDOW_FOCUS_PANEL);
            onEngagedChange(true);
          }}
          onBlur={() => onEngagedChange(false)}
          onKeyDown={(event) => {
            // Escape lets go of the field rather than closing the panel
            // behind it. The draft survives: the field is not going anywhere.
            // While Luke is still working it stops him first, and the caret
            // stays: quiet is what was asked for, not leaving.
            if (event.key === "Escape") {
              event.stopPropagation();
              if (stopping) {
                onStop();
                return;
              }
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
        {/* One button in both of its states, so the disc neither remounts nor
            loses focus when the turn changes hands. */}
        <button
          type={stopping ? "button" : "submit"}
          className="ask-luke-send"
          aria-label={stopping ? STOP_LABEL : SEND_LABEL}
          title={stopping ? STOP_LABEL : SEND_LABEL}
          disabled={!stopping && (asking || !draft.trim())}
          {...(stopping ? { onClick: onStop } : undefined)}
        >
          {stopping ? <StopIcon /> : <SendIcon />}
        </button>
      </form>
    </div>
  );
}
