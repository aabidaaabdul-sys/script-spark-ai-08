import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const MODES = [
  "standard",
  "thriller",
  "drama",
  "documentary",
  "shortfilm",
  "trailer",
] as const;
type Mode = (typeof MODES)[number];

const Body = z.object({
  script: z.string().min(1).max(60000),
  mode: z.enum(MODES).default("standard"),
});

const SHARED_RULES = `
ABSOLUTE MEANING-LOCK RULES (non-negotiable):
- Preserve 100% of the original meaning, intent, emotion, story beats, and information.
- Do NOT invent new characters, plot points, or facts that aren't implied by the source.
- Do NOT remove any story information present in the source.
- Translate all Hindi/Hinglish into SIMPLE, natural English a global audience understands.
- Use everyday words. Avoid jargon and flowery prose. Short, clear sentences.
- Keep the original mood: suspense stays suspenseful, emotion stays emotional, action stays kinetic.

INDUSTRY-STANDARD SCREENPLAY FORMAT (mandatory — output MUST look like a real film script):
- Open with "FADE IN:" on its own line when appropriate.
- SCENE HEADINGS in ALL CAPS on their own line: "INT. LOCATION - TIME" or "EXT. LOCATION - TIME"
  (TIME = DAY / NIGHT / DAWN / DUSK / CONTINUOUS / LATER).
- ACTION LINES: present tense, visual, concrete. Describe only what the camera sees and hears.
  Keep paragraphs short (1-3 lines). Blank line between action beats.
- CHARACTER CUES: ALL CAPS on their own line above dialogue (e.g., RAHUL).
  First time a character appears in action, write their name in ALL CAPS once.
- DIALOGUE: natural, simple, human English directly under the character cue.
- PARENTHETICALS: lowercase in parentheses on their own line between cue and dialogue,
  only when needed (e.g., "(whispering)", "(to himself)"). Use sparingly.
- TRANSITIONS in ALL CAPS, right-side feel, on their own line: "CUT TO:", "SMASH CUT TO:",
  "DISSOLVE TO:", "FADE OUT.". Use only when they add meaning.
- Use blank lines generously to separate headings, action, and dialogue blocks.
- Do NOT use markdown, bullet points, numbered lists, code fences, or commentary.
- Do NOT add a title page, logline, or author notes unless present in the source.
- Output ONLY the screenplay. Nothing else.

QUALITY BAR before finalizing (self-check silently):
1) Meaning preserved? 2) English simple & natural? 3) Real screenplay format? 
4) Dialogue sounds human? 5) Reads like a professional screenwriter wrote it?
`.trim();

const STYLE_PROMPTS: Record<Mode, string> = {
  standard: `You are a professional film screenwriter. Convert the user's rough Hinglish input into a clean, industry-standard movie screenplay in simple English. Balanced pacing, clear scenes, natural dialogue.\n\n${SHARED_RULES}`,
  thriller: `You are a thriller screenwriter (think Fincher / Vishal Bhardwaj). Convert the input into a tense, suspenseful screenplay. Short action lines. Heavy silences. Sharp, minimal dialogue. Build dread scene by scene — without inventing new plot.\n\n${SHARED_RULES}`,
  drama: `You are an emotional drama screenwriter. Convert the input into a heartfelt screenplay. Let emotional beats breathe. Use grounded, human dialogue. Subtext over melodrama. Preserve every emotional moment from the source.\n\n${SHARED_RULES}`,
  documentary: `You are a documentary screenwriter. Convert the input into a documentary-style script with NARRATOR (V.O.) cues, observational action lines, and optional INTERVIEW SUBJECT cues where the source implies speech. Composed, factual, measured tone.\n\n${SHARED_RULES}`,
  shortfilm: `You are a short film screenwriter. Convert the input into a tight, focused short-film screenplay (single arc, economy of scenes, every line earns its place). Strong opening image, clear turn, resonant final image.\n\n${SHARED_RULES}`,
  trailer: `You are a cinematic trailer screenwriter. Convert the input into a trailer-style screenplay: punchy title-card beats, hard CUTS, escalating tension, sparse iconic dialogue lines, big final image. Use TITLE CARD: lines where useful.\n\n${SHARED_RULES}`,
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
