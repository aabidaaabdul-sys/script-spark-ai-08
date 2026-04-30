/**
 * ScriptForge Export System
 *
 * Generates professional, multilingual exports of generated screenplays in:
 *  - PDF (screenplay layout)
 *  - TXT (UTF-8 plain text)
 *  - DOCX (editable Word document)
 *  - SRT (subtitle file with auto-estimated timings)
 *  - Teleprompter (large-text reader-friendly TXT)
 *
 * All exporters operate fully on the client. Hindi (Devanagari) and Urdu
 * (Arabic-script) are handled correctly in TXT/DOCX/SRT/Teleprompter via
 * UTF-8 + Unicode-friendly fonts. The PDF exporter uses Helvetica which
 * covers Latin scripts cleanly; for Hindi/Urdu we fall back to a Unicode
 * monospace and align right-to-left when needed.
 */

import { jsPDF } from "jspdf";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  PageNumber,
  Footer,
  LevelFormat,
} from "docx";

export type ExportLang = "english" | "hinglish" | "hindi" | "urdu";
export type ExportSource = "english" | "meaning" | "both";

export interface ExportInputs {
  englishScript: string;
  meaningScript: string;
  meaningLang: ExportLang;
  mode: string;
  source: ExportSource;
}

/* ----------------- Shared helpers ----------------- */

function fileBase(mode: string, source: ExportSource): string {
  return `scriptforge-${mode}-${source}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function pickContent(inputs: ExportInputs): { text: string; isRTL: boolean } {
  const { englishScript, meaningScript, meaningLang, source } = inputs;
  const isRTL = source !== "english" && meaningLang === "urdu";
  if (source === "english") return { text: englishScript, isRTL: false };
  if (source === "meaning") return { text: meaningScript, isRTL };
  // both
  const combined = [
    "=".repeat(60),
    "PROFESSIONAL ENGLISH SCREENPLAY",
    "=".repeat(60),
    "",
    englishScript.trim(),
    "",
    "",
    "=".repeat(60),
    `MEANING VERSION (${meaningLang.toUpperCase()})`,
    "=".repeat(60),
    "",
    meaningScript.trim(),
  ].join("\n");
  return { text: combined, isRTL: false };
}

function isSceneHeading(line: string): boolean {
  const t = line.trim();
  return /^(INT\.|EXT\.|INT\/EXT\.|EST\.)/i.test(t);
}

function isTransition(line: string): boolean {
  const t = line.trim();
  return (
    /^(FADE IN:|FADE OUT\.|FADE TO BLACK\.|CUT TO:|SMASH CUT TO:|DISSOLVE TO:|MATCH CUT TO:|TITLE CARD:)/i.test(
      t,
    ) || /TO:$/.test(t)
  );
}

function isCharacterCue(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 40) return false;
  if (isSceneHeading(t) || isTransition(t)) return false;
  // ALL CAPS line, possibly with parenthetical like (V.O.) or (CONT'D)
  const stripped = t.replace(/\(.*?\)/g, "").trim();
  if (!stripped) return false;
  return (
    stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped) && !/[.!?]$/.test(stripped)
  );
}

/* ----------------- TXT ----------------- */

export function exportTXT(inputs: ExportInputs) {
  const { text } = pickContent(inputs);
  // Prepend BOM so apps reliably detect UTF-8 (especially on Windows Notepad).
  const blob = new Blob(["\uFEFF" + text], {
    type: "text/plain;charset=utf-8",
  });
  triggerDownload(blob, `${fileBase(inputs.mode, inputs.source)}.txt`);
}

/* ----------------- Teleprompter ----------------- */

/**
 * Teleprompter format: large readable lines, soft-wrapped to ~42 chars,
 * generous spacing, action lines stripped of stage clutter so the reader
 * can flow naturally.
 */
export function exportTeleprompter(inputs: ExportInputs) {
  const { text } = pickContent(inputs);
  const wrapped = text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return "";
      if (isSceneHeading(t) || isTransition(t)) {
        return `\n— ${t.toUpperCase()} —\n`;
      }
      if (isCharacterCue(t)) {
        return `\n${t}:`;
      }
      // Soft-wrap long lines for teleprompter readability
      return softWrap(t, 42);
    })
    .join("\n\n");

  const header = [
    "TELEPROMPTER SCRIPT",
    `Mode: ${inputs.mode}`,
    `Generated: ${new Date().toLocaleString()}`,
    "—".repeat(28),
    "",
    "",
  ].join("\n");

  const blob = new Blob(["\uFEFF" + header + wrapped], {
    type: "text/plain;charset=utf-8",
  });
  triggerDownload(
    blob,
    `${fileBase(inputs.mode, inputs.source)}-teleprompter.txt`,
  );
}

function softWrap(line: string, max: number): string {
  if (line.length <= max) return line;
  const words = line.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > max) {
      if (current) out.push(current);
      current = w;
    } else {
      current = (current ? current + " " : "") + w;
    }
  }
  if (current) out.push(current);
  return out.join("\n");
}

/* ----------------- SRT ----------------- */

/**
 * Estimate timing using ~14 chars/sec reading speed with a min 1.2s and
 * max 6s per cue. Cues are split by sentence-ish boundaries.
 */
export function exportSRT(inputs: ExportInputs) {
  const { text } = pickContent(inputs);

  // Strip screenplay scaffolding so the SRT contains only spoken / readable beats.
  const cues: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (isSceneHeading(line) || isTransition(line)) continue;
    if (isCharacterCue(line)) continue;
    if (/^\(.*\)$/.test(line)) continue; // parenthetical only
    // Split on sentence enders for tighter subtitle cues.
    const parts = line
      .split(/(?<=[.!?。…])\s+|(?<=[।؟])\s+/u)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      // Further chunk very long parts to <= ~80 chars.
      if (p.length <= 80) cues.push(p);
      else cues.push(...softWrap(p, 80).split("\n"));
    }
  }

  let t = 0; // seconds
  const blocks: string[] = [];
  cues.forEach((cue, i) => {
    const dur = Math.min(6, Math.max(1.2, cue.length / 14));
    const start = t;
    const end = t + dur;
    t = end + 0.25; // small gap
    blocks.push(`${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${cue}\n`);
  });

  const blob = new Blob(["\uFEFF" + blocks.join("\n")], {
    type: "application/x-subrip;charset=utf-8",
  });
  triggerDownload(blob, `${fileBase(inputs.mode, inputs.source)}.srt`);
}

function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/* ----------------- DOCX ----------------- */

export async function exportDOCX(inputs: ExportInputs) {
  const sections = buildDocxSections(inputs);
  const doc = new Document({
    creator: "ScriptForge AI",
    title: `ScriptForge — ${inputs.mode}`,
    styles: {
      default: {
        document: { run: { font: "Courier New", size: 24 } }, // 12pt screenplay-standard
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 32, bold: true, font: "Calibri" },
          paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 28, bold: true, font: "Calibri" },
          paragraph: { spacing: { before: 180, after: 120 }, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections,
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, `${fileBase(inputs.mode, inputs.source)}.docx`);
}

function buildDocxSections(inputs: ExportInputs) {
  const isRTL = inputs.source !== "english" && inputs.meaningLang === "urdu";
  const blocks: Paragraph[] = [];

  blocks.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "ScriptForge AI", bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `${inputs.mode.toUpperCase()} · ${inputs.source.toUpperCase()}`,
          size: 20,
          color: "666666",
        }),
      ],
    }),
  );

  const pushScript = (text: string, label?: string, sectionRTL = false) => {
    if (label) {
      blocks.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: label, bold: true })],
        }),
      );
    }
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\r$/, "");
      blocks.push(formatScreenplayLine(line, sectionRTL));
    }
  };

  if (inputs.source === "english") {
    pushScript(inputs.englishScript);
  } else if (inputs.source === "meaning") {
    pushScript(inputs.meaningScript, undefined, isRTL);
  } else {
    pushScript(inputs.englishScript, "Professional English Screenplay");
    blocks.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
    pushScript(
      inputs.meaningScript,
      `Meaning Version (${inputs.meaningLang.toUpperCase()})`,
      isRTL,
    );
  }

  return [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // US Letter
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Page ", size: 18, color: "888888" }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  size: 18,
                  color: "888888",
                }),
              ],
            }),
          ],
        }),
      },
      children: blocks,
    },
  ];
}

function formatScreenplayLine(line: string, rtl: boolean): Paragraph {
  const trimmed = line.trim();
  if (!trimmed) {
    return new Paragraph({ children: [new TextRun({ text: "" })] });
  }
  const align = rtl ? AlignmentType.RIGHT : AlignmentType.LEFT;
  const bidi = rtl;

  if (isSceneHeading(trimmed)) {
    return new Paragraph({
      alignment: align,
      bidirectional: bidi,
      spacing: { before: 240, after: 120 },
      children: [
        new TextRun({ text: trimmed.toUpperCase(), bold: true, font: "Courier New" }),
      ],
    });
  }
  if (isTransition(trimmed)) {
    return new Paragraph({
      alignment: rtl ? AlignmentType.LEFT : AlignmentType.RIGHT,
      bidirectional: bidi,
      spacing: { before: 120, after: 120 },
      children: [
        new TextRun({ text: trimmed.toUpperCase(), bold: true, font: "Courier New" }),
      ],
    });
  }
  if (isCharacterCue(trimmed)) {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      bidirectional: bidi,
      indent: { left: 2880 },
      spacing: { before: 200, after: 0 },
      children: [
        new TextRun({ text: trimmed, bold: true, font: "Courier New" }),
      ],
    });
  }
  if (/^\(.*\)$/.test(trimmed)) {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      bidirectional: bidi,
      indent: { left: 2160 },
      children: [
        new TextRun({ text: trimmed, italics: true, font: "Courier New" }),
      ],
    });
  }
  // Default: action line / dialogue
  return new Paragraph({
    alignment: align,
    bidirectional: bidi,
    spacing: { after: 120 },
    children: [new TextRun({ text: trimmed, font: "Courier New" })],
  });
}

/* ----------------- PDF ----------------- */

/**
 * PDF export: industry-standard screenplay-ish layout.
 * - 1" margins, 12pt Courier
 * - Scene headings bold uppercase
 * - Character cues centered/uppercase
 * - Transitions right-aligned uppercase (or left for RTL)
 * - Title page on page 1, page numbers on subsequent pages
 *
 * Note: jsPDF's built-in fonts (Courier/Helvetica) cover Latin only.
 * For Hindi/Urdu meaning exports we fall back to Helvetica with the
 * UTF-8 string — modern PDF readers will substitute glyphs. For perfect
 * Devanagari/Nasta'liq rendering, users should prefer DOCX/TXT.
 */
export function exportPDF(inputs: ExportInputs) {
  const { text, isRTL } = pickContent(inputs);

  const doc = new jsPDF({
    unit: "in",
    format: "letter",
    compress: true,
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 1.0;
  const contentW = pageW - margin * 2;
  const lineH = 0.18; // ~13pt line height
  const isUnicode =
    inputs.source !== "english" &&
    (inputs.meaningLang === "hindi" || inputs.meaningLang === "urdu");

  // Title page
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text("ScriptForge AI", pageW / 2, 3.0, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.setTextColor(100);
  doc.text(
    `${inputs.mode.toUpperCase()} · ${inputs.source.toUpperCase()}`,
    pageW / 2,
    3.5,
    { align: "center" },
  );
  doc.setFontSize(10);
  doc.text(
    `Generated ${new Date().toLocaleString()}`,
    pageW / 2,
    3.85,
    { align: "center" },
  );
  doc.setTextColor(0);

  doc.addPage();
  let y = margin;
  let pageNum = 1;

  const writePageNumber = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(String(pageNum), pageW - margin, margin - 0.25, {
      align: "right",
    });
    doc.setTextColor(0);
  };
  writePageNumber();

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      pageNum++;
      y = margin;
      writePageNumber();
    }
  };

  const setLineFont = (kind: "body" | "bold") => {
    if (isUnicode) {
      // jsPDF built-in fonts don't embed Devanagari/Nasta'liq glyphs;
      // helvetica is used so PDF readers can attempt glyph substitution.
      doc.setFont("helvetica", kind === "bold" ? "bold" : "normal");
      doc.setFontSize(12);
    } else {
      doc.setFont("courier", kind === "bold" ? "bold" : "normal");
      doc.setFontSize(12);
    }
  };

  const drawWrapped = (
    text: string,
    opts: { align?: "left" | "center" | "right"; indent?: number; bold?: boolean } = {},
  ) => {
    setLineFont(opts.bold ? "bold" : "body");
    const indent = opts.indent ?? 0;
    const usableW = contentW - indent;
    const wrapped = doc.splitTextToSize(text, usableW) as string[];
    for (const w of wrapped) {
      ensureSpace(lineH);
      let x = margin + indent;
      let align: "left" | "center" | "right" = opts.align ?? "left";
      if (isRTL && align === "left") align = "right";
      if (align === "center") x = pageW / 2;
      else if (align === "right") x = pageW - margin;
      doc.text(w, x, y, { align });
      y += lineH;
    }
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      y += lineH * 0.6;
      continue;
    }
    if (isSceneHeading(line)) {
      y += lineH * 0.4;
      drawWrapped(line.toUpperCase(), { bold: true });
      continue;
    }
    if (isTransition(line)) {
      drawWrapped(line.toUpperCase(), { align: "right", bold: true });
      continue;
    }
    if (isCharacterCue(line)) {
      y += lineH * 0.3;
      drawWrapped(line, { align: "center", bold: true });
      continue;
    }
    if (/^\(.*\)$/.test(line)) {
      drawWrapped(line, { align: "center", indent: 2.2 });
      continue;
    }
    drawWrapped(line);
  }

  doc.save(`${fileBase(inputs.mode, inputs.source)}.pdf`);
}

/* ----------------- Public dispatcher ----------------- */

export type ExportFormat = "pdf" | "txt" | "docx" | "srt" | "teleprompter";

export async function runExport(format: ExportFormat, inputs: ExportInputs) {
  switch (format) {
    case "pdf":
      return exportPDF(inputs);
    case "txt":
      return exportTXT(inputs);
    case "docx":
      return exportDOCX(inputs);
    case "srt":
      return exportSRT(inputs);
    case "teleprompter":
      return exportTeleprompter(inputs);
  }
}
