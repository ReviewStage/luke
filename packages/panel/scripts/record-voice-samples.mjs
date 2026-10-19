/**
 * record-voice-samples.mjs -- records the clip Settings plays for each voice, from GPT-Live itself.
 *
 * Run it on a Mac, from the repository root, after bootstrapping:
 *
 *   OPENAI_API_KEY=… node packages/panel/scripts/record-voice-samples.mjs [voice …]
 *
 * With no voice named it records every voice `@luke/live` offers. Each is
 * spoken by the model and voice a call uses, over the Live WebSocket, so a
 * preview sounds as the voice does in a call rather than as a text-to-speech
 * model's reading of it. The model is asked to say one fixed line; a take
 * whose transcript is not that line is recorded again, and a voice that never
 * says it fails the run. The audio is trimmed of the quiet around it, brought
 * to one level, and written as AAC in an MPEG-4 file (`afconvert`, which every Mac has) under
 * `packages/panel/voices/`, the folder the panel serves (`build-table.mjs`).
 *
 * Note that this runs by hand, never in a check: it spends the key's money and
 * reaches the network, and its output is committed.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_DEFAULTS, LIVE_VOICE_LIST } from "../../live/src/voices.ts";

const panelRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOICES_DIRECTORY = path.join(panelRoot, "voices");

/** What every voice says, so the voices are compared on the same words. */
const SAMPLE_LINE =
  "Hi, I'm Luke. Tell me what you're working on, and I'll write the plan down as we talk.";

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

/** Lowercase words alone, so a take is compared on what was said and not on its punctuation. */
function wordsOf(text) {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
 * One take: a session in the voice, asked to say the line, with silence as
 * its microphone, ended once the model has spoken and gone quiet. Answers the
 * audio and the transcript of what was said.
 */
function recordTake(voice, apiKey) {
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
      if (socket.readyState === WebSocket.OPEN) socket.close();
      if (error) reject(error);
      else resolve({ pcm: Buffer.concat(audio), transcript });
    };
    const close = () => {
      if (closing) return;
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
                    // Worded as the guide words a greeting, the one way it documents to have the model speak first.
                    text: `Greet the caller now in English by saying exactly this, and nothing more: ${SAMPLE_LINE} Then pause and listen.`,
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

/** Records the voice until a take says the line, and writes it as the voice's clip. */
async function recordVoice(voice, apiKey, scratch) {
  for (let take = 1; take <= TAKES_PER_VOICE; take += 1) {
    const { pcm, transcript } = await recordTake(voice, apiKey);
    if (wordsOf(transcript) !== wordsOf(SAMPLE_LINE) || pcm.length === 0) {
      console.error(`${voice}: take ${take} said ${JSON.stringify(transcript.trim())}`);
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
