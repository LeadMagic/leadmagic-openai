# LeadMagic for ChatGPT

The LeadMagic plugin package for ChatGPT. It contains listing metadata, the MCP connection (`https://mcp.leadmagic.io/mcp`, OAuth), icons, and the bundled LeadMagic Tables skill. No server code or credentials.

## Build

Requires Node.js 24 and `zip`.

```sh
node scripts/package-openai-plugin.mjs
node scripts/package-openai-plugin.mjs --out=/tmp/leadmagic-openai-plugin.zip
```

Support: https://leadmagic.io/docs/support · Privacy: https://leadmagic.io/legal/privacy · Terms: https://leadmagic.io/legal/terms
