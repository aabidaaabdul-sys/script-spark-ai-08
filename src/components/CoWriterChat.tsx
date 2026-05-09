import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Bot,
  Send,
  Sparkles,
  StopCircle,
  User as UserIcon,
  Lightbulb,
  Wand2,
  Trash2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

type Lang = "hinglish" | "hindi" | "urdu" | "english";

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string; // chat-visible content (markers stripped)
  scriptPreview?: string; // first ~120 chars of any embedded script rewrite
  pending?: boolean;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  script: string;
  mode: string;
  lang: Lang;
  modeLabel: string;
  onScriptUpdate: (next: string, note?: string) => void;
  canUndo: boolean;
  onUndo: () => void;
}

const SUGGESTION_CHIPS: { label: string; prompt: string }[] = [
  { label: "Add Plot Twist", prompt: "Add a strong, unexpected plot twist near the climax. Keep all existing characters and continuity intact." },
  { label: "Improve Hook", prompt: "Rewrite the opening so the first page is impossible to look away from." },
  { label: "More Suspense", prompt: "Increase suspense throughout — withhold information, add tension beats, sharpen silences." },
  { label: "Darker Tone", prompt: "Make the overall tone darker and more cinematic without changing the story." },
  { label: "Better Ending", prompt: "Rewrite the ending to land with more emotional and dramatic impact." },
  { label: "More Emotional", prompt: "Deepen the emotional beats. Subtext over melodrama." },
  { label: "Faster Pacing", prompt: "Tighten pacing. Cut dead air. Sharpen scene transitions." },
  { label: "Cinematic Upgrade", prompt: "Upgrade action lines to be more visual and cinematic. Improve dialogue rhythm." },
  { label: "Improve Dialogue", prompt: "Rewrite the dialogue so every character has a distinct, memorable voice." },
  { label: "Netflix-Style", prompt: "Rewrite in a Netflix-grade prestige drama tone — grounded, layered, character-driven." },
];

const SCRIPT_OPEN = "<<<SCRIPT_REWRITE>>>";
const SCRIPT_CLOSE = "<<<END_SCRIPT_REWRITE>>>";

function extractRewrite(text: string): { chat: string; script: string | null } {
  const i = text.indexOf(SCRIPT_OPEN);
  if (i === -1) return { chat: text, script: null };
  const j = text.indexOf(SCRIPT_CLOSE, i + SCRIPT_OPEN.length);
  const before = text.slice(0, i).trim();
  if (j === -1) {
    // streaming: script not closed yet — show only the chat half so far
    return { chat: before || "Updating script…", script: null };
  }
  const script = text.slice(i + SCRIPT_OPEN.length, j).trim();
  const after = text.slice(j + SCRIPT_CLOSE.length).trim();
  const chat = [before, after].filter(Boolean).join("\n\n") || "Updated the script.";
  return { chat, script };
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function CoWriterChat({
  open,
  onOpenChange,
  script,
  mode,
  lang,
  modeLabel,
  onScriptUpdate,
  canUndo,
  onUndo,
}: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [brainstorm, setBrainstorm] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      const userMsg: ChatMsg = { id: uid(), role: "user", content: trimmed };
      const assistantId = uid();
      const assistantMsg: ChatMsg = {
        id: assistantId,
        role: "assistant",
        content: "",
        pending: true,
      };

      const history = [...messages, userMsg];
      setMessages([...history, assistantMsg]);
      setInput("");
      setBusy(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // rAF-throttled buffer for smooth streaming.
      let raw = "";
      let pending = "";
      let rafId: number | null = null;
      const apply = () => {
        rafId = null;
        if (!pending) return;
        raw += pending;
        pending = "";
        const { chat, script: rewritten } = extractRewrite(raw);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: chat,
                  scriptPreview: rewritten ? rewritten.slice(0, 140) : undefined,
                }
              : m,
          ),
        );
      };
      const schedule = (s: string) => {
        pending += s;
        if (rafId == null) rafId = requestAnimationFrame(apply);
      };

      try {
        const res = await fetch("/api/cowriter", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map(({ role, content }) => ({ role, content })),
            script,
            mode,
            lang,
            brainstorm,
          }),
        });
        if (!res.ok || !res.body) {
          let msg = "Co-Writer unavailable.";
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {}
          toast.error(msg);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: msg, pending: false } : m,
            ),
          );
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
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
              if (delta) schedule(delta);
            } catch {
              buffer = line + "\n" + buffer;
              break;
            }
          }
        }
        if (rafId != null) cancelAnimationFrame(rafId);
        apply();

        // Finalize: extract any script rewrite & apply to workspace.
        const final = extractRewrite(raw);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: final.chat || "Done.",
                  scriptPreview: final.script
                    ? final.script.slice(0, 140)
                    : undefined,
                  pending: false,
                }
              : m,
          ),
        );
        if (final.script) {
          onScriptUpdate(final.script, "Co-Writer revision");
          toast.success("Script updated by Co-Writer");
        }
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content || "Stopped.", pending: false }
                : m,
            ),
          );
        } else {
          console.error(err);
          toast.error("Co-Writer error.");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: "Something went wrong. Please retry.", pending: false }
                : m,
            ),
          );
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [messages, busy, script, mode, lang, brainstorm, onScriptUpdate],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearChat = useCallback(() => {
    if (busy) return;
    setMessages([]);
  }, [busy]);

  const headerSub = useMemo(
    () => `${modeLabel} · ${lang.toUpperCase()} · ${script ? `${Math.round(script.length / 1000)}k chars in context` : "no script yet"}`,
    [modeLabel, lang, script],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full max-w-full flex-col gap-0 border-l border-border/60 bg-card/85 p-0 backdrop-blur-2xl sm:max-w-[460px] md:max-w-[520px] lg:max-w-[560px]"
      >
        <SheetHeader className="space-y-1 border-b border-border/50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
              <Bot className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base font-display">
                AI Co-Writer
              </SheetTitle>
              <SheetDescription className="text-[11px] truncate">
                {headerSub}
              </SheetDescription>
            </div>
            <button
              type="button"
              onClick={() => setBrainstorm((b) => !b)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-medium uppercase tracking-wider transition-all ${
                brainstorm
                  ? "border-primary/60 bg-primary/15 text-primary shadow-glow"
                  : "border-border/60 bg-card/50 text-muted-foreground hover:text-foreground"
              }`}
              title="Toggle brainstorm mode"
            >
              <Lightbulb className="h-3 w-3" />
              {brainstorm ? "Brainstorm" : "Edit"}
            </button>
          </div>
        </SheetHeader>

        {/* Suggestions */}
        <div className="border-b border-border/40 px-5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Quick directions
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={onUndo}
                disabled={!canUndo || busy}
                title="Undo last script change"
              >
                <Undo2 className="mr-1 h-3 w-3" /> Undo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={clearChat}
                disabled={busy || messages.length === 0}
              >
                <Trash2 className="mr-1 h-3 w-3" /> Clear
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTION_CHIPS.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={busy}
                onClick={() => sendMessage(s.prompt)}
                className="rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-[11px] text-foreground/80 transition-all hover:border-primary/60 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/5">
                <Wand2 className="h-5 w-5 text-primary" />
              </div>
              <p className="max-w-xs text-sm text-muted-foreground">
                {script
                  ? "Tell me what to change — \"darker tone\", \"add plot twist\", \"rewrite the climax\"…"
                  : "Generate a script first, then I'll help you refine, expand, or brainstorm with it."}
              </p>
              <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                Hinglish · Hindi · Urdu · English
              </p>
            </div>
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} />)
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border/50 bg-card/60 px-4 py-3 backdrop-blur-md">
          <div className="flex items-end gap-2 rounded-xl border border-border/60 bg-card/80 p-2 focus-within:border-primary/60 focus-within:shadow-glow">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder={
                brainstorm
                  ? "Brainstorm freely — ideas, twists, character motives…"
                  : "Tell the Co-Writer what to change…"
              }
              rows={1}
              className="min-h-[40px] max-h-[160px] resize-none border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-0"
              disabled={busy}
            />
            {busy ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={stop}
                className="h-9 shrink-0"
              >
                <StopCircle className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                className="h-9 shrink-0 bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-95"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
            <span>Enter to send · Shift+Enter for newline</span>
            <span className="flex items-center gap-1">
              <RotateCcw className="h-2.5 w-2.5" /> Context-aware
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Bubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          isUser
            ? "bg-secondary text-secondary-foreground"
            : "bg-gradient-primary text-primary-foreground shadow-glow"
        }`}
      >
        {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={`max-w-[82%] space-y-1.5 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
            isUser
              ? "bg-primary/15 text-foreground"
              : "border border-border/60 bg-card/70 text-foreground"
          }`}
        >
          {msg.content || (msg.pending ? "…" : "")}
          {msg.pending && (
            <span className="ml-1 inline-block h-3 w-1 -translate-y-0.5 animate-pulse bg-primary align-middle" />
          )}
        </div>
        {msg.scriptPreview && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-[10.5px]">
            <div className="mb-0.5 flex items-center gap-1 font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" /> Script updated
            </div>
            <div className="font-mono text-[10px] text-muted-foreground line-clamp-2">
              {msg.scriptPreview}…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
