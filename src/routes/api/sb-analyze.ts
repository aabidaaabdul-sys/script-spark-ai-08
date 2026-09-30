import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SHOT_TYPES } from "@/lib/storyboard-types";

/**
 * Script analysis for a batch of parsed scenes. Receives the current Character /
 * Location Bible so recurring entities keep the same id and description.
 */

const s = (n: number) => z.string().max(n).default("");
const Scene = z.object({
  id: z.string().max(80),
  heading: s(200),
  intExt: s(10),
  location: s(160),
  timeOfDay: s(60),
  characters: z.array(z.string().max(60)).max(20).default([]),
  action: s(2000),
  dialogue: s(1200),
});
const Body = z.object({
  scenes: z.array(Scene).min(1).max(15),
  characters: z.array(z.record(z.string(), z.string().max(400))).max(60).default([]),
  locations: z.array(z.record(z.string(), z.string().max(400))).max(60).default([]),
});

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const SYSTEM = `You are a film pre-production analyst building storyboard data from a screenplay.
Return ONLY one json object with keys "characters", "locations", "scenes".

Rules:
- Use ONLY facts stated or clearly implied by the script. Never invent gender, age, clothing, locations, time or events that contradict it. If unknown, use "" (empty string). Scripts may be in Hindi/Urdu/Hinglish; always write values in English.
- "characters": the FULL updated Character Bible — every existing entry (keep its id and existing details, only fill empty fields or add details the new scenes state) plus new characters. Fields: id (lowercase-kebab of the name), name, ageRange, gender, appearance, hair, clothing, accessories, visualCues.
- "locations": the FULL updated Location Bible, same merge rule. Fields: id (lowercase-kebab), name, architecture, environment, objects, lighting, palette.
- "scenes": one entry per input scene, same order, fields: sceneId (copy input id), title (<=8 words), description (1-2 sentences of what the viewer sees), locationId, characters (array of character ids visible), action, objects, weather, mood (one or two words), cameraShot (one of: ${SHOT_TYPES.join(", ")}), cameraDirection (e.g. "establishing shot", "character-focused composition", "action-focused composition", "environmental composition"; "" if it adds nothing), lighting, keyMoment (the single most important visual moment to draw).
- Pick shots that fit the scene; do not force dramatic angles on simple scenes.`;

async function readResponsesStream(r: Response): Promise<string> {
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try {
          const ev = JSON.parse(d);
          if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
          if (ev.type === "error" || ev.type === "response.failed")
            throw new Error(ev.error?.message || ev.response?.error?.message || "Analysis failed");
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
  return text;
}

export const Route = createFileRoute("/api/sb-analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return json({ error: "Analysis service is not configured." }, 500);
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return json({ error: "Invalid analysis request." }, 400);
        }
        const input = {
          existingCharacterBible: body.characters,
          existingLocationBible: body.locations,
          scenes: body.scenes,
        };
        let r: Response;
        try {
          r = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
            method: "POST",
            signal: request.signal,
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
            body: JSON.stringify({
              model: "openai/gpt-6-astra",
              reasoning: { effort: "low" },
              store: false,
              stream: true,
              instructions: SYSTEM,
              input: `Analyze these scenes and return json:\n${JSON.stringify(input)}`,
              text: { format: { type: "json_object" } },
            }),
          });
        } catch (e) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          return json({ error: "Could not reach the analysis service." }, 502);
        }
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          console.error("[sb-analyze]", r.status, t.slice(0, 300));
          const msg =
            r.status === 429 ? "Too many requests. Please wait a moment." :
            r.status === 402 ? "Credits are used up. Add credits to continue." :
            `Script analysis failed (${r.status}).`;
          return json({ error: msg }, r.status === 429 || r.status === 402 ? r.status : 502);
        }
        let parsed: any;
        try {
          const text = await readResponsesStream(r);
          parsed = JSON.parse(text);
        } catch (e) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          console.error("[sb-analyze] parse", e);
          return json({ error: "Script analysis returned unreadable data. Retry." }, 502);
        }
        const str = (v: unknown, n = 400) => (typeof v === "string" ? v.slice(0, n) : "");
        const arr = (v: unknown) => (Array.isArray(v) ? v : []);
        return json({
          characters: arr(parsed.characters).filter((c: any) => c?.id && c?.name).map((c: any) => ({
            id: str(c.id, 60), name: str(c.name, 80), ageRange: str(c.ageRange, 40), gender: str(c.gender, 30),
            appearance: str(c.appearance), hair: str(c.hair, 120), clothing: str(c.clothing), accessories: str(c.accessories, 200), visualCues: str(c.visualCues),
          })),
          locations: arr(parsed.locations).filter((l: any) => l?.id && l?.name).map((l: any) => ({
            id: str(l.id, 60), name: str(l.name, 120), architecture: str(l.architecture), environment: str(l.environment),
            objects: str(l.objects), lighting: str(l.lighting, 200), palette: str(l.palette, 200),
          })),
          scenes: arr(parsed.scenes).map((x: any) => ({
            sceneId: str(x.sceneId, 80), title: str(x.title, 80), description: str(x.description, 500), locationId: str(x.locationId, 60),
            characters: arr(x.characters).map((c: unknown) => str(c, 60)).filter(Boolean),
            action: str(x.action, 500), objects: str(x.objects, 300), weather: str(x.weather, 80), mood: str(x.mood, 40),
            cameraShot: str(x.cameraShot, 40) || "Medium Shot", cameraDirection: str(x.cameraDirection, 80),
            lighting: str(x.lighting, 200), keyMoment: str(x.keyMoment, 400),
          })),
        });
      },
    },
  },
});
