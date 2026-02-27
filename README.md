# repo-context-mcp

Universal MCP server that analyzes any codebase and provides structured context to AI assistants. **Better than CLAUDE.md** because it's dynamic, accurate, and uses minimal tokens.

## What's New in v1.1.0

- **MCP Prompts**: Inject context without tool calls
- **Auto-preload**: Context loads on connect
- **Ultra format**: ~50 tokens for full context
- **Smart caching**: TTL + file hash validation

## Why Better Than CLAUDE.md?

| Feature | CLAUDE.md | repo-context-mcp |
|---------|-----------|------------------|
| Auto-generated | No (manual) | Yes |
| Always accurate | No (gets stale) | Yes |
| Token usage | ~500-2000 | **~50-300** |
| Detects endpoints | No | Yes |
| Detects models | No | Yes |
| Updates with code | No | Yes (auto-cache) |
| MCP Resources | N/A | Yes (0 extra tokens) |

## Token Efficiency

```
Format        Tokens    Use Case
─────────────────────────────────────────
minimal       ~50       Quick context awareness
ultra         ~150      Conversation start
compact       ~300      Full understanding (default)
normal        ~800      Detailed exploration
```

## Installation

```bash
npm install -g repo-context-mcp
```

## Quick Setup

### OpenCode / Claude Desktop / Cursor / Cline

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

## Usage

### Tools (AI calls these)

```bash
# Start of conversation (default: compact format)
get_project_context

# Ultra-efficient (~150 tokens)
get_project_context { "format": "ultra" }

# Minimal for quick awareness (~50 tokens)
get_project_context { "format": "minimal" }

# Specific info only
get_project_stack
get_project_structure
get_project_endpoints
get_project_models
get_project_status

# After major changes
refresh_project_context
```

### Resources (Zero Token Cost!)

MCP Resources are automatically available to AI - no tool call needed:

| Resource | Description |
|----------|-------------|
| `repo://context/summary` | ~50 token summary |
| `repo://context/full` | Complete compact context |
| `repo://context/stack` | Languages & frameworks |
| `repo://context/structure` | Folders & entry points |
| `repo://context/api` | API endpoints |
| `repo://context/models` | Data models |
| `repo://context.json` | Full JSON (programmatic) |

## Output Formats

### Minimal (~50 tokens)
```
my-app:typescript+nextjs [src/app/components/lib] entry:src/index.ts
```

### Ultra (~150 tokens)
```
my-app|typescript|nextjs
[src:45 app:20 components:15 lib:8]
→src/index.ts,src/app/page.tsx
API(12):G:/api/users P:/api/auth
M(5):User,Post,Comment
[docs|test:25|docker|ci:github]
```

### Compact (~300 tokens) - Default
```
# my-app (typescript)
A modern web application

Stack: typescript, Next.js, React, pnpm
Deps: next, react, prisma, zod

Structure:
  src/ (45) - Source code
  app/ (20) - Next.js app router
  components/ (15) - UI components
Entry: src/index.ts, src/app/page.tsx

API (12):
  GET /api/users → src/app/api/users/route.ts:5
  POST /api/auth → src/app/api/auth/route.ts:10

Models (5):
  User (model): id, email, name...
  Post (model): id, title, content...

Status: tests:25 | docker | ci:github | todos:3
```

## Smart Caching

- **In-memory**: 30s TTL for repeated calls
- **Disk cache**: 1h TTL with file hash validation
- **Auto-invalidate**: When config files change (package.json, etc.)

The cache file `.repo-context.json` is stored in your project root. Add to `.gitignore`.

## Supported Languages

| Language | Deps | Endpoints | Models |
|----------|------|-----------|--------|
| TypeScript/JS | package.json | Express, Fastify, Hono, NestJS, Next.js | Interfaces, Types, Classes |
| Python | requirements.txt, pyproject.toml | FastAPI, Flask, Django | Pydantic, Dataclasses |
| Rust | Cargo.toml | Actix, Axum, Rocket | Structs, Enums |
| Go | go.mod | Gin, Echo, Fiber | Structs |
| Java/Kotlin | pom.xml, build.gradle | Spring | Classes, Records |
| PHP | composer.json | Laravel, Symfony | Classes |
| Ruby | Gemfile | Rails, Sinatra | ActiveRecord |
| C#/.NET | .csproj | ASP.NET | Classes, Records |
| Swift | Package.swift | Vapor | Structs, Classes |
| Dart | pubspec.yaml | - | Classes |

## Analysis Includes

- **Tech Stack**: Languages, frameworks, dependencies, package manager
- **Structure**: Folders with descriptions, entry points, config files
- **API Endpoints**: REST routes, GraphQL operations
- **Data Models**: Interfaces, types, schemas, database models
- **Architecture**: MVC, Clean Architecture, Serverless, etc.
- **Status**: TODOs, tests, CI/CD, Docker

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REPO_CONTEXT_ROOT` | Project root override | `process.cwd()` |

## Contributing

```bash
git clone https://github.com/anomalyco/repo-context-mcp
cd repo-context-mcp
npm install
npm run build
```

### Adding Language Support

1. `src/detectors/language.ts` - Language detection
2. `src/detectors/endpoints.ts` - Endpoint patterns
3. `src/detectors/models.ts` - Model patterns

## License

MIT

---

**Use less tokens. Know more. Ship faster.**
