export function MiniBarChart({
  data,
  valueFormat = (value) => String(value),
  barColor = '#7C6FF0',
}: {
  data: { label: string; value: number }[]
  valueFormat?: (value: number) => string
  barColor?: string
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex h-40 items-end gap-1.5">
      {data.map((d, index) => {
        const heightPct = d.value > 0 ? Math.max(4, (d.value / max) * 100) : 2
        return (
          <div key={`${d.label}-${index}`} className="flex h-full flex-1 flex-col items-center gap-1.5">
            <span className="font-['JetBrains_Mono'] text-[10.5px] text-[#8A90A6]">
              {d.value > 0 ? valueFormat(d.value) : ' '}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t transition-all"
                style={{ height: `${heightPct}%`, backgroundColor: barColor, opacity: d.value > 0 ? 0.85 : 0.2 }}
              />
            </div>
            <span className="text-[10.5px] text-[#8A90A6]">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}
