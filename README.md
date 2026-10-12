# LeadMagic for ChatGPT

This repository contains the public OpenAI Plugin Directory package for LeadMagic. It contains only portable listing metadata, MCP connection configuration, icons, user-facing workflow guidance, and packaging tooling. The MCP service itself is hosted at `https://mcp.leadmagic.io/mcp` and authenticates through OAuth Dynamic Client Registration.

LeadMagic helps GTM teams research company accounts, enrich contacts, inspect connected CRM integrations, and work with structured tables. Table cleanup guidance preserves original values and verifies requested cell changes. Credit-bearing runs, imports, and outbound writes follow the hosted service's confirmation behavior.

## Build the submission ZIP

Use Node.js 24 (the current runtime pin) and the system `zip` utility. Validate the package and create the upload file outside this checkout:

```sh
node scripts/package-openai-plugin.mjs
node scripts/package-openai-plugin.mjs --out=/tmp/leadmagic-openai-plugin-1.0.1.zip
unzip -t /tmp/leadmagic-openai-plugin-1.0.1.zip
```

The ZIP contains `plugin.json`, `mcp.json`, both referenced icon assets, and the bundled LeadMagic Tables skill. It contains no server implementation or credentials. Upload it as an update to the existing LeadMagic listing; keep its assigned plugin identity and verify the live tool scan and private review details in the OpenAI dashboard before submission.

See [OPENAI_SUBMISSION.md](OPENAI_SUBMISSION.md) for package and portal checks.
