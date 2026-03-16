# Changelog

## v1.7.0

- `search_symbol` — global symbol search across all project files. Fuzzy matching, filter by type or exported-only.
- `exclude_pattern` in `search_in_project` — exclude files by glob (e.g. `"*.md"`, `"docs/**"`). Comma-separated for multiple patterns.
- **Diff-aware hot files** — `get_project_context` now detects `git diff` modified files and surfaces them as hot files with reason `modified`.

## v1.6.7

- `read_file_symbol` supports `const` variables with type `[const]`.
- Relative paths in search summary when multiple files share the same name.
- Fix `findConstEnd` to track `{`, `[` and `(`.

## v1.6.6

- `max_files=-1` grep replacement with `file_pattern`.
- Code files sorted before docs within same match-count tier.
- Merged overlapping context ranges (25-35% token savings).

## v1.6.5

- Compact search by default — single summary line.
- `max_files` parameter for code detail control.
- `context_lines` defaults to 0.

## v1.6.3

- Complete search coverage — no file silently skipped.

## v1.6.2

- Fix VS Code MCP configuration (`mcp.json` with `"type": "stdio"`).

## v1.6.1

- Multi-language diagnostics: `cargo check`, `go vet`, `mypy`/`ruff`, `dotnet build`, `mvn compile`, `rubocop`, `swift build`, `php -l`, `tsc`.

## v1.6.0

- Smart diagnostics (`get_diagnostics`) — strips noise, returns only fatal errors.

## v1.5.3

- In-memory file cache (10s TTL).
- Outline cache.
- Parallel search with thread-safe regex.

## v1.5.2

- `search_in_project`, `list_files`, `read_file` tools.
- 21 to 10 tools exposed (~900 fewer tokens).
- Fuzzy matching in `read_file_symbol`.
- `search_in_file` with 50-match limit, compact output.
- Unified `annotate` tool.
- `section` param in `get_project_context`.

## v1.5.0

- Smart File Reader (4 tools).
- Auto-generated OUTLINES.md.

## v1.4.0

- Interactive setup wizard (`reposynapse-setup`).
- 9 IDEs supported.

## v1.3.0

- Zero-token auto-docs (`.reposynapse/`).
- File watcher.
- Hot files detection, import graph, annotations.
