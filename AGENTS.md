# LeadMagic OpenAI package

This repository is the public Plugin Directory package only. Keep hosted service implementation, runtime code, customer data, reviewer credentials, and secrets out of this checkout. Package changes must preserve the existing app identity and use the OAuth hosted MCP endpoint in `mcp.json`.

Before preparing a release, run `npm run validate` and `npm run package -- --out=/tmp/leadmagic-openai-plugin.zip`, inspect the ZIP contents, and confirm the five positive and three negative review cases remain accurate. Keep product descriptions aligned with the actually exposed hosted tool catalog. Do not describe arbitrary HTTP request authoring or dispatch in the public listing or skill.
