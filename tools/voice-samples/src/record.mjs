/**
 * record.mjs -- records the clip Settings plays for each voice, from GPT-Live itself.
 *
 * Run it on a Mac, from the repository root, after bootstrapping:
 *
 *   OPENAI_API_KEY=… pnpm --filter @luke/voice-samples record [voice …]
 *
 * With no voice named it records every voice `@luke/live` offers. Each is
 * spoken by the model and voice a call uses, over the Live WebSocket, so a
 * preview sounds as the voice does in a call rather than as a text-to-speech
 * model's reading of it. The model is asked to say the voice's own line
 * (`SCRIPTS`), in English, a voice made for another language ending on a
 * short sign-off in it. A take whose transcript is not close to that line is
 * recorded again, and a voice that never says it fails the run. The audio is trimmed of the quiet around it, brought
 * to one level, and written as AAC in an MPEG-4 file (`afconvert`, which every Mac has) under
 * `packages/panel/voices/`, the folder the panel serves (its `build-table.mjs`).
 *
 * Note that this runs by hand, never in a check: it spends the key's money and
 * reaches the network, and its output is committed.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Note that the vocabulary is read from its source rather than through `@luke/live`, because
// Node strips the types of one TypeScript file but resolves no `.js` specifier to a `.ts` one.
import {
  LIVE_DEFAULTS,
  LIVE_VOICE_LANGUAGE,
  LIVE_VOICE_LIST,
  LIVE_VOICE_PROFILE,
} from "../../../packages/live/src/voices.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const VOICES_DIRECTORY = path.join(repositoryRoot, "packages/panel/voices");

/** The name of each language the model is told a voice's sign-off is in. */
const LANGUAGE_NAME = new Map([
  [LIVE_VOICE_LANGUAGE.PORTUGUESE, "Brazilian Portuguese"],
  [LIVE_VOICE_LANGUAGE.FRENCH, "French"],
  [LIVE_VOICE_LANGUAGE.GERMAN, "German"],
  [LIVE_VOICE_LANGUAGE.HINDI, "Hindi"],
  [LIVE_VOICE_LANGUAGE.JAPANESE, "Japanese"],
  [LIVE_VOICE_LANGUAGE.KOREAN, "Korean"],
]);

/**
 * What each voice says: a line of its own, so the list is a set of
 * introductions rather than one sentence read thirty-one times, each about
 * as long as the others so no voice is judged on more words. Every line is
 * English, since Luke's calls are, and a voice made for another language
 * ends on a short sign-off in it (`signOff`), a nod to what it is made for
 * that leaves no doubt Luke speaks English. A voice with no line here fails
 * the run rather than saying another's.
 */
const SCRIPTS = new Map([
  [
    "alloy",
    {
      line: "Hey, I'm Luke. Walk me through what you're building, and I'll keep the plan tidy as we go.",
    },
  ],
  [
    "ash",
    {
      line: "Hi there. Tell me the problem in your own words, and we'll turn it into a plan together.",
    },
  ],
  [
    "ballad",
    {
      line: "Good to meet you. Talk it through out loud, and I'll write down every decision we make.",
    },
  ],
  [
    "cedar",
    { line: "Hey. What are we working on today? Think out loud, and I'll take the notes." },
  ],
  [
    "coral",
    { line: "Hi! Got a bug, a feature, or just a hunch? Tell me, and I'll sketch out the plan." },
  ],
  [
    "echo",
    {
      line: "Hey there. Start anywhere you like, and I'll shape what you say into clear next steps.",
    },
  ],
  [
    "marin",
    {
      line: "Hi, I'm Luke. Tell me what you're working on, and I'll write the plan down as we talk.",
    },
  ],
  [
    "sage",
    {
      line: "Hello. Let's take a breath and think it through. I'll capture the plan while you talk.",
    },
  ],
  [
    "shimmer",
    {
      line: "Hi, I'm Luke. Describe what's on your mind, and I'll turn it into a plan you can ship.",
    },
  ],
  [
    "verse",
    {
      line: "Hey, ready when you are. Talk me through the task, and I'll keep track of the details.",
    },
  ],
  [
    "gleam",
    {
      line: "Hi! Let's figure this out together. Tell me what you need, and I'll write it all up.",
    },
  ],
  [
    "meridian",
    {
      line: "Hey, I'm Luke. Give me the big picture first, and we'll work our way down to the details.",
    },
  ],
  [
    "cinder",
    {
      line: "Well, hey there. Tell me what you're fixing, and I'll keep the plan straight for you.",
    },
  ],
  [
    "delta",
    { line: "Hey there, I'm Luke. Take your time, tell me the task, and I'll write up the plan." },
  ],
  [
    "vesper",
    {
      line: "Hello, I'm Luke. Tell me what you're after, and I'll keep a careful note of the plan.",
    },
  ],
  [
    "stone",
    {
      line: "Hi, I'm Luke. Tell me where you're stuck, and we'll work out the next step together.",
    },
  ],
  [
    "willow",
    { line: "Hello there. Talk me through your idea, and I'll shape it into a proper plan." },
  ],
  [
    "quartz",
    { line: "Hi, I'm Luke. Tell me what's on the list today, and I'll sort it into a plan." },
  ],
  [
    "ripple",
    { line: "G'day, I'm Luke. Run me through the job, and I'll jot the plan down as we go." },
  ],
  [
    "beacon",
    { line: "Hello, I'm Luke. Share what you're working on, and I'll map out the steps with you." },
  ],
  [
    "bossa",
    {
      line: "Hi, I'm Luke. Tell me your idea, and I'll turn it into a plan.",
      signOff: "Vamos lá!",
    },
  ],
  [
    "tempo",
    {
      line: "Hey, I'm Luke. Tell me the task, and I'll have the plan drafted in no time.",
      signOff: "Bora!",
    },
  ],
  [
    "brise",
    {
      line: "Hi, I'm Luke. Tell me what you're making, and I'll write the plan as we talk.",
      signOff: "À vous !",
    },
  ],
  [
    "sillage",
    {
      line: "Hello, I'm Luke. Walk me through it, and I'll follow along with the plan.",
      signOff: "Allons-y !",
    },
  ],
  [
    "nuri",
    {
      line: "Hi, I'm Luke. Tell me where to start, and I'll keep the plan in order.",
      signOff: "Los geht's!",
    },
  ],
  [
    "juni",
    {
      line: "Hey, I'm Luke. Share your idea, and I'll write the plan down for you.",
      signOff: "Ich höre zu!",
    },
  ],
  [
    "flitz",
    {
      line: "Hi, I'm Luke. Give me the task, and we'll have a plan before you know it.",
      signOff: "Auf geht's!",
    },
  ],
  [
    "nira",
    {
      line: "Hi, I'm Luke. Tell me what you're working on, and I'll note the plan.",
      signOff: "चलिए, शुरू करते हैं!",
    },
  ],
  [
    "harema",
    {
      line: "Hi, I'm Luke. Tell me about your project, and I'll write up the plan.",
      signOff: "よろしくね！",
    },
  ],
  [
    "shida",
    {
      line: "Hello, I'm Luke. Tell me the task, and I'll lay out the plan for you.",
      signOff: "始めましょう！",
    },
  ],
  [
    "noeul",
    {
      line: "Hi, I'm Luke. Tell me what you need, and I'll write the plan with you.",
      signOff: "같이 해 봐요!",
    },
  ],
]);

/**
 * How close a take's transcript must come to its line, as the share of the
 * line's letters it matches. Note that this is not an exact match, because
 * a transcript of Japanese or Hindi may spell a word in another of its
 * scripts while the speech is right.
 */
const LEAST_LIKENESS = 0.8;

const LIVE_URL = "wss://api.openai.com/v1/live/sessions";
const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2;
/** How much silence is sent as the microphone each step, paced in real time as the guide asks. */
const INPUT_STEP_MS = 100;
/**
 * How long the model's audio may stay quiet, once it has spoken, before the
 * take is over. Note that this is measured on the audio's level rather than
 * on when audio arrives, because the session sends its silence too.
 */
const QUIET_AFTER_SPEECH_MS = 2_000;
const TAKE_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 15_000;
const TAKES_PER_VOICE = 5;
/** The level under which a sample counts as quiet when the take is trimmed, and the quiet kept either side. */
const QUIET_LEVEL = 400;
const TRIM_PAD_MS = 150;
/**
 * The level every clip is brought to, as the root mean square of its samples,
 * so one voice never sounds better than another by being louder; and the
 * peak that gain may not push a sample past.
 */
const TARGET_RMS = 0.1 * 32_767;
const PEAK_CEILING = 0.95 * 32_767;
const AAC_BIT_RATE = 48_000;

/** The letters and digits alone, in lowercase, so a take is compared on what was said and not on its punctuation or spacing. */
function lettersOf(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
}

/** How alike two texts' letters are: one less their edit distance over the longer one's length. */
function likeness(said, line) {
  const a = [...lettersOf(said)];
  const b = [...lettersOf(line)];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const swap = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      row.push(Math.min(previous[j] + 1, row[j - 1] + 1, swap));
    }
    previous = row;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length, 1);
}

/** What the voice says, its sign-off included, and the words the model is asked to say it in. */
function scriptOf(voice) {
  const script = SCRIPTS.get(voice);
  if (script === undefined) throw new Error(`${voice}: no line to say`);
  // Worded as the guide words a greeting, the one way it documents to have the model speak first.
  if (script.signOff === undefined) {
    return {
      line: script.line,
      instruction: `Greet the caller now in English by saying exactly this, and nothing more: ${script.line} Then pause and listen.`,
    };
  }
  const language = LANGUAGE_NAME.get(LIVE_VOICE_PROFILE[voice].language);
  return {
    line: `${script.line} ${script.signOff}`,
    instruction: `Greet the caller now by saying exactly this in English: ${script.line} Then end with this short sign-off in ${language}, and nothing more: ${script.signOff} Then pause and listen.`,
  };
}

/** Whether any sample of the PCM is louder than quiet. */
function audible(pcm) {
  for (let offset = 0; offset + 1 < pcm.length; offset += BYTES_PER_SAMPLE) {
    if (Math.abs(pcm.readInt16LE(offset)) > QUIET_LEVEL) return true;
  }
  return false;
}

/** The take's PCM without the quiet before and after the speech, keeping a short pad. */
function trimmed(pcm) {
  const samples = pcm.length / BYTES_PER_SAMPLE;
  const loud = (index) => Math.abs(pcm.readInt16LE(index * BYTES_PER_SAMPLE)) > QUIET_LEVEL;
  let first = 0;
  while (first < samples && !loud(first)) first += 1;
  let last = samples - 1;
  while (last > first && !loud(last)) last -= 1;
  const pad = Math.round((SAMPLE_RATE * TRIM_PAD_MS) / 1000);
  const start = Math.max(0, first - pad);
  const end = Math.min(samples, last + 1 + pad);
  return pcm.subarray(start * BYTES_PER_SAMPLE, end * BYTES_PER_SAMPLE);
}

/** The PCM brought to the target level, with less gain where that would clip its loudest sample. */
function leveled(pcm) {
  const samples = pcm.length / BYTES_PER_SAMPLE;
  let squares = 0;
  let peak = 1;
  for (let index = 0; index < samples; index += 1) {
    const sample = pcm.readInt16LE(index * BYTES_PER_SAMPLE);
    squares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(squares / Math.max(1, samples)) || 1;
  const gain = Math.min(TARGET_RMS / rms, PEAK_CEILING / peak);
  const out = Buffer.alloc(pcm.length);
  for (let index = 0; index < samples; index += 1) {
    out.writeInt16LE(
      Math.round(pcm.readInt16LE(index * BYTES_PER_SAMPLE) * gain),
      index * BYTES_PER_SAMPLE,
    );
  }
  return out;
}

/** Mono 16-bit PCM wrapped in a WAV header, which `afconvert` reads. */
function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * One take: a session in the voice, asked to say its line as the instruction
 * words it, with silence as its microphone, ended once the model has spoken
 * and gone quiet. Answers the audio and the transcript of what was said.
 */
function recordTake(voice, apiKey, instruction) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(LIVE_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    const audio = [];
    let transcript = "";
    let lastSpokeAt = 0;
    let microphone;
    let closing = false;
    const timers = [];
    const finish = (error) => {
      clearInterval(microphone);
      for (const timer of timers) clearTimeout(timer);
      closing = true;
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
      if (error) reject(error);
      else resolve({ pcm: Buffer.concat(audio), transcript });
    };
    const close = () => {
      if (closing) return;
      // A socket that never opened has no session to close, so the take fails rather than sending into it.
      if (socket.readyState !== WebSocket.OPEN) {
        finish(new Error(`${voice}: the connection never opened`));
        return;
      }
      closing = true;
      clearInterval(microphone);
      socket.send(JSON.stringify({ type: "session.close" }));
      timers.push(setTimeout(() => finish(), CLOSE_TIMEOUT_MS));
    };
    timers.push(setTimeout(close, TAKE_TIMEOUT_MS));
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "session.start",
          event_id: "start",
          session: {
            model: LIVE_DEFAULTS.MODEL,
            instructions:
              "You are recording a short sample of your voice. Speak warmly and naturally.",
            input: [
              {
                type: "message",
                role: "developer",
                content: [
                  {
                    type: "input_text",
                    text: instruction,
                  },
                ],
              },
            ],
            delegation: { type: "client" },
            store: false,
            audio: { format: { type: "audio/pcm", rate: SAMPLE_RATE }, output: { voice } },
          },
        }),
      );
    });
    socket.addEventListener("message", (message) => {
      const event = JSON.parse(String(message.data));
      if (event.type === "session.started") {
        const silence = Buffer.alloc((SAMPLE_RATE * BYTES_PER_SAMPLE * INPUT_STEP_MS) / 1000);
        microphone = setInterval(() => {
          if (closing) return;
          socket.send(
            JSON.stringify({
              type: "session.input_audio.append",
              audio: silence.toString("base64"),
            }),
          );
          if (lastSpokeAt > 0 && Date.now() - lastSpokeAt > QUIET_AFTER_SPEECH_MS) close();
        }, INPUT_STEP_MS);
      } else if (event.type === "session.output_audio.delta") {
        const chunk = Buffer.from(event.delta, "base64");
        audio.push(chunk);
        if (audible(chunk)) lastSpokeAt = Date.now();
      } else if (event.type === "session.output_transcript.delta") {
        transcript += event.delta;
      } else if (event.type === "session.closed") {
        finish();
      } else if (event.type === "error") {
        finish(new Error(`${voice}: ${JSON.stringify(event.error ?? event)}`));
      }
    });
    // Note that the socket reports an error as the service drops it after
    // `session.closed`, which is no failure once the take is closing.
    socket.addEventListener("error", () => {
      if (!closing) finish(new Error(`${voice}: the connection failed`));
    });
    socket.addEventListener("close", () => finish());
  });
}

/** Records the voice until a take says its line, and writes it as the voice's clip. */
async function recordVoice(voice, apiKey, scratch) {
  const { line, instruction } = scriptOf(voice);
  for (let take = 1; take <= TAKES_PER_VOICE; take += 1) {
    const recorded = await recordTake(voice, apiKey, instruction).catch((error) => {
      console.error(`${voice}: take ${take} failed: ${error.message}`);
      return undefined;
    });
    if (recorded === undefined) continue;
    const { pcm, transcript } = recorded;
    const alike = likeness(transcript, line);
    if (alike < LEAST_LIKENESS || pcm.length === 0) {
      console.error(
        `${voice}: take ${take} said ${JSON.stringify(transcript.trim())} (${alike.toFixed(2)})`,
      );
      continue;
    }
    const source = path.join(scratch, `${voice}.wav`);
    writeFileSync(source, wav(leveled(trimmed(pcm))));
    const clip = path.join(VOICES_DIRECTORY, `${voice}.m4a`);
    execFileSync("afconvert", [
      ...["-f", "m4af", "-d", "aac", "-b", String(AAC_BIT_RATE)],
      ...[source, clip],
    ]);
    console.error(`${voice}: ${clip}`);
    return;
  }
  throw new Error(`${voice}: no take said the line in ${TAKES_PER_VOICE} tries`);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY to record the voices.");
const asked = process.argv.slice(2);
const unknown = asked.filter((voice) => !LIVE_VOICE_LIST.includes(voice));
if (unknown.length > 0) throw new Error(`Not a Live voice: ${unknown.join(", ")}`);
mkdirSync(VOICES_DIRECTORY, { recursive: true });
const scratch = mkdtempSync(path.join(tmpdir(), "voice-samples-"));
try {
  for (const voice of asked.length > 0 ? asked : LIVE_VOICE_LIST) {
    await recordVoice(voice, apiKey, scratch);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
