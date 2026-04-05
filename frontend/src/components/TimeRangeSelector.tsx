type TimeRange = '1D' | '5D' | '1M' | '3M'

interface Props {
  value: TimeRange
  onChange: (range: TimeRange) => void
}

export default function TimeRangeSelector({ value, onChange }: Props) {
  const ranges: TimeRange[] = ['1D', '5D', '1M', '3M']

  return (
    <div className="flex gap-2">
      {ranges.map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          className={`px-4 py-2 rounded-md font-medium transition-colors ${
            value === range
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {range}
        </button>
      ))}
    </div>
  )
}
