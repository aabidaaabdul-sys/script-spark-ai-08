import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const convertSchema = z.object({
  script: z.string().min(1).max(60000),
  mode: z.enum(["cinematic", "strict"]).default("cinematic"),
});

const SYSTEM_PROMPTS = {
  cinematic: `You are a master screenwriter. Convert the user's rough script (which may be in Hindi, Hinglish, or broken English) into a polished, cinematic English screenplay.

ABSOLUTE RULES:
- Preserve 100% of the original meaning, intent, emotion, and story logic.
- Do NOT add new plot points or remove any information.
- Improve grammar, flow, dialogue rhythm, scene clarity, and emotional impact.

OUTPUT FORMAT (industry-standard screenplay):
- Scene headings in CAPS: INT. LOCATION - DAY / EXT. LOCATION - NIGHT
- Action lines in present tense, vivid but concise.
- CHARACTER names in CAPS centered above their dialogue.
- Parentheticals (in lowercase) for delivery cues only when needed.
- Blank lines between blocks.

Return ONLY the screenplay text. No preamble, no markdown fences.`,
  strict: `You are an editor. Take the user's rough script (Hindi, Hinglish, or broken English) and translate/clean it into clear, grammatical English.

RULES:
- Preserve 100% of meaning and structure.
- Fix grammar, spelling, and awkward phrasing only.
- Do NOT reformat into screenplay style.
- Do NOT add or remove content.

Return only the cleaned text.`,
};

export const convertScript = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => convertSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "OPENAI_API_KEY is not configured." };
    }

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.7,
          messages: [
            { role: "system", content: SYSTEM_PROMPTS[data.mode] },
            { role: "user", content: data.script },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("OpenAI error:", res.status, text);
        return {
          ok: false as const,
          error: `Conversion failed (${res.status}). Please try again.`,
        };
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const output = json.choices?.[0]?.message?.content?.trim() ?? "";
      if (!output) {
        return { ok: false as const, error: "Empty response from model." };
      }
      return { ok: true as const, output };
    } catch (err) {
      console.error("convertScript error:", err);
      return {
        ok: false as const,
        error: "Network error during conversion. Please retry.",
      };
    }
  });

const ttsSchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().min(1).max(64),
  stability: z.number().min(0).max(1).default(0.5),
  similarity: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0.4),
  speed: z.number().min(0.7).max(1.2).default(1.0),
});

export const synthesizeNarration = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ttsSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return {
        ok: false as const,
        error: "ELEVENLABS_API_KEY is not configured.",
      };
    }

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
          data.voiceId,
        )}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: data.text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: data.stability,
              similarity_boost: data.similarity,
              style: data.style,
              use_speaker_boost: true,
              speed: data.speed,
            },
          }),
        },
      );

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
      console.error("synthesizeNarration error:", err);
      return {
        ok: false as const,
        error: "Network error during voice synthesis.",
      };
    }
  });
