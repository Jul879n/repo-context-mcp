# reposynapse — Benchmark real en proyecto React Native / Expo

**Proyecto**: Aplicacion de logistica last-mile (React Native + Expo + Tamagui + AWS Lambda)
**Fecha**: 2026-03-05
**Version benchmarkeada**: v1.7.3 → v1.8.0
**Baseline**: `Read` completo de un hook central (701L, 24,820 bytes) = **6,205 tokens**

---

## Tabla de referencia — tokens reales medidos

| Tarea | Herramienta | Tokens medidos | vs baseline |
|---|---|---|---|
| Orientación inicial del proyecto | `get_project_context ultra` | **97t** | 98% ahorro |
| Archivos git-modificados | `get_project_context section="modified"` | **~15t** | 99% ahorro |
| Context completo con modelos | `get_project_context compact` | **308t** | 95% ahorro |
| Hot files con tamaños | `get_project_context section="hotfiles"` | **189t** | 97% ahorro |
| Tamaños de archivos en carpeta | `list_files` | **36t** | 99% ahorro |
| Errores de compilacion | `get_diagnostics` | **35t** | 99% ahorro |
| Buscar simbolo por nombre | `search_symbol "nombre"` | **~25t** | 99% ahorro |
| Buscar simbolo multi-nombre (v1.8.0) | `search_symbol "a,b"` | **~25t/busqueda** | 99% ahorro |
| Existe este patron? (resumen) | `search_in_project max_files=0` | **65t** | 99% ahorro |
| Buscar patron en tipo de archivo | `Grep files_with_matches + glob` | **79t** | 99% ahorro |
| Ver codigo del patron (top 3 archivos) | `search_in_project max_files=3` | **~600t** | 90% ahorro |
| Buscar dentro de un archivo | `search_in_file ctx+-2` | **158t** | 97% ahorro |
| Outline top-level archivo complejo (v1.8.0) | `read_file_outline depth=1` | **~10-80t** | 99%+ ahorro |
| Outline completo archivo simple | `read_file_outline` 131L/6sym | **55t** | 99% ahorro |
| Outline completo archivo mediano | `read_file_outline` 701L/15sym | **148t** | 98% ahorro |
| Outline completo archivo grande | `read_file_outline` 1722L/52sym | **~350t** | 94% ahorro |
| Outline completo archivo muy grande | `read_file_outline` 3405L/91sym | **~900t** | 85% ahorro |
| Outline completo archivo monstruo | `read_file_outline` 5159L/338sym | **~3,000-5,000t** | EVITAR |
| Leer funcion especifica por nombre | `read_file_symbol` | **~350-1,159t** | 81-94% ahorro |
| Leer rango de lineas | `read_file start/end_line` | **~212t** | 97% ahorro |
| Leer archivo completo para editar | `Read` nativo | **6,205t** | baseline |

---

## Hallazgos por version

### v1.8.0 (2026-03-05)

#### 1. `section="modified"` — seccion dedicada para git-modified

```ts
get_project_context({ section: "modified" })
// -> "1 modified files:\nhooks/useVehicleSchedules.ts (1367L)"
// Tokens: ~15t
```

- **Bug 0L corregido**: v1.7.3 mostraba `0L` para archivos solo-modified. v1.8.0 muestra lineas reales.
- No requiere `force_refresh` — deteccion inmediata.

#### 2. `read_file_outline depth=1` — top-level only

```ts
read_file_outline({ file: "[direction].tsx", depth: 1 })
// -> "5159 lines, 1 symbols (top-level only)\nfunction:Direction L87-5158"
// Tokens: ~10t vs ~3,000-5,000t sin depth = 99.8% ahorro
```

- Filtra a simbolos de **primer nivel** unicamente (sin nested consts/functions).
- Critico para archivos con >200 simbolos donde el outline completo es inusable.
- Primera llamada puede ser stale (cache): si no muestra `(top-level only)`, reintentar.

**Comparacion por complejidad:**

| Archivo | Simbolos sin depth | Con `depth=1` | Ahorro |
|---|---|---|---|
| `Button.tsx` 320L | 4 (~55t) | 3 (~45t) | ~18% |
| `[vehicle].tsx` 1722L | 52 (~350t) | ~5-8 (~80t) | ~77% |
| `[direction].tsx` 5159L | 338 (~3,000t+) | 1 (~10t) | **99.8%** |

#### 3. `search_symbol` multi-nombre

```ts
search_symbol({ name: "handleDelete,handleEdit" })
// -> Devuelve 2 busquedas separadas por "---"
// Cada una con indicadores de calidad de match
```

- Una sola tool call para multiples simbolos relacionados.
- Indicadores de calidad del match:
  - (sin tag) = match exacto
  - `~ci` = case-insensitive
  - `~sub` = substring match
  - `~fuzzy` = match difuso
  - Header `(fuzzy -- no exact match found)` cuando no hay exacto.

#### 4. `max_files=-1` limite seguro

```ts
search_in_project({ pattern: "useState", file_pattern: "*.tsx", max_files: -1 })
// -> Summary de 89 archivos en ~34t (no explota en tokens)
// Antes: potencial de ~50,000t+ sin limite
```

- Default `max_results=5 per file` (antes era 30).
- Sin `context_lines`: cae automaticamente a modo summary.
- Para ver codigo: agregar `context_lines=1`.

---

### v1.7.3

#### `search_symbol` — busqueda global de simbolos

```ts
search_symbol({ name: "openWazeWithAddress" })
// -> "app/[direction].tsx:1022 [function] openWazeWithAddress (L1022-1055)"
// Tokens: ~25t vs Grep ~79t = 68% ahorro
```

#### `exclude_pattern` en `search_in_project`

```ts
search_in_project({ pattern: "handleRoute", exclude_pattern: "*.md,docs/**" })
// Redujo 288->214 matches en este proyecto
```

---

## Escenarios de uso — flujos optimos

### Explorar un archivo grande desconocido

```
1. list_files "hooks/"              -> ~36t  (ver tamanos)
2. read_file_outline depth=1        -> ~10t  (estructura top-level)
3. search_symbol "funcionBuscada"   -> ~25t  (ubicar funcion exacta)
4. Read nativo offset+limit         -> exacto (solo las lineas necesarias)
Total: ~71t vs ~6,205t directo = 98.9% ahorro
```

### Encontrar donde se usa un patron

```
1. search_in_project max_files=0        -> 65t   (existe? cuantos archivos?)
2. search_in_project max_files=3 ctx=2  -> ~600t (ver codigo en top 3 archivos)
Total: ~665t vs leer todos los archivos
```

### Orientacion inicial en proyecto nuevo

```
1. get_project_context ultra  -> 97t   (stack, estructura, entry points)
2. list_files                 -> 36t   (tamanos de carpetas clave)
Total: ~133t — contexto completo para empezar
```

---

## Comportamientos importantes

### Peligros / gotchas

- **`read_file_outline` sin `depth=1` en archivos con +300 simbolos**: puede superar 3,000 tokens.
- **`search_in_project max_files=-1` sin `file_pattern`**: aunque v1.8.0 lo limita a 5/archivo, con patrones genericos en proyectos grandes sigue siendo caro.
- **`reposynapse://context/outlines` completo**: ~16,000t estimado — nunca usar.
- **`depth=1` primera llamada stale**: si el resultado no muestra `(top-level only)`, reintentar.

### Reglas de oro

- `list_files` antes de leer cualquier archivo — muestra tamanos y evita sorpresas.
- `depth=1` siempre como primer paso en archivos desconocidos grandes.
- `search_symbol` antes de `Grep` para buscar funciones/clases/consts.
- `Read` nativo es irreemplazable para editar — leer con `Read` antes de `Edit`.
- `get_project_context ultra` al inicio de sesion — 97t que orientan toda la conversacion.

---

## Proyecto de referencia

- **Stack**: React Native, Expo Router, Tamagui, AWS Lambda (sin REST API), Redux Toolkit, React Context
- **Tamano**: ~87 componentes, ~41 hooks, 22 rutas de app, backend Lambda-only
- **Archivos mas complejos**:
  - `[direction].tsx` 5,159L / 338 simbolos — gestion de rutas de entrega
  - `[company].tsx` 3,505L / 91 simbolos
  - `[detail].tsx` 2,535L
  - `hooks/useVehicleSchedules.ts` 1,367L
