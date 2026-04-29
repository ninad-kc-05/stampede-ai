import { AlertTriangle, BarChart3, Navigation, ShieldAlert, Users } from 'lucide-react'

const iconMap = {
  'People Count': Users,
  Density: BarChart3,
  Movement: Navigation,
  'Risk Level': AlertTriangle,
  'Stampede Risk': ShieldAlert,
}

const riskTone = {
  LOW: 'text-[#00ff41] bg-[#00ff41]/8 border-[#00ff41]/30',
  MEDIUM: 'text-[#ffaa00] bg-[#ffaa00]/10 border-[#ffaa00]/30',
  HIGH: 'text-[#ff3333] bg-[#ff3333]/10 border-[#ff3333]/30',
}

function MetricsPanel({ metrics }) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      {metrics.map((item) => {
        const Icon = iconMap[item.label] || BarChart3
        const tone =
          item.label === 'Stampede Risk' && item.value === 'TRUE'
            ? riskTone.HIGH
            : item.label === 'Risk Level' && item.value
            ? riskTone[item.value] || 'text-[#00cc33] bg-[#0d140d] border-[#1a3a1a]'
            : 'text-[#00cc33] bg-[#0d140d] border-[#1a3a1a]'
        const trendTone = item.trend === 'up' ? 'text-[#ff6666]' : item.trend === 'down' ? 'text-[#00ff41]' : 'text-[#00cc33]'
        const trendSymbol = item.trend === 'up' ? 'UP' : item.trend === 'down' ? 'DOWN' : 'STABLE'
        const liveValue = item.value !== null && item.value !== undefined

        return (
          <article key={item.label} className={`rounded-2xl border p-4 shadow-sm transition-all duration-300 hover:shadow-[0_0_18px_rgba(0,255,65,0.15)] ${liveValue ? 'metric-fade-in' : ''} ${tone}`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#004d14]">{item.label}</p>
              <Icon className="h-4 w-4" />
            </div>
            <p className="mt-3 text-3xl font-semibold">{item.value ?? '--'}</p>
            <p className="mt-1 text-xs text-[#00cc33]">{item.subtext || '--'}</p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-[#004d14]">{item.detail || ''}</p>
              <p className={`text-xs font-semibold ${trendTone}`}>{trendSymbol}</p>
            </div>
          </article>
        )
      })}
    </section>
  )
}

export default MetricsPanel
