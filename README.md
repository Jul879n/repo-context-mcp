# repo-context-mcp

Universal MCP server that analyzes any codebase and provides structured context to AI assistants, **saving tokens** by eliminating redundant project exploration.

## The Problem

Every time you start a new session with Claude, ChatGPT, or any AI assistant, it has to re-explore your entire project structure linearly. This wastes tokens and time.

## The Solution

`repo-context-mcp` analyzes your project once and provides a comprehensive context that includes:

- **Tech Stack**: Languages, frameworks, dependencies, package manager, runtime
- **Project Structure**: Folders with descriptions, entry points, config files
- **API Endpoints**: REST routes, GraphQL operations (auto-detected)
- **Data Models**: Interfaces, types, schemas, database models
- **Architecture**: Detected patterns (MVC, Clean Architecture, Serverless, etc.)
- **Project Status**: TODOs, test coverage, CI/CD setup, Docker presence

## Supported Languages

| Language | Dependencies | Endpoints | Models |
|----------|--------------|-----------|--------|
| TypeScript/JavaScript | package.json | Express, Fastify, Hono, NestJS | Interfaces, Types, Classes |
| Python | requirements.txt, pyproject.toml | FastAPI, Flask, Django | Pydantic, Dataclasses, SQLAlchemy |
| Rust | Cargo.toml | Actix, Axum, Rocket | Structs, Enums |
| Go | go.mod | Gin, Echo, Fiber | Structs |
| Java/Kotlin | pom.xml, build.gradle | Spring | Classes, Records |
| PHP | composer.json | Laravel, Symfony | Classes |
| Ruby | Gemfile | Rails, Sinatra | ActiveRecord models |
| C#/.NET | .csproj | - | Classes, Records |
| Swift | Package.swift | - | Structs, Classes |
| Dart | pubspec.yaml | - | Classes |

## Installation

```bash
# npm
npm install -g repo-context-mcp

# pnpm
pnpm add -g repo-context-mcp

# yarn
yarn global add repo-context-mcp

# bun
bun add -g repo-context-mcp
```

## Configuration

### OpenCode

Add to your `opencode.json` (project root or `~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "repo-context": {
      "type": "local",
      "command": ["npx", "repo-context-mcp"],
      "enabled": true
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

### Cursor

In Settings → MCP Servers, add:

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

### Cline (VS Code Extension)

In Cline settings, MCP section:

```json
{
  "repo-context": {
    "command": "npx",
    "args": ["repo-context-mcp"]
  }
}
```

### Windsurf

Add to your MCP configuration:

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

### Other AI Tools (Gemini, ChatGPT, etc.)

These don't support MCP natively yet. You can manually generate context:

```bash
cd /your/project
npx repo-context-mcp --analyze > context.md
```

Then paste `context.md` content into your chat.

## Usage

Once configured, the AI assistant can use these tools:

### `get_project_context`

Returns the full project context. Use this at the **start of a conversation** to give the AI complete understanding of your project.

```
Use get_project_context to understand this project
```

### `refresh_project_context`

Invalidates the cache and re-analyzes the project. Use after making significant structural changes.

```
Refresh the project context
```

### Individual Tools

For more targeted queries:

- `get_project_stack` - Only tech stack info
- `get_project_structure` - Only folder structure
- `get_project_endpoints` - Only API endpoints
- `get_project_models` - Only data models
- `get_project_status` - Only TODOs, tests, CI/CD info

## Example Output

```markdown
# my-awesome-app

A modern web application built with TypeScript

Version: 1.0.0

## Tech Stack
- **Primary Language:** typescript
- **Frameworks:** Next.js (14.0.0), React (18.2.0)
- **Package Manager:** pnpm
- **Runtime:** node

### Key Dependencies
- next: ^14.0.0
- react: ^18.2.0
- prisma: ^5.0.0
- zod: ^3.22.0

## Project Structure

### Entry Points
- src/app/page.tsx
- src/app/api/route.ts

### Folders
- **src/** - Source code (45 files)
- **app/** - Next.js app router (20 files)
- **components/** - UI components (15 files)
- **lib/** - Library code (8 files)

## API Endpoints (REST)
- `GET /api/users` → src/app/api/users/route.ts:5
- `POST /api/users` → src/app/api/users/route.ts:15
- `GET /api/posts` → src/app/api/posts/route.ts:5

## Data Models
ORM: Prisma

- **User** (model) → prisma/schema.prisma:10
  Fields: id, email, name, createdAt, updatedAt
- **Post** (model) → prisma/schema.prisma:20
  Fields: id, title, content, authorId

## Architecture
- **Pattern:** serverless
- Serverless/FaaS architecture with event-driven function handlers
- **Layers:** Source code, UI components, Library code

## Project Status
- **Documentation:** Yes
- **Docker:** Yes
- **CI/CD:** Yes (GitHub Actions)
- **Tests:** 25 test files (Vitest)
- **TODOs:** 3 found

### Top TODOs
- 🔴 FIXME: Handle edge case for empty users (src/lib/users.ts:45)
- 🟡 Add pagination to posts endpoint (src/app/api/posts/route.ts:12)
- ⚪ Refactor this function (src/components/Header.tsx:20)
```

## How It Works

1. **Detection Phase**: Scans your project root for config files (package.json, Cargo.toml, go.mod, etc.)
2. **Analysis Phase**: Parses dependencies, scans source files for patterns
3. **Caching**: Stores results in `.repo-context.json` (add to .gitignore)
4. **Serving**: Provides context to AI assistants via MCP protocol

## Caching

Results are cached in `.repo-context.json` at your project root. The cache is automatically invalidated when you:

- Call `refresh_project_context`
- Pass `force_refresh: true` to `get_project_context`

We recommend adding `.repo-context.json` to your `.gitignore`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REPO_CONTEXT_ROOT` | Override the project root directory | `process.cwd()` |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Adding Support for New Languages/Frameworks

1. Add language detection in `src/detectors/language.ts`
2. Add endpoint patterns in `src/detectors/endpoints.ts`
3. Add model patterns in `src/detectors/models.ts`

## License

MIT

## Author

Jul879n

---

**Save tokens. Ship faster.**
