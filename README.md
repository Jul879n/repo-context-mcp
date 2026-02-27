# repo-context-mcp

Universal MCP server that analyzes any codebase and provides structured context to AI assistants. **Better than CLAUDE.md** because it's dynamic, accurate, and uses minimal tokens.

## What's New in v1.4.0

- **🧙 Interactive Setup Wizard**: `repo-context-setup` auto-configures your IDEs/AIs
- **9 IDEs supported**: Claude Desktop, Cursor, Windsurf, VS Code, Cline, Zed, OpenCode, Codex, Antigravity
- **Auto-detection**: Wizard detects which tools you have installed
- **Safe merge**: Never overwrites existing MCP servers in your config
- **Update anytime**: Run the wizard again to add/remove configurations

## What's New in v1.3.0

- **📝 Zero-Token Auto-Docs**: Auto-generates `.repo-context/` with 5 markdown files on startup
- **👁️ File Watcher**: Detects code changes and regenerates docs automatically (5s debounce)
- **0 MCP tokens per session**: AI reads `.repo-context/*.md` naturally — no tool calls needed
- **🔥 Hot Files Detection**: Auto-detects oversized files, high imports, TODO-dense code
- **🔗 Import Graph**: Internal dependency map with hub files, orphans, and **mermaid diagrams**
- **📋 Annotations**: Manage business rules, gotchas, and warnings via MCP tools (CRUD)
- **14 Tools + 10 Resources**: Up from 7+7 in v1.1.0

## Quick Setup

### Automatic (recommended)

```bash
npm install -g repo-context-mcp

# Run the interactive setup wizard
repo-context-setup
```

The wizard will:

1. Detect installed AI tools (Claude Desktop, Cursor, Windsurf, VS Code, Cline, Zed, OpenCode, Codex, Antigravity)
2. Let you select which ones to configure
3. Safely merge `repo-context` into their config files (backup created)
4. Show a summary of changes

```bash
# Alternative: use the --setup flag
repo-context-mcp --setup

# Check current config status (non-interactive)
repo-context-setup --status
```

### Manual Setup

Add to your IDE's MCP config file:

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

# Ultra-efficient (~165 tokens)
get_project_context { "format": "ultra" }

# Minimal for quick awareness (~50 tokens)
get_project_context { "format": "minimal" }

# Specific info only
get_project_stack
get_project_structure
get_project_endpoints
get_project_models
get_project_status

# v1.3.0 — New intelligence tools
get_project_hotfiles                              # Complex/oversized files
get_project_imports                               # Dependency graph (text)
get_project_imports { "format": "mermaid" }       # Dependency graph (visual)
get_project_annotations                           # Business rules & gotchas
generate_project_docs                             # Force regenerate .repo-context/

# v1.2.0 — Annotation management
add_annotation { "category": "businessRules", "text": "..." }
add_annotation { "category": "gotchas", "text": "..." }
add_annotation { "category": "warnings", "text": "..." }
remove_annotation { "category": "gotchas", "index": 0 }
list_annotations

# After major changes
refresh_project_context
```

### Resources (Zero Token Cost!)

MCP Resources are automatically available to AI - no tool call needed:

| Resource                     | Description               |
| ---------------------------- | ------------------------- |
| `repo://context/summary`     | ~50 token summary         |
| `repo://context/full`        | Complete compact context  |
| `repo://context/stack`       | Languages & frameworks    |
| `repo://context/structure`   | Folders & entry points    |
| `repo://context/api`         | API endpoints             |
| `repo://context/models`      | Data models               |
| `repo://context/hotfiles`    | Complex/oversized files   |
| `repo://context/annotations` | Business rules & gotchas  |
| `repo://context/imports`     | Internal dependency graph |
| `repo://context.json`        | Full JSON (programmatic)  |

## Output Formats

### Minimal (~50 tokens)

```
my-app:typescript+nextjs [src/app/components/lib] entry:src/index.ts
```

### Ultra (~165 tokens)

```
my-app|typescript|nextjs
[src:45(⚠page.tsx:1200L) app:20 components:15 lib:8]
→src/index.ts,src/app/page.tsx
API(12):G:/api/users P:/api/auth
M(5):User,Post,Comment
⚠3hot|hub:store/index.ts(←12)|rules:2|gotchas:1
[docs|test:25|docker|ci:github]
```

### Compact (~350 tokens) - Default

```
# my-app (typescript)
A modern web application

Stack: typescript, Next.js, React, pnpm
Deps: next, react, prisma, zod

Structure:
  src/ (45) - Source code ⚠page.tsx:1200L
  app/ (20) - Next.js app router
  components/ (15) - UI components
Entry: src/index.ts, src/app/page.tsx

API (12):
  GET /api/users → src/app/api/users/route.ts:5
  POST /api/auth → src/app/api/auth/route.ts:10

Models (5):
  User (model): id, email, name...
  Post (model): id, title, content...

⚠ Hot Files (3):
  src/app/page.tsx (1200L) - oversized
  src/store/index.ts (800L) - oversized,high-imports

Import hubs: store/index.ts(←12), utils/api.ts(←9)
Orphans: legacy/parser.ts, utils/deprecated.ts

📋 Business Rules:
  - Schedules: ≥1min separation
⚠ Gotchas:
  - page.tsx: 1200+ lines, read by sections

Status: tests:25 | docker | ci:github | todos:3
```

## Zero-Token Auto-Docs (v1.3.0)

On startup, the MCP generates a `.repo-context/` directory with rich markdown docs:

```
your-project/
├── .repo-context/
│   ├── ARCHITECTURE.md     ← Stack, frameworks, deps, patterns
│   ├── COMPONENTS.md       ← Folders, entry points, hot files, endpoints
│   ├── MODELS.md           ← All data models with fields
│   ├── IMPORTS.md          ← Hub files, orphans, mermaid diagram
│   └── STATUS.md           ← TODOs, CI/CD, Docker, annotations
```

The AI reads these files naturally — **0 MCP token cost**. A file watcher keeps them updated automatically when you change code (5s debounce).

## Hot Files Detection (v1.2.0)

Automatically identifies problematic files based on:

| Criterion     | Threshold | Why it matters                    |
| ------------- | --------- | --------------------------------- |
| Lines of code | > 300     | File too large to navigate easily |
| Import count  | > 15      | High coupling                     |
| Export count  | > 20      | Too many responsibilities         |
| TODO density  | > 3       | Concentrated tech debt            |

## Import Graph (v1.2.0)

Analyzes internal `import`/`require` statements to build a dependency map:

- **Hub files**: Most-imported files (core of the system)
- **Orphan files**: Files nobody imports (possible dead code)
- **Mermaid output**: Visual diagram with `get_project_imports { "format": "mermaid" }`

## Annotations (v1.2.0)

Manage project knowledge via MCP tools — no manual file editing needed:

```bash
# Add a business rule
add_annotation { "category": "businessRules", "text": "Orders require payment before shipping" }

# Add a gotcha
add_annotation { "category": "gotchas", "text": "UserService.ts has 2000+ lines, read by sections" }

# List all with indices
list_annotations

# Remove by index
remove_annotation { "category": "gotchas", "index": 0 }
```

Annotations are persisted in `.repo-context-notes.json` and included in all context formats.

## Smart Caching

- **In-memory**: 30s TTL for repeated calls
- **Disk cache**: 1h TTL with file hash validation
- **Auto-invalidate**: When config files change (package.json, etc.)

The cache file `.repo-context.json` is stored in your project root. Add to `.gitignore`.

## Supported Languages

| Language      | Deps                             | Endpoints                               | Models                     |
| ------------- | -------------------------------- | --------------------------------------- | -------------------------- |
| TypeScript/JS | package.json                     | Express, Fastify, Hono, NestJS, Next.js | Interfaces, Types, Classes |
| Python        | requirements.txt, pyproject.toml | FastAPI, Flask, Django                  | Pydantic, Dataclasses      |
| Rust          | Cargo.toml                       | Actix, Axum, Rocket                     | Structs, Enums             |
| Go            | go.mod                           | Gin, Echo, Fiber                        | Structs                    |
| Java/Kotlin   | pom.xml, build.gradle            | Spring                                  | Classes, Records           |
| PHP           | composer.json                    | Laravel, Symfony                        | Classes                    |
| Ruby          | Gemfile                          | Rails, Sinatra                          | ActiveRecord               |
| C#/.NET       | .csproj                          | ASP.NET                                 | Classes, Records           |
| Swift         | Package.swift                    | Vapor                                   | Structs, Classes           |
| Dart          | pubspec.yaml                     | -                                       | Classes                    |

## Analysis Includes

- **Tech Stack**: Languages, frameworks, dependencies, package manager
- **Structure**: Folders with descriptions, entry points, config files, largest file per folder
- **API Endpoints**: REST routes, GraphQL operations
- **Data Models**: Interfaces, types, schemas, database models
- **Architecture**: MVC, Clean Architecture, Serverless, etc.
- **Status**: TODOs, tests, CI/CD, Docker
- **Hot Files**: Oversized, high-import, TODO-dense files
- **Import Graph**: Hub files, orphan files, dependency map
- **Annotations**: Business rules, gotchas, warnings (managed via MCP)

## Environment Variables

| Variable            | Description           | Default         |
| ------------------- | --------------------- | --------------- |
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

### Adding Detectors

4. `src/detectors/hotfiles.ts` - Hot file thresholds
5. `src/detectors/imports.ts` - Import graph patterns
6. `src/detectors/annotations.ts` - Annotation manager

## License

MIT

---

**Use less tokens. Know more. Ship faster.**
