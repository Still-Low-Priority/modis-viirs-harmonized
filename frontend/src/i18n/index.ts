// The interface is English-only. Strings still live in per-feature
// `messages.ts` dictionaries so a second language can be added in one place.

export type Lang = 'en'

export function useLang(): Lang {
  return 'en'
}

/** `const t = useT(messages)` returns the dictionary for the active language. */
export function useT<T extends Record<string, string>>(messages: { en: T }): T {
  return messages.en
}

/** fmt('Showing {n} of {total}', { n: 5, total: 9 }) */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (Object.hasOwn(values, key) ? String(values[key]) : m))
}

/** plural(1, 'detection') -> 'detection'; plural(5, 'detection') -> 'detections' */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}
