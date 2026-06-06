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

// Register Protocol Buffers (.proto) language
monaco.languages.register({ id: "proto" });
monaco.languages.setMonarchTokensProvider("proto", {
  keywords: [
    "syntax", "package", "import", "option", "message", "enum", "service",
    "rpc", "returns", "stream", "oneof", "map", "reserved", "extensions",
    "extend", "optional", "required", "repeated", "to", "max", "true", "false",
  ],
  builtinTypes: [
    "double", "float", "int32", "int64", "uint32", "uint64",
    "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64",
    "bool", "string", "bytes",
  ],
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/\/\*/, { token: "comment.block", next: "@blockComment" }],
      [/"([^"\\]|\\.)*"/, "string"],
      [/\b\d+\b/, "number"],
      [/[=;{}()[\],<>]/, "delimiter"],
      [/[a-zA-Z_]\w*/, {
        cases: {
          "@keywords": "keyword",
          "@builtinTypes": "type",
          "@default": "identifier",
        },
      }],
      [/\s+/, "white"],
    ],
    blockComment: [
      [/\*\//, { token: "comment.block", next: "@pop" }],
      [/./, "comment.block"],
    ],
  },
});

// Use local monaco instead of CDN
loader.config({ monaco });

registerGraphQLCompletionProvider();
