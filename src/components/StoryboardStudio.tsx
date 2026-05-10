import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Clapperboard,
  Wand2,
  Loader2,
  RefreshCw,
  Copy,
  Download,
  Trash2,
  Maximize2,
  Square,
  Camera,
  Image as ImageIcon,
} from "lucide-react";

/* --------------------------- types --------------------------- */

type Frame = {
  id: string;
  title: string;
  description: string;
  camera: string;
  mood: string;
  prompt: string;
  characters: string[];
  imageUrl?: string;
  status: "pending" | "loading" | "ready" | "error";
  error?: string;
};

const STYLE_OPTIONS = [
  { id: "cinematic-realistic", label: "Cinematic Realistic" },
  { id: "dark-thriller", label: "Dark Thriller" },
  { id: "documentary", label: "Documentary" },
  { id: "anime", label: "Anime Style" },
  { id: "comic", label: "Comic / Graphic Novel" },
  { id: "minimal", label: "Minimal Storyboard" },
];

const DETAIL_OPTIONS = [
  { id: "quick", label: "Quick Storyboard", frames: 6 },
  { id: "detailed", label: "Detailed Storyboard", frames: 10 },
  { id: "cinematic", label: "Cinematic Storyboard", frames: 14 },
] as const;

const MOOD_TONE: Record<string, string> = {
  horror: "from-red-900/40 to-zinc-900/40 border-red-900/40",
  suspense: "from-amber-900/30 to-zinc-900/40 border-amber-900/40",
  thriller: "from-purple-900/30 to-zinc-900/40 border-purple-900/40",
  emotional: "from-rose-900/30 to-zinc-900/40 border-rose-900/40",
  romantic: "from-pink-900/30 to-zinc-900/40 border-pink-900/40",
  action: "from-orange-900/30 to-zinc-900/40 border-orange-900/40",
  tense: "from-yellow-900/30 to-zinc-900/40 border-yellow-900/40",
  calm: "from-sky-900/30 to-zinc-900/40 border-sky-900/40",
  hopeful: "from-emerald-900/30 to-zinc-900/40 border-emerald-900/40",
};
function moodClass(mood: string) {
  const k = mood.toLowerCase();
  for (const key of Object.keys(MOOD_TONE)) {
    if (k.includes(key)) return MOOD_TONE[key];
  }
  return "from-zinc-800/40 to-zinc-900/40 border-border/40";
}

/* --------------------------- queue --------------------------- */

async function runQueue<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency = 2,
) {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        await worker(items[idx], idx);
      } catch {
        // worker handles its own errors
      }
    }
  });
  await Promise.all(runners);
}

/* --------------------------- component --------------------------- */

export function StoryboardStudio({
  englishScript,
  meaningScript,
  meaningLang,
  mode,
}: {
  englishScript: string;
  meaningScript: string;
  meaningLang: string;
  mode: string;
}) {
  const [source, setSource] = useState<"english" | "meaning">("english");
  const [style, setStyle] = useState("cinematic-realistic");
  const [detail, setDetail] =
    useState<(typeof DETAIL_OPTIONS)[number]["id"]>("detailed");
  const [planning, setPlanning] = useState(false);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [lightboxFrame, setLightboxFrame] = useState<Frame | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeScript = source === "english" ? englishScript : meaningScript;
  const detailMeta = DETAIL_OPTIONS.find((d) => d.id === detail)!;

  const renderFrameImage = useCallback(
    async (frameId: string) => {
      setFrames((prev) =>
        prev.map((f) =>
          f.id === frameId ? { ...f, status: "loading", error: undefined } : f,
        ),
      );
      // Snapshot the prompt at call time.
      let prompt = "";
      setFrames((prev) => {
        const f = prev.find((x) => x.id === frameId);
        prompt = f?.prompt ?? "";
        return prev;
      });
      if (!prompt) return;
      try {
        const res = await fetch("/api/storyboard-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, aspect: "16:9" }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const { url } = (await res.json()) as { url: string };
        setFrames((prev) =>
          prev.map((f) =>
            f.id === frameId ? { ...f, status: "ready", imageUrl: url } : f,
          ),
        );
      } catch (e) {
        const msg = (e as Error).message || "Image failed";
        setFrames((prev) =>
          prev.map((f) =>
            f.id === frameId ? { ...f, status: "error", error: msg } : f,
          ),
        );
      }
    },
    [],
  );

  const generate = useCallback(async () => {
    if (!activeScript.trim()) {
      toast.error("Generate or paste a script first.");
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPlanning(true);
    setFrames([]);
    try {
      const res = await fetch("/api/storyboard", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: activeScript,
          style,
          detail,
          frames: detailMeta.frames,
          mode,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { frames: Omit<Frame, "status">[] };
      const planned: Frame[] = data.frames.map((f) => ({ ...f, status: "pending" }));
      setFrames(planned);
      toast.success(`Storyboard ready — rendering ${planned.length} frames…`);

      // Render images progressively, 2 at a time.
      runQueue(planned, async (f) => {
        if (ctrl.signal.aborted) return;
        await renderFrameImage(f.id);
      }, 2);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error((e as Error).message || "Storyboard failed.");
    } finally {
      setPlanning(false);
    }
  }, [activeScript, style, detail, detailMeta.frames, mode, renderFrameImage]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setPlanning(false);
  }, []);

  const regenerate = useCallback(
    (id: string) => {
      renderFrameImage(id);
    },
    [renderFrameImage],
  );

  const remove = useCallback((id: string) => {
    setFrames((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const move = useCallback((id: string, dir: -1 | 1) => {
    setFrames((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const copyPrompt = useCallback(async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("Prompt copied");
    } catch {
      toast.error("Copy failed");
    }
  }, []);

  const downloadFrame = useCallback((f: Frame) => {
    if (!f.imageUrl) return;
    const a = document.createElement("a");
    a.href = f.imageUrl;
    a.download = `${f.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "frame"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const downloadAll = useCallback(() => {
    const ready = frames.filter((f) => f.imageUrl);
    if (ready.length === 0) {
      toast.error("No rendered frames yet.");
      return;
    }
    ready.forEach((f, i) => setTimeout(() => downloadFrame(f), i * 250));
    toast.success(`Downloading ${ready.length} frames…`);
  }, [frames, downloadFrame]);

  const readyCount = useMemo(
    () => frames.filter((f) => f.status === "ready").length,
    [frames],
  );

  return (
    <section className="mt-10 rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-card/60 p-5 shadow-elevated">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Clapperboard className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">AI Storyboard Studio</h2>
            <p className="text-xs text-muted-foreground">
              Cinematic frames, camera suggestions, and mood — generated from your screenplay.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {frames.length > 0 && (
            <>
              <span className="rounded-full border border-border/50 px-2.5 py-1">
                {readyCount}/{frames.length} rendered
              </span>
              <Button size="sm" variant="outline" className="gap-2" onClick={downloadAll}>
                <Download className="h-3.5 w-3.5" /> Download all
              </Button>
            </>
          )}
        </div>
      </header>

      {/* controls */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Source
          </label>
          <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="english" disabled={!englishScript.trim()}>
                English Script
              </SelectItem>
              <SelectItem value="meaning" disabled={!meaningScript.trim()}>
                {meaningLang ? `Meaning (${meaningLang})` : "Meaning Version"}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Visual style
          </label>
          <Select value={style} onValueChange={setStyle}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STYLE_OPTIONS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Detail
          </label>
          <Select value={detail} onValueChange={(v) => setDetail(v as typeof detail)}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DETAIL_OPTIONS.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.label} · {d.frames} frames
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          {!planning ? (
            <Button onClick={generate} className="w-full gap-2">
              <Wand2 className="h-4 w-4" />
              Generate Storyboard
            </Button>
          ) : (
            <Button onClick={cancel} variant="destructive" className="w-full gap-2">
              <Square className="h-4 w-4" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* grid */}
      <div className="mt-6">
        {planning && frames.length === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: detailMeta.frames }).map((_, i) => (
              <div
                key={i}
                className="aspect-video animate-pulse rounded-xl border border-border/40 bg-muted/30"
              />
            ))}
          </div>
        ) : frames.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            <ImageIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
            Generate a script, then turn it into a cinematic storyboard.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {frames.map((f, idx) => (
              <FrameCard
                key={f.id}
                frame={f}
                index={idx}
                total={frames.length}
                onExpand={() => setLightboxFrame(f)}
                onRegenerate={() => regenerate(f.id)}
                onCopyPrompt={() => copyPrompt(f.prompt)}
                onDownload={() => downloadFrame(f)}
                onDelete={() => remove(f.id)}
                onMoveUp={() => move(f.id, -1)}
                onMoveDown={() => move(f.id, 1)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightboxFrame} onOpenChange={(o) => !o && setLightboxFrame(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{lightboxFrame?.title}</DialogTitle>
          </DialogHeader>
          {lightboxFrame?.imageUrl ? (
            <img
              src={lightboxFrame.imageUrl}
              alt={lightboxFrame.title}
              className="w-full rounded-lg"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-sm text-muted-foreground">
              No image rendered yet.
            </div>
          )}
          {lightboxFrame && (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full border border-border/50 px-2 py-0.5">
                  <Camera className="mr-1 inline h-3 w-3" />
                  {lightboxFrame.camera}
                </span>
                <span className="rounded-full border border-border/50 px-2 py-0.5">
                  {lightboxFrame.mood}
                </span>
                {lightboxFrame.characters.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-border/50 px-2 py-0.5"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <p className="text-muted-foreground">{lightboxFrame.description}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* --------------------------- card --------------------------- */

function FrameCard({
  frame,
  index,
  total,
  onExpand,
  onRegenerate,
  onCopyPrompt,
  onDownload,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  frame: Frame;
  index: number;
  total: number;
  onExpand: () => void;
  onRegenerate: () => void;
  onCopyPrompt: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const tone = moodClass(frame.mood);
  return (
    <article
      className={`group relative overflow-hidden rounded-xl border bg-gradient-to-br ${tone} backdrop-blur transition-all hover:shadow-elevated`}
    >
      <div className="relative aspect-video overflow-hidden bg-zinc-950">
        {frame.status === "ready" && frame.imageUrl ? (
          <img
            src={frame.imageUrl}
            alt={frame.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : frame.status === "loading" ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Rendering frame…
            </div>
          </div>
        ) : frame.status === "error" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-destructive">
            <span>Generation failed</span>
            <span className="text-[10px] text-muted-foreground">{frame.error}</span>
            <Button size="sm" variant="outline" onClick={onRegenerate} className="gap-1">
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
              <ImageIcon className="h-5 w-5 opacity-50" />
              Queued
            </div>
          </div>
        )}

        {/* number badge */}
        <div className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-mono text-white backdrop-blur">
          #{String(index + 1).padStart(2, "0")}
        </div>
        {frame.status === "ready" && (
          <button
            type="button"
            onClick={onExpand}
            className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
            title="Expand"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="space-y-2 p-3">
        <h3 className="line-clamp-1 text-sm font-semibold tracking-tight">{frame.title}</h3>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded-full border border-border/50 bg-background/40 px-2 py-0.5">
            <Camera className="mr-1 inline h-2.5 w-2.5" />
            {frame.camera}
          </span>
          <span className="rounded-full border border-border/50 bg-background/40 px-2 py-0.5">
            {frame.mood}
          </span>
        </div>
        <p className="line-clamp-2 text-[11px] text-muted-foreground">{frame.description}</p>

        <div className="flex flex-wrap gap-1 pt-1">
          <IconBtn title="Regenerate" onClick={onRegenerate}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="Copy prompt" onClick={onCopyPrompt}>
            <Copy className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn
            title="Download"
            onClick={onDownload}
            disabled={frame.status !== "ready"}
          >
            <Download className="h-3.5 w-3.5" />
          </IconBtn>
          <div className="ml-auto flex gap-1">
            <IconBtn title="Move up" onClick={onMoveUp} disabled={index === 0}>
              ↑
            </IconBtn>
            <IconBtn
              title="Move down"
              onClick={onMoveDown}
              disabled={index === total - 1}
            >
              ↓
            </IconBtn>
            <IconBtn title="Delete" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconBtn>
          </div>
        </div>
      </div>
    </article>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-7 min-w-7 items-center justify-center rounded-md border border-border/50 bg-background/40 px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
