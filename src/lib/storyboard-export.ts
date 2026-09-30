import jsPDF from "jspdf";
import JSZip from "jszip";
import type { CharacterEntry, StoryFrame } from "@/lib/storyboard-types";

export type ExportItem = { frame: StoryFrame; image?: string };
export type PdfOptions = { description: boolean; characters: boolean; camera: boolean; dialogue: boolean; prompt: boolean };

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "scene";
export const fileName = (f: StoryFrame) => `scene-${String(f.number).padStart(2, "0")}-${slug(f.title || f.heading)}.png`;

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadDataUrl(dataUrl: string, name: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Image could not be decoded"));
    i.src = src;
  });
}

/** Re-encode to JPEG to keep PDFs small. */
async function toJpeg(src: string, maxW = 1400) {
  const img = await loadImg(src);
  const scale = Math.min(1, maxW / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return { data: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height };
}

export async function exportPdf(items: ExportItem[], chars: CharacterEntry[], title: string, opt: PdfOptions) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 36;
  pdf.setFont("helvetica", "bold").setFontSize(28).text(title, M, H / 2 - 10);
  pdf.setFont("helvetica", "normal").setFontSize(12).text(`Storyboard · ${items.length} scenes · ${new Date().toLocaleDateString()}`, M, H / 2 + 16);
  const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id;
  for (const { frame: f, image } of items) {
    pdf.addPage();
    pdf.setFont("helvetica", "bold").setFontSize(14).text(`SCENE ${f.number} — ${f.heading}`.slice(0, 110), M, M + 6);
    const imgW = W * 0.58;
    const imgH = imgW * (9 / 16);
    if (image) {
      const j = await toJpeg(image);
      const h = Math.min(imgH * 1.3, imgW * (j.h / j.w));
      pdf.addImage(j.data, "JPEG", M, M + 20, imgW, h);
    } else {
      pdf.setDrawColor(150).rect(M, M + 20, imgW, imgH);
      pdf.setFontSize(10).text("No image generated", M + 10, M + 40);
    }
    let y = M + 30;
    const x = M + imgW + 18;
    const colW = W - x - M;
    const block = (label: string, text: string) => {
      if (!text) return;
      pdf.setFont("helvetica", "bold").setFontSize(9).text(label.toUpperCase(), x, y);
      y += 12;
      pdf.setFont("helvetica", "normal").setFontSize(9);
      const lines = pdf.splitTextToSize(text, colW).slice(0, 14);
      pdf.text(lines, x, y);
      y += lines.length * 11 + 8;
    };
    block("Title", f.title);
    if (opt.description) block("Description", f.description);
    if (opt.characters) block("Characters", f.characters.map(nameOf).join(", "));
    if (opt.camera) block("Camera", [f.cameraShot, f.cameraDirection].filter(Boolean).join(" — "));
    if (opt.dialogue) block("Dialogue", f.dialogueExcerpt);
    if (opt.prompt) block("Visual prompt", f.promptUsed || f.editedPrompt || f.originalPrompt);
    pdf.setFontSize(8).text(`${f.number}`, W - M, H - 18, { align: "right" });
  }
  save(pdf.output("blob"), `${slug(title)}-storyboard.pdf`);
}

export async function exportZip(items: ExportItem[], title: string) {
  const zip = new JSZip();
  const withImg = items.filter((i) => i.image);
  if (!withImg.length) throw new Error("No generated images to export.");
  for (const { frame, image } of withImg) zip.file(fileName(frame), image!.split(",")[1], { base64: true });
  zip.file(
    "storyboard.json",
    JSON.stringify(items.map((i) => ({ ...i.frame, image: i.image ? fileName(i.frame) : null })), null, 2),
  );
  save(await zip.generateAsync({ type: "blob" }), `${slug(title)}-storyboard.zip`);
}

export async function exportContactSheet(items: ExportItem[], title: string) {
  const cols = 4;
  const cw = 480;
  const ch = 270;
  const cap = 44;
  const pad = 16;
  const rows = Math.ceil(items.length / cols);
  const c = document.createElement("canvas");
  c.width = cols * (cw + pad) + pad;
  c.height = rows * (ch + cap + pad) + pad + 50;
  const g = c.getContext("2d")!;
  g.fillStyle = "#111";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#eee";
  g.font = "bold 26px sans-serif";
  g.fillText(title, pad, 36);
  for (let i = 0; i < items.length; i++) {
    const { frame, image } = items[i];
    const x = pad + (i % cols) * (cw + pad);
    const y = 50 + pad + Math.floor(i / cols) * (ch + cap + pad);
    g.fillStyle = "#222";
    g.fillRect(x, y, cw, ch);
    if (image) {
      const img = await loadImg(image);
      const s = Math.max(cw / img.width, ch / img.height);
      const sw = cw / s, sh = ch / s;
      g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, cw, ch);
    }
    g.fillStyle = "#ddd";
    g.font = "bold 15px sans-serif";
    g.fillText(`${frame.number}. ${frame.title}`.slice(0, 52), x, y + ch + 18);
    g.font = "12px sans-serif";
    g.fillStyle = "#999";
    g.fillText(`${frame.cameraShot} · ${frame.heading}`.slice(0, 70), x, y + ch + 35);
  }
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not encode the contact sheet.");
  save(blob, `${slug(title)}-contact-sheet.png`);
}
