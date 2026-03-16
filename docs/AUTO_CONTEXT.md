# Auto-Context Configuration

This document explains how to configure your AI tool to automatically use reposynapse.

## OpenCode

Add to your `opencode.json`:

```json
{
  "mcp": {
    "reposynapse": {
      "command": ["npx", "reposynapse"],
      "enabled": true
    }
  }
}
```

The tool description tells the AI to use `get_project_context` at the start of conversations.

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "reposynapse": {
      "command": "npx",
      "args": ["reposynapse"]
    }
  }
}
```

Then in Claude Desktop settings, add this to your custom instructions:

```
At the start of each conversation about code, call get_project_context to understand the project structure.
```

## Cursor

In Settings → MCP Servers:

```json
{
  "reposynapse": {
    "command": "npx",
    "args": ["reposynapse"]
  }
}
```

In Settings → Rules for AI, add:

```
Always use get_project_context at the start of coding conversations.
```

## Cline (VS Code)

In Cline settings, MCP section:

```json
{
  "reposynapse": {
    "command": "npx",
    "args": ["reposynapse"]
  }
}
```

In Custom Instructions:

```
Use get_project_context to understand any project before making changes.
```

## How It Works

1. **On MCP Connect**: The server pre-loads and caches the project context
2. **AI Sees Tool**: The tool description says "IMPORTANT: Call this tool FIRST"
3. **AI Calls Tool**: Gets ~50-150 tokens of context (vs ~500+ for CLAUDE.md)
4. **Cache Hit**: Subsequent calls are instant (in-memory cache)

## Token Usage

| Method | Tokens per conversation |
|--------|------------------------|
| CLAUDE.md in every message | ~500 × N messages |
| reposynapse (once) | ~50-150 × 1 |

## Verify It's Working

When the MCP connects, you'll see in stderr:

```
[reposynapse] Project loaded: your-project-name
[reposynapse] your-project:typescript+express [src/lib/tests] entry:src/index.ts
```
