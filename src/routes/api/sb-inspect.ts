import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Visual QA: a vision-capable model compares a generated frame against the
 * structured scene requirements. Returns categorical checks (no invented
 * numeric scores) plus a targeted correction instruction when fixable.
 */

const MODEL = "openai/gpt-6-astra";
const Body = z.object({
  image: z.string().max(12_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/),
  scene: z.object({
    heading: z.string().max(200).default(""),
    description: z.string().max(1000).default(""),
    keyMoment: z.string().max(500).default(""),
    timeOfDay: z.string().max(60).default(""),
    location: z.string().max(400).default(""),
    characters: z.array(z.string().max(500)).max(12).default([]),
    objects: z.string().max(400).default(""),
    cameraShot: z.string().max(80).default(""),
    lighting: z.string().max(200).default(""),
    style: z.string().max(300).default(""),
  }),
});

const CHECKS = [
  "Character count", "Character identity & clothing", "Character positions", "Objects & props",
  "Location & environment", "Time of day & lighting", "Composition & camera shot", "Anatomy & faces",
  "Artifacts & unintended text", "Perspective", "Contradictions with screenplay",
];

const SYSTEM = `You are a strict storyboard quality inspector. Look at the image and compare it to the scene requirements.
Return ONLY a json object: {"checks":[{"name":string,"result":"pass"|"issue"|"unclear","note":string}],"issues":[string],"fixType":"none"|"edit"|"regenerate","correction":string}
- Include exactly these checks in order: ${CHECKS.join(", ")}.
- "issue" only for a clear, meaningful defect a director would reject (wrong number of people, wrong gender/clothing, missing key prop, day instead of night, extra limbs/fingers, garbled face, visible text/watermark, wrong location). Minor stylistic differences are "pass". Use "unclear" when you cannot judge.
- "fixType": "edit" for a localized defect fixable by editing this image; "regenerate" when the whole composition is wrong; "none" if no issues.
- "correction": one concise imperative instruction describing exactly what to change (e.g. "Remove the third person on the left; make the lamp off; keep everything else identical"). "" if none.
- notes <= 20 words each. Never invent details not in the requirements.`;

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function readStream(r: Response): Promise<string> {
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
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
        let ev: any;
        try { ev = JSON.parse(d); } catch { continue; }
        if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
        if (ev.type === "error" || ev.type === "response.failed")
          throw new Error(ev.error?.message || ev.response?.error?.message || "Inspection failed");
      }
    }
  }
  return text;
}

export const Route = createFileRoute("/api/sb-inspect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return json({ error: "Service is not configured." }, 500);
        let body: z.infer<typeof Body>;
        try { body = Body.parse(await request.json()); }
        catch { return json({ error: "Invalid inspection request." }, 400); }
        const sc = body.scene;
        const req = [
          `Heading: ${sc.heading}`, `What happens: ${sc.description}`, `Key moment: ${sc.keyMoment}`,
          `Time of day: ${sc.timeOfDay || "unspecified"}`, `Location: ${sc.location}`,
          `Characters that must be visible (${sc.characters.length}): ${sc.characters.join(" | ") || "none"}`,
          `Important objects: ${sc.objects || "none"}`, `Camera: ${sc.cameraShot}`, `Lighting: ${sc.lighting}`, `Style: ${sc.style}`,
        ].join("\n");
        let r: Response;
        try {
          r = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
            method: "POST",
            signal: request.signal,
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
            body: JSON.stringify({
              model: MODEL,
              reasoning: { effort: "low" },
              store: false,
              stream: true,
              instructions: SYSTEM,
              text: { format: { type: "json_object" } },
              input: [{ role: "user", content: [
                { type: "input_text", text: `Scene requirements:\n${req}\n\nInspect the image and return json.` },
                { type: "input_image", image_url: body.image },
              ] }],
            }),
          });
        } catch {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          return json({ error: "Could not reach the inspection service." }, 502);
        }
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          console.error("[sb-inspect]", r.status, t.slice(0, 300));
          const msg = r.status === 429 ? "Too many requests. Please wait a moment." :
            r.status === 402 ? "Credits are used up. Add credits to continue." : `Image inspection failed (${r.status}).`;
          return json({ error: msg }, r.status === 429 || r.status === 402 || r.status === 403 ? r.status : 502);
        }
        let parsed: any;
        try { parsed = JSON.parse(await readStream(r)); }
        catch (e) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          console.error("[sb-inspect] parse", e);
          return json({ error: "Inspection returned unreadable data. Retry." }, 502);
        }
        const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
        const checks = (Array.isArray(parsed.checks) ? parsed.checks : []).slice(0, 14).map((c: any) => ({
          name: s(c?.name, 60), result: ["pass", "issue", "unclear"].includes(c?.result) ? c.result : "unclear", note: s(c?.note, 200),
        }));
        const issues = (Array.isArray(parsed.issues) ? parsed.issues : []).map((x: unknown) => s(x, 200)).filter(Boolean).slice(0, 10);
        const hasIssue = issues.length > 0 || checks.some((c: any) => c.result === "issue");
        const fixType = hasIssue ? (parsed.fixType === "regenerate" ? "regenerate" : "edit") : "none";
        return json({
          status: hasIssue ? "needs_fix" : "approved",
          checks, issues, fixType,
          correction: hasIssue ? s(parsed.correction, 600) : "",
          model: MODEL, at: Date.now(),
        });
      },
    },
  },
});
