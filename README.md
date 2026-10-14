# LeadMagic for ChatGPT

The public LeadMagic package for ChatGPT and Codex. It contains directory metadata, the hosted MCP connection at `https://mcp.leadmagic.io/mcp`, declared listing images, and the LeadMagic Tables skill. Authentication is configured in the OpenAI submission portal.

LeadMagic supports B2B account research, contact enrichment, table inspection and scoped cleanup, and connected CRM inspection. Available tools depend on the connected workspace's permissions. Paid table runs require a scope and credit quote followed by human approval. Outbound CRM and sequencer delivery is handled in the LeadMagic app.

## Build

Requires Node.js 24.18+ and `zip`. Authored tooling uses TypeScript with Node's native type stripping; validation also runs the strict TypeScript compiler and package boundary tests.

```sh
npm ci
npm run validate
npm run package -- --out=/tmp/leadmagic-openai-plugin.zip
```

Support: [LeadMagic Support](https://leadmagic.io/docs/support) · [Privacy](https://leadmagic.io/legal/privacy) · [Terms](https://leadmagic.io/legal/terms)

The validator checks the stable plugin identity, listing limits, review tool names, and one hosted HTTPS MCP without embedded credentials, headers, or an authentication override. It rejects app references, lifecycle hooks, unsafe paths, symlinked package files, and obsolete paid-run instructions. This package uses noninterlaced PNG images, decoded with pinned `pngjs` after checking file size and dimensions. Declared screenshots must be distinct PNG assets, one per starter prompt, each 706 pixels wide and 400–860 pixels tall, at most 5 MiB.

The upload ZIP contains only the plugin manifest, MCP connection metadata, declared images, and the Tables skill. Packaging creates a fresh archive, so previous ZIP contents cannot survive. Registry metadata, build tools, repository files, and undeclared assets are excluded. Write the ZIP outside this repository. Keep reviewer credentials and sign-in instructions in the secure OpenAI review form; OpenAI rejects them in ZIP metadata.

To check review tool names against a saved MCP `tools/list` response or catalog:

```sh
npm run validate -- --tools=/absolute/path/tools-list.json
```

A local catalog verifies tool names only. It is not a fresh authenticated production scan.

## Submit an update

Use the existing LeadMagic entry in the OpenAI submission portal and the **With MCP** flow. Preserve the package identity and existing authentication configuration, verify domain ownership, and scan the production endpoint. Screenshots require custom UI reported by that scan.

Run all five positive and three negative review cases using the review account and provide an accessible demo recording that demonstrates the current package. Local validation does not verify live tool behavior or complete directory review.

Package rules: [OpenAI submission guide](https://developers.openai.com/plugins/deploy/submission) · [Submission errors](https://developers.openai.com/plugins/deploy/submission-errors) · [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines).

## Official MCP Registry

`server.json` publishes LeadMagic's hosted MCP endpoint to the [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.leadmagic%2Fserver). It uses the `io.leadmagic` domain namespace and a Streamable HTTP connection; clients authenticate through the service's OAuth flow. This repository contains public connection and listing metadata only, not the hosted server implementation.

Validate the listing before publishing with `mcp-publisher validate server.json`.
