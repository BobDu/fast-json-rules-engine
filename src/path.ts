import { CompileError } from './errors'

/**
 * Minimal, dependency-free path resolver covering the common JSONPath subset:
 * dot access, bracketed quoted keys, and numeric indices — `$.a.b`,
 * `$.a[0].b`, `$["a"]['b']`, and the same without a leading `$`.
 *
 * Anything with JSONPath meta-syntax (wildcards `*`, recursive descent `..`,
 * filters `[?...]`, script `[(...)]`, unions `,`, slices `[a:b]`, `@`) is
 * rejected at compile time rather than silently mis-resolved — inject a full
 * resolver via `pathResolver` if you need those.
 *
 * Semantics match json-rules-engine's default (jsonpath-plus with wrap:false)
 * for this subset: a missing segment yields `undefined`.
 */

const META = /[*?@,]|\.\.|\[\?|\[\(|:/

interface Segment {
  key: string | number
}

/** Parse a path string into a fixed list of accessors. Throws on meta-syntax. */
export function parsePath(path: string): Segment[] {
  if (META.test(path)) {
    throw new CompileError(
      `Unsupported JSONPath "${path}": only simple dot/bracket paths are ` +
        `supported by the default resolver. Pass a custom "pathResolver" for full JSONPath.`,
    )
  }

  const segments: Segment[] = []
  // Strip an optional leading `$`.
  let i = path[0] === '$' ? 1 : 0
  const n = path.length

  while (i < n) {
    const ch = path[i]
    if (ch === '.') {
      i++
      continue
    }
    if (ch === '[') {
      const end = path.indexOf(']', i)
      if (end === -1) throw new CompileError(`Malformed path "${path}": missing "]"`)
      let token = path.slice(i + 1, end).trim()
      if (
        (token[0] === '"' && token[token.length - 1] === '"') ||
        (token[0] === "'" && token[token.length - 1] === "'")
      ) {
        segments.push({ key: token.slice(1, -1) })
      } else if (/^\d+$/.test(token)) {
        segments.push({ key: Number(token) })
      } else if (token.length > 0) {
        // Bare bracket token treated as a property name.
        segments.push({ key: token })
      }
      i = end + 1
      continue
    }
    // Dot-style identifier segment: read until the next `.` or `[`.
    let j = i
    while (j < n && path[j] !== '.' && path[j] !== '[') j++
    const token = path.slice(i, j)
    if (token.length > 0) segments.push({ key: token })
    i = j
  }

  return segments
}

/** Build a resolver closure for a fixed, pre-parsed path. */
export function compilePath(path: string): (value: unknown) => unknown {
  const segments = parsePath(path)
  if (segments.length === 0) return (value) => value
  return (value: unknown) => {
    let current: any = value
    for (let k = 0; k < segments.length; k++) {
      if (current == null) return undefined
      current = current[segments[k].key]
    }
    return current
  }
}

/** Runtime path resolver (default for `pathResolver` option). */
export function defaultPathResolver(value: unknown, path: string): unknown {
  return compilePath(path)(value)
}
