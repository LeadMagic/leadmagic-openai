# LeadMagic for ChatGPT

The LeadMagic plugin package for ChatGPT. It contains listing metadata, the MCP connection (`https://mcp.leadmagic.io/mcp`, OAuth), icons, and the bundled LeadMagic Tables skill. No server code or credentials.

## Build

Requires Node.js 24.18+ and `zip`. Authored tooling uses TypeScript with Node's native type stripping; validation also runs the strict TypeScript compiler and package boundary tests.

```sh
npm ci
npm run validate
npm run package -- --out=/tmp/leadmagic-openai-plugin.zip
```

Support: https://leadmagic.io/docs/support · Privacy: https://leadmagic.io/legal/privacy · Terms: https://leadmagic.io/legal/terms

The upload ZIP contains only the plugin manifest, MCP connection metadata, two icons, and the Tables skill. Registry metadata, build tools, and repository files are excluded. Keep reviewer credentials and sign-in instructions in the secure OpenAI review form; OpenAI rejects them in ZIP metadata.

## Official MCP Registry

`server.json` publishes LeadMagic's hosted MCP endpoint to the [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.leadmagic%2Fserver). It uses the `io.leadmagic` domain namespace and a Streamable HTTP connection; clients authenticate through the service's OAuth flow. This repository contains public connection and listing metadata only, not the hosted server implementation.

Validate the listing before publishing with `mcp-publisher validate server.json`.
