import {
  getShaderColorFromString,
  meshGradientFragmentShader,
  ShaderMount,
} from "@paper-design/shaders";
import {
  CloseIcon,
  CopyIcon,
  MicrophoneIcon,
  OptionsIcon,
  PlusIcon,
  WingFace,
} from "@sidecar/panel";
import { useEffect, useRef, useState } from "react";

/**
 * The hero visual: a CSS recreation of Luke's app window, ported from
 * `apps/desktop/src/renderer/desktop`. It draws the reference plan from
 * `docs/PLANNING.md` partway through a planning call: the sidebar of plans,
 * the open plan's document with the notetaker typing a field in, and the call
 * bar with Luke's question over it.
 *
 * The typing loops: it types the field, holds it long enough to be read, and
 * starts over. Under reduced motion nothing loops and the field stands whole.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The typing's clock. Faster than the product's 12 characters a second,
 * because a visitor gives the hero seconds rather than a whole call.
 */
const TYPING = {
  START_MS: 1200,
  TICK_MS: 40,
  CHARACTERS_PER_TICK: 2,
  HOLD_MS: 5000,
} as const;

/**
 * The display the window sits on, painted by Paper's mesh gradient: bundled
 * and pinned, so the page carries its own shader instead of fetching one at
 * runtime. The palette runs indigo into the product's cyan with one violet
 * spot: bright enough that the dark window cuts a hard silhouette, dark
 * enough that the art stays a backdrop rather than a rival.
 */
const BACKDROP_COLORS = ["#0c1430", "#20308f", "#5cd5ff", "#123f6e", "#7a5cff"];
const BACKDROP_DISTORTION = 0.85;
const BACKDROP_SWIRL = 0.5;
const BACKDROP_SPEED = 0.5;

/** The sidebar's plans, the open one first, each with its folder line. */
const MOCK_PLANS = [
  { name: "Teammate invitations", folder: "~/code/relay" },
  { name: "Billing export", folder: "~/code/ledger" },
  { name: "Dark mode toggle", folder: "~/code/relay" },
] as const;

const OPEN_PLAN = MOCK_PLANS[0];

/** The fields already written, in the template's order. */
const WRITTEN_FIELDS = [
  {
    section: "Goal",
    heading: "Problem",
    text: "Only an admin can add someone to a workspace, so members wait on an admin.",
  },
  {
    section: "Rules",
    heading: "Accepted links are spent",
    text: "A withdrawn or accepted invite link never grants access again.",
    example:
      "Given an accepted invite, when anyone opens its link again, it says the invite is no longer valid.",
  },
] as const;

/** The field the notetaker types in while the call goes on. */
const TYPED_FIELD = {
  section: "Decisions",
  text: "Store an invite as a memberships row with state = pending. Rejected: a separate invitations table.",
} as const;

const ASSUMPTIONS = [
  "Members and admins can both invite.",
  "An invite expires after 7 days.",
] as const;

/** What Luke is saying on the call, drawn where the window draws its captions. */
const CAPTION =
  "Okay, pending memberships it is. Who should be able to withdraw an invite: whoever sent it, any admin, or both?";

const MOCK_LABEL = `Luke's app window with the plan "${OPEN_PLAN.name}" open and being written during a voice call, while Luke asks: ${CAPTION}`;

/** The window's three traffic lights, drawn for the silhouette alone. */
function TrafficLights(): React.JSX.Element {
  return (
    <span className="traffic-lights">
      <i />
      <i />
      <i />
    </span>
  );
}

/** The call bar's three waiting dots, as the product draws them. */
function ThinkingDots(): React.JSX.Element {
  return (
    <span className="thinking-dots">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Luke's meter beside his name while he speaks: five bars on a loop of their own. */
function Waveform(): React.JSX.Element {
  return (
    <span className="waveform">
      <span className="waveform-bar" />
      <span className="waveform-bar" />
      <span className="waveform-bar" />
      <span className="waveform-bar" />
      <span className="waveform-bar" />
    </span>
  );
}

/**
 * How much of the typed field shows. It types, holds, and starts over, and
 * stands whole under reduced motion.
 */
function useTypedLength(): number {
  const [length, setLength] = useState(0);
  useEffect(() => {
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      setLength(TYPED_FIELD.text.length);
      return;
    }
    let timer: number;
    const type = (shown: number) => {
      setLength(shown);
      const done = shown >= TYPED_FIELD.text.length;
      const next = done ? 0 : Math.min(shown + TYPING.CHARACTERS_PER_TICK, TYPED_FIELD.text.length);
      const wait = done ? TYPING.HOLD_MS : shown === 0 ? TYPING.START_MS : TYPING.TICK_MS;
      timer = window.setTimeout(() => type(next), wait);
    };
    type(0);
    return () => window.clearTimeout(timer);
  }, []);
  return length;
}

export function WindowMock(): React.JSX.Element {
  const typedLength = useTypedLength();
  const typing = typedLength < TYPED_FIELD.text.length;

  // Mounted imperatively because ShaderMount owns its canvas. Reduced motion
  // holds the gradient at its first frame rather than hiding it — a still
  // image is not motion — and the query is watched live, so toggling the
  // setting mid-visit answers like the rest of the mock does. A machine
  // without WebGL throws here, leaving the frame's own gradient as the
  // display.
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = backdrop.current;
    if (!host) return;
    const reduceMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    let mount: ShaderMount | undefined;
    try {
      mount = new ShaderMount(
        host,
        meshGradientFragmentShader,
        {
          u_fit: 1,
          u_scale: 1,
          u_rotation: 0,
          u_originX: 0.5,
          u_originY: 0.5,
          u_offsetX: 0,
          u_offsetY: 0,
          u_worldWidth: 0,
          u_worldHeight: 0,
          u_colors: BACKDROP_COLORS.map((color) => getShaderColorFromString(color)),
          u_colorsCount: BACKDROP_COLORS.length,
          u_distortion: BACKDROP_DISTORTION,
          u_swirl: BACKDROP_SWIRL,
          u_grainMixer: 0,
          u_grainOverlay: 0,
        },
        undefined,
        reduceMotion.matches ? 0 : BACKDROP_SPEED,
      );
    } catch {
      // Nothing to do: the backdrop div stays empty over the frame.
    }
    const applySpeed = () => mount?.setSpeed(reduceMotion.matches ? 0 : BACKDROP_SPEED);
    reduceMotion.addEventListener("change", applySpeed);
    return () => {
      reduceMotion.removeEventListener("change", applySpeed);
      mount?.dispose();
    };
  }, []);

  return (
    <div className="mock-stage">
      {/* One labelled image: nothing inside is a control, so the whole
          recreation reads as a single illustration. */}
      <div className="mock" role="img" aria-label={MOCK_LABEL}>
        <span className="mock-frame" />
        <div className="mock-backdrop" ref={backdrop} />

        <div className="mock-window" inert>
          <aside className="desktop-sidebar">
            <TrafficLights />
            <div className="luke-identity">
              <span className="luke-identity-face">
                <WingFace />
              </span>
              <span className="luke-identity-copy">
                <span className="luke-identity-name">Luke</span>
                <span className="luke-identity-status">Speaking</span>
              </span>
              <Waveform />
            </div>
            <span className="sidebar-new-plan">
              <PlusIcon />
              New plan
            </span>
            <h2 className="sidebar-heading">Plans</h2>
            <ul className="sidebar-plans">
              {MOCK_PLANS.map((plan) => (
                <li
                  className="sidebar-plan"
                  data-current={String(plan === OPEN_PLAN)}
                  key={plan.name}
                >
                  <span className="sidebar-plan-name">{plan.name}</span>
                  <span className="sidebar-plan-repository">{plan.folder}</span>
                </li>
              ))}
            </ul>
            <span className="sidebar-item">
              <OptionsIcon />
              Settings
            </span>
          </aside>

          <main className="desktop-main">
            <header className="desktop-toolbar">
              <span className="desktop-toolbar-heading">
                <span className="desktop-toolbar-title">{OPEN_PLAN.name}</span>
                <span className="desktop-toolbar-subtitle">{OPEN_PLAN.folder}</span>
              </span>
              <span className="toolbar-button">
                <CopyIcon />
                Copy plan
              </span>
              <span className="toolbar-icon-button">
                <CloseIcon />
              </span>
            </header>

            <div className="plan-document-scroll">
              {WRITTEN_FIELDS.map((field) => (
                <div className="plan-unit" key={field.section}>
                  <h3 className="plan-section">{field.section}</h3>
                  <h4 className="plan-field-heading">{field.heading}</h4>
                  <p>{field.text}</p>
                  {"example" in field ? <p className="plan-example">{field.example}</p> : null}
                </div>
              ))}
              <div className="plan-unit" data-writing={String(typing)}>
                <h3 className="plan-section">{TYPED_FIELD.section}</h3>
                <p>
                  {TYPED_FIELD.text.slice(0, typedLength)}
                  <span className="plan-caret" />
                </p>
              </div>
              <div className="plan-assumptions">
                <h3 className="plan-assumptions-heading">Assumptions</h3>
                <ul>
                  {ASSUMPTIONS.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Luke's words float over the work column, above the call bar. */}
            <p className="voice-caption">{CAPTION}</p>

            <footer className="desktop-call-bar">
              <span className="plan-microphone">
                <MicrophoneIcon />
              </span>
              <span className="plan-voice-status">
                <span className="plan-voice-word">Speaking</span>
                {typing ? (
                  <span className="plan-backend">
                    <ThinkingDots />
                    Notetaker · Writing notes
                  </span>
                ) : null}
              </span>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
