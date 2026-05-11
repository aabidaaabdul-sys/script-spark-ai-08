import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * AI Storyboard — frame planner.
 * Uses the Lovable AI Gateway with tool-calling to break a screenplay into
 * cinematic storyboard frames. Image rendering is handled separately
 * by /api/storyboard-image so we can stream frames into the UI as they finish.
 */

const Body = z.object({
  script: z.string().min(1).max(60_000),
  style: z.string().default("cinematic-realistic"),
  detail: z.enum(["quick", "detailed", "cinematic"]).default("detailed"),
  frames: z.number().int().min(3).max(24).default(10),
  mode: z.string().default("standard"),
});

const STYLE_HINTS: Record<string, string> = {
  "cinematic-realistic":
    "photoreal cinematic film still, 35mm anamorphic lens, dramatic key lighting, shallow depth of field, color-graded like a feature film",
  "dark-thriller":
    "dark thriller cinematography, low-key lighting, deep shadows, moody teal-and-amber grade, neo-noir composition",
  documentary:
    "observational documentary photography, available light, handheld feel, natural skin tones, journalistic framing",
  anime:
    "modern anime key visual, hand-painted backgrounds, expressive lighting, 2D cel shading, Studio-Ghibli/Makoto-Shinkai influence",
  comic:
    "graphic-novel storyboard illustration, bold ink lines, dynamic panel composition, dramatic comic-book shading",
  minimal:
    "minimal black-and-white storyboard sketch, clean pencil lines, simple shapes, clear staging, pre-vis style",
};

function getKey() {
  return process.env.LOVABLE_API_KEY;
}

export const Route = createFileRoute("/api/storyboard")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = getKey();
        if (!key) {
          return new Response(
            JSON.stringify({ error: "Storyboard service is not configured." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        let body;
        try {
          body = Body.parse(await request.json());
        } catch (e) {
          return new Response(
            JSON.stringify({
              error: "Invalid storyboard request.",
              detail: e instanceof Error ? e.message : String(e),
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const styleHint = STYLE_HINTS[body.style] ?? STYLE_HINTS["cinematic-realistic"];
        const detailHint =
          body.detail === "quick"
            ? "Pick only the most pivotal beats. Short prompts."
            : body.detail === "cinematic"
              ? "Treat each frame like a hero shot. Rich, detailed visual prompts."
              : "Balanced coverage of the story arc.";

        // Truncate very long scripts so the planner stays fast.
        const MAX = 18_000;
        const script =
          body.script.length > MAX
            ? body.script.slice(0, MAX / 2) +
              "\n\n[... middle truncated for planning ...]\n\n" +
              body.script.slice(-MAX / 2)
            : body.script;

        const system = `You are a senior film storyboard artist and DP. Break the
provided screenplay into ${body.frames} cinematic storyboard frames in script
order. ${detailHint}

For EACH frame return:
- title: short scene title (max 8 words, in English even if script is in another language)
- description: one cinematic sentence describing what the viewer sees
- camera: one of [Close-Up, Wide Shot, Medium Shot, Establishing Shot, Over the Shoulder, POV, Low Angle, High Angle, Tracking Shot, Handheld]
- mood: one short tag like Horror, Suspense, Emotional, Thriller, Action, Calm, Romantic, Tense, Hopeful
- prompt: a rich visual generation prompt (35-70 words). Always APPEND this style hint to every prompt: "${styleHint}". Describe environment, lighting, character look (age/build/clothes if known), composition, and lens. Maintain CHARACTER CONSISTENCY: the same character must look the same in every frame they appear in. Never put words/text in the image. No logos.
- characters: array of character names appearing in the frame (use [] if none)

Detect language naturally — script may be Hinglish, Hindi, Urdu, or English. The
prompts you return must always be in clean English so an image model can render them.
Story mode: ${body.mode}. Visual style key: ${body.style}.`;

        const tool = {
          type: "function" as const,
          function: {
            name: "emit_storyboard",
            description: "Return the storyboard frames in script order.",
            parameters: {
              type: "object",
              properties: {
                frames: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" },
                      camera: { type: "string" },
                      mood: { type: "string" },
                      prompt: { type: "string" },
                      characters: { type: "array", items: { type: "string" } },
                    },
                    required: ["title", "description", "camera", "mood", "prompt"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["frames"],
              additionalProperties: false,
            },
          },
        };

        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          signal: request.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: system },
              { role: "user", content: `SCREENPLAY:\n"""\n${script}\n"""` },
            ],
            tools: [tool],
            tool_choice: { type: "function", function: { name: "emit_storyboard" } },
          }),
        });

        if (!r.ok) {
          const t = await r.text().catch(() => "");
          let msg = `Storyboard planner error (${r.status}).`;
          if (r.status === 429) msg = "Rate limit reached. Please wait a moment and retry.";
          else if (r.status === 402) msg = "Credits exhausted. Add credits in Workspace → Usage.";
          console.error("[storyboard] gateway", r.status, t.slice(0, 280));
          return new Response(JSON.stringify({ error: msg }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        const data = await r.json();
        const call = data?.choices?.[0]?.message?.tool_calls?.[0];
        const argsRaw = call?.function?.arguments;
        if (!argsRaw) {
          return new Response(
            JSON.stringify({ error: "Planner returned no frames." }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }
        let parsed;
        try {
          parsed = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
        } catch {
          return new Response(
            JSON.stringify({ error: "Planner returned malformed JSON." }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }

        const frames = Array.isArray(parsed?.frames) ? parsed.frames : [];
        const cleaned = frames
          .filter(
            (f: any) =>
              f && typeof f.title === "string" && typeof f.prompt === "string",
          )
          .slice(0, body.frames)
          .map((f: any, i: number) => ({
            id: `frame-${Date.now()}-${i}`,
            title: String(f.title).slice(0, 80),
            description: String(f.description ?? "").slice(0, 280),
            camera: String(f.camera ?? "Medium Shot").slice(0, 30),
            mood: String(f.mood ?? "Cinematic").slice(0, 24),
            prompt: String(f.prompt).slice(0, 700),
            characters: Array.isArray(f.characters)
              ? f.characters.slice(0, 6).map((c: any) => String(c).slice(0, 40))
              : [],
          }));

        return new Response(JSON.stringify({ frames: cleaned, style: body.style }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
