import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Lang = z.enum(["hinglish", "hindi", "urdu", "english"]);
const Message = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20_000),
});

const Body = z.object({
  messages: z.array(Message).min(1).max(40),
  script: z.string().max(2_000_000).default(""),
  mode: z.string().max(40).default("standard"),
  lang: Lang.default("hinglish"),
  brainstorm: z.boolean().default(false),
});

type Provider = { name: string; url: string; key: string; model: string };

function getProviders(): Provider[] {
  const out: Provider[] = [];
  const lk = process.env.LOVABLE_API_KEY;
  if (lk)
    out.push({
      name: "lovable",
      url: "https://ai.gateway.lovable.dev/v1/chat/completions",
      key: lk,
      model: "google/gemini-3-flash-preview",
    });
  const ok = process.env.OPENAI_API_KEY;
  if (ok)
    out.push({
      name: "openai",
      url: "https://api.openai.com/v1/chat/completions",
      key: ok,
      model: "gpt-4o-mini",
    });
  return out;
}

function buildSystem(opts: {
  mode: string;
  lang: string;
  brainstorm: boolean;
  hasScript: boolean;
}) {
  return `ROLE
You are ScriptForge Co-Writer — a senior, award-winning screenwriter and creative
collaborator. You partner with the user to refine, rewrite, expand, brainstorm,
and elevate their screenplay. You think like Fincher, Imtiaz Ali, Sriram Raghavan,
Villeneuve, Lonergan combined.

CONTEXT
- Current screenplay style mode: ${opts.mode}
- Original input language: ${opts.lang}
- ${opts.brainstorm ? "BRAINSTORM MODE: prioritise creative ideation — ideas, twists, motives, scene concepts." : "EDIT MODE: prioritise refining the existing script."}
- ${opts.hasScript ? "A current screenplay is provided in the SYSTEM SCRIPT block." : "No screenplay yet — help the user develop one."}

CONVERSATION RULES
- Reply in the SAME language the user wrote in (Hinglish / Hindi / Urdu / English). Auto-detect.
- Be a creative partner: warm, sharp, decisive, never robotic.
- Keep replies concise unless the user asks for depth. Use short paragraphs.
- Preserve all character names, story events, prior changes, and continuity.
- Never break screenplay format. Never invent contradictions to the source.

SCRIPT-EDITING PROTOCOL (very important)
When the user asks you to MODIFY the screenplay (rewrite, improve, add, expand,
shorten, darker, more suspense, fix dialogue, etc.), you MUST:
1) Write a SHORT chat reply (1-3 sentences) explaining what you changed.
2) Then output the FULL updated screenplay wrapped EXACTLY between these markers
   on their own lines, with no markdown fences:

<<<SCRIPT_REWRITE>>>
FADE IN:
... full updated screenplay here, industry-standard format ...
FADE OUT.
<<<END_SCRIPT_REWRITE>>>

3) Inside the markers, output ONLY clean screenplay text — no commentary, no
   markdown, no code fences. Preserve scene headings, character cues in ALL CAPS,
   action lines, dialogue, parentheticals, and transitions.
4) Keep every existing character name and important story beat unless the user
   explicitly asked to remove them. Edit surgically — do not bloat the script.

When the user is only chatting, asking questions, or brainstorming, DO NOT emit
the SCRIPT_REWRITE markers. Just reply conversationally.

QUALITY BAR
- Dialogue must sound like real humans.
- Action must be visual, present-tense, concrete.
- Tone of mode "${opts.mode}" must be felt throughout.
- Never output meta-commentary like "Here is your script". Just deliver.`;
}

async function callStream(
  provider: Provider,
  messages: { role: string; content: string }[],
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
      messages,
    }),
  });
}

export const Route = createFileRoute("/api/cowriter")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const providers = getProviders();
        if (providers.length === 0) {
          return new Response(
            JSON.stringify({ error: "AI is not configured." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        let body;
        try {
          body = Body.parse(await request.json());
        } catch {
          return new Response(
            JSON.stringify({ error: "Invalid request body." }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const system = buildSystem({
          mode: body.mode,
          lang: body.lang,
          brainstorm: body.brainstorm,
          hasScript: body.script.trim().length > 0,
        });

        const MAX_SCRIPT_CTX = 60_000;
        const scriptCtx =
          body.script.length > MAX_SCRIPT_CTX
            ? body.script.slice(0, MAX_SCRIPT_CTX / 2) +
              "\n\n[... middle truncated for context ...]\n\n" +
              body.script.slice(-MAX_SCRIPT_CTX / 2)
            : body.script;

        const sysWithScript = scriptCtx.trim()
          ? `${system}\n\nSYSTEM SCRIPT (current screenplay — your single source of truth):\n"""\n${scriptCtx}\n"""`
          : system;

        const messages = [
          { role: "system", content: sysWithScript },
          ...body.messages.map((m) => ({ role: m.role, content: m.content })),
        ];

        let upstream: Response | null = null;
        let lastErr = "AI service unavailable.";
        for (const provider of providers) {
          try {
            const r = await callStream(provider, messages, request.signal);
            if (r.ok && r.body) {
              upstream = r;
              break;
            }
            const t = await r.text().catch(() => "");
            console.error(`[cowriter] ${provider.name} ${r.status}: ${t.slice(0, 300)}`);
            if (r.status === 429) lastErr = "Rate limit reached. Please wait a moment and retry.";
            else if (r.status === 402) lastErr = "AI credits exhausted. Add credits in Workspace → Usage.";
            else if (r.status === 401 || r.status === 403) lastErr = "AI key unauthorized.";
            else lastErr = `${provider.name} error (${r.status}).`;
          } catch (e) {
            console.error(`[cowriter] ${provider.name} threw:`, e);
            lastErr = `${provider.name} request failed.`;
          }
        }
        if (!upstream) {
          return new Response(JSON.stringify({ error: lastErr }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
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
