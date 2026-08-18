import type { GrpcService, GrpcField } from "@/lib/tauri";

const shortName = (fullName: string) => fullName.split(".").pop() ?? fullName;

/** Named types render as their own name; scalars render as the kind itself. */
function fieldTypeName(f: GrpcField): string {
  return f.kind === "message" || f.kind === "enum" ? shortName(f.typeName) : f.kind;
}

/**
 * Renders a readable .proto from reflected services, for the read-only Proto
 * tab. It is a view of the descriptors, not a faithful reproduction of the
 * original file: field numbers are positional and only request messages appear.
 */
export function generateProtoFromServices(services: GrpcService[]): string {
  const lines: string[] = ['syntax = "proto3";', ""];
  const messagesSeen = new Set<string>();

  for (const svc of services) {
    lines.push(`service ${svc.name} {`);
    for (const m of svc.methods) {
      const inp = m.clientStreaming ? `stream ${shortName(m.inputType)}` : shortName(m.inputType);
      const out = m.serverStreaming ? `stream ${shortName(m.outputType)}` : shortName(m.outputType);
      lines.push(`  rpc ${m.name} (${inp}) returns (${out}) {}`);
    }
    lines.push("}");
    lines.push("");
  }

  for (const svc of services) {
    for (const m of svc.methods) {
      if (!messagesSeen.has(m.inputType) && m.inputFields.length > 0) {
        messagesSeen.add(m.inputType);
        lines.push(`message ${shortName(m.inputType)} {`);
        m.inputFields.forEach((f, i) => {
          const mod = f.repeated ? "repeated " : f.optional ? "optional " : "";
          lines.push(`  ${mod}${fieldTypeName(f)} ${f.name} = ${i + 1};`);
        });
        lines.push("}");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}
