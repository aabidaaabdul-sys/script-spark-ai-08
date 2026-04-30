import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileDown,
  FileText,
  FileType2,
  Subtitles,
  Mic,
  ChevronDown,
  Loader2,
  Languages,
} from "lucide-react";
import { toast } from "sonner";
import {
  runExport,
  type ExportFormat,
  type ExportLang,
  type ExportSource,
} from "@/lib/exporters";

interface Props {
  englishScript: string;
  meaningScript: string;
  meaningLang: ExportLang;
  mode: string;
}

const FORMATS: {
  id: ExportFormat;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "pdf", label: "PDF Screenplay", desc: "Print-ready · industry layout", icon: FileDown },
  { id: "docx", label: "DOCX (Word)", desc: "Editable · formatted", icon: FileType2 },
  { id: "txt", label: "TXT", desc: "Plain text · UTF-8", icon: FileText },
  { id: "srt", label: "Subtitle SRT", desc: "Auto-timed cues", icon: Subtitles },
  { id: "teleprompter", label: "Teleprompter", desc: "Large readable lines", icon: Mic },
];

const SOURCES: { id: ExportSource; label: string; desc: string }[] = [
  { id: "english", label: "English Script", desc: "Box 2 only" },
  { id: "meaning", label: "Meaning Version", desc: "Box 3 only" },
  { id: "both", label: "Both Together", desc: "English + meaning" },
];

export function ExportPanel({
  englishScript,
  meaningScript,
  meaningLang,
  mode,
}: Props) {
  const [source, setSource] = useState<ExportSource>("english");
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const hasEnglish = englishScript.trim().length > 0;
  const hasMeaning = meaningScript.trim().length > 0;
  const canExport =
    (source === "english" && hasEnglish) ||
    (source === "meaning" && hasMeaning) ||
    (source === "both" && hasEnglish && hasMeaning);

  const handleExport = async (format: ExportFormat) => {
    if (!canExport) {
      toast.error("Generate the script first.");
      return;
    }
    setBusy(format);
    try {
      await runExport(format, {
        englishScript,
        meaningScript,
        meaningLang,
        mode,
        source,
      });
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch (err) {
      console.error("export failed", err);
      toast.error("File generation failed. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const sourceLabel = SOURCES.find((s) => s.id === source)?.label ?? "English Script";

  return (
    <section className="mt-6 rounded-2xl border border-border/60 bg-card/50 p-4 shadow-elevated backdrop-blur-xl sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground shadow-glow">
            <FileDown className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
              Export & Download
            </div>
            <h3 className="font-display text-base sm:text-lg">
              Premium Multi-Format Export
            </h3>
            <p className="text-[11.5px] text-muted-foreground">
              PDF · DOCX · TXT · SRT · Teleprompter — full Hindi / Urdu / Hinglish support
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Languages className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Source:</span>
                <span className="font-medium">{sourceLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Export Source</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SOURCES.map((s) => {
                const disabled =
                  (s.id === "english" && !hasEnglish) ||
                  (s.id === "meaning" && !hasMeaning) ||
                  (s.id === "both" && !(hasEnglish && hasMeaning));
                return (
                  <DropdownMenuItem
                    key={s.id}
                    disabled={disabled}
                    onClick={() => setSource(s.id)}
                    className="flex flex-col items-start"
                  >
                    <span className="font-medium">{s.label}</span>
                    <span className="text-[11px] text-muted-foreground">{s.desc}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {FORMATS.map((f) => {
          const Icon = f.icon;
          const isBusy = busy === f.id;
          return (
            <button
              key={f.id}
              type="button"
              disabled={!canExport || busy !== null}
              onClick={() => handleExport(f.id)}
              className="group flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/40 p-3 text-left transition-all hover:border-primary/50 hover:bg-card/70 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border/60 disabled:hover:bg-card/40 disabled:hover:shadow-none"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-elevated text-muted-foreground group-hover:bg-gradient-primary group-hover:text-primary-foreground">
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium leading-tight">
                  {f.label}
                </div>
                <div className="truncate text-[10.5px] leading-snug text-muted-foreground">
                  {f.desc}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {!canExport && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Generate a script first to enable downloads.
        </p>
      )}
    </section>
  );
}
