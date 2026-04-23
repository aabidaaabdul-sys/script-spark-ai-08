import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  script: z.string().min(1).max(60000),
  mode: z.enum(["cinematic", "strict"]).default("cinematic"),
});

const CINEMATIC_SYSTEM = `You are a master Hollywood screenwriter and editor.

You will receive a rough script that may be in Hindi, Hinglish, or broken English. Two-step thinking before you write:
1. INTERNALLY extract the core meaning, emotional beats, characters, and story logic. Do not output this step.
2. Then rewrite the script as a polished cinematic English screenplay.

ABSOLUTE RULES (meaning-lock):
- Preserve 100% of the original meaning, intent, emotion, and story logic.
- Do NOT invent new plot points, characters, or settings.
- Do NOT remove information present in the source.
- If a Hinglish/Hindi phrase is ambiguous, choose the most natural English equivalent that preserves intent.

OUTPUT FORMAT (industry-standard screenplay):
- Scene headings in CAPS on their own line: INT. LOCATION - DAY  /  EXT. LOCATION - NIGHT
- Action lines in present tense, vivid but concise.
- CHARACTER names in CAPS on their own line, immediately above their dialogue.
- Parentheticals (lowercase, in parens) only when delivery cue is essential.
- Blank line between blocks.
- Break the script into clear scenes whenever the location, time, or focus changes.

Return ONLY the screenplay text. No preamble, no markdown fences, no commentary.`;

const STRICT_SYSTEM = `You are a precise editor. Take the user's rough script (Hindi, Hinglish, or broken English) and produce clean, grammatical English.

RULES:
- Preserve 100% of meaning, structure, and order.
- Fix grammar, spelling, awkward phrasing only.
- Do NOT reformat into screenplay style.
- Do NOT add or remove content.

Return only the cleaned text.`;

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
          temperature: 0.65,
          stream: true,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        const txt = await res.text();
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
        } catch (e) {
          return new Response(
            JSON.stringify({ error: "Invalid request body" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const system =
          parsed.mode === "cinematic" ? CINEMATIC_SYSTEM : STRICT_SYSTEM;

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
            JSON.stringify({
              error: "AI service unavailable. Please retry.",
            }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }

        if (!upstream.ok || !upstream.body) {
          const t = await upstream.text().catch(() => "");
          console.error("convert: bad upstream", upstream.status, t);
          return new Response(
            JSON.stringify({
              error: `AI gateway error (${upstream.status}).`,
            }),
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
