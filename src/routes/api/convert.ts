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
