import * as monaco from "monaco-editor";
import { sendRequest } from "./tauri";

const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args { name description type { ...TypeRef } }
        type { ...TypeRef }
        isDeprecated
      }
      inputFields { name description type { ...TypeRef } }
      enumValues(includeDeprecated: true) { name description }
    }
  }
}
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name } } }
}`;

interface IntrospectionTypeRef {
  kind: string;
  name?: string | null;
  ofType?: IntrospectionTypeRef | null;
}

interface IntrospectionField {
  name: string;
  description?: string | null;
  type: IntrospectionTypeRef;
  args: { name: string; description?: string | null; type: IntrospectionTypeRef }[];
  isDeprecated?: boolean;
}

interface IntrospectionType {
  kind: string;
  name: string;
  description?: string | null;
  fields?: IntrospectionField[] | null;
  inputFields?: { name: string; description?: string | null; type: IntrospectionTypeRef }[] | null;
  enumValues?: { name: string; description?: string | null }[] | null;
}

export interface SchemaField {
  name: string;
  returnType: string;
  description?: string;
  args: { name: string; type: string }[];
  isDeprecated?: boolean;
}

export interface SchemaType {
  kind: string;
  fields: SchemaField[];
}

export interface ParsedSchema {
  queryType: string;
  mutationType?: string;
  subscriptionType?: string;
  types: Record<string, SchemaType>;
}

function unwrapType(ref: IntrospectionTypeRef): string {
  return ref.ofType ? unwrapType(ref.ofType) : (ref.name ?? "Unknown");
}

export async function fetchGraphQLSchema(
  url: string,
  headers: Record<string, string>,
): Promise<ParsedSchema> {
  const resp = await sendRequest({
    method: "POST",
    url,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ query: INTROSPECTION_QUERY }),
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const json = JSON.parse(resp.body);
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "GraphQL error");
  if (!json.data?.__schema) throw new Error("Invalid introspection response");

  const { __schema } = json.data;
  const types: Record<string, SchemaType> = {};

  for (const t of __schema.types as IntrospectionType[]) {
    if (t.name.startsWith("__")) continue;

    const rawFields = t.kind === "INPUT_OBJECT" ? t.inputFields : t.fields;
    const fields: SchemaField[] = (rawFields ?? []).map((f) => ({
      name: f.name,
      returnType: unwrapType(f.type),
      description: f.description ?? undefined,
      args: "args" in f
        ? (f as IntrospectionField).args.map((a) => ({ name: a.name, type: unwrapType(a.type) }))
        : [],
      isDeprecated: "isDeprecated" in f ? (f as IntrospectionField).isDeprecated : false,
    }));

    types[t.name] = { kind: t.kind, fields };
  }

  return {
    queryType: __schema.queryType.name,
    mutationType: __schema.mutationType?.name,
    subscriptionType: __schema.subscriptionType?.name,
    types,
  };
}

function getCurrentType(text: string, schema: ParsedSchema): string {
  const typeStack: string[] = [schema.queryType];
  let inComment = false;
  let inString = false;
  let tripleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (tripleQuote) {
      if (text.slice(i, i + 3) === '"""') { tripleQuote = false; i += 2; }
      continue;
    }
    if (inString) { if (ch === '"') inString = false; continue; }
    if (inComment) { if (ch === "\n") inComment = false; continue; }
    if (text.slice(i, i + 3) === '"""') { tripleQuote = true; i += 2; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === "#") { inComment = true; continue; }

    if (ch === "{") {
      const before = text.slice(0, i).trimEnd().replace(/\([^)]*\)\s*$/, "").trimEnd();
      const wordMatch = before.match(/([a-zA-Z_]\w*)\s*(?::\s*\S+\s*)?$/);
      if (wordMatch) {
        const word = wordMatch[1];
        if (word === "mutation") {
          typeStack.push(schema.mutationType ?? schema.queryType);
        } else if (word === "subscription") {
          typeStack.push(schema.subscriptionType ?? schema.queryType);
        } else if (word === "query") {
          typeStack.push(schema.queryType);
        } else {
          const current = schema.types[typeStack[typeStack.length - 1]];
          const field = current?.fields.find((f) => f.name === word);
          if (field) {
            typeStack.push(field.returnType);
          } else if (schema.types[word]) {
            // inline fragment `... on TypeName { }`
            typeStack.push(word);
          } else {
            // operation name or unknown — stay at current type
            typeStack.push(typeStack[typeStack.length - 1]);
          }
        }
      } else {
        // shorthand query `{ field }` — root type
        typeStack.push(typeStack[typeStack.length - 1]);
      }
    } else if (ch === "}") {
      if (typeStack.length > 1) typeStack.pop();
    }
  }

  return typeStack[typeStack.length - 1];
}

let _schema: ParsedSchema | null = null;
let _registered = false;

export function setCurrentSchema(schema: ParsedSchema | null): void {
  _schema = schema;
}

export function registerGraphQLCompletionProvider(): void {
  if (_registered) return;
  _registered = true;

  monaco.languages.registerCompletionItemProvider("graphql", {
    triggerCharacters: [" ", "\n", "{", "("],

    provideCompletionItems(model, position) {
      const schema = _schema;

      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: monaco.languages.CompletionItem[] = [];

      if (!schema) {
        for (const kw of ["query", "mutation", "subscription", "fragment"]) {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
          });
        }
        return { suggestions };
      }

      const textBeforeCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      let depth = 0;
      for (const ch of textBeforeCursor) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }

      if (depth <= 0) {
        for (const kw of ["query", "mutation", "subscription", "fragment"]) {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            sortText: "0" + kw,
          });
        }
        return { suggestions };
      }

      const currentTypeName = getCurrentType(textBeforeCursor, schema);
      const currentType = schema.types[currentTypeName];

      if (currentType) {
        for (const field of currentType.fields) {
          const hasArgs = field.args.length > 0;
          const subType = schema.types[field.returnType];
          const hasSubFields = (subType?.fields.length ?? 0) > 0;

          const argsSnippet = hasArgs
            ? `(${field.args.map((a, i) => `${a.name}: \${${i + 1}}`).join(", ")})`
            : "";
          const bodySnippet = hasSubFields ? ` {\n\t$0\n}` : "";

          suggestions.push({
            label: field.name,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: field.returnType,
            documentation: field.description,
            insertText: field.name + argsSnippet + bodySnippet,
            insertTextRules:
              hasArgs || hasSubFields
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
            range,
            sortText: (field.isDeprecated ? "z" : "a") + field.name,
          });
        }
      }

      return { suggestions };
    },
  });
}
