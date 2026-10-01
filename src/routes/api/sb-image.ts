import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getImageService, ImageGenError } from "@/lib/image-generation.server";

const MAX_REF_BYTES = 4 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();

const Body = z.object({
  prompt: z.string().min(10).max(6000),
  aspectRatio: z.enum(["16:9", "9:16", "4:3", "1:1", "21:9"]).default("16:9"),
  quality: z.enum(["fast", "cinematic", "max"]).default("cinematic"),
  purpose: z.enum(["scene", "correct"]).default("scene"),
  references: z.array(z.string().max(6_000_000)).max(3).default([]),
  meta: z
    .object({
      sceneDescription: z.string().max(1000).optional(),
      characters: z.array(z.string().max(80)).max(12).optional(),
      location: z.string().max(200).optional(),
      timeOfDay: z.string().max(60).optional(),
      mood: z.string().max(60).optional(),
      cameraShot: z.string().max(80).optional(),
      visualStyle: z.string().max(300).optional(),
    })
    .default({}),
});

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/sb-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return json({ error: "Invalid image request." }, 400);
        }
        const refs: { mime: string; bytes: Uint8Array }[] = [];
        for (const r of body.references) {
          const m = r.match(/^data:([^;]+);base64,(.+)$/);
          if (!m || !ALLOWED.includes(m[1])) return json({ error: "Reference images must be PNG, JPEG or WebP." }, 400);
          const bytes = Uint8Array.from(Buffer.from(m[2], "base64"));
          if (bytes.byteLength > MAX_REF_BYTES) return json({ error: "Reference image is larger than 4 MB." }, 400);
          refs.push({ mime: m[1], bytes });
        }
        let prompt = clean(body.prompt);
        if (body.purpose === "correct") {
          if (!refs.length) return json({ error: "Correction needs the image to fix." }, 400);
          prompt =
            "Edit the FIRST attached image. Keep composition, characters, identity, clothing, location and lighting the same; change ONLY what this correction asks:\n" +
            prompt;
        } else if (refs.length)
          prompt =
            "Use the attached reference image(s) only to keep the character/location appearance consistent. Create a NEW scene as described:\n" +
            prompt;
        try {
          const svc = getImageService();
          const started = Date.now();
          const out = await svc.generate({ prompt, aspectRatio: body.aspectRatio, references: refs, quality: body.quality, signal: request.signal });
          return json({
            image: `data:${out.mime};base64,${out.base64}`,
            metadata: {
              provider: out.provider,
              model: out.model,
              aspectRatio: body.aspectRatio,
              usedReferences: refs.length,
              quality: body.quality,
              purpose: body.purpose,
              ms: Date.now() - started,
              ...body.meta,
              createdAt: new Date().toISOString(),
            },
          });
        } catch (e) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          if (e instanceof ImageGenError) return json({ error: e.message }, e.status >= 500 ? 502 : e.status);
          console.error("[sb-image]", e);
          return json({ error: "Image generation failed. Please retry." }, 502);
        }
      },
    },
  },
});
