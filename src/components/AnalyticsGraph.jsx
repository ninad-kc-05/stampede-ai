import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function formatXAxis(value) {
  if (!value) return '--'
  const text = String(value)
  if (text.includes('T')) {
    return text.split('T')[1]?.slice(0, 8) || text
  }
  return text
}

function AnalyticsGraph({ data, title = 'Time-Based Analytics' }) {
  return (
    <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
      <p className="mb-3 text-base font-semibold text-[#00ff41]">{title}</p>
      <div className="h-[360px] rounded-xl border border-[#1a3a1a] bg-[#050a05] p-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="#123312" strokeDasharray="4 4" />
            <XAxis dataKey="time" tickFormatter={formatXAxis} stroke="#00cc33" tick={{ fontSize: 11, fill: '#00cc33' }} />
            <YAxis stroke="#00cc33" tick={{ fontSize: 11, fill: '#00cc33' }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0d140d', border: '1px solid #1a3a1a', borderRadius: '12px', color: '#00ff41' }}
            />
            <Legend wrapperStyle={{ color: '#00cc33' }} />
            <Line type="monotone" dataKey="people" name="People Count" stroke="#0ea5e9" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="adjusted" name="Density Score" stroke="#10b981" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="motion" name="Movement Score" stroke="#f97316" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  )
}

export default AnalyticsGraph
