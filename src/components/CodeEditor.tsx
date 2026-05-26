import { useState, useRef } from "react";
import Editor from "@monaco-editor/react";
import "@/lib/monacoSetup";
import { useSettingsStore } from "@/stores/settings";
import { Sparkles, Send, Loader2, X } from "lucide-react";

type Lang = "json" | "javascript" | "graphql" | "html" | "xml" | "plaintext";

interface CodeEditorProps {
  value: string;
  onChange: (val: string) => void;
  lang: Lang;
  placeholder?: string;
  showLineNumbers?: boolean;
  readOnly?: boolean;
  noBorder?: boolean;
  onAiEdit?: (instruction: string) => Promise<string>;
}

function defineThemes(monaco: typeof import("monaco-editor")) {
  monaco.editor.defineTheme("flux-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background":                  "#0F0F0F",
      "editor.foreground":                  "#E4E4E7",
      "editor.lineHighlightBackground":     "#FFFFFF00",
      "editor.lineHighlightBorder":         "#FFFFFF00",
      "editor.selectionBackground":         "#A855F740",
      "editorCursor.foreground":            "#A855F7",
      "editorLineNumber.foreground":        "#52525B",
      "editorLineNumber.activeForeground":  "#A1A1AA",
      "editorIndentGuide.background1":      "#27272A",
      "editorIndentGuide.activeBackground1":"#52525B",
      "editorBracketMatch.background":      "#A855F730",
      "editorBracketMatch.border":          "#A855F780",
      "editorWidget.background":            "#1A1A1A",
      "editorWidget.border":                "#27272A",
      "editorSuggestWidget.background":     "#1A1A1A",
      "editorSuggestWidget.border":         "#27272A",
      "editorSuggestWidget.selectedBackground": "#A855F725",
      "editorHoverWidget.background":       "#1A1A1A",
      "editorHoverWidget.border":           "#27272A",
      "scrollbarSlider.background":         "#27272A80",
      "scrollbarSlider.hoverBackground":    "#52525B80",
    },
  });

  monaco.editor.defineTheme("flux-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background":                  "#EBEBEB",
      "editor.foreground":                  "#09090B",
      "editor.lineHighlightBackground":     "#00000000",
      "editor.lineHighlightBorder":         "#00000000",
      "editor.selectionBackground":         "#A855F730",
      "editorCursor.foreground":            "#A855F7",
      "editorLineNumber.foreground":        "#A1A1AA",
      "editorLineNumber.activeForeground":  "#71717A",
      "editorIndentGuide.background1":      "#D1D1D6",
      "editorIndentGuide.activeBackground1":"#A1A1AA",
      "editorBracketMatch.background":      "#A855F720",
      "editorBracketMatch.border":          "#A855F760",
      "editorWidget.background":            "#F5F5F5",
      "editorWidget.border":                "#D1D1D6",
      "editorSuggestWidget.background":     "#F5F5F5",
      "editorSuggestWidget.border":         "#D1D1D6",
      "editorSuggestWidget.selectedBackground": "#A855F715",
      "editorHoverWidget.background":       "#F5F5F5",
      "editorHoverWidget.border":           "#D1D1D6",
      "scrollbarSlider.background":         "#D1D1D680",
      "scrollbarSlider.hoverBackground":    "#A1A1AA80",
    },
  });
}

function toMonacoLang(lang: Lang): string {
  if (lang === "json") return "json";
  if (lang === "html") return "html";
  if (lang === "xml") return "xml";
  if (lang === "graphql") return "graphql";
  if (lang === "plaintext") return "plaintext";
  return "javascript";
}

export function CodeEditor({
  value, onChange, lang, placeholder,
  showLineNumbers = false, readOnly = false, noBorder = false,
  onAiEdit,
}: CodeEditorProps) {
  const { theme, wordWrap } = useSettingsStore();
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const [aiOpen, setAiOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleAiEdit() {
    if (!onAiEdit || !instruction.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await onAiEdit(instruction.trim());
      onChange(result);
      setInstruction("");
      setAiOpen(false);
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }

  function openAi() {
    setAiOpen(true);
    setAiError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function closeAi() {
    setAiOpen(false);
    setInstruction("");
    setAiError(null);
  }

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 overflow-hidden${noBorder ? "" : " rounded-lg"}`}
      style={noBorder ? {} : { border: "1px solid var(--color-border)" }}
    >
      {/* AI toolbar — shown only when onAiEdit is provided and not readOnly */}
      {onAiEdit && !readOnly && (
        <div
          className="flex items-center shrink-0 gap-1 px-2"
          style={{
            height: 32,
            background: "var(--color-topbar)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {!aiOpen ? (
            <button
              onClick={openAi}
              className="flex items-center gap-1.5 px-2 rounded transition-colors hover:opacity-80"
              style={{ height: 22, background: "var(--color-accent-10)", border: "1px solid var(--color-accent-20)" }}
              title="Edit with AI"
            >
              <Sparkles size={11} style={{ color: "var(--color-accent)" }} />
              <span className="text-[11px] font-medium" style={{ color: "var(--color-accent)" }}>Ask AI</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 flex-1">
              <Sparkles size={11} style={{ color: "var(--color-accent)" }} className="shrink-0" />
              <input
                ref={inputRef}
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleAiEdit();
                  if (e.key === "Escape") closeAi();
                }}
                placeholder="e.g. add auth header, format as JSON, fix syntax…"
                className="flex-1 text-[11px] bg-transparent outline-none"
                style={{ color: "var(--color-fg)", fontFamily: "Geist Mono, monospace" }}
                disabled={aiLoading}
              />
              {aiError && (
                <span className="text-[10px] truncate max-w-40" style={{ color: "#EF4444" }} title={aiError}>
                  {aiError}
                </span>
              )}
              <button
                onClick={handleAiEdit}
                disabled={!instruction.trim() || aiLoading}
                className="shrink-0 flex items-center justify-center rounded transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ width: 22, height: 22, background: "var(--color-accent)" }}
              >
                {aiLoading
                  ? <Loader2 size={11} className="animate-spin text-white" />
                  : <Send size={11} className="text-white" />}
              </button>
              <button
                onClick={closeAi}
                className="shrink-0 flex items-center justify-center rounded transition-opacity hover:opacity-70"
                style={{ width: 22, height: 22, color: "var(--color-fg-4)" }}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <Editor
          value={value}
          onChange={v => onChange(v ?? "")}
          language={toMonacoLang(lang)}
          theme={isDark ? "flux-dark" : "flux-light"}
          beforeMount={defineThemes}
          options={{
            fontSize: 12,
            fontFamily: "Geist Mono, JetBrains Mono, Fira Code, monospace",
            lineHeight: 20,
            lineNumbers: showLineNumbers ? "on" : "off",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: wordWrap ? "on" : "off",
            tabSize: 2,
            insertSpaces: true,
            folding: readOnly,
            renderLineHighlight: "none",
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
            padding: { top: 12, bottom: 12 },
            placeholder: readOnly ? undefined : placeholder,
            bracketPairColorization: { enabled: false },
            guides: { indentation: true, bracketPairs: false },
            contextmenu: true,
            fixedOverflowWidgets: true,
            automaticLayout: true,
            readOnly,
            domReadOnly: readOnly,
          }}
          height="100%"
        />
      </div>
    </div>
  );
}
