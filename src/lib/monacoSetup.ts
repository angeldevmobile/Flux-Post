import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { registerGraphQLCompletionProvider } from "./graphqlIntrospection";

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

// Register GraphQL as a Monaco language with basic syntax highlighting
monaco.languages.register({ id: "graphql" });
monaco.languages.setMonarchTokensProvider("graphql", {
  keywords: [
    "query", "mutation", "subscription", "fragment", "on",
    "type", "interface", "union", "enum", "input", "schema",
    "extend", "directive", "implements", "true", "false", "null",
  ],
  scalars: ["String", "Int", "Float", "Boolean", "ID"],
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/"""/, { token: "string.block", next: "@blockString" }],
      [/"([^"\\]|\\.)*"/, "string"],
      [/@[a-zA-Z_]\w*/, "tag"],
      [/\$[a-zA-Z_]\w*/, "variable"],
      [/[a-zA-Z_]\w*/, {
        cases: {
          "@keywords": "keyword",
          "@scalars": "type",
          "@default": "identifier",
        },
      }],
      [/[0-9]+(\.[0-9]+)?/, "number"],
      [/[{}[\]()!:=|&]/, "delimiter"],
      [/\s+/, "white"],
    ],
    blockString: [
      [/"""/, { token: "string.block", next: "@pop" }],
      [/./, "string"],
    ],
  },
});

// Use local monaco instead of CDN
loader.config({ monaco });

registerGraphQLCompletionProvider();
