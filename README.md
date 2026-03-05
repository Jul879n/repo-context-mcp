# repo-context-mcp

Universal MCP server that analyzes any codebase and provides structured context to AI assistants. Dynamic, accurate, and token-efficient.

## What's New in v1.7.0

- **`search_symbol`** — global symbol search across all project files. Fuzzy matching, filter by type or exported-only.
- **`exclude_pattern`** in `search_in_project` — exclude files by glob (e.g. `"*.md"`, `"docs/**"`). Comma-separated for multiple patterns.
- **Diff-aware hot files** — `get_project_context` detects `git diff` modified files and surfaces them with reason `modified`.

See [CHANGELOG.md](./CHANGELOG.md) for previous versions.

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

**Claude Desktop / Cursor / Windsurf** (`claude_desktop_config.json` / `~/.cursor/mcp.json`):

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

**VS Code** (`~/Library/Application Support/Code/User/mcp.json` on macOS, `%APPDATA%\Code\User\mcp.json` on Windows):

```json
{
	"servers": {
		"repo-context": {
			"type": "stdio",
			"command": "npx",
			"args": ["repo-context-mcp"]
		}
	}
}
```

## Usage

### Tools (12 exposed — optimized for minimal token overhead)

```bash
# ─── Project Context ───
get_project_context                                # Full context (default: compact)
get_project_context { "format": "ultra" }          # Ultra-efficient (~165 tokens)
get_project_context { "section": "stack" }         # Specific section only
get_project_context { "section": "endpoints" }     # Sections: stack|structure|endpoints|models|status|hotfiles|imports|annotations
get_project_context { "force_refresh": true }      # Force re-analysis

# ─── Smart File Reading (v1.5.2) ───
read_file { "file": "src/server.ts" }              # Smart: full if <200L, outline if >200L
read_file { "file": "src/server.ts", "start_line": 100, "end_line": 150 }  # Range
read_file_outline { "file": "src/server.ts" }      # Outline: symbols + line ranges
read_file_symbol { "file": "src/server.ts", "symbol": "createServer" }     # Fuzzy match

# ─── Search (v1.5.2+) ───
search_in_file { "file": "src/server.ts", "pattern": "TODO" }                       # In-file search
search_in_file { "file": "src/server.ts", "pattern": "TODO", "context_lines": 3 }   # With context

search_in_project { "pattern": "handleRoute" }                                       # 1-line summary: total matches + top 10 hottest files
search_in_project { "pattern": "export", "file_pattern": "*.tsx" }                  # Filter by glob
search_in_project { "pattern": "TODO", "max_files": 5 }                             # Code detail for top 5 files (sorted: code before docs)
search_in_project { "pattern": "TODO", "max_files": 5, "context_lines": 2 }         # Detail with context (overlapping ranges merged automatically)
search_in_project { "pattern": "TODO", "max_files": 5, "max_results": 10 }          # Max 10 matches per file

# grep replacement (v1.6.6) — all files matching glob, grouped + sorted, respects .gitignore
search_in_project { "pattern": "useState", "file_pattern": "*.ts", "max_files": -1 }
search_in_project { "pattern": "invokeLambda", "file_pattern": "*.tsx", "max_files": -1, "context_lines": 2 }

# exclude docs/markdown from results (v1.7.0)
search_in_project { "pattern": "handleRoute", "exclude_pattern": "*.md" }
search_in_project { "pattern": "TODO", "exclude_pattern": "*.md,docs/**", "max_files": 5 }

# ─── Global Symbol Search (v1.7.0) ───
search_symbol { "name": "createServer" }                                      # Find symbol across project (fuzzy)
search_symbol { "name": "User", "type": "interface" }                         # Filter by type
search_symbol { "name": "handle", "exported_only": true }                     # Only exported symbols

# ─── File Listing (v1.5.2) ───
list_files                                          # Project root
list_files { "path": "src", "pattern": "*.ts" }     # Filtered

# ─── Annotations ───
annotate { "action": "list" }
annotate { "action": "add", "category": "businessRules", "text": "..." }
annotate { "action": "remove", "category": "gotchas", "index": 0 }

# ─── Diagnostics (v1.6.1) ───
get_diagnostics                                     # Auto-detects language, runs checker, returns ONLY fatal errors

# ─── Docs ───
generate_project_docs                               # Force regenerate .repo-context/
```

### Resources (Zero Token Cost!)

MCP Resources are automatically available to AI - no tool call needed:

| Resource                     | Description                         |
| ---------------------------- | ----------------------------------- |
| `repo://context/summary`     | ~50 token summary                   |
| `repo://context/full`        | Complete compact context            |
| `repo://context/stack`       | Languages & frameworks              |
| `repo://context/structure`   | Folders & entry points              |
| `repo://context/api`         | API endpoints                       |
| `repo://context/models`      | Data models                         |
| `repo://context/hotfiles`    | Complex/oversized files             |
| `repo://context/annotations` | Business rules & gotchas            |
| `repo://context/imports`     | Internal dependency graph           |
| `repo://context/outlines`    | All file outlines (symbols + lines) |
| `repo://context.json`        | Full JSON (programmatic)            |

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
│   ├── OUTLINES.md         ← All symbols with line ranges (v1.5.0)
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
