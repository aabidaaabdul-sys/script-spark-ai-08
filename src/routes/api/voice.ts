import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * AI Voice Studio — server route
 *
 * Parses a screenplay, auto-casts ElevenLabs voices to characters,
 * generates each segment with the right emotional voice settings, and
 * concatenates the resulting MP3 frames into a single audio file.
 *
 * Models:
 *   eleven_multilingual_v2  — best multilingual quality (Hindi / Urdu / Hinglish)
 *   eleven_turbo_v2_5       — lower latency (used as fallback for huge scripts)
 */

const SegmentKind = z.enum(["narration", "dialogue", "scene"]);
const Override = z.object({
  character: z.string().min(1),
  voiceId: z.string().min(1),
});

const Body = z.object({
  script: z.string().min(1).max(60_000),
  narratorVoiceId: z.string().min(1),
  defaultMaleVoiceId: z.string().optional(),
  defaultFemaleVoiceId: z.string().optional(),
  overrides: z.array(Override).default([]),
  speed: z.number().min(0.7).max(1.2).default(1.0),
  stability: z.number().min(0).max(1).default(0.45),
  similarity: z.number().min(0).max(1).default(0.8),
  style: z.number().min(0).max(1).default(0.4),
  model: z.enum(["eleven_multilingual_v2", "eleven_turbo_v2_5"]).default("eleven_multilingual_v2"),
  // Optional vibe override: trailer / horror / documentary / drama / standard
  vibe: z.string().default("standard"),
});

type Segment = {
  kind: "narration" | "dialogue" | "scene";
  character?: string;
  parenthetical?: string;
  text: string;
};

const SCENE_RE = /^(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.)/i;
const TRANSITION_RE = /^(FADE IN:|FADE OUT\.?|CUT TO:|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:)$/i;

function isCharacterCue(line: string): boolean {
  const l = line.trim();
  if (!l) return false;
  if (l.length > 40) return false;
  if (SCENE_RE.test(l) || TRANSITION_RE.test(l)) return false;
  // ALL CAPS allowing spaces, dots, parens after, e.g. "RAHUL (V.O.)"
  const stripped = l.replace(/\(.*?\)\s*$/, "").trim();
  if (!stripped) return false;
  // must contain at least one letter, mostly uppercase
  const letters = stripped.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  return letters === letters.toUpperCase();
}

function parseScreenplay(raw: string): Segment[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const segs: Segment[] = [];
  let buf: string[] = [];
  const flushNarration = () => {
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    buf = [];
    if (text) segs.push({ kind: "narration", text });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flushNarration();
      continue;
    }
    if (SCENE_RE.test(trimmed) || TRANSITION_RE.test(trimmed)) {
      flushNarration();
      segs.push({ kind: "scene", text: trimmed });
      continue;
    }
    if (isCharacterCue(trimmed)) {
      flushNarration();
      const cueRaw = trimmed;
      const character = cueRaw.replace(/\(.*?\)\s*$/, "").trim();
      // collect optional parenthetical and dialogue lines
      let parenthetical: string | undefined;
      const dialogueLines: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        const nt = next.trim();
        if (!nt) break;
        if (isCharacterCue(nt) || SCENE_RE.test(nt) || TRANSITION_RE.test(nt)) {
          i--;
          break;
        }
        const paren = nt.match(/^\((.*)\)$/);
        if (paren && dialogueLines.length === 0) {
          parenthetical = paren[1];
        } else {
          dialogueLines.push(nt);
        }
        i++;
      }
      const text = dialogueLines.join(" ").replace(/\s+/g, " ").trim();
      if (text) segs.push({ kind: "dialogue", character, parenthetical, text });
      continue;
    }
    buf.push(trimmed);
  }
  flushNarration();
  return segs;
}

/* ---------- voice casting ---------- */

const MALE_POOL = [
  "TX3LPaxmHKxFdv7VOQHJ", // Liam
  "IKne3meq5aSn9XLyUdCD", // Charlie
  "N2lVS1w4EtoT3dr4eOWO", // Callum
  "iP95p4xoKVk53GoZ742B", // Chris
  "cjVigY5qzO86Huf0OWal", // Eric
  "onwK4e9ZLuTAKqWW03F9", // Daniel
  "bIHbv24MWmeRgasZH58o", // Will
  "pqHfZKP75CvOlQylNhV4", // Bill
];
const FEMALE_POOL = [
  "EXAVITQu4vr4xnSDxMaL", // Sarah
  "FGY2WhTYpPnrIDTdsKH5", // Laura
  "Xb7hH8MSUJpSbSDYk0k2", // Alice
  "XrExE9yKIg1WjnnlVkGX", // Matilda
  "cgSgspJ2msm6clMCkdW9", // Jessica
  "pFZP5JQG7iQjIQuC4Bku", // Lily
];

// Heuristic: tag obviously-female cues so we draw from the female pool.
const FEMALE_HINTS = /\b(MOM|MOTHER|MAA|MAMA|GIRL|WOMAN|AUNT|SISTER|DIDI|PRIYA|SARA|AISHA|MEERA|RIYA|ANJALI|POOJA|NEHA|LADY|MRS|MISS|QUEEN|PRINCESS|WIFE|DAUGHTER|NURSE|MAID|FATIMA|AYESHA|ZARA)\b/i;

function castVoices(
  segs: Segment[],
  opts: {
    overrides: { character: string; voiceId: string }[];
    defaultMale?: string;
    defaultFemale?: string;
  },
): Map<string, string> {
  const map = new Map<string, string>();
  for (const o of opts.overrides) map.set(o.character.toUpperCase(), o.voiceId);
  let male = 0;
  let female = 0;
  for (const s of segs) {
    if (s.kind !== "dialogue" || !s.character) continue;
    const key = s.character.toUpperCase();
    if (map.has(key)) continue;
    const isFemale = FEMALE_HINTS.test(key);
    if (isFemale) {
      const v =
        opts.defaultFemale && female === 0
          ? opts.defaultFemale
          : FEMALE_POOL[female % FEMALE_POOL.length];
      map.set(key, v);
      female++;
    } else {
      const v =
        opts.defaultMale && male === 0
          ? opts.defaultMale
          : MALE_POOL[male % MALE_POOL.length];
      map.set(key, v);
      male++;
    }
  }
  return map;
}

/* ---------- emotional voice settings ---------- */

function tuneSettings(
  base: { stability: number; similarity: number; style: number; speed: number },
  parenthetical: string | undefined,
  vibe: string,
  kind: Segment["kind"],
) {
  let { stability, similarity, style, speed } = base;
  const p = (parenthetical || "").toLowerCase();

  if (kind === "narration") {
    stability = Math.min(1, stability + 0.1);
    style = Math.max(0, style - 0.05);
  }
  if (kind === "scene") {
    stability = 0.85;
    style = 0.15;
    speed = Math.min(1.1, speed);
  }

  if (/whisper|soft|quiet/.test(p)) {
    stability += 0.2;
    style = Math.max(0, style - 0.2);
    speed = Math.max(0.8, speed - 0.1);
  }
  if (/shout|yell|angry|furious|rage/.test(p)) {
    stability = Math.max(0, stability - 0.25);
    style = Math.min(1, style + 0.35);
  }
  if (/cry|sob|tear|breaking|emotional|sad/.test(p)) {
    stability = Math.max(0, stability - 0.15);
    style = Math.min(1, style + 0.2);
    speed = Math.max(0.85, speed - 0.05);
  }
  if (/excited|cheer|happy|laugh/.test(p)) {
    style = Math.min(1, style + 0.25);
    speed = Math.min(1.15, speed + 0.05);
  }
  if (/scared|fear|panic|terrified/.test(p)) {
    stability = Math.max(0, stability - 0.2);
    style = Math.min(1, style + 0.3);
    speed = Math.min(1.15, speed + 0.05);
  }

  if (vibe === "horror") {
    speed = Math.max(0.78, speed - 0.08);
    stability += 0.05;
  } else if (vibe === "trailer") {
    style = Math.min(1, style + 0.15);
    stability = Math.max(0, stability - 0.05);
  } else if (vibe === "documentary") {
    stability = Math.min(1, stability + 0.15);
    style = Math.max(0, style - 0.1);
  } else if (vibe === "drama") {
    style = Math.min(1, style + 0.1);
  }

  stability = Math.max(0, Math.min(1, stability));
  similarity = Math.max(0, Math.min(1, similarity));
  style = Math.max(0, Math.min(1, style));
  speed = Math.max(0.7, Math.min(1.2, speed));
  return { stability, similarity_boost: similarity, style, speed, use_speaker_boost: true };
}

/* ---------- ElevenLabs call ---------- */

async function tts(
  apiKey: string,
  voiceId: string,
  text: string,
  model: string,
  voice_settings: ReturnType<typeof tuneSettings>,
  previous_text: string | undefined,
  next_text: string | undefined,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const r = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings,
      previous_text,
      next_text,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`ElevenLabs ${r.status}: ${t.slice(0, 220)}`);
  }
  const buf = await r.arrayBuffer();
  return new Uint8Array(buf);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

export const Route = createFileRoute("/api/voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "Voice studio is not configured." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        let body;
        try {
          body = Body.parse(await request.json());
        } catch (e) {
          return new Response(
            JSON.stringify({
              error: "Invalid voice request.",
              detail: e instanceof Error ? e.message : String(e),
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const segs = parseScreenplay(body.script);
        if (segs.length === 0) {
          return new Response(
            JSON.stringify({ error: "Script has no readable lines." }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const cast = castVoices(segs, {
          overrides: body.overrides,
          defaultMale: body.defaultMaleVoiceId,
          defaultFemale: body.defaultFemaleVoiceId,
        });

        // Hard guard against runaway requests / token blowups.
        const MAX_CHARS = 12_000;
        let used = 0;
        const safeSegs: Segment[] = [];
        for (const s of segs) {
          used += s.text.length;
          if (used > MAX_CHARS) break;
          safeSegs.push(s);
        }

        const parts: Uint8Array[] = [];
        const manifest: {
          character: string | null;
          kind: string;
          chars: number;
          bytes: number;
          voiceId: string;
        }[] = [];

        for (let i = 0; i < safeSegs.length; i++) {
          const s = safeSegs[i];
          if (s.kind === "scene") continue;
          const voiceId =
            s.kind === "dialogue" && s.character
              ? cast.get(s.character.toUpperCase()) || body.narratorVoiceId
              : body.narratorVoiceId;

          const settings = tuneSettings(
            {
              stability: body.stability,
              similarity: body.similarity,
              style: body.style,
              speed: body.speed,
            },
            s.parenthetical,
            body.vibe,
            s.kind,
          );

          const prev = safeSegs[i - 1]?.text;
          const next = safeSegs[i + 1]?.text;

          const speakable =
            s.kind === "dialogue"
              ? s.text
              : s.text;

          try {
            const audio = await tts(
              apiKey,
              voiceId,
              speakable,
              body.model,
              settings,
              prev,
              next,
              request.signal,
            );
            parts.push(audio);
            manifest.push({
              character: s.character ?? null,
              kind: s.kind,
              chars: speakable.length,
              bytes: audio.byteLength,
              voiceId,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[voice] segment failed:", msg);
            // Surface the first failure clearly instead of producing partial silence.
            return new Response(
              JSON.stringify({ error: msg }),
              { status: 502, headers: { "Content-Type": "application/json" } },
            );
          }
        }

        if (parts.length === 0) {
          return new Response(
            JSON.stringify({ error: "Nothing speakable in this script." }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const merged = concat(parts);

        const castObj: Record<string, string> = {};
        cast.forEach((v, k) => (castObj[k] = v));

        return new Response(merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength) as ArrayBuffer, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
            "X-Voice-Cast": encodeURIComponent(JSON.stringify(castObj)),
            "X-Voice-Segments": String(manifest.length),
            "X-Voice-Manifest": encodeURIComponent(
              JSON.stringify(manifest).slice(0, 6_000),
            ),
          },
        });
      },
    },
  },
});
