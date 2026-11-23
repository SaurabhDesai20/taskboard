/** "Asha Rao" -> "AR", "Chen" -> "C": first letters of the first and last words, uppercased. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return letters.map((part) => [...part][0]?.toUpperCase() ?? '').join('')
}
