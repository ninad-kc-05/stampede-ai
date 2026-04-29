import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts'

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '--' : value
}

function riskScore(risk) {
  if (risk === 'HIGH') return 2
  if (risk === 'MEDIUM') return 1
  return 0
}

function timeLabel(value) {
  if (!value) return '--'
  const text = String(value)
  if (text.includes('T')) return text.split('T')[1]?.slice(0, 8) || text
  return text
}

function CombinedChart({ data }) {
  return (
    <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-3 shadow-sm">
      <p className="mb-2 text-sm font-semibold text-[#00ff41]">Live Detection Signals (Selected Feed)</p>
      <div className="h-[280px] rounded-xl border border-[#1a3a1a] bg-[#050a05] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="#123312" strokeDasharray="4 4" />
            <XAxis dataKey="time" tickFormatter={timeLabel} stroke="#00cc33" tick={{ fontSize: 10, fill: '#00cc33' }} />
            <YAxis stroke="#00cc33" tick={{ fontSize: 10, fill: '#00cc33' }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0d140d', border: '1px solid #1a3a1a', borderRadius: '10px', color: '#00ff41' }}
              labelStyle={{ color: '#00cc33' }}
            />
            <Legend wrapperStyle={{ color: '#00cc33', fontSize: '11px' }} />
            <Line type="monotone" dataKey="people" name="People" stroke="#22d3ee" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="adjusted" name="Density Score" stroke="#00ff41" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="motion" name="Motion Score" stroke="#ffaa00" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="risk_score" name="Risk Score (0-2)" stroke="#ff3333" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  )
}

function DebugMode({
  stream,
  metrics,
  analytics,
  selectedFeedId,
  debugVisuals,
}) {
  const telemetryRows = [
    ['People Count', valueOrDash(metrics.people)],
    ['Adjusted Count', valueOrDash(metrics.adjusted)],
    ['Density Score', valueOrDash(metrics.adjusted)],
    ['Density', valueOrDash(metrics.density)],
    ['Motion Score', valueOrDash(metrics.motion)],
    ['Movement', valueOrDash(metrics.movement)],
    ['Risk Score', riskScore(metrics.risk)],
    ['Risk Level', valueOrDash(metrics.risk)],
    ['Stampede Risk', metrics.stampede_risk ? 'TRUE' : 'FALSE'],
    ['Trigger Reason', valueOrDash(metrics.trigger_reason)],
    ['FPS', valueOrDash(metrics.fps)],
    ['Timestamp', valueOrDash(metrics.timestamp)],
    ['Selected Feed', `Feed ${selectedFeedId}`],
  ]

  const chartRows = useMemo(
    () =>
      (analytics || []).map((row) => ({
        time: row.time || row.timestamp || '',
        people: row.people ?? 0,
        adjusted: row.adjusted ?? row.density_score ?? 0,
        motion: row.motion ?? 0,
        risk_score: row.risk_score ?? riskScore(row.risk),
        risk: row.risk || 'LOW',
      })),
    [analytics],
  )

  return (
    <section className="space-y-4">
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_1fr]">
        <div className="space-y-3">
          {metrics.stampede_risk ? (
            <article className="rounded-2xl border border-[#ff3333]/70 bg-[#2a0707] p-3 text-sm font-semibold text-[#ffdddd] shadow-[0_0_22px_rgba(255,51,51,0.28)]">
              STAMPEDE RISK: HIGH DENSITY + ABNORMAL MOTION
            </article>
          ) : null}
          <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
              <span className="rounded border border-[#00ff41]/45 bg-[#082208] px-2 py-1 text-[#00ff41]">Debug Stream Active</span>
              <span className={`rounded border px-2 py-1 ${debugVisuals.boxes ? 'border-[#00ff41]/45 bg-[#082208] text-[#00ff41]' : 'border-[#1a3a1a] bg-[#0d140d] text-[#00cc33]'}`}>
                Boxes {debugVisuals.boxes ? 'ON' : 'OFF'}
              </span>
              <span className={`rounded border px-2 py-1 ${debugVisuals.heatmap ? 'border-[#ffaa00]/50 bg-[#2a1b08] text-[#ffd07a]' : 'border-[#1a3a1a] bg-[#0d140d] text-[#00cc33]'}`}>
                Heatmap {debugVisuals.heatmap ? 'ON' : 'OFF'}
              </span>
              <span className={`rounded border px-2 py-1 ${debugVisuals.telemetry ? 'border-[#00ff41]/45 bg-[#082208] text-[#00ff41]' : 'border-[#1a3a1a] bg-[#0d140d] text-[#00cc33]'}`}>
                Telemetry {debugVisuals.telemetry ? 'ON' : 'OFF'}
              </span>
            </div>
          </article>
          {stream}
        </div>

        <div className="space-y-4">
          <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
            <p className="mb-3 text-base font-semibold text-[#00ff41]">Raw Telemetry Snapshot</p>
            <div className="rounded-xl border border-[#1a3a1a] bg-[#050a05] p-3">
              {telemetryRows.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-[#102510] py-2 text-sm last:border-b-0">
                  <p className="text-[#00cc33]">{label}</p>
                  <p className="font-semibold text-[#00ff41]">{value}</p>
                </div>
              ))}
            </div>
          </article>

        </div>
      </section>

      <CombinedChart data={chartRows} />

    </section>
  )
}

export default DebugMode
