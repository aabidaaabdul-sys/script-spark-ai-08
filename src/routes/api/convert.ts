import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const MODES = [
  "professional",
  "viral",
  "documentary",
  "cinematic",
  "storytelling",
  "simple",
] as const;
type Mode = (typeof MODES)[number];

const Body = z.object({
  script: z.string().min(1).max(60000),
  mode: z.enum(MODES).default("professional"),
});

const SHARED_RULES = `
ABSOLUTE MEANING-LOCK RULES (non-negotiable):
- Preserve 100% of the original meaning, intent, emotion, and information.
- Do NOT invent new facts, characters, examples, or plot points.
- Do NOT remove any information present in the source.
- Detect the original tone (dramatic / educational / motivational / documentary / casual) and KEEP it.
- Auto-fix all grammar, spelling, and awkward phrasing.
- Translate Hindi/Hinglish phrases to the most natural English equivalent that preserves intent.
- Improve weak wording, tighten sentence structure, smooth transitions.
- Sound like an expert human writer — never robotic, never AI-flavored.
- Keep natural human rhythm and pacing.
- Sharpen the opening hook so it grabs attention without changing meaning.

INTERNAL QUALITY CHECK (do this silently before producing output):
1. Meaning fully preserved? 2. Grammar clean? 3. Wording professional? 4. Sounds human?
5. Flow smooth? 6. No awkward translation? Only then return the final script.

OUTPUT: Return ONLY the rewritten English script. No preamble, no markdown fences, no commentary, no headings unless they exist in the source.
`.trim();

const STYLE_PROMPTS: Record<Mode, string> = {
  professional: `You are a senior English content writer. Rewrite the user's rough Hinglish/broken-English text into clean, professional English suitable for high-quality publishing.\n\n${SHARED_RULES}`,

  viral: `You are a top-tier YouTube scriptwriter who writes high-retention viral scripts. Rewrite the input into punchy, hook-driven, conversational English that holds attention sentence by sentence. Use short sentences, curiosity gaps, and momentum — but DO NOT change the meaning or add fake hype.\n\n${SHARED_RULES}`,

  documentary: `You are a documentary writer in the style of premium streaming docuseries. Rewrite the input as composed, factual, observational English narration with a measured, authoritative voice.\n\n${SHARED_RULES}`,

  cinematic: `You are a cinematic narrator/screenwriter. Rewrite the input as evocative, vivid, image-rich English narration with cinematic pacing — like a film voice-over. Keep it grounded; do not invent imagery that isn't implied by the source.\n\n${SHARED_RULES}`,

  storytelling: `You are a master storyteller. Rewrite the input as warm, immersive, story-driven English with natural narrative flow — scene-setting, emotional beats, and human rhythm — while preserving every fact and idea from the source.\n\n${SHARED_RULES}`,

  simple: `You are an expert editor focused on clarity. Rewrite the input as clean, simple, plain English that anyone can understand. Short sentences, everyday words, zero jargon. Keep all original meaning.\n\n${SHARED_RULES}`,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callOpenAIStream(
  apiKey: string,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.6,
          stream: true,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        const txt = await res.text().catch(() => "");
        lastErr = new Error(`OpenAI ${res.status}: ${txt}`);
        await sleep(400 * Math.pow(2, attempt));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(400 * Math.pow(2, attempt));
    }
  }
  throw lastErr ?? new Error("OpenAI request failed");
}

export const Route = createFileRoute("/api/convert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return new Response(
            JSON.stringify({ error: "Invalid request body" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const system = STYLE_PROMPTS[parsed.mode];

        let upstream: Response;
        try {
          upstream = await callOpenAIStream(
            apiKey,
            system,
            parsed.script,
            request.signal,
          );
        } catch (e) {
          console.error("convert: upstream failed", e);
          return new Response(
            JSON.stringify({ error: "AI service unavailable. Please retry." }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }

        if (!upstream.ok || !upstream.body) {
          const t = await upstream.text().catch(() => "");
          console.error("convert: bad upstream", upstream.status, t);
          return new Response(
            JSON.stringify({ error: `AI gateway error (${upstream.status}).` }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(upstream.body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
