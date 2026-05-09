import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const MODES = [
  "standard",
  "thriller",
  "drama",
  "documentary",
  "shortfilm",
  "trailer",
  "hinglish",
  "hindi",
  "urdu",
  "english_meaning",
] as const;
type Mode = (typeof MODES)[number];

const Body = z.object({
  // Allow extremely large scripts (~2M chars ≈ ~300k+ words). Internally chunked.
  script: z.string().min(1).max(2_000_000),
  mode: z.enum(MODES).default("standard"),
});

// Soft threshold: anything bigger is processed in smart chunks with shared context.
const CHUNK_THRESHOLD = 18_000; // characters
const CHUNK_TARGET = 12_000;    // target size per chunk
const CHUNK_OVERLAP_TAIL = 1_400; // chars of prior chunk tail re-fed for continuity

type Lang = "hinglish" | "hindi" | "urdu" | "english";

/**
 * Lightweight, deterministic input-language detector.
 * - Devanagari range  → hindi
 * - Arabic/Urdu range → urdu
 * - Latin-only with strong Hindi-Roman markers → hinglish
 * - Otherwise         → english
 */
function detectLanguage(text: string): Lang {
  const sample = text.slice(0, 4000);
  const devCount = (sample.match(/[\u0900-\u097F]/g) || []).length;
  const arabicCount = (sample.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
  const latinLetters = (sample.match(/[A-Za-z]/g) || []).length;
  const totalScript = devCount + arabicCount + latinLetters || 1;

  if (arabicCount / totalScript > 0.2) return "urdu";
  if (devCount / totalScript > 0.2) return "hindi";

  if (latinLetters > 0) {
    const lower = " " + sample.toLowerCase() + " ";
    const hindiRomanMarkers = [
      " hai ", " hain ", " kya ", " nahi ", " nahin ", " mein ", " mujhe ",
      " tum ", " tumhe ", " aap ", " kar ", " karna ", " raha ", " rahi ",
      " gaya ", " gayi ", " bhai ", " yaar ", " kyun ", " kyu ", " kaisa ",
      " kaise ", " accha ", " acha ", " bhi ", " phir ", " toh ", " woh ",
      " yeh ", " ye ", " ladka ", " ladki ", " ghar ", " baat ", " kuch ",
      " sab ", " ek ", " ko ", " se ", " ki ", " ka ", " ke ", " ho ",
    ];
    let hits = 0;
    for (const m of hindiRomanMarkers) if (lower.includes(m)) hits++;
    if (hits >= 2) return "hinglish";
  }
  return "english";
}


const SHARED_RULES = `
ROLE
You are a senior, award-winning screenwriter and script doctor. You do NOT translate.
You REWRITE, RESTRUCTURE, ELEVATE, and POLISH the user's rough material into an
industry-standard screenplay. Treat the input as raw clay — your job is to sculpt it
into a production-ready script that a real director could shoot tomorrow.

ABSOLUTE MEANING-LOCK (non-negotiable)
- Preserve the core story, intent, message, characters, relationships, and emotional purpose.
- Keep every important scene/beat from the source. Do NOT delete plot information.
- Do NOT invent contradictory facts or new characters that change the story.
- You MAY add small connective tissue (a beat of silence, a look, a transition line, a
  micro-action) ONLY when needed to make the existing story flow cinematically.

ENHANCEMENT ENGINE (apply on every pass)
- STRUCTURE: organize material into clear scenes with a strong opening image, escalating
  midpoint, and a resonant final image. Fix broken pacing.
- DIALOGUE: rewrite weak/awkward lines into natural, human, character-specific speech.
  Cut filler. Add subtext. Make at least a few lines memorable.
- ACTION: replace vague description with concrete, visual, present-tense imagery the
  camera can actually see. Short paragraphs (1–3 lines).
- TRANSITIONS: smooth scene-to-scene flow. Use CUT TO: / SMASH CUT TO: / DISSOLVE TO:
  only when they earn the moment.
- HOOKS & RETENTION: strong first page, clear turning points, no dead air.
- CHARACTER: give each named character a distinct voice, even within one scene.
- TONE LOCK: the mode's tone must be felt in EVERY scene, not just the opener.

LANGUAGE
- Translate all Hindi/Hinglish into SIMPLE, natural, globally readable English.
- No robotic phrasing. No literal translation. No flowery prose. No jargon.
- Short, clear sentences. Human rhythm.

INDUSTRY-STANDARD SCREENPLAY FORMAT (mandatory)
- Open with "FADE IN:" on its own line.
- SCENE HEADINGS in ALL CAPS: "INT. LOCATION - DAY/NIGHT/DAWN/DUSK/CONTINUOUS/LATER"
- ACTION: present tense, visual, concrete. Blank line between beats.
- CHARACTER CUE: ALL CAPS, on its own line, above dialogue. ALL CAPS the first time a
  named character appears in an action line.
- DIALOGUE: directly under the cue. Natural and simple.
- PARENTHETICAL: lowercase in parens, used sparingly — only when tone isn't obvious.
- TRANSITIONS: ALL CAPS on their own line. End with "FADE OUT." when the story closes.
- Use blank lines generously between headings, action, and dialogue blocks.
- NO markdown, NO bullets, NO numbered lists, NO code fences, NO author notes,
  NO logline, NO title page, NO commentary before/after the script.
- Output ONLY the finished screenplay text.

SILENT SELF-CHECK BEFORE FINALIZING (do not show this in output)
1) Selected mode's tone applied throughout? 2) Original meaning preserved?
3) Story actually improved (structure, pacing, dialogue, imagery)?
4) Real screenplay format? 5) Dialogue sounds like real humans?
6) Would a working director read this and say "I can shoot this"?
`.trim();

const STYLE_PROMPTS: Record<Mode, string> = {
  standard: `MODE: STANDARD FEATURE FILM
You are a senior studio screenwriter. Deliver a clean, polished, feature-film-grade
screenplay. Balanced three-act feel even in short pieces. Clear scene goals. Natural
dialogue with subtext. Cinematic but grounded action. Studio-level professionalism in
every line. The script should read like a finished draft from a working pro.\n\n${SHARED_RULES}`,

  thriller: `MODE: THRILLER / SUSPENSE
You write like Fincher, Denis Villeneuve, and Sriram Raghavan. Rebuild the material as
an edge-of-seat thriller. Use short, punchy action lines. Heavy silences. Long shadows.
Withheld information. Misdirection. Ticking-clock pressure. Dialogue is sharp, minimal,
and often loaded with threat or doubt. End scenes on hooks, twists, or unease. Make
the reader's pulse rise — without inventing plot that contradicts the source.\n\n${SHARED_RULES}`,

  drama: `MODE: EMOTIONAL DRAMA
You write like Imtiaz Ali, Shoojit Sircar, and Kenneth Lonergan. Rebuild the material
as a deeply human drama. Let emotional beats breathe. Use silence, glances, small
gestures. Dialogue is honest, vulnerable, specific to each character's wound. Favor
subtext over melodrama. Find at least one moment that quietly breaks the heart.
Preserve and AMPLIFY every emotional moment present in the source.\n\n${SHARED_RULES}`,

  documentary: `MODE: DOCUMENTARY (Netflix / BBC / Discovery grade)
You write professional documentary scripts. Rebuild the material as a polished doc.
Use NARRATOR (V.O.) cues for clean, voiceover-friendly narration — informative,
measured, authoritative, never preachy. Use observational EXT./INT. action lines for
b-roll imagery. Where the source implies someone speaking, render it as
"INTERVIEW SUBJECT" or the named person's cue. Use clear segment transitions
(DISSOLVE TO:, CUT TO:). Every paragraph should sound like it could be read aloud
over footage. Keep facts faithful to the source.\n\n${SHARED_RULES}`,

  shortfilm: `MODE: SHORT FILM (festival grade)
You write tight, festival-ready short films (5–15 minute feel). One central idea. One
clear arc. Economy of scenes — every scene must justify its existence. Strong opening
image. One clear turn. A resonant, lingering final image. Dialogue is minimal and
loaded. The whole script should feel like a punch to the chest in a small package.\n\n${SHARED_RULES}`,

  trailer: `MODE: CINEMATIC TRAILER
You write trailer scripts at the level of top Hollywood/Bollywood marketing houses.
Rebuild the material as a 90–150 second trailer screenplay. Structure in beats:
1) BIG HOOK opening image, 2) world/character setup in fast cuts, 3) the central
conflict revealed, 4) escalating montage of stakes, 5) one iconic dialogue moment,
6) climactic tease, 7) TITLE CARD reveal, 8) final stinger. Use SMASH CUT TO: and
hard CUTS. Use TITLE CARD: "..." lines for on-screen text. Dialogue is sparse,
iconic, quotable. Every line must build hype.\n\n${SHARED_RULES}`,

  hinglish: `MODE: HINGLISH MEANING TRANSLATION (PREMIUM)

You are India's most trusted bilingual screenwriter. You translate finished English
screenplays into clean, natural, EMOTIONALLY ACCURATE Hinglish (Roman Hindi mixed
with simple English — the way real Indians speak in real life and in modern films).

ABSOLUTE FAITHFULNESS (non-negotiable)
- Translate EVERY scene heading, EVERY action line, EVERY character cue, EVERY
  dialogue, EVERY parenthetical, EVERY transition — in the SAME order.
- Do NOT summarize. Do NOT shorten. Do NOT skip lines. Do NOT add new lines or
  scenes. Do NOT change the order. ONE-TO-ONE with the source.
- Preserve the EXACT meaning, emotion, suspense, drama, romance, fear, anger,
  comedy, tone, pacing, intent, and subtext of every line.
- A line that hits hard in English must hit equally hard in Hinglish.
- Dialogue must sound like real people speaking — not a textbook translation.

NATURAL HINGLISH WORD CHOICE (very important)
- Use common, everyday Roman Hindi + simple English mix.
- AVOID heavy/Sanskritized/formal Hindi words. AVOID Devanagari script.
- AVOID literal awkward word-for-word translation.
- Examples of CORRECT style:
  EN: "I know you're inside."           → HI: "Mujhe pata hai tum andar ho."
  EN: "I have a feeling someone's here." → HI: "Mujhe lagta hai koi yahaan hai."
  EN: "Don't move."                      → HI: "Hilna mat."
  EN: "Are you serious?"                 → HI: "Sach mein?"
  EN: "I can't do this anymore."         → HI: "Main aur nahi kar sakta."
- Examples of WRONG style (do NOT do this):
  ✗ "Mujhe andaza hai koi wahan vidyamaan hai."
  ✗ "Kya aap satya bol rahe hain?"

FORMAT — MIRROR THE ENGLISH SCRIPT EXACTLY
- Keep these screenplay terms AS-IS in English (universal industry standard):
  FADE IN:, FADE OUT., CUT TO:, SMASH CUT TO:, DISSOLVE TO:, MATCH CUT TO:,
  TITLE CARD:, INT., EXT., V.O., O.S., CONT'D, NARRATOR.
- Scene heading format: "INT. LOCATION - DAY/NIGHT" — translate the LOCATION
  to natural Hinglish, keep INT./EXT. and DAY/NIGHT/DAWN/DUSK in English.
- Character cues (names) stay in ALL CAPS, exactly as the source.
- Action lines: present tense, natural Hinglish, same length & rhythm as source.
- Dialogue: conversational Hinglish — how real Indians actually talk.
- Parentheticals: lowercase Hinglish in parens, used only when present in source.
- Preserve ALL blank lines and block structure of the original screenplay.

SILENT SELF-CHECK BEFORE OUTPUT (do not show)
1) Same number of scenes & lines as source? 2) Meaning identical?
3) Emotion preserved at the same intensity? 4) Sounds like a real Indian talking?
5) Screenplay format mirrored exactly? 6) No Devanagari, no formal Hindi?

OUTPUT
- Output ONLY the translated screenplay text.
- NO commentary, NO markdown, NO notes, NO "here is the translation".
- The result must look STRUCTURALLY IDENTICAL to the input — only the language changes.
`.trim(),

  hindi: `MODE: HINDI MEANING TRANSLATION (PREMIUM, DEVANAGARI)

You are a senior bilingual screenwriter. Translate the finished English screenplay
into clean, natural, emotionally accurate HINDI in proper DEVANAGARI script.

ABSOLUTE FAITHFULNESS
- Translate EVERY scene heading, action line, character cue, dialogue, parenthetical,
  and transition — in the SAME order. ONE-TO-ONE with the source.
- Do NOT summarize, shorten, skip, or add lines. Preserve meaning, emotion, suspense,
  drama, tone, pacing, intent, and subtext exactly.

LANGUAGE
- Use proper, readable Devanagari Hindi. Natural, modern, conversational.
- Avoid heavy/archaic Sanskritized words unless the scene demands it.
- Dialogue must sound like real people speaking modern Hindi.

FORMAT — MIRROR THE ENGLISH SCRIPT EXACTLY
- Keep universal screenplay terms in English: FADE IN:, FADE OUT., CUT TO:,
  SMASH CUT TO:, DISSOLVE TO:, MATCH CUT TO:, TITLE CARD:, INT., EXT., V.O.,
  O.S., CONT'D, NARRATOR.
- Scene heading: "INT. <स्थान> - DAY/NIGHT" — translate the LOCATION to Hindi
  (Devanagari), keep INT./EXT. and DAY/NIGHT/DAWN/DUSK in English.
- Character cues stay in ALL CAPS English exactly as the source.
- Action lines: present tense, Devanagari Hindi, same length and rhythm.
- Dialogue: natural Hindi in Devanagari. Parentheticals: lowercase Hindi in parens.
- Preserve all blank lines and block structure.

OUTPUT
- Output ONLY the translated screenplay text. No commentary, no markdown, no notes.
`.trim(),

  urdu: `MODE: URDU MEANING TRANSLATION (PREMIUM, NASTA'LIQ SCRIPT)

You are a senior bilingual screenwriter. Translate the finished English screenplay
into clean, natural, emotionally accurate URDU in proper Urdu script (Arabic-based,
right-to-left).

ABSOLUTE FAITHFULNESS
- Translate EVERY scene heading, action line, character cue, dialogue, parenthetical,
  and transition — in the SAME order. ONE-TO-ONE with the source.
- Do NOT summarize, shorten, skip, or add lines. Preserve meaning, emotion, suspense,
  drama, tone, pacing, intent, and subtext exactly.

LANGUAGE
- Use proper, elegant, readable Urdu. Natural and modern, the way real Urdu speakers
  talk in films and dramas. Avoid heavy/archaic vocabulary unless the scene demands it.
- Dialogue must sound like real human speech in Urdu.

FORMAT — MIRROR THE ENGLISH SCRIPT EXACTLY
- Keep universal screenplay terms in English (left-to-right): FADE IN:, FADE OUT.,
  CUT TO:, SMASH CUT TO:, DISSOLVE TO:, MATCH CUT TO:, TITLE CARD:, INT., EXT.,
  V.O., O.S., CONT'D, NARRATOR.
- Scene heading: "INT. <مقام> - DAY/NIGHT" — translate the LOCATION to Urdu, keep
  INT./EXT. and DAY/NIGHT/DAWN/DUSK in English.
- Character cues stay in ALL CAPS English exactly as the source (so they remain
  recognizable on a shoot).
- Action lines and dialogue in Urdu script. Parentheticals: lowercase Urdu in parens.
- Preserve all blank lines and block structure.

OUTPUT
- Output ONLY the translated screenplay text. No commentary, no markdown, no notes.
`.trim(),

  english_meaning: `MODE: ENGLISH PLAIN-MEANING VERSION

You receive a finished, industry-formatted English screenplay. Produce a SIMPLIFIED,
plain-English meaning version that mirrors the screenplay one-to-one.

ABSOLUTE FAITHFULNESS
- Mirror EVERY scene heading, action line, character cue, dialogue, parenthetical,
  and transition — in the SAME order. ONE-TO-ONE with the source.
- Do NOT summarize, shorten, skip, or add lines. Preserve meaning, emotion, tone,
  pacing, intent, and subtext exactly.

LANGUAGE
- Use very simple, clear, modern English. Short sentences. No literary/flowery words.
- Dialogue stays natural and human. Action stays visual and concrete.

FORMAT
- Identical screenplay format as the source. Keep FADE IN:, INT./EXT., DAY/NIGHT,
  CUT TO:, character cues in ALL CAPS, etc., exactly as in the source.
- Preserve all blank lines and block structure.

OUTPUT
- Output ONLY the simplified screenplay text. No commentary, no markdown, no notes.
`.trim(),
};

type Provider = {
  name: string;
  url: string;
  key: string;
  model: string;
};

function getProviders(): Provider[] {
  const out: Provider[] = [];
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) {
    out.push({
      name: "lovable",
      url: "https://ai.gateway.lovable.dev/v1/chat/completions",
      key: lovableKey,
      model: "google/gemini-3-flash-preview",
    });
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    out.push({
      name: "openai",
      url: "https://api.openai.com/v1/chat/completions",
      key: openaiKey,
      model: "gpt-4o-mini",
    });
  }
  return out;
}

async function callStream(
  provider: Provider,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(provider.url, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${provider.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
}

/**
 * Split very large scripts into smart chunks at natural boundaries
 * (scene headings, transitions, paragraph breaks). Preserves order.
 */
function smartChunk(text: string, target = CHUNK_TARGET): string[] {
  if (text.length <= CHUNK_THRESHOLD) return [text];
  const chunks: string[] = [];
  // Prefer splitting on screenplay scene boundaries first.
  const sceneRegex = /(?=^\s*(?:INT\.|EXT\.|FADE IN:|FADE OUT\.|CUT TO:|SMASH CUT TO:|DISSOLVE TO:|MATCH CUT TO:|TITLE CARD:))/gm;
  const sceneBlocks = text.split(sceneRegex).filter((b) => b.trim().length > 0);
  const blocks = sceneBlocks.length > 1 ? sceneBlocks : text.split(/\n{2,}/);

  let buf = "";
  const flush = () => {
    if (buf.trim()) chunks.push(buf);
    buf = "";
  };
  for (const block of blocks) {
    if (block.length > target * 1.6) {
      // Oversized block: hard-split by sentences.
      flush();
      const sentences = block.split(/(?<=[.!?…])\s+/);
      for (const s of sentences) {
        if (buf.length + s.length + 1 > target && buf.length > 0) flush();
        buf += (buf ? " " : "") + s;
      }
      flush();
      continue;
    }
    if (buf.length + block.length + 2 > target && buf.length > 0) flush();
    buf += (buf ? "\n\n" : "") + block;
  }
  flush();
  return chunks;
}

function emitSSE(controller: ReadableStreamDefaultController, encoder: TextEncoder, content: string) {
  const payload = JSON.stringify({ choices: [{ delta: { content } }] });
  controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
}

async function pipeUpstreamToClient(
  upstream: Response,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
): Promise<string> {
  if (!upstream.body) return "";
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (delta) {
          acc += delta;
          // Re-emit as a clean SSE event downstream.
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
        }
      } catch {
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }
  return acc;
}

function buildChunkUserPrompt(opts: {
  fullChunk: string;
  index: number;
  total: number;
  priorTail: string;
  isTranslation: boolean;
}): string {
  const { fullChunk, index, total, priorTail, isTranslation } = opts;
  if (total === 1) return fullChunk;

  const header = isTranslation
    ? `LARGE-SCRIPT TRANSLATION — PART ${index + 1} of ${total}.
You are translating a long screenplay in sequential parts. Maintain identical
character names, tone, formatting, and screenplay structure across parts.
Translate ONLY the "CURRENT PART" below, line-by-line, in the SAME order.
Do NOT repeat earlier content. Do NOT add a preface, header, or summary.
Do NOT add "Part X" labels. Output ONLY the translated screenplay text for this part.`
    : `LARGE-SCRIPT REWRITE — PART ${index + 1} of ${total}.
You are rewriting a long screenplay in sequential parts. Maintain consistent
characters, tone, world, and screenplay format across parts. Rewrite ONLY the
"CURRENT PART" below into industry-standard screenplay format. Do NOT repeat
earlier content. Do NOT add a preface, summary, or "Part X" label.
Do NOT write FADE IN: again unless this is part 1. Do NOT write FADE OUT.
unless this is the final part. Output ONLY the screenplay text for this part.`;

  const continuity = priorTail
    ? `\n\nPREVIOUS PART — TAIL (for continuity only, DO NOT repeat or rewrite):\n"""\n${priorTail}\n"""`
    : "";

  return `${header}${continuity}\n\nCURRENT PART (rewrite/translate this part only):\n"""\n${fullChunk}\n"""`;
}

const TRANSLATION_MODES: Mode[] = ["hinglish", "hindi", "urdu", "english_meaning"];

async function tryProvidersStream(opts: {
  providers: Provider[];
  system: string;
  user: string;
  signal: AbortSignal;
}): Promise<{ upstream: Response; provider: Provider } | { errorMsg: string }> {
  let lastErrorMsg = "AI service unavailable.";
  for (const provider of opts.providers) {
    try {
      const upstream = await callStream(provider, opts.system, opts.user, opts.signal);
      if (upstream.ok && upstream.body) return { upstream, provider };
      const errText = await upstream.text().catch(() => "");
      console.error(`[convert] ${provider.name} ${upstream.status}: ${errText.slice(0, 400)}`);
      if (upstream.status === 401 || upstream.status === 403)
        lastErrorMsg = `${provider.name} API key is invalid or unauthorized.`;
      else if (upstream.status === 429)
        lastErrorMsg = "Rate limit reached. Please wait a moment and retry.";
      else if (upstream.status === 402)
        lastErrorMsg = "AI credits exhausted. Please add credits in Workspace Settings → Usage.";
      else if (upstream.status >= 500)
        lastErrorMsg = `${provider.name} server error (${upstream.status}). Trying fallback…`;
      else lastErrorMsg = `${provider.name} error (${upstream.status}).`;
    } catch (e) {
      console.error(`[convert] ${provider.name} threw:`, e);
      lastErrorMsg = `${provider.name} request failed. Trying fallback…`;
    }
  }
  return { errorMsg: lastErrorMsg };
}

export const Route = createFileRoute("/api/convert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const providers = getProviders();
        if (providers.length === 0) {
          return new Response(
            JSON.stringify({
              error: "AI is not configured. Please add LOVABLE_API_KEY or OPENAI_API_KEY.",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return new Response(
            JSON.stringify({ error: "Invalid request. Send { script, mode }." }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const isTranslation = TRANSLATION_MODES.includes(parsed.mode);
        const detectedLang: Lang = isTranslation ? "english" : detectLanguage(parsed.script);
        const system = STYLE_PROMPTS[parsed.mode];

        // FAST PATH — small/medium scripts: passthrough stream as before.
        if (parsed.script.length <= CHUNK_THRESHOLD) {
          const result = await tryProvidersStream({
            providers,
            system,
            user: parsed.script,
            signal: request.signal,
          });
          if ("errorMsg" in result) {
            return new Response(JSON.stringify({ error: result.errorMsg }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(result.upstream.body, {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
              "X-Provider": result.provider.name,
              "X-Lang": detectedLang,
              "X-Chunks": "1",
              "Access-Control-Expose-Headers": "X-Lang, X-Provider, X-Chunks",
            },
          });
        }

        // LARGE PATH — chunked sequential generation, streamed to client.
        const chunks = smartChunk(parsed.script);
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              let priorTail = "";
              for (let i = 0; i < chunks.length; i++) {
                if (request.signal.aborted) break;
                const userPrompt = buildChunkUserPrompt({
                  fullChunk: chunks[i],
                  index: i,
                  total: chunks.length,
                  priorTail,
                  isTranslation,
                });
                const result = await tryProvidersStream({
                  providers,
                  system,
                  user: userPrompt,
                  signal: request.signal,
                });
                if ("errorMsg" in result) {
                  emitSSE(controller, encoder, `\n\n[Generation interrupted at part ${i + 1}/${chunks.length}: ${result.errorMsg}]\n`);
                  break;
                }
                if (i > 0) emitSSE(controller, encoder, "\n\n");
                const partText = await pipeUpstreamToClient(result.upstream, controller, encoder);
                priorTail = partText.slice(-CHUNK_OVERLAP_TAIL);
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } catch (e) {
              console.error("[convert] chunked stream failed:", e);
              try {
                emitSSE(controller, encoder, "\n\n[Generation error. Please retry.]");
              } catch {}
            } finally {
              try { controller.close(); } catch {}
            }
          },
          cancel() {
            // Client disconnected; nothing else to clean up.
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Provider": providers[0].name,
            "X-Lang": detectedLang,
            "X-Chunks": String(chunks.length),
            "Access-Control-Expose-Headers": "X-Lang, X-Provider, X-Chunks",
          },
        });
      },
    },
  },
});
