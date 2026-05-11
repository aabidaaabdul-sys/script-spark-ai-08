import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Single-frame image renderer for the AI Storyboard.
 * Calls the Lovable AI Gateway image model and returns a data URL so the
 * client can render it instantly in a <img> tag.
 */

const Body = z.object({
  prompt: z.string().min(4).max(1200),
  // Style hint is already baked into the prompt by the planner, but we accept
  // an optional reinforcement so the user can re-roll with a new look.
  styleSuffix: z.string().max(400).optional(),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:3"]).default("16:9"),
});

export const Route = createFileRoute("/api/storyboard-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return new Response(
            JSON.stringify({ error: "Image service is not configured." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        let body;
        try {
          body = Body.parse(await request.json());
        } catch (e) {
          return new Response(
            JSON.stringify({
              error: "Invalid image request.",
              detail: e instanceof Error ? e.message : String(e),
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const aspectHint =
          body.aspect === "16:9"
            ? "widescreen 16:9 cinematic frame"
            : body.aspect === "9:16"
              ? "vertical 9:16 cinematic frame"
              : body.aspect === "1:1"
                ? "square 1:1 cinematic frame"
                : "4:3 classic film frame";

        const finalPrompt =
          `${body.prompt}\n\nFraming: ${aspectHint}. ` +
          (body.styleSuffix ? body.styleSuffix : "") +
          " No text, no watermarks, no captions, no logos. Photoreal cinematic quality.";

        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          signal: request.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-image",
            messages: [{ role: "user", content: finalPrompt }],
            modalities: ["image", "text"],
          }),
        });

        if (!r.ok) {
          const t = await r.text().catch(() => "");
          let msg = `Image generation error (${r.status}).`;
          if (r.status === 429)
            msg = "Rate limit reached. Slow down or retry in a moment.";
          else if (r.status === 402)
            msg = "Credits exhausted. Add credits in Workspace → Usage.";
          console.error("[storyboard-image] gateway", r.status, t.slice(0, 240));
          return new Response(JSON.stringify({ error: msg }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        const data = await r.json();
        const url: string | undefined =
          data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (!url) {
          return new Response(
            JSON.stringify({ error: "No image returned." }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ url }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
