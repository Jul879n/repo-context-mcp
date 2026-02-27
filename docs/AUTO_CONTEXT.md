# Auto-Context Configuration

This document explains how to configure your AI tool to automatically use repo-context-mcp.

## OpenCode

Add to your `opencode.json`:

```json
{
  "mcp": {
    "repo-context": {
      "command": ["npx", "repo-context-mcp"],
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
    "repo-context": {
      "command": "npx",
      "args": ["repo-context-mcp"]
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
  "repo-context": {
    "command": "npx",
    "args": ["repo-context-mcp"]
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
  "repo-context": {
    "command": "npx",
    "args": ["repo-context-mcp"]
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
| repo-context (once) | ~50-150 × 1 |

## Verify It's Working

When the MCP connects, you'll see in stderr:

```
[repo-context] Project loaded: your-project-name
[repo-context] your-project:typescript+express [src/lib/tests] entry:src/index.ts
```
