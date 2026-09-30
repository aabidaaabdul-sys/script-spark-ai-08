import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Clapperboard, Wand2, Loader2, RefreshCw, Download, Trash2, Square, Copy, Pencil,
  GripVertical, ChevronUp, ChevronDown, FileText, Archive, LayoutGrid, ScanSearch, Upload, X, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { parseScenes, parseElements, type ParsedScene } from "@/lib/screenplay";
import {
  ASPECTS, SHOT_TYPES, VISUAL_STYLES, buildContinuity, buildVisualPrompt, styleHint,
  type Aspect, type CharacterEntry, type LocationEntry, type StoryFrame,
} from "@/lib/storyboard-types";
import { getAsset, getProject, putAsset, putProject, deleteAsset } from "@/lib/storyboard-store";
import { downloadDataUrl, exportContactSheet, exportPdf, exportZip, fileName, type PdfOptions } from "@/lib/storyboard-export";

const PROJECT_ID = "default";
const BATCH = 8;
const CONCURRENCY = 2;
const MAX_REF = 4 * 1024 * 1024;

type Project = {
  frames: StoryFrame[];
  characters: CharacterEntry[];
  locations: LocationEntry[];
  style: string;
  customStyle: string;
  aspect: Aspect;
  title: string;
};

type Step = { label: string; state: "pending" | "active" | "done" | "failed" };

class HttpError extends Error {
  constructor(msg: string, public status: number, public retryAfter?: number) { super(msg); }
}

async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new HttpError("Network error — check your connection.", 0);
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new HttpError(j.error || `Server error (${r.status}).`, r.status, Number(r.headers.get("Retry-After")) || undefined);
  }
  return r.json();
}

const retryable = (e: unknown) => e instanceof HttpError && (e.status === 429 || e.status >= 500 || e.status === 0);
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

export function VisualStoryboard({
  originalScript, englishScript, meaningScript, meaningLang,
}: { originalScript: string; englishScript: string; meaningScript: string; meaningLang: string }) {
  const [source, setSource] = useState<"english" | "original" | "meaning">("english");
  const [p, setP] = useState<Project>({ frames: [], characters: [], locations: [], style: "cinematic", customStyle: "", aspect: "16:9", title: "Untitled Project" });
  const [images, setImages] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<StoryFrame | null>(null);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pdfOpt, setPdfOpt] = useState<PdfOptions>({ description: true, characters: true, camera: true, dialogue: true, prompt: false });
  const [exporting, setExporting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pRef = useRef(p);
  pRef.current = p;

  const script = source === "english" ? englishScript : source === "original" ? originalScript : meaningScript;
  const structure = useMemo(() => parseElements(script), [script]);
  const parsedScenes = useMemo(() => parseScenes(script), [script]);

  /* ---------- persistence ---------- */
  useEffect(() => {
    (async () => {
      try {
        const saved = await getProject<Project>(PROJECT_ID);
        if (saved) {
          // Interrupted jobs from a previous visit are no longer running.
          saved.frames = saved.frames.map((f) => (f.status === "processing" || f.status === "queued" ? { ...f, status: f.imageKey ? "completed" : "cancelled" } : f));
          setP(saved);
          const imgs: Record<string, string> = {};
          for (const f of saved.frames) if (f.imageKey) { const a = await getAsset(f.imageKey); if (a) imgs[f.imageKey] = a.dataUrl; }
          setImages(imgs);
        }
      } catch (e) {
        console.error(e);
        toast.error("Saved storyboard could not be loaded from this browser.");
      } finally { setLoaded(true); }
    })();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => { putProject(PROJECT_ID, p).catch(() => toast.error("Could not save storyboard in this browser (storage full?).")); }, 400);
    return () => clearTimeout(t);
  }, [p, loaded]);

  const patchFrame = useCallback((id: string, patch: Partial<StoryFrame>) => {
    setP((prev) => ({ ...prev, frames: prev.frames.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  }, []);
  const setStep = (i: number, state: Step["state"], label?: string) =>
    setSteps((prev) => prev.map((s, j) => (j === i ? { label: label ?? s.label, state } : s)));

  const promptFor = useCallback((f: StoryFrame, proj: Project) => {
    if (f.editedPrompt) return f.editedPrompt;
    return buildVisualPrompt({
      frame: f, chars: proj.characters, loc: proj.locations.find((l) => l.id === f.locationId),
      style: styleHint(proj.style, proj.customStyle), aspect: proj.aspect,
      continuity: buildContinuity(f, proj.frames, proj.characters, proj.locations),
    });
  }, []);

  /* ---------- analysis ---------- */
  const analyze = useCallback(async (signal: AbortSignal, stepBase: number): Promise<Project | null> => {
    const scenes: ParsedScene[] = parseScenes(script);
    if (!scenes.length) throw new Error("No scenes detected yet. Add a script with scene headings like INT. ROOM - NIGHT.");
    setStep(stepBase, "done", `Detected ${scenes.length} scene${scenes.length > 1 ? "s" : ""}`);
    let chars = pRef.current.characters;
    let locs = pRef.current.locations;
    const analyses: Record<string, any> = {};
    const batches = Math.ceil(scenes.length / BATCH);
    for (let b = 0; b < batches; b++) {
      setStep(stepBase + 1, "active", `Building Character & Location Bible (batch ${b + 1}/${batches})`);
      const slice = scenes.slice(b * BATCH, (b + 1) * BATCH);
      const payload = {
        scenes: slice.map((s) => ({
          id: s.id, heading: s.heading, intExt: s.intExt, location: s.location, timeOfDay: s.timeOfDay, characters: s.characters,
          action: s.action.slice(0, 2000),
          dialogue: s.dialogue.map((d) => `${d.character}${d.parenthetical ? ` (${d.parenthetical})` : ""}: ${d.text}`).join("\n").slice(0, 1200),
        })),
        characters: chars.map(({ referenceImage, ...c }) => c),
        locations: locs.map(({ referenceImage, ...l }) => l),
      };
      let res: { characters: CharacterEntry[]; locations: LocationEntry[]; scenes: any[] } | null = null;
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try { res = await postJson("/api/sb-analyze", payload, signal); }
        catch (e) {
          if (!retryable(e) || attempt === 2) throw e;
          await sleep(((e as HttpError).retryAfter ?? 2 ** attempt * 2) * 1000 + Math.random() * 500, signal);
        }
      }
      // Merge bibles, keeping user-added reference images and user edits.
      const mergeC = (old: CharacterEntry[], nw: CharacterEntry[]) => {
        const out = [...old];
        for (const c of nw) {
          const i = out.findIndex((o) => o.id === c.id);
          if (i < 0) out.push(c);
          else out[i] = { ...c, ...Object.fromEntries(Object.entries(out[i]).filter(([, v]) => v)) } as CharacterEntry;
        }
        return out;
      };
      const mergeL = (old: LocationEntry[], nw: LocationEntry[]) => {
        const out = [...old];
        for (const l of nw) {
          const i = out.findIndex((o) => o.id === l.id);
          if (i < 0) out.push(l);
          else out[i] = { ...l, ...Object.fromEntries(Object.entries(out[i]).filter(([, v]) => v)) } as LocationEntry;
        }
        return out;
      };
      chars = mergeC(chars, res!.characters);
      locs = mergeL(locs, res!.locations);
      for (const a of res!.scenes) analyses[a.sceneId] = a;
    }
    setStep(stepBase + 1, "done", `Character Bible: ${chars.length} · Location Bible: ${locs.length}`);
    setStep(stepBase + 2, "active");
    const oldById = new Map(pRef.current.frames.map((f) => [f.id, f]));
    const frames: StoryFrame[] = scenes.map((s, i) => {
      const a = analyses[s.id] ?? {};
      const old = oldById.get(s.id);
      return {
        sceneId: s.id, title: a.title || s.location || `Scene ${i + 1}`, description: a.description || s.action.slice(0, 300),
        locationId: a.locationId || "", characters: a.characters ?? [], action: a.action || s.action.slice(0, 300),
        objects: a.objects || "", weather: a.weather || "", mood: a.mood || "", cameraShot: a.cameraShot || "Medium Shot",
        cameraDirection: a.cameraDirection || "", lighting: a.lighting || "", keyMoment: a.keyMoment || "",
        id: s.id, number: i + 1, heading: s.heading, timeOfDay: s.timeOfDay, intExt: s.intExt,
        dialogueExcerpt: s.dialogue.slice(0, 3).map((d) => `${d.character}: ${d.text}`).join("\n").slice(0, 400),
        originalPrompt: "", editedPrompt: old?.editedPrompt,
        status: old?.imageKey ? "completed" : "idle", imageKey: old?.imageKey, promptUsed: old?.promptUsed,
      };
    });
    const proj = { ...pRef.current, characters: chars, locations: locs, frames };
    proj.frames = frames.map((f) => ({ ...f, originalPrompt: buildVisualPrompt({
      frame: f, chars, loc: locs.find((l) => l.id === f.locationId), style: styleHint(proj.style, proj.customStyle),
      aspect: proj.aspect, continuity: buildContinuity(f, frames, chars, locs),
    }) }));
    setP(proj);
    pRef.current = proj;
    setStep(stepBase + 2, "done", `Created ${frames.length} visual prompts`);
    return proj;
  }, [script]);

  /* ---------- image queue ---------- */
  const renderOne = useCallback(async (id: string, signal: AbortSignal) => {
    const proj = pRef.current;
    const f = proj.frames.find((x) => x.id === id);
    if (!f) return false;
    const prompt = promptFor(f, proj);
    const refs = [
      ...proj.characters.filter((c) => f.characters.includes(c.id) && c.referenceImage).map((c) => c.referenceImage!),
      proj.locations.find((l) => l.id === f.locationId)?.referenceImage,
    ].filter(Boolean).slice(0, 3) as string[];
    patchFrame(id, { status: "processing", error: undefined });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await postJson<{ image: string; metadata: Record<string, unknown> }>("/api/sb-image", {
          prompt, aspectRatio: proj.aspect, references: refs,
          meta: { sceneDescription: f.description, characters: f.characters, location: f.locationId, timeOfDay: f.timeOfDay, mood: f.mood, cameraShot: f.cameraShot, visualStyle: styleHint(proj.style, proj.customStyle) },
        }, signal);
        const key = `img-${id}-${Date.now()}`;
        await putAsset({ id: key, projectId: PROJECT_ID, type: "image", mimeType: "image/png", size: res.image.length, dataUrl: res.image, createdAt: new Date().toISOString(), metadata: res.metadata });
        const oldKey = pRef.current.frames.find((x) => x.id === id)?.imageKey;
        if (oldKey && !pRef.current.frames.some((x) => x.id !== id && x.imageKey === oldKey)) deleteAsset(oldKey).catch(() => {});
        setImages((m) => ({ ...m, [key]: res.image }));
        patchFrame(id, { status: "completed", imageKey: key, imageUpdatedAt: Date.now(), promptUsed: prompt });
        return true;
      } catch (e) {
        if ((e as Error).name === "AbortError") { patchFrame(id, { status: "cancelled" }); return false; }
        if (retryable(e) && attempt < 2) {
          try { await sleep(((e as HttpError).retryAfter ?? 2 ** attempt * 3) * 1000 + Math.random() * 800, signal); continue; }
          catch { patchFrame(id, { status: "cancelled" }); return false; }
        }
        patchFrame(id, { status: "failed", error: `Scene generation failed. ${(e as Error).message}` });
        return false;
      }
    }
    return false;
  }, [patchFrame, promptFor]);

  const runQueue = useCallback(async (ids: string[], signal: AbortSignal, stepIdx?: number) => {
    setP((prev) => ({ ...prev, frames: prev.frames.map((f) => (ids.includes(f.id) ? { ...f, status: "queued", error: undefined } : f)) }));
    let next = 0, done = 0, failed = 0;
    const worker = async () => {
      while (next < ids.length && !signal.aborted) {
        const id = ids[next++];
        const n = pRef.current.frames.find((f) => f.id === id)?.number;
        if (stepIdx !== undefined) setStep(stepIdx, "active", `Generating Scene ${n} (${done}/${ids.length} done)`);
        const ok = await renderOne(id, signal);
        if (ok) done++; else failed++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    if (signal.aborted)
      setP((prev) => ({ ...prev, frames: prev.frames.map((f) => (ids.includes(f.id) && f.status === "queued" ? { ...f, status: "cancelled" } : f)) }));
    if (stepIdx !== undefined) setStep(stepIdx, failed || signal.aborted ? "failed" : "done", `Generated ${done}/${ids.length} images${failed ? ` · ${failed} failed` : ""}${signal.aborted ? " · cancelled" : ""}`);
    return { done, failed };
  }, [renderOne]);

  const start = () => { abortRef.current?.abort(); const c = new AbortController(); abortRef.current = c; setRunning(true); return c; };
  const finish = () => setRunning(false);

  const fullPipeline = async () => {
    if (!script.trim()) return toast.error("Add or generate a script first.");
    const c = start();
    setSteps([
      { label: "Analyzing script · Detecting scenes", state: "active" },
      { label: "Building Character & Location Bible", state: "pending" },
      { label: "Creating visual prompts", state: "pending" },
      { label: "Generating images", state: "pending" },
      { label: "Finalizing storyboard", state: "pending" },
    ]);
    try {
      const proj = await analyze(c.signal, 0);
      if (!proj) return;
      const ids = proj.frames.filter((f) => f.status !== "completed").map((f) => f.id);
      const { failed } = await runQueue(ids, c.signal, 3);
      setStep(4, "done", c.signal.aborted ? "Stopped" : failed ? `Finished with ${failed} failed scene(s) — use Retry failed` : "Storyboard complete");
      if (c.signal.aborted) toast.message("Storyboard generation cancelled.");
      else if (failed) toast.error(`${failed} scene(s) failed. Use "Retry failed".`);
      else toast.success("Storyboard complete.");
    } catch (e) {
      if ((e as Error).name === "AbortError") { toast.message("Cancelled."); setSteps((s) => s.map((x) => (x.state === "active" ? { ...x, state: "failed" } : x))); return; }
      setSteps((s) => s.map((x) => (x.state === "active" ? { ...x, state: "failed", label: `${x.label} — ${(e as Error).message}` } : x)));
      toast.error((e as Error).message);
    } finally { finish(); }
  };

  const analyzeOnly = async () => {
    if (!script.trim()) return toast.error("Add or generate a script first.");
    const c = start();
    setSteps([
      { label: "Analyzing script · Detecting scenes", state: "active" },
      { label: "Building Character & Location Bible", state: "pending" },
      { label: "Creating visual prompts", state: "pending" },
    ]);
    try { await analyze(c.signal, 0); toast.success("Script analyzed. Review scenes, then generate images."); }
    catch (e) {
      if ((e as Error).name !== "AbortError") { toast.error((e as Error).message); setSteps((s) => s.map((x) => (x.state === "active" ? { ...x, state: "failed", label: `${x.label} — ${(e as Error).message}` } : x))); }
    } finally { finish(); }
  };

  const generateIds = async (ids: string[], label: string) => {
    if (!ids.length) return toast.message("Nothing to generate.");
    const c = start();
    setSteps([{ label, state: "active" }]);
    try {
      const { failed } = await runQueue(ids, c.signal, 0);
      if (!c.signal.aborted) failed ? toast.error(`${failed} scene(s) failed.`) : toast.success("Images ready.");
    } finally { finish(); }
  };

  const cancel = () => abortRef.current?.abort();

  /* ---------- editing ---------- */
  const removeFrame = (id: string) => {
    const f = p.frames.find((x) => x.id === id);
    if (f?.imageKey && !p.frames.some((x) => x.id !== id && x.imageKey === f.imageKey)) deleteAsset(f.imageKey).catch(() => {});
    setP((prev) => ({ ...prev, frames: renumber(prev.frames.filter((x) => x.id !== id)) }));
  };
  const duplicate = (id: string) => setP((prev) => {
    const i = prev.frames.findIndex((f) => f.id === id);
    const copy: StoryFrame = { ...prev.frames[i], id: `${id}-copy-${Date.now().toString(36)}`, imageKey: undefined, status: "idle", error: undefined };
    const next = [...prev.frames]; next.splice(i + 1, 0, copy);
    return { ...prev, frames: renumber(next) };
  });
  const move = (id: string, dir: -1 | 1) => setP((prev) => {
    const i = prev.frames.findIndex((f) => f.id === id), j = i + dir;
    if (j < 0 || j >= prev.frames.length) return prev;
    const next = [...prev.frames]; [next[i], next[j]] = [next[j], next[i]];
    return { ...prev, frames: renumber(next) };
  });
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setP((prev) => {
      const next = [...prev.frames];
      const from = next.findIndex((f) => f.id === dragId);
      const [item] = next.splice(from, 1);
      next.splice(next.findIndex((f) => f.id === targetId), 0, item);
      return { ...prev, frames: renumber(next) };
    });
    setDragId(null);
  };

  const uploadRef = async (kind: "char" | "loc", id: string, file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return toast.error("Use a PNG, JPEG or WebP image.");
    if (file.size > MAX_REF) return toast.error("Reference image must be under 4 MB.");
    const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(file); })
      .catch(() => { toast.error("Could not read that image."); return ""; });
    if (!url) return;
    setP((prev) => kind === "char"
      ? { ...prev, characters: prev.characters.map((c) => (c.id === id ? { ...c, referenceImage: url } : c)) }
      : { ...prev, locations: prev.locations.map((l) => (l.id === id ? { ...l, referenceImage: url } : l)) });
    toast.success("Reference saved. It will be used for scenes featuring it.");
  };

  const exportItems = () => p.frames.map((frame) => ({ frame, image: frame.imageKey ? images[frame.imageKey] : undefined }));
  const doExport = async (kind: "pdf" | "zip" | "sheet") => {
    if (!p.frames.length) return toast.error("No storyboard generated yet.");
    setExporting(true);
    try {
      if (kind === "pdf") await exportPdf(exportItems(), p.characters, p.title, pdfOpt);
      if (kind === "zip") await exportZip(exportItems(), p.title);
      if (kind === "sheet") await exportContactSheet(exportItems(), p.title);
      toast.success("Export downloaded.");
    } catch (e) { toast.error(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(false); }
  };

  const clearAll = async () => {
    if (!confirm("Clear the whole storyboard, bibles and images saved in this browser?")) return;
    for (const f of p.frames) if (f.imageKey) await deleteAsset(f.imageKey).catch(() => {});
    setImages({}); setSelected(new Set()); setSteps([]);
    setP((prev) => ({ ...prev, frames: [], characters: [], locations: [] }));
  };

  const counts = useMemo(() => {
    const c = { completed: 0, failed: 0, processing: 0, queued: 0 };
    for (const f of p.frames) if (f.status in c) c[f.status as keyof typeof c]++;
    return c;
  }, [p.frames]);
  const failedIds = p.frames.filter((f) => f.status === "failed" || f.status === "cancelled").map((f) => f.id);
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <section className="mt-10 rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-card/60 p-5 shadow-elevated">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow"><Clapperboard className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Visual Storyboard</h2>
            <p className="text-xs text-muted-foreground">Scene analysis, character & location continuity, and generated frames — saved in this browser.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full border border-border/50 px-2.5 py-1">{parsedScenes.length} scenes detected</span>
          {p.frames.length > 0 && <span className="rounded-full border border-border/50 px-2.5 py-1">{counts.completed}/{p.frames.length} images</span>}
        </div>
      </header>

      {/* Controls */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Project title"><Input value={p.title} maxLength={80} onChange={(e) => setP({ ...p, title: e.target.value })} className="h-10" /></Field>
        <Field label="Script source">
          <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="english" disabled={!englishScript.trim()}>Screenplay (English)</SelectItem>
              <SelectItem value="original" disabled={!originalScript.trim()}>Original script</SelectItem>
              <SelectItem value="meaning" disabled={!meaningScript.trim()}>{meaningLang ? `Meaning (${meaningLang})` : "Meaning version"}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Visual style">
          <Select value={p.style} onValueChange={(v) => setP({ ...p, style: v })}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>{VISUAL_STYLES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Aspect ratio">
          <Select value={p.aspect} onValueChange={(v) => setP({ ...p, aspect: v as Aspect })}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>{ASPECTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {p.style === "custom" ? (
          <Field label="Custom style (broad traits, no artist names)"><Input value={p.customStyle} maxLength={300} onChange={(e) => setP({ ...p, customStyle: e.target.value })} placeholder="e.g. muted watercolor, soft grain" className="h-10" /></Field>
        ) : <div />}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!running ? (
          <>
            <Button onClick={fullPipeline} className="gap-2"><Wand2 className="h-4 w-4" /> Generate Visual Storyboard</Button>
            <Button variant="outline" onClick={analyzeOnly} className="gap-2"><ScanSearch className="h-4 w-4" /> Analyze Script Only</Button>
            <Button variant="outline" disabled={!selected.size} onClick={() => generateIds([...selected], `Generating ${selected.size} selected scene(s)`)}>Generate Selected ({selected.size})</Button>
            <Button variant="outline" disabled={!p.frames.length} onClick={() => generateIds(p.frames.filter((f) => f.status !== "completed").map((f) => f.id), "Generating missing images")}>Generate Missing</Button>
            <Button variant="outline" disabled={!p.frames.length} onClick={() => confirm("Regenerate every image? This uses credits for every scene.") && generateIds(p.frames.map((f) => f.id), "Regenerating all scenes")} className="gap-2"><RefreshCw className="h-4 w-4" /> Regenerate All</Button>
            {failedIds.length > 0 && <Button variant="secondary" onClick={() => generateIds(failedIds, "Retrying failed scenes")}>Retry failed ({failedIds.length})</Button>}
            {p.frames.length > 0 && <Button variant="ghost" onClick={clearAll} className="gap-2 text-destructive"><Trash2 className="h-4 w-4" /> Clear</Button>}
          </>
        ) : (
          <Button variant="destructive" onClick={cancel} className="gap-2"><Square className="h-4 w-4" /> Cancel job</Button>
        )}
      </div>

      {steps.length > 0 && (
        <ol className="mt-4 space-y-1.5 rounded-lg border border-border/50 bg-muted/20 p-3 text-xs">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              {s.state === "active" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : s.state === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : s.state === "failed" ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> : <span className="h-3.5 w-3.5 rounded-full border border-border" />}
              <span className={s.state === "pending" ? "text-muted-foreground" : ""}>{s.label}</span>
            </li>
          ))}
          {running && p.frames.length > 0 && (
            <li className="pt-1 text-muted-foreground">Queue: {counts.processing} processing · {counts.queued} queued · {counts.completed} completed · {counts.failed} failed</li>
          )}
        </ol>
      )}

      <Tabs defaultValue="board" className="mt-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="board">Storyboard</TabsTrigger>
          <TabsTrigger value="screenplay">Screenplay Mode</TabsTrigger>
          <TabsTrigger value="characters">Character Bible ({p.characters.length})</TabsTrigger>
          <TabsTrigger value="locations">Location Bible ({p.locations.length})</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          {p.frames.length === 0 ? (
            <Empty text={parsedScenes.length ? "No storyboard generated yet. Click Generate Visual Storyboard." : "No scenes detected yet."} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {p.frames.map((f, i) => {
                const img = f.imageKey ? images[f.imageKey] : undefined;
                return (
                  <article key={f.id} draggable onDragStart={() => setDragId(f.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(f.id)}
                    className={`overflow-hidden rounded-xl border bg-background/40 transition ${dragId === f.id ? "opacity-50" : ""} ${selected.has(f.id) ? "border-primary" : "border-border/50"}`}>
                    <div className="relative bg-muted/40" style={{ aspectRatio: p.aspect.replace(":", " / ") }}>
                      {img ? <img src={img} alt={f.title} className="h-full w-full cursor-zoom-in object-cover" onClick={() => setLightbox(img)} /> : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
                          {f.status === "processing" ? <><Loader2 className="h-5 w-5 animate-spin" /> Generating…</> :
                           f.status === "queued" ? "Queued" :
                           f.status === "failed" ? <span className="text-destructive">{f.error}</span> :
                           f.status === "cancelled" ? "Cancelled" : "No image yet"}
                        </div>
                      )}
                      {img && f.status === "processing" && <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-xs"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Regenerating…</div>}
                      <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-background/80 px-1.5 py-1">
                        <Checkbox checked={selected.has(f.id)} onCheckedChange={() => toggleSel(f.id)} aria-label="Select scene" />
                        <GripVertical className="h-3.5 w-3.5 cursor-grab text-muted-foreground" />
                        <span className="text-[11px] font-semibold">#{f.number}</span>
                      </div>
                      <span className="absolute right-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{f.status}</span>
                    </div>
                    <div className="space-y-2 p-3 text-xs">
                      <div className="font-mono text-[11px] text-muted-foreground">{f.heading}</div>
                      <div className="text-sm font-semibold">{f.title}</div>
                      <p className="text-muted-foreground">{f.description}</p>
                      <div className="flex flex-wrap gap-1">
                        <Chip>{f.cameraShot}</Chip>
                        {f.mood && <Chip>{f.mood}</Chip>}
                        {p.locations.find((l) => l.id === f.locationId) && <Chip>{p.locations.find((l) => l.id === f.locationId)!.name}</Chip>}
                        {f.characters.map((c) => <Chip key={c}>{p.characters.find((x) => x.id === c)?.name ?? c}</Chip>)}
                      </div>
                      <Select value={f.cameraShot} onValueChange={(v) => patchFrame(f.id, { cameraShot: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{[...new Set([f.cameraShot, ...SHOT_TYPES])].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                      {f.editedPrompt && <div className="text-[10px] text-primary">Using edited prompt</div>}
                      <div className="flex flex-wrap gap-1 pt-1">
                        <Button size="sm" variant="secondary" disabled={running} onClick={() => generateIds([f.id], `${img ? "Regenerating" : "Generating"} scene ${f.number}`)} className="h-7 gap-1 px-2 text-[11px]"><RefreshCw className="h-3 w-3" />{img ? "Regenerate" : "Generate"}</Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditing(f); setDraftPrompt(f.editedPrompt ?? promptFor({ ...f, editedPrompt: undefined }, p)); }} className="h-7 gap-1 px-2 text-[11px]"><Pencil className="h-3 w-3" />Prompt</Button>
                        <IconBtn label="Download" disabled={!img} onClick={() => img && downloadDataUrl(img, fileName(f))}><Download className="h-3 w-3" /></IconBtn>
                        <IconBtn label="Duplicate" onClick={() => duplicate(f.id)}><Copy className="h-3 w-3" /></IconBtn>
                        <IconBtn label="Move up" disabled={i === 0} onClick={() => move(f.id, -1)}><ChevronUp className="h-3 w-3" /></IconBtn>
                        <IconBtn label="Move down" disabled={i === p.frames.length - 1} onClick={() => move(f.id, 1)}><ChevronDown className="h-3 w-3" /></IconBtn>
                        <IconBtn label="Delete" onClick={() => removeFrame(f.id)}><Trash2 className="h-3 w-3" /></IconBtn>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="screenplay" className="mt-4">
          {structure.length === 0 ? <Empty text="No script to structure yet." /> : (
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div className="max-h-[520px] overflow-y-auto rounded-lg border border-border/50 bg-background/40 p-4 font-mono text-xs leading-relaxed">
                {structure.map((e, i) => (
                  <div key={i} className={
                    e.type === "heading" ? "mt-4 font-bold text-primary" :
                    e.type === "transition" ? "my-2 text-right text-muted-foreground" :
                    e.type === "character" ? "mt-3 pl-[30%] font-semibold" :
                    e.type === "parenthetical" ? "pl-[25%] italic text-muted-foreground" :
                    e.type === "dialogue" ? "pl-[18%] pr-[15%]" :
                    e.type === "shot" || e.type === "montage" ? "mt-2 font-semibold uppercase" : "mt-1"}>
                    <span className="mr-2 select-none rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">{e.type}</span>{e.text}
                  </div>
                ))}
              </div>
              <div className="space-y-2 text-xs">
                <div className="font-semibold">Scenes ({parsedScenes.length})</div>
                {parsedScenes.map((s) => (
                  <div key={s.id} className="rounded-md border border-border/40 p-2">
                    <div className="font-mono text-[11px]">{s.number}. {s.heading}</div>
                    <div className="text-muted-foreground">{[s.intExt, s.location, s.timeOfDay].filter(Boolean).join(" · ")}</div>
                    {s.characters.length > 0 && <div className="text-muted-foreground">Cast: {s.characters.join(", ")}</div>}
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">Your original script is never modified — this is a separate structured view.</p>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="characters" className="mt-4">
          {p.characters.length === 0 ? <Empty text="No characters yet. Analyze the script to build the Character Bible." /> : (
            <div className="grid gap-3 md:grid-cols-2">
              {p.characters.map((c) => (
                <BibleCard key={c.id} title={c.name} image={c.referenceImage}
                  onUpload={(f) => uploadRef("char", c.id, f)}
                  onClearImage={() => setP((prev) => ({ ...prev, characters: prev.characters.map((x) => (x.id === c.id ? { ...x, referenceImage: undefined } : x)) }))}
                  fields={(["ageRange", "gender", "appearance", "hair", "clothing", "accessories", "visualCues"] as const).map((k) => ({
                    key: k, value: c[k], onChange: (v: string) => setP((prev) => ({ ...prev, characters: prev.characters.map((x) => (x.id === c.id ? { ...x, [k]: v } : x)) })),
                  }))} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="locations" className="mt-4">
          {p.locations.length === 0 ? <Empty text="No locations yet. Analyze the script to build the Location Bible." /> : (
            <div className="grid gap-3 md:grid-cols-2">
              {p.locations.map((l) => (
                <BibleCard key={l.id} title={l.name} image={l.referenceImage}
                  onUpload={(f) => uploadRef("loc", l.id, f)}
                  onClearImage={() => setP((prev) => ({ ...prev, locations: prev.locations.map((x) => (x.id === l.id ? { ...x, referenceImage: undefined } : x)) }))}
                  fields={(["architecture", "environment", "objects", "lighting", "palette"] as const).map((k) => ({
                    key: k, value: l[k], onChange: (v: string) => setP((prev) => ({ ...prev, locations: prev.locations.map((x) => (x.id === l.id ? { ...x, [k]: v } : x)) })),
                  }))} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="export" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-4 text-xs">
            {(Object.keys(pdfOpt) as (keyof PdfOptions)[]).map((k) => (
              <label key={k} className="flex items-center gap-2 capitalize"><Checkbox checked={pdfOpt[k]} onCheckedChange={(v) => setPdfOpt({ ...pdfOpt, [k]: !!v })} />{k === "prompt" ? "Visual prompt" : k}</label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={exporting} onClick={() => doExport("pdf")} className="gap-2"><FileText className="h-4 w-4" /> PDF storyboard</Button>
            <Button disabled={exporting} variant="outline" onClick={() => doExport("zip")} className="gap-2"><Archive className="h-4 w-4" /> ZIP of images</Button>
            <Button disabled={exporting} variant="outline" onClick={() => doExport("sheet")} className="gap-2"><LayoutGrid className="h-4 w-4" /> Contact sheet (PNG)</Button>
            {exporting && <Loader2 className="h-4 w-4 animate-spin self-center" />}
          </div>
          <p className="text-[11px] text-muted-foreground">Single PNGs download from each card.</p>
        </TabsContent>
      </Tabs>

      {/* Prompt editor */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Scene {editing?.number} — Visual prompt</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 text-xs">
              <div>
                <div className="mb-1 font-semibold text-muted-foreground">Original AI prompt (read-only)</div>
                <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/50 bg-muted/30 p-2">{promptFor({ ...editing, editedPrompt: undefined }, p)}</pre>
              </div>
              <div>
                <div className="mb-1 font-semibold text-muted-foreground">Edited prompt</div>
                <Textarea value={draftPrompt} maxLength={6000} onChange={(e) => setDraftPrompt(e.target.value)} className="min-h-[180px] font-mono text-xs" />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => { patchFrame(editing.id, { editedPrompt: undefined }); setEditing(null); toast.success("Reverted to original prompt."); }}>Use original</Button>
                <Button variant="outline" onClick={() => { patchFrame(editing.id, { editedPrompt: draftPrompt.trim() || undefined }); setEditing(null); toast.success("Edited prompt saved."); }}>Save</Button>
                <Button disabled={running || draftPrompt.trim().length < 10} onClick={() => { const id = editing.id; patchFrame(id, { editedPrompt: draftPrompt.trim() }); pRef.current = { ...pRef.current, frames: pRef.current.frames.map((f) => (f.id === id ? { ...f, editedPrompt: draftPrompt.trim() } : f)) }; setEditing(null); generateIds([id], "Regenerating with edited prompt"); }}>Save & Regenerate</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>Frame</DialogTitle></DialogHeader>{lightbox && <img src={lightbox} alt="Storyboard frame" className="w-full rounded-lg" />}</DialogContent>
      </Dialog>
    </section>
  );
}

function renumber(frames: StoryFrame[]) { return frames.map((f, i) => ({ ...f, number: i + 1 })); }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>{children}</div>;
}
function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-border/50 px-2 py-0.5 text-[10px]">{children}</span>;
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">{text}</div>;
}
function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <Button size="sm" variant="ghost" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="h-7 w-7 p-0">{children}</Button>;
}
function BibleCard({ title, image, fields, onUpload, onClearImage }: {
  title: string; image?: string; onUpload: (f: File | undefined) => void; onClearImage: () => void;
  fields: { key: string; value: string; onChange: (v: string) => void }[];
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <div className="flex items-center gap-2">
          {image && (<><img src={image} alt={`${title} reference`} className="h-10 w-10 rounded object-cover" /><button aria-label="Remove reference" onClick={onClearImage}><X className="h-3.5 w-3.5" /></button></>)}
          <label className="flex cursor-pointer items-center gap-1 rounded border border-border/50 px-2 py-1 hover:bg-muted/40">
            <Upload className="h-3 w-3" /> Reference
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">{f.key.replace(/([A-Z])/g, " $1")}</span>
            <Input value={f.value} maxLength={400} onChange={(e) => f.onChange(e.target.value)} className="h-8 text-xs" />
          </label>
        ))}
      </div>
    </div>
  );
}
