/**
 * The introduction's beats and the script each one speaks, as one pure
 * transition table. The takeover component owns the clocks, the voice, and
 * the drawing; what belongs here is the order of the moments and the words
 * fixed by the build — so the one flow that plays before any account exists
 * can be tested without a window, a call, or a microphone.
 */

export const INTRODUCTION_BEAT = {
  /** The desktop dims, the tone rises, the voice connects in the background. */
  DARK: "dark",
  /** The smile draws itself and the eyes blink open. */
  WAKE: "wake",
  /** "Hi! I'm Luke." */
  HELLO: "hello",
  /** The keyless peek answers and the detected rows materialize. */
  DETECT: "detect",
  /** The scrim lifts and everything springs up into the notch. */
  FLIGHT: "flight",
  /**
   * The flight's quiet twin, for a voice that never stood up: no line was or
   * will be spoken, so Luke glides from the centre straight toward the
   * capsule and the ordinary gate — the room tone fading under the sweep
   * rather than being cut with the window.
   */
  GLIDE: "glide",
  /** The landed panel holds and the staged "needs you" moment plays. */
  TOUR: "tour",
  /** Luke asks before macOS does. */
  MICROPHONE: "microphone",
  /**
   * macOS's own dialog is up: the landed panel stands aside to the waiting
   * slot for as long as the ask stands — the same pill a calendar consent
   * stands down to — and springs back the moment it is answered.
   */
  MICROPHONE_DIALOG: "microphone-dialog",
  /** The panel back up, the refusal answered kindly. */
  MICROPHONE_DENIED: "microphone-denied",
  /** The talk key is drawn and a real spoken exchange happens. */
  PRACTICE: "practice",
  /** The sign-off line, spoken over the landed panel with the voice still up. */
  SIGN_OFF: "sign-off",
  /** The landed panel stands down to the capsule, rows first, shape after. */
  STAND_DOWN: "stand-down",
  /** The takeover fades over the real capsule, whose greeting then expands. */
  DONE: "done",
} as const;

export type IntroductionBeat = (typeof INTRODUCTION_BEAT)[keyof typeof INTRODUCTION_BEAT];

export const INTRODUCTION_EVENT = {
  VOICE_READY: "voice-ready",
  VOICE_FAILED: "voice-failed",
  /** The dark has held long enough on its own clock; the wake need not wait. */
  DARK_SETTLED: "dark-settled",
  WAKE_DONE: "wake-done",
  /** Every line the current beat had to say has been spoken to the end. */
  LINES_DONE: "lines-done",
  FLIGHT_SETTLED: "flight-settled",
  MICROPHONE_GRANTED: "microphone-granted",
  /** macOS's dialog was refused; the kind answer has not been spoken yet. */
  MICROPHONE_DENIED: "microphone-refused",
  /** The refusal was answered kindly and the answer has finished. */
  MICROPHONE_DENIED_SAID: "microphone-denied-said",
  /** The practice exchange was answered, or its patience ran out. */
  PRACTICE_DONE: "practice-done",
  /** The landed panel has finished standing down to the capsule. */
  STOOD_DOWN: "stood-down",
} as const;

export type IntroductionEvent = (typeof INTRODUCTION_EVENT)[keyof typeof INTRODUCTION_EVENT];

/**
 * Where each event moves each beat. An event a beat does not name leaves it
 * standing — the component fires clocks and callbacks freely, and only the
 * table decides which of them matter where. Total over the beats, so a new
 * beat does not build until this table has answered for it; the three rows
 * with no entries move only on the cross-cutting events below.
 */
const TRANSITIONS = {
  [INTRODUCTION_BEAT.DARK]: {
    // Whichever comes first wakes him: the voice standing up, or the dark
    // simply having held long enough — the wake plays while the call is
    // still connecting, and the first spoken line waits on the call instead.
    [INTRODUCTION_EVENT.VOICE_READY]: INTRODUCTION_BEAT.WAKE,
    [INTRODUCTION_EVENT.DARK_SETTLED]: INTRODUCTION_BEAT.WAKE,
  },
  [INTRODUCTION_BEAT.WAKE]: {
    [INTRODUCTION_EVENT.WAKE_DONE]: INTRODUCTION_BEAT.HELLO,
  },
  [INTRODUCTION_BEAT.HELLO]: {
    [INTRODUCTION_EVENT.LINES_DONE]: INTRODUCTION_BEAT.DETECT,
  },
  [INTRODUCTION_BEAT.DETECT]: {
    [INTRODUCTION_EVENT.LINES_DONE]: INTRODUCTION_BEAT.FLIGHT,
  },
  [INTRODUCTION_BEAT.FLIGHT]: {
    [INTRODUCTION_EVENT.FLIGHT_SETTLED]: INTRODUCTION_BEAT.TOUR,
  },
  [INTRODUCTION_BEAT.GLIDE]: {
    [INTRODUCTION_EVENT.FLIGHT_SETTLED]: INTRODUCTION_BEAT.STAND_DOWN,
  },
  [INTRODUCTION_BEAT.TOUR]: {
    [INTRODUCTION_EVENT.LINES_DONE]: INTRODUCTION_BEAT.MICROPHONE,
  },
  [INTRODUCTION_BEAT.MICROPHONE]: {
    // A grant or refusal already standing needs no dialog: the beat's own
    // probe short-circuits straight past the aside.
    [INTRODUCTION_EVENT.MICROPHONE_GRANTED]: INTRODUCTION_BEAT.PRACTICE,
    [INTRODUCTION_EVENT.MICROPHONE_DENIED_SAID]: INTRODUCTION_BEAT.SIGN_OFF,
    // The warning spoken, macOS asks next — and the panel gets out of its way.
    [INTRODUCTION_EVENT.LINES_DONE]: INTRODUCTION_BEAT.MICROPHONE_DIALOG,
  },
  [INTRODUCTION_BEAT.MICROPHONE_DIALOG]: {
    [INTRODUCTION_EVENT.MICROPHONE_GRANTED]: INTRODUCTION_BEAT.PRACTICE,
    [INTRODUCTION_EVENT.MICROPHONE_DENIED]: INTRODUCTION_BEAT.MICROPHONE_DENIED,
  },
  [INTRODUCTION_BEAT.MICROPHONE_DENIED]: {
    [INTRODUCTION_EVENT.MICROPHONE_DENIED_SAID]: INTRODUCTION_BEAT.SIGN_OFF,
  },
  [INTRODUCTION_BEAT.PRACTICE]: {
    [INTRODUCTION_EVENT.PRACTICE_DONE]: INTRODUCTION_BEAT.SIGN_OFF,
  },
  [INTRODUCTION_BEAT.SIGN_OFF]: {
    [INTRODUCTION_EVENT.LINES_DONE]: INTRODUCTION_BEAT.STAND_DOWN,
  },
  [INTRODUCTION_BEAT.STAND_DOWN]: {
    [INTRODUCTION_EVENT.STOOD_DOWN]: INTRODUCTION_BEAT.DONE,
  },
  [INTRODUCTION_BEAT.DONE]: {},
} as const satisfies Record<IntroductionBeat, Partial<Record<IntroductionEvent, IntroductionBeat>>>;

function eventTarget(
  row: Partial<Record<IntroductionEvent, IntroductionBeat>>,
  event: IntroductionEvent,
): IntroductionBeat | undefined {
  return row[event];
}

/**
 * The beats a voice failure sends through the quiet glide rather than the
 * stand-down: nothing has flown yet, so Luke still has his whole journey —
 * centre to capsule to the ordinary gate — to make gracefully.
 */
const PRE_FLIGHT_BEATS: ReadonlySet<IntroductionBeat> = new Set([
  INTRODUCTION_BEAT.DARK,
  INTRODUCTION_BEAT.WAKE,
  INTRODUCTION_BEAT.HELLO,
  INTRODUCTION_BEAT.DETECT,
]);

/**
 * The next beat. One event cuts across the table: the voice failing ends the
 * introduction honestly and gracefully — the quiet glide while the stage has
 * not flown, the stand-down once it has — because the real signed-out gate
 * needs no voice, and a takeover cut mid-note would make a refused quota
 * feel like a crash.
 */
export function nextIntroductionBeat(
  beat: IntroductionBeat,
  event: IntroductionEvent,
): IntroductionBeat {
  if (beat === INTRODUCTION_BEAT.DONE) return beat;
  if (event === INTRODUCTION_EVENT.VOICE_FAILED) {
    return PRE_FLIGHT_BEATS.has(beat) ? INTRODUCTION_BEAT.GLIDE : INTRODUCTION_BEAT.STAND_DOWN;
  }
  return eventTarget(TRANSITIONS[beat], event) ?? beat;
}

/**
 * How many detected sessions' titles may travel to the voice. The drawn list
 * is unbounded — the developer's own sessions on their own screen, scrolling
 * exactly as the panel's list does — but what leaves the machine stays a
 * first impression, not an inventory: the panel's own visible depth.
 */
export const INTRODUCTION_SPOKEN_SESSION_LIMIT = 5;

/**
 * The script, as directions to the voice rather than text to display: the
 * introduction is entirely spoken, so these lines never render. Quoted words
 * are kept exactly; the rest is said in Luke's own voice.
 */
export const INTRODUCTION_SCRIPT = {
  // Where Luke lives is said after he has flown there, not before: the words
  // and the screen must agree.
  HELLO: [
    'Say exactly: "Hi! I\'m Luke."',
    'Say close to: "I keep an eye on your coding agents — so you don\'t have to."',
  ],
  DETECT_FOUND: [
    "The developer's own coding agent sessions just appeared on screen; their titles are in the data. " +
      'Say close to: "These are your coding agents. I can already see them from here." ' +
      "Then mention one or two of them by title, briefly.",
  ],
  DETECT_PRETEND: [
    "No local sessions were found, so pretend example rows are on screen instead. " +
      "Say that these ones are pretend, until their real coding agents show up — " +
      "and that this is what their agents will look like from here.",
  ],
  TOUR_HOME: [
    "The whole stage just flew up and settled at the top of the screen, beside the notch. " +
      'Say close to: "And this is where I live — right up here, next to the notch."',
  ],
  TOUR: [
    'One of the rows just flipped to "Needs you", with a ding. ' +
      'Say close to: "When one of them needs you — like this — I say so."',
  ],
  MICROPHONE: [
    "Say close to: \"Want to be able to talk to me? Your Mac's about to ask about the " +
      "microphone — I only hear you while you're holding the talk key.\"",
  ],
  MICROPHONE_DENIED: [
    "The developer declined the microphone. Say kindly that that is fine, it lives in settings " +
      "if they change their mind — and even then Luke only hears them while the talk key is " +
      "held — and Luke will still tap them on the shoulder up here.",
  ],
  PRACTICE: ['Say close to: "Hold Option Space and ask me anything."'],
  SIGN_OFF: ['Say close to: "One last thing — sign in, and I\'m all yours."'],
} as const;
