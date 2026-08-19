# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report privately through
[GitHub Security Advisories](https://github.com/angeldevmobile/Flux-Post/security/advisories/new),
or by email to the address on the maintainer's GitHub profile.

Include what you can: affected version, steps to reproduce, and the impact you
believe it has. A proof of concept helps but is not required.

Expect a first reply within 7 days. If a fix is needed, we will agree on a
disclosure date with you before publishing.

## Supported versions

Only the latest release receives security fixes. Flux updates itself, so the
practical advice is to stay on the current version.

## Where your data lives

**On your device.** Request history and cookies live in a local SQLite database.
Collections are plain YAML files in a folder you choose. Your Claude API key and
any client TLS certificates are stored locally and are explicitly excluded from
cloud sync.

**In your Supabase project.** If you sign in, history metadata, collections,
environments and settings sync to Supabase under row level security, so each
account only reaches its own rows.

**Through the Flux AI proxy, only on the free tier.** When you have no API key of
your own, AI requests are relayed through a small proxy that checks your quota
and forwards the call to Anthropic. The prompt travels with them, and for
features like debug assist that prompt contains part of the response body you
are inspecting. The proxy stores token counts and which feature was used, never
prompt or response content. With your own API key nothing is relayed: requests go
from your machine straight to Anthropic.

## What we ask of you

Flux sends requests wherever you point it and runs the pre and post-request
scripts you write. Treat a collection file from an untrusted source the way you
would treat a script from one: read it before running it.

## Verifying a release

Every release is signed for the built-in updater, so Flux only installs updates
signed with our key. Installers are not yet signed with a code signing
certificate, which means Windows SmartScreen and macOS Gatekeeper will warn on
first run. Download only from the
[releases page](https://github.com/angeldevmobile/Flux-Post/releases).
