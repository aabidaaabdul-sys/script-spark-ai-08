import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  Copy,
  Check,
  Trash2,
  Download,
  StopCircle,
  Wand2,
  Flame,
  Film,
  Clapperboard,
  BookOpen,
  Feather,
  Type,
} from "lucide-react";

const STORAGE_KEY = "scriptforge.input.v2";
const MODE_KEY = "scriptforge.mode.v2";

type Mode =
  | "standard"
  | "thriller"
  | "drama"
  | "documentary"
  | "shortfilm"
  | "trailer";

const MODES: {
  id: Mode;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: "standard",
    label: "Standard Movie Script",
    desc: "Industry-standard screenplay format",
    icon: Film,
  },
  {
    id: "thriller",
    label: "Thriller Script",
    desc: "Tense, suspenseful, sharp dialogue",
    icon: Flame,
  },
  {
    id: "drama",
    label: "Emotional Drama",
    desc: "Heartfelt, grounded, human beats",
    icon: BookOpen,
  },
  {
    id: "documentary",
    label: "Documentary Script",
    desc: "Narrator V.O. + observational scenes",
    icon: Feather,
  },
  {
    id: "shortfilm",
    label: "Short Film Script",
    desc: "Tight single arc, every line earns it",
    icon: Type,
  },
  {
    id: "trailer",
    label: "Cinematic Trailer",
    desc: "Punchy beats, hard cuts, big finish",
    icon: Clapperboard,
  },
];

function wordCount(t: string) {
  const trimmed = t.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

type Stage =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "streaming"; chars: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function ScriptForgeWorkspace() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [hinglish, setHinglish] = useState("");
  const [hinglishBusy, setHinglishBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("standard");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [copiedHi, setCopiedHi] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const hinglishAbortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  // Restore draft + mode
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setInput(stored);
    const m = localStorage.getItem(MODE_KEY) as Mode | null;
    if (m && MODES.some((x) => x.id === m)) setMode(m);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(STORAGE_KEY, input), 400);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  // Elapsed timer
  useEffect(() => {
    if (stage.kind !== "thinking" && stage.kind !== "streaming") return;
    const id = setInterval(
      () => setElapsed((Date.now() - startedAtRef.current) / 1000),
      100,
    );
    return () => clearInterval(id);
  }, [stage.kind]);

  const inWords = useMemo(() => wordCount(input), [input]);
  const outWords = useMemo(() => wordCount(output), [output]);
  const inChars = input.length;

  const translateToHinglish = useCallback(async (englishScript: string) => {
    if (!englishScript.trim()) return;
    hinglishAbortRef.current?.abort();
    const ctrl = new AbortController();
    hinglishAbortRef.current = ctrl;
    setHinglish("");
    setHinglishBusy(true);
    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: englishScript, mode: "hinglish" }),
      });
      if (!res.ok || !res.body) {
        setHinglishBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content as
              | string
              | undefined;
            if (delta) {
              acc += delta;
              setHinglish(acc);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== "AbortError") {
        console.error("hinglish translate error", err);
      }
    } finally {
      setHinglishBusy(false);
    }
  }, []);

  const handleConvert = useCallback(async () => {
    if (!input.trim()) {
      toast.error("Paste or type your rough script first.");
      return;
    }
    abortRef.current?.abort();
    hinglishAbortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setOutput("");
    setHinglish("");
    startedAtRef.current = Date.now();
    setElapsed(0);
    setStage({ kind: "thinking" });

    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: input, mode }),
      });
      if (!res.ok || !res.body) {
        let msg = "Conversion failed.";
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {}
        setStage({ kind: "error", message: msg });
        toast.error(msg);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content as
              | string
              | undefined;
            if (delta) {
              acc += delta;
              setOutput(acc);
              setStage({ kind: "streaming", chars: acc.length });
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      setStage({ kind: "done" });
      toast.success(
        `Done in ${((Date.now() - startedAtRef.current) / 1000).toFixed(1)}s`,
      );
      // Auto-generate Hinglish meaning version
      if (acc.trim()) {
        translateToHinglish(acc);
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        setStage({ kind: "idle" });
        return;
      }
      console.error(err);
      const msg = "Conversion error. Please retry.";
      setStage({ kind: "error", message: msg });
      toast.error(msg);
    }
  }, [input, mode, translateToHinglish]);

  const cancelConvert = useCallback(() => {
    abortRef.current?.abort();
    hinglishAbortRef.current?.abort();
    setHinglishBusy(false);
    setStage({ kind: "idle" });
  }, []);

  const copyOutput = useCallback(async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }, [output]);

  const copyHinglish = useCallback(async () => {
    if (!hinglish) return;
    try {
      await navigator.clipboard.writeText(hinglish);
      setCopiedHi(true);
      toast.success("Hinglish copied");
      setTimeout(() => setCopiedHi(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }, [hinglish]);

  const downloadOutput = useCallback(() => {
    if (!output) return;
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scriptforge-${mode}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [output, mode]);

  const downloadHinglish = useCallback(() => {
    if (!hinglish) return;
    const blob = new Blob([hinglish], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scriptforge-${mode}-hinglish.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [hinglish, mode]);

  // Shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === "Enter") {
        e.preventDefault();
        handleConvert();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleConvert]);

  const isBusy = stage.kind === "thinking" || stage.kind === "streaming";
  const progressPct =
    stage.kind === "streaming"
      ? Math.min(
          95,
          Math.round((stage.chars / Math.max(input.length * 1.4, 400)) * 100),
        )
      : stage.kind === "thinking"
        ? 8
        : stage.kind === "done"
          ? 100
          : 0;

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 py-6 sm:px-6 sm:py-10">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
            <Wand2 className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold leading-none tracking-tight sm:text-3xl">
              ScriptForge <span className="text-gradient-primary">AI</span>
            </h1>
            <p className="mt-1.5 text-xs text-muted-foreground sm:text-sm">
              Rough Hinglish → professional movie screenplay. Industry format. Instantly.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary shadow-glow" />
          Streaming AI · Meaning-locked
        </div>
      </header>

      {/* Mode selector */}
      <section className="mt-7">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="font-display text-base">Choose screenplay style</h2>
            <p className="text-xs text-muted-foreground">
              Output is always real industry-standard screenplay format. Style sets the tone.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`group relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all ${
                  active
                    ? "border-primary/60 bg-primary/10 shadow-glow"
                    : "border-border/60 bg-card/40 backdrop-blur-md hover:border-border hover:bg-card/70"
                }`}
              >
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-md ${
                    active
                      ? "bg-gradient-primary text-primary-foreground"
                      : "bg-surface-elevated text-muted-foreground group-hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="text-[12.5px] font-medium leading-tight">
                  {m.label}
                </div>
                <div className="text-[10.5px] leading-snug text-muted-foreground">
                  {m.desc}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Progress */}
      {(isBusy || stage.kind === "done" || stage.kind === "error") && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-4 py-3 backdrop-blur-md">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15">
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : stage.kind === "done" ? (
              <Check className="h-3.5 w-3.5 text-primary" />
            ) : (
              <StopCircle className="h-3.5 w-3.5 text-destructive" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">
                {stage.kind === "thinking"
                  ? "Reading meaning, tone & intent…"
                  : stage.kind === "streaming"
                    ? "Forging your professional script…"
                    : stage.kind === "done"
                      ? "Done · meaning preserved"
                      : stage.kind === "error"
                        ? stage.message
                        : ""}
              </span>
              {(isBusy || stage.kind === "done") && (
                <span className="tabular-nums text-muted-foreground">
                  {elapsed.toFixed(1)}s
                </span>
              )}
            </div>
            <Progress value={progressPct} className="mt-2 h-1" />
          </div>
        </div>
      )}

      {/* Editors */}
      <section className="mt-5 grid flex-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {/* Input */}
        <Glass>
          <PanelHeader
            eyebrow="Box 1 · Input"
            title="Rough Script Input"
            sub="Hinglish · broken English · raw notes — paste anything"
            right={
              <div className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {inWords}w · {inChars} chars
                </span>
                {input && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setInput("");
                      setOutput("");
                      setHinglish("");
                      setStage({ kind: "idle" });
                    }}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Clear
                  </Button>
                )}
              </div>
            }
          />
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Yahaan paste karo apna rough script ya idea...

Example:
"Aaj main aapko ek aisi story bataunga jo aapki life change kar degi. Ye kahani hai ek ladke ki jo bilkul zero se start kiya tha..."`}
            className="h-[52vh] resize-none border-0 bg-transparent px-0 text-[14px] leading-relaxed shadow-none focus-visible:ring-0 sm:text-[15px]"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              ⌘/Ctrl + Enter to convert
            </span>
            {isBusy ? (
              <Button
                onClick={cancelConvert}
                size="lg"
                variant="secondary"
                className="font-medium"
              >
                <StopCircle className="mr-2 h-4 w-4" /> Stop
              </Button>
            ) : (
              <Button
                onClick={handleConvert}
                disabled={!input.trim()}
                size="lg"
                className="bg-gradient-primary font-medium text-primary-foreground shadow-glow hover:opacity-95"
              >
                <Sparkles className="mr-2 h-4 w-4" /> Generate Screenplay
              </Button>
            )}
          </div>
        </Glass>

        {/* Output */}
        <Glass accent>
          <PanelHeader
            eyebrow={`Screenplay · ${MODES.find((m) => m.id === mode)?.label}`}
            title="Professional movie script"
            sub="Industry format · simple English · meaning preserved"
            right={
              <div className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {outWords}w
                </span>
                {output && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={copyOutput}
                    >
                      {copied ? (
                        <>
                          <Check className="mr-1 h-3 w-3" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="mr-1 h-3 w-3" /> Copy
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={downloadOutput}
                    >
                      <Download className="mr-1 h-3 w-3" /> .txt
                    </Button>
                  </>
                )}
              </div>
            }
          />
          {output ? (
            <pre className="h-[52vh] overflow-auto whitespace-pre-wrap px-0 font-mono text-[13px] leading-[1.55] sm:text-[13.5px]">
              {output}
              {isBusy && (
                <span className="ml-0.5 inline-block h-4 w-1.5 -translate-y-0.5 animate-pulse bg-primary align-middle" />
              )}
            </pre>
          ) : (
            <div className="flex h-[52vh] items-center justify-center text-center">
              <div className="max-w-xs space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/5">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Your professionally formatted screenplay will stream here.
                </p>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                  Scene headings · action · dialogue · transitions
                </p>
              </div>
            </div>
          )}
        </Glass>
      </section>

      {/* Footer trust strip */}
      <footer className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-border/40 pt-5 text-[11px] text-muted-foreground sm:flex-row">
        <span>© ScriptForge AI · Built for creators</span>
        <span className="flex items-center gap-3">
          <span>Meaning-locked</span>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
          <span>Tone-aware</span>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
          <span>Zero login</span>
        </span>
      </footer>
    </div>
  );
}

/* ---------- Glass panel ---------- */

function Glass({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border border-border/60 bg-card/50 p-4 shadow-elevated backdrop-blur-xl sm:p-5 ${
        accent ? "bg-spotlight" : ""
      }`}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
        aria-hidden
      />
      {children}
    </div>
  );
}

function PanelHeader({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
          {eyebrow}
        </div>
        <h3 className="mt-1 truncate font-display text-base sm:text-lg">
          {title}
        </h3>
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
          {sub}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </div>
  );
}
