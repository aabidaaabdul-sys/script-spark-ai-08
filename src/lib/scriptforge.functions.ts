import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabase } from "@/integrations/supabase/client";

const attachAuthHeader = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);

const ttsSchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().min(1).max(64),
  stability: z.number().min(0).max(1).default(0.5),
  similarity: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0.4),
  speed: z.number().min(0.7).max(1.2).default(1.0),
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const synthesizeNarration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ttsSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return {
        ok: false as const,
        error: "ELEVENLABS_API_KEY is not configured.",
      };
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      data.voiceId,
    )}?output_format=mp3_44100_128`;

    const body = JSON.stringify({
      text: data.text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: data.stability,
        similarity_boost: data.similarity,
        style: data.style,
        use_speaker_boost: true,
        speed: data.speed,
      },
    });

    let lastError = "Unknown error";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body,
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = `ElevenLabs ${res.status}`;
          await sleep(400 * Math.pow(2, attempt));
          continue;
        }
        if (!res.ok) {
          const text = await res.text();
          console.error("ElevenLabs error:", res.status, text);
          return {
            ok: false as const,
            error: `Voice synthesis failed (${res.status}).`,
          };
        }
        const buf = await res.arrayBuffer();
        const base64 = Buffer.from(buf).toString("base64");
        return { ok: true as const, audioBase64: base64 };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await sleep(400 * Math.pow(2, attempt));
      }
    }

    console.error("synthesizeNarration exhausted retries:", lastError);
    return {
      ok: false as const,
      error: "Voice synthesis is temporarily unavailable. Please retry.",
    };
  });
