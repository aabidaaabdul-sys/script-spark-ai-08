/**
 * ImageGenerationService — provider abstraction. Swap the provider via
 * IMAGE_PROVIDER / IMAGE_MODEL env vars without touching routes or UI.
 */

export type ImageRequest = {
  prompt: string;
  aspectRatio: string;
  references: { mime: string; bytes: Uint8Array }[];
  signal?: AbortSignal;
};

export type ImageResult = { mime: string; base64: string; model: string; provider: string };

export class ImageGenError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

interface ImageProvider {
  name: string;
  generate(req: ImageRequest): Promise<ImageResult>;
}

function sizeFor(aspect: string) {
  if (aspect === "9:16") return "1024x1536";
  if (aspect === "1:1") return "1024x1024";
  return "1536x1024"; // 16:9, 4:3, 21:9 — closest landscape size; composition guided by prompt
}

function friendly(status: number, body: string) {
  if (status === 429) return "Too many image requests right now. Retrying shortly may help.";
  if (status === 402) return "Image credits are used up. Add credits to continue.";
  if (status === 403) return "The image service refused this request.";
  if (status === 400) return `The image request was rejected: ${body.slice(0, 160)}`;
  return `Image service error (${status}).`;
}

class LovableGatewayProvider implements ImageProvider {
  name = "lovable-gateway";
  constructor(
    private apiKey: string,
    private model: string,
  ) {}
  async generate(req: ImageRequest): Promise<ImageResult> {
    const base = "https://ai.gateway.lovable.dev/v1/images";
    let r: Response;
    if (req.references.length) {
      const form = new FormData();
      form.set("model", this.model);
      form.set("prompt", req.prompt);
      form.set("size", sizeFor(req.aspectRatio));
      req.references.forEach((ref, i) =>
        form.append("image[]", new Blob([ref.bytes as BlobPart], { type: ref.mime }), `ref-${i}.${ref.mime.split("/")[1]}`),
      );
      r = await fetch(`${base}/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: req.signal,
      });
    } else {
      r = await fetch(`${base}/generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: req.prompt, size: sizeFor(req.aspectRatio) }),
        signal: req.signal,
      });
    }
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("[image] provider", r.status, t.slice(0, 300));
      throw new ImageGenError(friendly(r.status, t), r.status);
    }
    const data = await r.json();
    const b64: string | undefined = data?.data?.[0]?.b64_json;
    if (!b64) throw new ImageGenError("The image service returned no image.", 502);
    return { mime: "image/png", base64: b64, model: this.model, provider: this.name };
  }
}

export function getImageService(): ImageProvider {
  const provider = process.env["IMAGE_PROVIDER"] || "lovable-gateway";
  const model = process.env["IMAGE_MODEL"] || "openai/gpt-image-2.5-sunburst";
  if (provider === "lovable-gateway") {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new ImageGenError("Image service is not configured.", 500);
    return new LovableGatewayProvider(key, model);
  }
  throw new ImageGenError(`Unknown image provider "${provider}".`, 500);
}
