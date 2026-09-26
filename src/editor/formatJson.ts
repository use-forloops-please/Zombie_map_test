/**
 * Formats JSON the way the project's hand-written map files look (and the way Prettier
 * leaves them): anything that fits within `width` columns goes on one line, like
 * `{ "pos": [0, 1.5, 0], "yaw": 90 }`; anything longer is broken one entry per line.
 */
export function formatJson(value: unknown, width = 100): string {
  return format(value, '', 0, width) + '\n'
}

/** `prefix` is the text already on the line before this value (its key, if any). */
function format(value: unknown, indent: string, prefix: number, width: number): string {
  const flat = inline(value)
  if (
    value === null ||
    typeof value !== 'object' ||
    indent.length + prefix + flat.length <= width
  ) {
    return flat
  }
  const inner = indent + '  '
  if (Array.isArray(value)) {
    const items = value.map((v) => inner + format(v, inner, 0, width))
    return `[\n${items.join(',\n')}\n${indent}]`
  }
  const entries = Object.entries(value).map(([k, v]) => {
    const key = `${JSON.stringify(k)}: `
    return inner + key + format(v, inner, key.length, width)
  })
  return `{\n${entries.join(',\n')}\n${indent}}`
}

/** One-line form with Prettier's spacing: `{ "a": [1, 2] }`, `[]`, `{}`. */
function inline(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`
  const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`)
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`
}
