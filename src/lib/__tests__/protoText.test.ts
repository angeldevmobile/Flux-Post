import { describe, it, expect } from "vitest";
import { generateProtoFromServices } from "../protoText";
import type { GrpcService, GrpcField } from "@/lib/tauri";

const f = (over: Partial<GrpcField> & { name: string; kind: string }): GrpcField => ({
  typeName: "",
  repeated: false,
  optional: false,
  ...over,
});

const greeter: GrpcService[] = [
  {
    name: "Greeter",
    fullName: "test.Greeter",
    methods: [
      {
        name: "Unary",
        inputType: "test.Hello",
        outputType: "test.Reply",
        clientStreaming: false,
        serverStreaming: false,
        inputFields: [f({ name: "name", kind: "string" })],
      },
      {
        name: "ServerStream",
        inputType: "test.Hello",
        outputType: "test.Reply",
        clientStreaming: false,
        serverStreaming: true,
        inputFields: [],
      },
      {
        name: "ClientStream",
        inputType: "test.Hello",
        outputType: "test.Reply",
        clientStreaming: true,
        serverStreaming: false,
        inputFields: [],
      },
      {
        name: "Bidi",
        inputType: "test.Hello",
        outputType: "test.Reply",
        clientStreaming: true,
        serverStreaming: true,
        inputFields: [],
      },
    ],
  },
];

describe("generateProtoFromServices", () => {
  it("emits a proto3 header and the service block", () => {
    const out = generateProtoFromServices(greeter);
    expect(out.startsWith('syntax = "proto3";')).toBe(true);
    expect(out).toContain("service Greeter {");
  });

  it("marks each streaming direction on the right side of the rpc", () => {
    const out = generateProtoFromServices(greeter);
    expect(out).toContain("rpc Unary (Hello) returns (Reply) {}");
    expect(out).toContain("rpc ServerStream (Hello) returns (stream Reply) {}");
    expect(out).toContain("rpc ClientStream (stream Hello) returns (Reply) {}");
    expect(out).toContain("rpc Bidi (stream Hello) returns (stream Reply) {}");
  });

  it("strips the package from type names", () => {
    expect(generateProtoFromServices(greeter)).not.toContain("test.Hello");
  });

  it("renders each field with its type, and named types by name", () => {
    const out = generateProtoFromServices([
      {
        name: "S",
        fullName: "p.S",
        methods: [
          {
            name: "M",
            inputType: "p.Req",
            outputType: "p.Res",
            clientStreaming: false,
            serverStreaming: false,
            inputFields: [
              f({ name: "title", kind: "string" }),
              f({ name: "count", kind: "int32" }),
              f({ name: "status", kind: "enum", typeName: "p.Status" }),
              f({ name: "address", kind: "message", typeName: "p.Address" }),
            ],
          },
        ],
      },
    ]);

    expect(out).toContain("  string title = 1;");
    expect(out).toContain("  int32 count = 2;");
    // An enum field renders as its type, not the literal word "enum".
    expect(out).toContain("  Status status = 3;");
    expect(out).toContain("  Address address = 4;");
    expect(out).not.toMatch(/^\s+enum status/m);
  });

  it("prefixes repeated and optional fields, and nothing else", () => {
    const out = generateProtoFromServices([
      {
        name: "S",
        fullName: "p.S",
        methods: [
          {
            name: "M",
            inputType: "p.Req",
            outputType: "p.Res",
            clientStreaming: false,
            serverStreaming: false,
            inputFields: [
              f({ name: "plain", kind: "string" }),
              f({ name: "tags", kind: "string", repeated: true }),
              f({ name: "nickname", kind: "string", optional: true }),
            ],
          },
        ],
      },
    ]);

    expect(out).toContain("  string plain = 1;");
    expect(out).toContain("  repeated string tags = 2;");
    expect(out).toContain("  optional string nickname = 3;");
  });

  it("emits each request message once even when several rpcs share it", () => {
    const out = generateProtoFromServices(greeter);
    expect(out.match(/message Hello \{/g)).toHaveLength(1);
  });

  it("skips messages with no fields", () => {
    const out = generateProtoFromServices([
      {
        name: "S",
        fullName: "p.S",
        methods: [
          {
            name: "Ping",
            inputType: "p.Empty",
            outputType: "p.Empty",
            clientStreaming: false,
            serverStreaming: false,
            inputFields: [],
          },
        ],
      },
    ]);
    expect(out).toContain("rpc Ping (Empty) returns (Empty) {}");
    expect(out).not.toContain("message Empty {");
  });

  it("handles an empty service list", () => {
    expect(generateProtoFromServices([])).toBe('syntax = "proto3";\n');
  });
});
