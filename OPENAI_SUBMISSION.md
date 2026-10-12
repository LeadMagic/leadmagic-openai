# OpenAI Plugin Directory submission

This folder is the standalone public package for the existing LeadMagic listing. It is intentionally limited to portable listing metadata, hosted OAuth MCP configuration, icons, review cases, and user-facing skill guidance. The MCP implementation and private service code remain in the hosted service repository.

## Package identity and endpoint

- Existing Plugin Directory identity: `app-69eb2710b3748191b3eac40b5218144c`
- Prepared package version: `1.0.1`
- MCP endpoint: `https://mcp.leadmagic.io/mcp`
- Authentication: OAuth with Dynamic Client Registration
- Support contact: `support@leadmagic.io`

The package retains the existing identity. Its MCP declaration deliberately omits an authentication override: this approved listing already has OAuth configured, and OpenAI requires updates to reuse that connection. Do not create a new listing. The package omits `review.demo_recording_url` and reviewer access fields so previously saved private dashboard values remain intact; verify those fields after upload.

## Product scope

LeadMagic provides B2B account and contact research, connected CRM integration inventory and operations, and GTM table workflows. Users can inspect tables, clean explicitly requested cells while preserving source columns, and enrich account lists.

## Review cases

`plugin.json` contains exactly five positive and three negative cases. The positive cases cover account research, read-only table audit, cleanup of a dedicated new test table, CRM connection/object inventory, and a cost-only preview. CRM inventory does not import or push records. The cleanup case scopes writes to its new test table and verifies the changed values by reading them back.

## Validate and package

From this directory:

```sh
node scripts/package-openai-plugin.mjs
node scripts/package-openai-plugin.mjs --out=/tmp/leadmagic-openai-plugin-1.0.1.zip
unzip -t /tmp/leadmagic-openai-plugin-1.0.1.zip
```

Before submitting, upload the ZIP to the existing listing and confirm the listing retained the saved reviewer details and recording. Separately deploy the hosted MCP changes, run a fresh Plugin Directory rescan, inspect the actual tools and annotations, and execute the review cases against a dedicated workspace. A valid ZIP does not establish those live-service checks.
