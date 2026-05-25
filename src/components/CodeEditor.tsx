import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const fluxHighlight = HighlightStyle.define([
  { tag: t.keyword,                     color: "#A855F7" },
  { tag: t.string,                      color: "#86EFAC" },
  { tag: t.number,                      color: "#FCA5A5" },
  { tag: t.bool,                        color: "#F9A8D4" },
  { tag: t.null,                        color: "#F9A8D4" },
  { tag: t.propertyName,               color: "#93C5FD" },
  { tag: t.comment,                     color: "#52525b", fontStyle: "italic" },
  { tag: t.operator,                    color: "#71717A" },
  { tag: t.punctuation,                 color: "#71717A" },
  { tag: t.bracket,                     color: "#A1A1AA" },
  { tag: t.variableName,               color: "#e4e4e7" },
  { tag: t.function(t.variableName),   color: "#C4B5FD" },
  { tag: t.definition(t.variableName), color: "#C4B5FD" },
  { tag: t.typeName,                   color: "#67E8F9" },
  { tag: t.attributeName,              color: "#93C5FD" },
  { tag: t.attributeValue,             color: "#86EFAC" },
]);

const fluxTheme = EditorView.theme({
  "&": { background: "var(--color-sidebar)", height: "100%", borderRadius: "8px" },
  ".cm-scroller": {
    fontFamily: "Geist Mono, JetBrains Mono, Fira Code, monospace",
    fontSize: "12px",
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": { padding: "12px", color: "#e4e4e7", caretColor: "#A855F7" },
  ".cm-gutters": {
    background: "var(--color-sidebar)",
    border: "none",
    paddingRight: "8px",
    color: "#52525b",
    minWidth: "32px",
  },
  ".cm-lineNumbers .cm-gutterElement": { paddingLeft: "8px" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-matchingBracket": { backgroundColor: "#A855F730", outline: "1px solid #A855F760" },
  ".cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "#A855F7" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#A855F730 !important" },
  ".cm-placeholder": { color: "#52525b" },
}, { dark: true });

const baseExtensions = [
  fluxTheme,
  syntaxHighlighting(fluxHighlight),
  EditorView.lineWrapping,
];

type Lang = "json" | "javascript" | "graphql";

interface CodeEditorProps {
  value: string;
  onChange: (val: string) => void;
  lang: Lang;
  placeholder?: string;
  showLineNumbers?: boolean;
}

export function CodeEditor({ value, onChange, lang, placeholder, showLineNumbers = false }: CodeEditorProps) {
  const langExt = lang === "json" ? [json()] : lang === "javascript" ? [javascript()] : [];

  return (
    <div className="flex-1 min-h-0 overflow-hidden rounded-lg" style={{ border: "1px solid var(--color-border)" }}>
      <CodeMirror
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: showLineNumbers,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          searchKeymap: false,
          syntaxHighlighting: false,
        }}
        extensions={[...baseExtensions, ...langExt]}
        style={{ height: "100%", display: "flex", flexDirection: "column" }}
      />
    </div>
  );
}
