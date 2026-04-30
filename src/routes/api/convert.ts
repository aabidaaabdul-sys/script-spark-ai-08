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
  script: z.string().min(1).max(60000),
  mode: z.enum(MODES).default("standard"),
});

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

export const Route = createFileRoute("/api/convert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const providers = getProviders();
        if (providers.length === 0) {
          return new Response(
            JSON.stringify({
              error:
                "AI is not configured. Please add LOVABLE_API_KEY or OPENAI_API_KEY.",
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

        const system = STYLE_PROMPTS[parsed.mode];

        let lastErrorMsg = "AI service unavailable.";
        for (const provider of providers) {
          try {
            const upstream = await callStream(
              provider,
              system,
              parsed.script,
              request.signal,
            );

            if (upstream.ok && upstream.body) {
              return new Response(upstream.body, {
                status: 200,
                headers: {
                  "Content-Type": "text/event-stream; charset=utf-8",
                  "Cache-Control": "no-cache, no-transform",
                  Connection: "keep-alive",
                  "X-Provider": provider.name,
                },
              });
            }

            const errText = await upstream.text().catch(() => "");
            console.error(
              `[convert] ${provider.name} ${upstream.status}: ${errText.slice(0, 500)}`,
            );

            if (upstream.status === 401 || upstream.status === 403) {
              lastErrorMsg = `${provider.name} API key is invalid or unauthorized.`;
            } else if (upstream.status === 429) {
              lastErrorMsg = "Rate limit reached. Please wait a moment and retry.";
            } else if (upstream.status === 402) {
              lastErrorMsg =
                "AI credits exhausted. Please add credits in Workspace Settings → Usage.";
            } else if (upstream.status >= 500) {
              lastErrorMsg = `${provider.name} server error (${upstream.status}). Trying fallback…`;
            } else {
              lastErrorMsg = `${provider.name} error (${upstream.status}).`;
            }
            // try next provider
          } catch (e) {
            console.error(`[convert] ${provider.name} threw:`, e);
            lastErrorMsg = `${provider.name} request failed. Trying fallback…`;
          }
        }

        return new Response(JSON.stringify({ error: lastErrorMsg }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
