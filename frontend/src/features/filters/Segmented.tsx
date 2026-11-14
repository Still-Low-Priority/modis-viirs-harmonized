import './filters.css'

export interface SegmentedOption<T> {
  value: T
  label: string
}

interface Props<T> {
  /** Accessible name of the group. */
  label: string
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
}

export function Segmented<T extends string | null>({ label, options, value, onChange }: Props<T>) {
  return (
    <div className="filters-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className="btn filters-seg__btn"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
