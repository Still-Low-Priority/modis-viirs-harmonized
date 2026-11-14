import { describe, expect, it } from 'vitest'
import { fmt, plural, useLang, useT } from './index'

describe('fmt', () => {
  it('replaces placeholders with strings and numbers', () => {
    expect(fmt('Showing {n} of {total}', { n: 5, total: 9 })).toBe('Showing 5 of 9')
  })
  it('replaces every occurrence of a repeated placeholder', () => {
    expect(fmt('{a}-{a}-{b}-{a}', { a: 'x', b: 1 })).toBe('x-x-1-x')
  })
  it('keeps the placeholder when the key is missing', () => {
    expect(fmt('Hello {name}, {n}', { n: 2 })).toBe('Hello {name}, 2')
  })
  it('keeps text without placeholders unchanged', () => {
    expect(fmt('plain', { a: 1 })).toBe('plain')
    expect(fmt('', {})).toBe('')
  })
  it('renders 0 and the empty string rather than treating them as missing', () => {
    expect(fmt('{n}|{s}', { n: 0, s: '' })).toBe('0|')
  })
  it('does not re-expand placeholders found inside values', () => {
    expect(fmt('{a}', { a: '{b}', b: 'x' })).toBe('{b}')
  })
  it('does not treat $ patterns in values specially', () => {
    expect(fmt('{a}', { a: "$& $1 $'" })).toBe("$& $1 $'")
  })
  it('ignores braces that are not word placeholders', () => {
    expect(fmt('{ n } {} {a-b}', { n: 1 })).toBe('{ n } {} {a-b}')
  })
  // BUG: `key in values` also matches inherited Object.prototype members.
  it('keeps {toString} / {constructor} placeholders when only own keys are provided', () => {
    expect(fmt('{toString}', {})).toBe('{toString}')
  })
})

describe('english-only helpers', () => {
  it('useLang is en and useT returns the en dictionary', () => {
    expect(useLang()).toBe('en')
    expect(useT({ en: { hello: 'Hello' } }).hello).toBe('Hello')
  })

  it('plural picks the singular only for exactly one', () => {
    expect(plural(1, 'detection')).toBe('detection')
    expect(plural(0, 'detection')).toBe('detections')
    expect(plural(2, 'day')).toBe('days')
    expect(plural(2, 'person', 'people')).toBe('people')
  })
})
