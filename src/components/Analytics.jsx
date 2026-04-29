import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import API_BASE_URL from '../config/api'

const GLOBAL_ANALYTICS_POLL_MS = 2000
const BACKEND_RETRY_INTERVAL_MS = 5000

const DEFAULT_LIMITS = {
  peopleLimit: 70,
  densityLimit: 250,
  motionLimit: 15,
  riskLimit: 2,
}

const RISK_MAP = { LOW: 0, MEDIUM: 1, HIGH: 2 }

function safeNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function toRiskScore(risk) {
  if (!risk) return 0
  return RISK_MAP[String(risk).toUpperCase()] ?? 0
}

function formatTimeLabel(value) {
  if (!value) return '--'
  const text = String(value)
  if (text.includes('T')) return text.split('T')[1]?.slice(0, 8) || text
  return text
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history.map((item, index) => {
    const risk = String(item.risk || 'LOW').toUpperCase()
    const densityScore = safeNumber(item.density_score, safeNumber(item.adjusted, 0))
    return {
      frame_id: item.frame_id ?? index + 1,
      feed_id: item.feed_id,
      time: item.time || item.timestamp || '',
      people: safeNumber(item.people, 0),
      adjusted: safeNumber(item.adjusted, densityScore),
      density_score: densityScore,
      motion: safeNumber(item.motion, 0),
      motion_score: safeNumber(item.motion_score, safeNumber(item.motion, 0)),
      density: item.density || '',
      movement: item.movement || '',
      risk,
      risk_score: safeNumber(item.risk_score, toRiskScore(risk)),
      threat: item.threat || '',
      action: item.action || '',
      stampede_risk: item.stampede_risk === true,
      trigger_reason: item.trigger_reason || '',
    }
  })
}

function average(list, key) {
  if (!list.length) return 0
  return list.reduce((acc, item) => acc + safeNumber(item[key], 0), 0) / list.length
}

function countStampedeTransitions(history) {
  let count = 0
  let previous = false
  history.forEach((item) => {
    if (item.stampede_risk && !previous) count += 1
    previous = item.stampede_risk
  })
  return count
}

function deriveSummary(history, backendSummary) {
  const avgPeople = average(history, 'people')
  const avgDensity = average(history, 'density_score')
  const avgMotion = average(history, 'motion')
  const peakMotion = history.reduce((max, item) => Math.max(max, safeNumber(item.motion, 0)), 0)
  const maxDensity = history.reduce((max, item) => Math.max(max, safeNumber(item.density_score, 0)), 0)
  const riskEvents = countStampedeTransitions(history)
  const riskDuration = history.filter((item) => item.stampede_risk).length
  const stability =
    riskEvents > 0 ? 'UNSTABLE' : peakMotion > 15 || maxDensity > 320 ? 'WATCH' : 'STABLE'
  const highestRiskFeed = history.find((item) => item.stampede_risk)?.feed_id

  return {
    avg_people: safeNumber(backendSummary?.avg_people, avgPeople).toFixed(1),
    avg_density: safeNumber(backendSummary?.avg_density, avgDensity).toFixed(1),
    avg_motion: safeNumber(backendSummary?.avg_motion, avgMotion).toFixed(1),
    peak_motion: safeNumber(backendSummary?.peak_motion, peakMotion).toFixed(1),
    max_density: safeNumber(backendSummary?.max_density, maxDensity).toFixed(1),
    risk_events: Math.round(safeNumber(backendSummary?.risk_events, riskEvents)),
    stampede_risk_events: Math.round(safeNumber(backendSummary?.stampede_risk_events, riskEvents)),
    high_risk_duration: Math.round(safeNumber(backendSummary?.high_risk_duration, riskDuration)),
    highest_risk_feed: backendSummary?.highest_risk_feed ?? highestRiskFeed ?? '--',
    stability: backendSummary?.stability || stability,
  }
}

function severityTone(value) {
  const text = String(value || '').toUpperCase()
  if (text.includes('HIGH') || text.includes('CRITICAL') || text.includes('UNSTABLE')) return 'text-[#ff6666] border-[#ff3333]/35 bg-[#ff3333]/10'
  if (text.includes('MEDIUM') || text.includes('WATCH') || text.includes('WARNING')) return 'text-[#ffd07a] border-[#ffaa00]/35 bg-[#ffaa00]/10'
  return 'text-[#00ff41] border-[#00ff41]/30 bg-[#00ff41]/8'
}

function generateEvents(history, backendEvents, limits) {
  if (Array.isArray(backendEvents) && backendEvents.length) {
    return backendEvents.map((event) => ({
      time: formatTimeLabel(event.time),
      type: event.type || 'EVENT',
      message: event.message || '',
      severity: event.severity || (String(event.type || '').includes('STAMPEDE') ? 'CRITICAL' : 'WARNING'),
    }))
  }
  if (history.length < 2) return []

  const previous = history[history.length - 2]
  const current = history[history.length - 1]
  const events = []

  if (previous.density_score <= limits.densityLimit && current.density_score > limits.densityLimit) {
    events.push({
      time: formatTimeLabel(current.time),
      type: 'DENSITY_THRESHOLD',
      message: 'Density crossed crowd limit',
      severity: 'WARNING',
    })
  }
  if (previous.motion <= limits.motionLimit && current.motion > limits.motionLimit) {
    events.push({
      time: formatTimeLabel(current.time),
      type: 'MOTION_SPIKE',
      message: 'Motion spike detected',
      severity: 'WARNING',
    })
  }
  if (!previous.stampede_risk && current.stampede_risk) {
    events.push({
      time: formatTimeLabel(current.time),
      type: 'STAMPEDE_RISK',
      message: 'Stampede risk detected: High density + abnormal movement.',
      severity: 'CRITICAL',
    })
  }

  return events
}

function deriveInsight(summary, backendInsight) {
  if (backendInsight) return backendInsight
  const avgDensity = safeNumber(summary.avg_density, 0)
  const avgMotion = safeNumber(summary.avg_motion, 0)

  if (safeNumber(summary.stampede_risk_events, 0) > 0) return 'Selected feed showed stampede-risk condition due to high density and abnormal movement.'
  if (avgDensity >= 250 && avgMotion < 10) return 'Crowd is dense but currently stable. Continue monitoring.'
  if (avgDensity < 200 && avgMotion >= 15) return 'Unusual movement detected in low-density area. Verify camera feed.'
  return 'Crowd conditions stable.'
}

function statusForChart(kind, latest, limits) {
  if (!latest) return 'Status: STANDBY'
  if (kind === 'people') return latest.people > limits.peopleLimit ? 'Status: HIGH CONGESTION' : 'Status: NORMAL'
  if (kind === 'density') return latest.density_score > limits.densityLimit ? 'Status: HIGH CONGESTION' : 'Status: NORMAL'
  if (kind === 'motion') return latest.motion > limits.motionLimit ? 'Status: ABNORMAL MOTION' : 'Status: NORMAL'
  if (kind === 'risk') return latest.stampede_risk ? 'Status: STAMPEDE RISK' : latest.risk_score === 1 ? 'Status: WATCH' : 'Status: NORMAL'
  return 'Status: NORMAL'
}

function deriveSessionSummary(history, events, limits) {
  if (!history.length) {
    return {
      maxPeople: '--',
      peakDensity: '--',
      riskDuration: '--',
      highestRisk: '--',
      totalEvents: '--',
    }
  }

  const maxPeople = history.reduce((max, item) => Math.max(max, safeNumber(item.people, 0)), 0)
  const maxDensity = history.reduce((max, item) => Math.max(max, safeNumber(item.density_score, 0)), 0)
  const peakDensity = maxDensity > limits.densityLimit ? 'HIGH' : maxDensity > limits.densityLimit * 0.6 ? 'MEDIUM' : 'LOW'
  const highRiskFrames = history.filter((item) => item.stampede_risk).length
  const riskDuration = `${highRiskFrames}s`
  const highestScore = history.reduce((max, item) => Math.max(max, safeNumber(item.risk_score, 0)), 0)
  const highestRisk = highRiskFrames > 0 ? 'CRITICAL' : highestScore >= 1 ? 'WATCH' : 'NOMINAL'

  return {
    maxPeople,
    peakDensity,
    riskDuration,
    highestRisk,
    totalEvents: events.length,
  }
}

function StatCard({ label, value }) {
  return (
    <article className={`rounded-xl border p-4 ${severityTone(String(value))}`}>
      <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value ?? '--'}</p>
    </article>
  )
}

function ThresholdControls({ limits, onChange }) {
  const fields = [
    { key: 'peopleLimit', label: 'People Limit' },
    { key: 'densityLimit', label: 'Density Limit' },
    { key: 'motionLimit', label: 'Motion Limit' },
    { key: 'riskLimit', label: 'Risk Limit' },
  ]

  return (
    <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-[#00ff41]">Threshold Settings</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {fields.map((field) => (
          <label key={field.key} className="text-xs text-[#00cc33]">
            {field.label}
            <input
              type="number"
              min="0"
              value={limits[field.key]}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  [field.key]: safeNumber(event.target.value, prev[field.key]),
                }))
              }
              className="mt-1 w-full rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-3 py-2 text-sm text-[#00ff41] outline-none"
            />
          </label>
        ))}
      </div>
    </article>
  )
}

function MetricChart({ title, data, dataKey, color, limit, limitLabel, statusText, riskAxis = false }) {
  return (
    <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-[#00ff41]">{title}</p>
        <p className="text-xs text-[#00cc33]">{statusText}</p>
      </div>
      <div className="relative h-[220px] rounded-xl border border-[#1a3a1a] bg-[#050a05] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="#123312" strokeDasharray="4 4" />
            <XAxis dataKey="time" tickFormatter={formatTimeLabel} stroke="#00cc33" tick={{ fontSize: 11, fill: '#00cc33' }} />
            <YAxis
              stroke="#00cc33"
              tick={{ fontSize: 11, fill: '#00cc33' }}
              ticks={riskAxis ? [0, 1, 2] : undefined}
              domain={riskAxis ? [0, 2] : ['auto', 'auto']}
              tickFormatter={riskAxis ? (value) => (value === 2 ? 'HIGH' : value === 1 ? 'MED' : 'LOW') : undefined}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#0d140d', border: '1px solid #1a3a1a', borderRadius: '10px', color: '#00ff41' }}
              labelStyle={{ color: '#00cc33' }}
            />
            <ReferenceLine y={limit} stroke="#ff6666" strokeDasharray="5 5" label={{ value: limitLabel, fill: '#ff6666', fontSize: 10 }} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.2} dot={false} isAnimationActive animationDuration={450} />
          </LineChart>
        </ResponsiveContainer>
        {data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#050a05]/70 text-sm text-[#00cc33]">
            Waiting for live data...
          </div>
        ) : null}
      </div>
    </article>
  )
}

function EventTimeline({ events, hasFeedStarted }) {
  return (
    <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-[#00ff41]">Risk Event Timeline</p>
      {events.length === 0 ? (
        <div className="rounded-xl border border-[#1a3a1a] bg-[#0d140d] p-4 text-sm text-[#00cc33]">
          {hasFeedStarted ? 'System stable - no abnormal spikes detected.' : 'Event timeline will appear after monitoring starts.'}
        </div>
      ) : (
        <div className="max-h-[280px] space-y-2 overflow-auto pr-1">
          {events.map((event, index) => (
            <div key={`${event.time}-${index}`} className="rounded-xl border border-[#1a3a1a] bg-[#0d140d] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[#00cc33]">{event.time}</p>
                <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${severityTone(event.severity)}`}>{event.severity}</span>
              </div>
              <p className="mt-1 text-xs text-[#00ff41]">{event.type}</p>
              <p className="text-sm text-[#00cc33]">{event.message}</p>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

function InsightPanel({ insight }) {
  return (
    <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
      <p className="mb-2 text-sm font-semibold text-[#00ff41]">System Insight</p>
      <p className="text-sm text-[#00cc33]">{insight}</p>
    </article>
  )
}

function SessionSummary({ summary }) {
  return (
    <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-[#00ff41]">Session Summary</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-3 text-sm text-[#00cc33]">Max People: <span className="font-semibold text-[#00ff41]">{summary.maxPeople}</span></div>
        <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-3 text-sm text-[#00cc33]">Peak Density: <span className="font-semibold text-[#00ff41]">{summary.peakDensity}</span></div>
        <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-3 text-sm text-[#00cc33]">Risk Duration: <span className="font-semibold text-[#00ff41]">{summary.riskDuration}</span></div>
        <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-3 text-sm text-[#00cc33]">Highest Risk: <span className="font-semibold text-[#00ff41]">{summary.highestRisk}</span></div>
        <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-3 text-sm text-[#00cc33] sm:col-span-2">Total Events: <span className="font-semibold text-[#00ff41]">{summary.totalEvents}</span></div>
      </div>
    </article>
  )
}

function Analytics({ backendStatus }) {
  const [limits, setLimits] = useState(DEFAULT_LIMITS)
  const [analyticsPayload, setAnalyticsPayload] = useState({ history: [], summary: null, events: [], insight: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timeoutId = null

    const poll = async () => {
      let nextDelay = GLOBAL_ANALYTICS_POLL_MS
      try {
        const res = await fetch(`${API_BASE_URL}/analytics/global`)
        if (!res.ok) {
          nextDelay = BACKEND_RETRY_INTERVAL_MS
          throw new Error(`request_failed_${res.status}`)
        }
        const data = await res.json()
        if (cancelled) return

        if (Array.isArray(data)) {
          setAnalyticsPayload({ history: data, summary: null, events: [], insight: '' })
        } else {
          setAnalyticsPayload({
            history: Array.isArray(data?.history) ? data.history : [],
            summary: data?.summary || null,
            events: Array.isArray(data?.events) ? data.events : [],
            insight: data?.insight || '',
          })
        }
        setError(false)
      } catch (pollError) {
        nextDelay = BACKEND_RETRY_INTERVAL_MS
        console.log('[frontend] analytics global retry', {
          error: pollError.message || 'backend unavailable',
          retry_ms: BACKEND_RETRY_INTERVAL_MS,
        })
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
        if (!cancelled) {
          timeoutId = window.setTimeout(poll, nextDelay)
        }
      }
    }

    poll()
    return () => {
      cancelled = true
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [])

  const history = useMemo(() => normalizeHistory(analyticsPayload.history), [analyticsPayload.history])
  const summary = useMemo(() => deriveSummary(history, analyticsPayload.summary), [history, analyticsPayload.summary])
  const events = useMemo(() => generateEvents(history, analyticsPayload.events, limits), [history, analyticsPayload.events, limits])
  const sessionSummary = useMemo(() => deriveSessionSummary(history, events, limits), [history, events, limits])
  const insight = useMemo(() => deriveInsight(summary, analyticsPayload.insight), [summary, analyticsPayload.insight])
  const latest = history.length ? history[history.length - 1] : null
  const backendState = String(backendStatus?.state || '').toUpperCase()
  const liveState = ['RUNNING', 'LOOPING'].includes(backendState) && history.length > 0 ? 'LIVE ANALYTICS' : 'STANDBY'
  const hasFeedStarted = ['UPLOADED', 'PROCESSING', 'READY', 'LOOPING', 'RUNNING', 'STOPPED'].includes(backendState) || !!backendStatus?.has_video

  return (
    <section className="space-y-4">
      <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-2xl font-semibold phosphor-text">Analytics Command View</p>
            <p className="mt-1 text-sm text-[#00cc33]">Time-based crowd density, movement, and risk intelligence</p>
          </div>
          <span className={`rounded-lg border px-3 py-1 text-xs font-semibold ${liveState === 'LIVE ANALYTICS' ? 'border-[#00ff41]/40 bg-[#00ff41]/10 text-[#00ff41]' : 'border-[#ffaa00]/40 bg-[#ffaa00]/10 text-[#ffd07a]'}`}>
            {liveState}
          </span>
        </div>
      </article>

      {history.length === 0 ? (
        <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-5 text-sm text-[#00cc33]">
          {loading
            ? 'Waiting for analytics data...'
            : hasFeedStarted
              ? 'No data available yet. Start a feed to generate analytics.'
              : 'No data available yet. Start a feed to generate analytics.'}
        </article>
      ) : null}

      {error && hasFeedStarted ? (
        <article className="rounded-2xl border border-[#ffaa00]/40 bg-[#221607] p-4 text-sm text-[#ffd07a]">
          Data source warning. Live analytics stream is temporarily unavailable.
        </article>
      ) : null}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Average People" value={summary.avg_people} />
        <StatCard label="Average Density" value={summary.avg_density} />
        <StatCard label="Average Motion" value={summary.avg_motion} />
        <StatCard label="Peak Motion" value={summary.peak_motion} />
        <StatCard label="Stampede Events" value={summary.stampede_risk_events} />
        <StatCard label="Crowd Stability" value={summary.stability} />
      </section>

      <SessionSummary summary={sessionSummary} />
      <ThresholdControls limits={limits} onChange={setLimits} />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MetricChart title="People Count Chart" data={history} dataKey="people" color="#22d3ee" limit={limits.peopleLimit} limitLabel="People Limit" statusText={statusForChart('people', latest, limits)} />
        <MetricChart title="Density Score Chart" data={history} dataKey="density_score" color="#00ff41" limit={limits.densityLimit} limitLabel="Density Limit" statusText={statusForChart('density', latest, limits)} />
        <MetricChart title="Motion Score Chart" data={history} dataKey="motion" color="#ffaa00" limit={limits.motionLimit} limitLabel="Motion Limit" statusText={statusForChart('motion', latest, limits)} />
        <MetricChart title="Risk Score Chart" data={history} dataKey="risk_score" color="#ff3333" limit={limits.riskLimit} limitLabel="Critical Limit" statusText={statusForChart('risk', latest, limits)} riskAxis />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <EventTimeline events={events} hasFeedStarted={hasFeedStarted} />
        <InsightPanel insight={insight} />
      </section>
    </section>
  )
}

export default Analytics
