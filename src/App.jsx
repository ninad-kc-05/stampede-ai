import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToastContainer, toast } from 'react-toastify'
import emailjs from '@emailjs/browser'
import 'react-toastify/dist/ReactToastify.css'
import {
  AlertTriangle,
  Ambulance,
  BadgeAlert,
  Bot,
  Clock3,
  Download,
  FileJson,
  FileSpreadsheet,
  Hospital,
  Megaphone,
  Shield,
  ShieldAlert,
  Trash2,
  Volume2,
  VolumeX,
  Users,
  Video,
} from 'lucide-react'
import AlertsPanel from './components/AlertsPanel'
import Analytics from './components/Analytics'
import ControlPanel from './components/ControlPanel'
import DebugMode from './components/DebugMode'
import FeedVideoPanel from './components/FeedVideoPanel'
import MetricsPanel from './components/MetricsPanel'
import NotificationBell from './components/NotificationBell'
import RiskIndicator from './components/RiskIndicator'
import Sidebar from './components/Sidebar'
import API_BASE_URL from './config/api'
const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
const EMAILJS_PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY
const BACKEND_ALERT_SENT_KEY = 'backend_alert_sent'
const FEED_SLOTS = 6
const FEED_IDS = Array.from({ length: FEED_SLOTS }, (_, idx) => idx + 1)
const MODE_PROTOTYPE = 'prototype_buffered'
const MODE_CONTINUOUS = 'continuous_monitoring'
const STATUS_POLL_INTERVAL_MS = 1000
const DATA_POLL_INTERVAL_MS = 1000
const ANALYTICS_POLL_INTERVAL_MS = 2000
const BACKEND_RETRY_INTERVAL_MS = 5000

function debugLog(action, details) {
  if (details === undefined) {
    console.log(`[frontend] ${action}`)
    return
  }
  console.log(`[frontend] ${action}`, details)
}

async function sendAlert() {
  const missingKeys = [
    !EMAILJS_SERVICE_ID ? 'VITE_EMAILJS_SERVICE_ID' : null,
    !EMAILJS_TEMPLATE_ID ? 'VITE_EMAILJS_TEMPLATE_ID' : null,
    !EMAILJS_PUBLIC_KEY ? 'VITE_EMAILJS_PUBLIC_KEY' : null,
  ].filter(Boolean)

  debugLog('email alert config', {
    service_id_present: Boolean(EMAILJS_SERVICE_ID),
    template_id_present: Boolean(EMAILJS_TEMPLATE_ID),
    public_key_present: Boolean(EMAILJS_PUBLIC_KEY),
  })

  if (missingKeys.length) {
    debugLog('email alert skipped', { reason: 'missing_emailjs_env', missing_keys: missingKeys })
    return false
  }

  try {
    debugLog('email alert send start', { service: EMAILJS_SERVICE_ID, template: EMAILJS_TEMPLATE_ID })
    const result = await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      {},
      { publicKey: EMAILJS_PUBLIC_KEY },
    )
    debugLog('email alert response', { status: result?.status, text: result?.text })
    return true
  } catch (error) {
    debugLog('email alert error', { 
      error: error?.message || String(error),
      error_name: error?.name,
      stack: error?.stack?.slice(0, 200)
    })
    return false
  }
}

async function readApiJson(response, context = {}) {
  const contentType = response.headers.get('content-type') || ''
  const bodyText = await response.text()
  const bodyPreview = bodyText.slice(0, 300)

  if (!contentType.toLowerCase().includes('application/json')) {
    const looksLikeHtml = bodyText.trimStart().startsWith('<')
    debugLog('api returned non-json response', {
      ...context,
      url: response.url,
      api_base_url: API_BASE_URL,
      http_status: response.status,
      content_type: contentType || 'missing',
      body_preview: bodyPreview,
      likely_problem: looksLikeHtml
        ? 'The API URL returned an HTML page. Check VITE_API_URL, rebuild, and make sure the Cloudflare/backend server is running.'
        : 'The backend did not return JSON.',
    })
    throw new Error(
      looksLikeHtml
        ? `Upload endpoint returned HTML instead of JSON. Check VITE_API_URL/backend tunnel: ${API_BASE_URL}`
        : `Backend returned ${contentType || 'unknown content type'} instead of JSON.`,
    )
  }

  try {
    return bodyText ? JSON.parse(bodyText) : {}
  } catch (error) {
    debugLog('api returned invalid json', {
      ...context,
      url: response.url,
      api_base_url: API_BASE_URL,
      http_status: response.status,
      content_type: contentType,
      body_preview: bodyPreview,
      error: error.message,
    })
    throw new Error(`Backend returned invalid JSON: ${error.message}`)
  }
}

const EMPTY_METRICS = {
  people: null,
  adjusted: null,
  density: null,
  movement: null,
  risk: null,
  threat: 'STANDBY',
  action: 'WAITING',
  stampede_risk: false,
  trigger_reason: 'Awaiting detection',
  status: 'idle',
  timestamp: '',
  fps: 0,
  frame_id: 0,
  left_zone: null,
  right_zone: null,
  motion: null,
  motion_score: null,
  density_score: null,
  feed_id: 1,
}

const EMPTY_TRENDS = {
  people: 'stable',
  density: 'stable',
  movement: 'stable',
  risk: 'stable',
}

function createFeed(id) {
  return {
    id,
    name: `Feed ${id}`,
    videoUrl: null,
    sourceFile: null,
    status: 'EMPTY',
    backendState: 'IDLE',
    hasBackendVideo: false,
    processedFrames: 0,
    packetsCount: 0,
    totalFrames: 0,
    streamKey: 0,
    debugStreamKey: 0,
    videoId: null,
    storageVideoId: null,
    storageStatus: 'idle',
    storageProgress: 0,
    processedVideoUrl: null,
    analyticsUrl: null,
    storageAnalytics: null,
    storageFps: null,
    message: 'Awaiting video upload',
    risk: null,
    threat: 'STANDBY',
    action: 'WAITING',
    stampedeRisk: false,
    triggerReason: 'Awaiting detection',
    people: null,
    density: null,
    movement: null,
    fps: null,
    timestamp: null,
  }
}

function createFeedWall() {
  return Array.from({ length: FEED_SLOTS }, (_, idx) => createFeed(idx + 1))
}

function parseFeedId(feed) {
  const text = String(feed || 'feed-1')
  const id = Number(text.replace('feed-', ''))
  return Number.isFinite(id) && id > 0 ? id : 1
}

function resolveFeedId(feed) {
  const id = parseFeedId(feed)
  if (FEED_IDS.includes(id)) return id
  console.warn('[App] Invalid feed selection, falling back to Feed 1:', feed)
  return 1
}

function feedSelectValue(feedId) {
  return `feed-${resolveFeedId(feedId)}`
}

function toTimestampLabel(timestamp) {
  if (!timestamp) return '--'
  const text = String(timestamp)
  if (text.includes('T')) return text.split('T')[1]?.replace('Z', '') || text
  return text
}

function progressFromMessage(message) {
  const text = String(message || '')
  const match = text.match(/frame\s+(\d+)\s*\/\s*(\d+)/i)
  if (!match) return null
  const current = Number(match[1])
  const total = Number(match[2])
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)))
}

function densityFromAdjusted(adjusted) {
  if (adjusted == null) return null
  if (adjusted > 200) return 'HIGH'
  if (adjusted > 80) return 'MEDIUM'
  return 'LOW'
}

function trendNumber(nextValue, prevValue) {
  if (typeof nextValue !== 'number' || typeof prevValue !== 'number') return 'stable'
  if (nextValue > prevValue) return 'up'
  if (nextValue < prevValue) return 'down'
  return 'stable'
}

function trendEnum(nextValue, prevValue, rankMap) {
  if (!nextValue || !prevValue) return 'stable'
  const next = rankMap[nextValue]
  const prev = rankMap[prevValue]
  if (next == null || prev == null) return 'stable'
  if (next > prev) return 'up'
  if (next < prev) return 'down'
  return 'stable'
}

function densityLabel(density) {
  if (density === 'HIGH') return 'Heavy Congestion'
  if (density === 'MEDIUM') return 'Moderate Congestion'
  if (density === 'LOW') return 'Open Flow'
  return '--'
}

function movementLabel(movement) {
  if (movement === 'ABNORMAL') return 'Irregular Motion'
  if (movement === 'NORMAL') return 'Stable Movement'
  return '--'
}

function riskLabel(risk) {
  if (risk === 'HIGH') return 'Critical'
  if (risk === 'MEDIUM') return 'Watch'
  if (risk === 'LOW') return 'Low Threat'
  return '--'
}

function fuseOperationalState(density, movement) {
  if (density === 'HIGH' && movement === 'ABNORMAL') {
    return {
      risk: 'HIGH',
      threat: 'CRITICAL',
      action: 'ALERT',
      stampede_risk: true,
      statusText: 'STAMPede RISK DETECTED',
      trigger_reason: 'High density + abnormal movement',
      insight: 'System detected high crowd density combined with abnormal movement patterns. This indicates possible panic flow and requires immediate intervention.',
    }
  }
  if (density === 'HIGH' && movement === 'NORMAL') {
    return {
      risk: 'MEDIUM',
      threat: 'WATCH',
      action: 'MONITOR',
      stampede_risk: false,
      statusText: 'CROWDED BUT STABLE',
      trigger_reason: 'High density + normal movement',
      insight: 'Crowded but stable. Maintain active monitoring and prepare prevention measures.',
    }
  }
  if (density === 'MEDIUM' && movement === 'ABNORMAL') {
    return {
      risk: 'MEDIUM',
      threat: 'WARNING',
      action: 'PREPARE',
      stampede_risk: false,
      statusText: 'MOVEMENT WARNING',
      trigger_reason: 'Medium density + abnormal movement',
      insight: 'Movement warning detected. Prepare crowd staff and monitor zone closely.',
    }
  }
  if (density === 'LOW' && movement === 'ABNORMAL') {
    return {
      risk: 'MEDIUM',
      threat: 'CHECK',
      action: 'VERIFY',
      stampede_risk: false,
      statusText: 'UNUSUAL MOVEMENT',
      trigger_reason: 'Low density + abnormal movement',
      insight: 'Unusual motion detected in a low-density area. Verify camera feed and ground conditions.',
    }
  }
  return {
    risk: 'LOW',
    threat: 'NOMINAL',
    action: 'STANDBY',
    stampede_risk: false,
    statusText: 'NORMAL',
    trigger_reason: 'Density and movement stable',
    insight: 'Crowd conditions stable.',
  }
}

function deriveOperationalState(source) {
  const density = source.density || densityFromAdjusted(source.adjusted)
  const movement = source.movement
  const fused = fuseOperationalState(density, movement)
  return {
    density,
    movement,
    risk: fused.risk,
    threat: fused.threat,
    action: fused.action,
    stampede_risk: fused.stampede_risk,
    trigger_reason: source.trigger_reason || fused.trigger_reason,
    statusText: source.status && source.status !== 'idle' ? source.status : fused.statusText,
    insight: fused.insight,
  }
}

function normalizeClientMetrics(raw) {
  const next = { ...EMPTY_METRICS, ...(raw || {}) }
  if (!next.density) next.density = densityFromAdjusted(next.adjusted)
  if (next.density_score == null) next.density_score = next.adjusted
  if (next.motion_score == null) next.motion_score = next.motion
  const fused = deriveOperationalState(next)
  next.risk = fused.risk
  next.threat = fused.threat
  next.action = fused.action
  next.stampede_risk = fused.stampede_risk
  next.trigger_reason = next.trigger_reason || fused.trigger_reason
  return next
}

function preventionActionsForState(operational) {
  if (operational.stampede_risk || operational.risk === 'HIGH') {
    return [
      'Activate emergency protocol',
      'Dispatch security team',
      'Trigger public announcement',
      'Open emergency exits',
      'Dispatch ambulance',
      'Alert police/control room',
    ]
  }
  if (operational.risk === 'MEDIUM') {
    return [
      'Open additional exit gates',
      'Deploy crowd control staff',
      'Announce slow movement instructions',
      'Monitor zone closely',
    ]
  }
  return ['Continue monitoring', 'Maintain normal flow']
}

function EventTime() {
  return new Date().toLocaleTimeString()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toastForSeverity(severity, message, force = false) {
  if (!force && severity !== 'HIGH') return
  const tone =
    severity === 'HIGH'
      ? { color: '#ff6666', border: '1px solid rgba(255,51,51,0.45)', background: '#220b0b', boxShadow: '0 0 16px rgba(255,51,51,0.25)' }
      : severity === 'MEDIUM'
        ? { color: '#ffd07a', border: '1px solid rgba(255,170,0,0.45)', background: '#221607', boxShadow: '0 0 14px rgba(255,170,0,0.2)' }
        : { color: '#00ff41', border: '1px solid rgba(0,255,65,0.45)', background: '#08150b', boxShadow: '0 0 12px rgba(0,255,65,0.2)' }
  toast(message, { position: 'top-right', autoClose: 3400, style: tone })
}

function cardTone(feed, selected) {
  if (feed.status === 'EMPTY') {
    return selected ? 'border-[#00ff41]/45 shadow-[0_0_20px_rgba(0,255,65,0.2)]' : 'border-[#1a3a1a]'
  }
  if (feed.stampedeRisk || feed.risk === 'HIGH') {
    return selected
      ? 'border-[#ff3333]/75 shadow-[0_0_28px_rgba(255,51,51,0.36)] animate-pulse'
      : 'border-[#ff3333]/55 shadow-[0_0_16px_rgba(255,51,51,0.2)]'
  }
  if (feed.risk === 'MEDIUM') {
    return selected
      ? 'border-[#ffaa00]/75 shadow-[0_0_24px_rgba(255,170,0,0.3)]'
      : 'border-[#ffaa00]/50 shadow-[0_0_14px_rgba(255,170,0,0.18)]'
  }
  return selected
    ? 'border-[#00ff41]/70 shadow-[0_0_24px_rgba(0,255,65,0.25)]'
    : 'border-[#00ff41]/38 shadow-[0_0_12px_rgba(0,255,65,0.14)]'
}

function statusBadgeTone(status) {
  if (['LIVE', 'READY', 'LOOPING'].includes(status)) return 'border-[#00ff41]/45 bg-[#00ff41]/10 text-[#00ff41]'
  if (status === 'LOADING') return 'border-[#ffaa00]/45 bg-[#ffaa00]/12 text-[#ffd07a]'
  if (status === 'STOPPED') return 'border-[#ff3333]/35 bg-[#ff3333]/10 text-[#ff6666]'
  return 'border-[#1a3a1a] bg-[#0d140d] text-[#00cc33]'
}

function PreventionPanel({ actions, operational, compact = false }) {
  const isStampedeRisk = operational.stampede_risk || operational.risk === 'HIGH'
  const tone = isStampedeRisk
    ? 'border-[#ff3333]/50 bg-[#2a0b0b] text-[#ffb4b4]'
    : operational.risk === 'MEDIUM'
      ? 'border-[#ffaa00]/45 bg-[#221607] text-[#ffd07a]'
      : 'border-[#1a3a1a] bg-[#0d140d] text-[#00cc33]'

  return (
    <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold text-[#00ff41]">Prevention Actions</p>
        <span className={`rounded border px-2 py-1 text-[10px] font-semibold ${tone}`}>
          {isStampedeRisk ? 'STAMPEDE RISK' : operational.risk === 'MEDIUM' ? operational.threat || 'WATCH' : 'NORMAL'}
        </span>
      </div>
      <div className={`grid grid-cols-1 gap-2 ${compact ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
        {actions.map((action) => (
          <div key={action} className={`rounded-xl border p-3 text-sm font-semibold ${tone}`}>
            {action}
          </div>
        ))}
      </div>
    </article>
  )
}

function StampedeBanner({ operational, selectedFeedId, metrics }) {
  if (operational.stampede_risk) {
    return (
      <article className="rounded-2xl border border-[#ff3333]/75 bg-[#2a0707] p-4 text-[#ffdddd] shadow-[0_0_28px_rgba(255,51,51,0.34)]">
        <p className="text-xl font-bold">STAMPEDE RISK DETECTED - IMMEDIATE ACTION REQUIRED</p>
        <p className="mt-1 text-sm">
          Feed {selectedFeedId} | People {metrics.people ?? '--'} | Density {operational.density ?? '--'} | Movement {operational.movement ?? '--'} | Action {operational.action}
        </p>
      </article>
    )
  }
  if (operational.risk === 'MEDIUM') {
    return (
      <article className="rounded-2xl border border-[#ffaa00]/55 bg-[#221607] p-3 text-[#ffd07a]">
        Congestion warning - monitor zone.
      </article>
    )
  }
  return null
}

function AlarmControls({ alarmMuted, alarmActive, onMuteToggle, onTest, onStop }) {
  return (
    <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[#00ff41]">Emergency Alarm</p>
          <p className="text-xs text-[#00cc33]">{alarmActive ? 'Alarm playing' : alarmMuted ? 'Muted' : 'Armed for stampede-risk transition'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onMuteToggle} className="inline-flex items-center gap-2 rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-3 py-2 text-xs font-semibold text-[#00cc33] hover:bg-[#111a11]">
            {alarmMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            {alarmMuted ? 'Unmute' : 'Mute'}
          </button>
          <button type="button" onClick={onTest} className="rounded-lg border border-[#ffaa00]/45 bg-[#221607] px-3 py-2 text-xs font-semibold text-[#ffd07a] hover:bg-[#2d1c08]">
            Test Alarm
          </button>
          <button type="button" onClick={onStop} className="rounded-lg border border-[#ff3333]/45 bg-[#2a0b0b] px-3 py-2 text-xs font-semibold text-[#ff8888] hover:bg-[#391010]">
            Stop Alarm
          </button>
        </div>
      </div>
    </article>
  )
}

function feedStatusFromBackendState(state) {
  const s = String(state || '').toUpperCase()
  if (s === 'PROCESSING') return 'LOADING'
  if (s === 'LOOPING' || s === 'RUNNING') return 'LIVE'
  if (s === 'READY') return 'READY'
  if (s === 'UPLOADED') return 'UPLOADED'
  if (s === 'ERROR') return 'STOPPED'
  if (s === 'STOPPED') return 'STOPPED'
  if (s === 'IDLE') return 'STOPPED'
  return 'STOPPED'
}

function isStreamableState(state, processedFrames = 0, packetsCount = 0) {
  const s = String(state || '').toUpperCase()
  const hasFrames = Number(packetsCount || 0) > 0 || Number(processedFrames || 0) > 0
  return ['READY', 'LOOPING', 'RUNNING'].includes(s) || (s === 'STOPPED' && hasFrames)
}

function App() {
  const [activeModule, setActiveModule] = useState('dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedFeedId, setSelectedFeedId] = useState(1)
  const [backendHealthStatus, setBackendHealthStatus] = useState('checking')
  const backendHealthStatusRef = useRef('checking')

  const [backendStatus, setBackendStatus] = useState({
    state: 'IDLE',
    mode: 'prototype_buffered',
    message: 'Awaiting video upload',
    progress: 0,
    has_video: false,
    active_feed_id: 1,
    heatmap_enabled: false,
  })
  const [metrics, setMetrics] = useState(EMPTY_METRICS)
  const [analytics, setAnalytics] = useState([])
  const [alerts, setAlerts] = useState([])
  const [trends, setTrends] = useState(EMPTY_TRENDS)
  const [feeds, setFeeds] = useState(createFeedWall)

  const [streamEnabled, setStreamEnabled] = useState(false)
  const [monitoringActive, setMonitoringActive] = useState(false)
  const [canTriggerAlert, setCanTriggerAlert] = useState(false)
  const [bootStepMessage, setBootStepMessage] = useState('')
  const [debugVisuals, setDebugVisuals] = useState({
    heatmap: false,
    boxes: true,
    telemetry: true,
  })
  const [processingMode, setProcessingMode] = useState('')
  const [confidence, setConfidence] = useState({
    level: '--',
    text: 'Awaiting telemetry...',
  })
  const [emergencyProtocolActive, setEmergencyProtocolActive] = useState(false)
  const [responseElapsed, setResponseElapsed] = useState(0)
  const [alarmMuted, setAlarmMuted] = useState(false)
  const [alarmActive, setAlarmActive] = useState(false)
  const [incidentTimeline, setIncidentTimeline] = useState([])

  const lastFrameIdsRef = useRef({})
  const previousMetricsByFeedRef = useRef({})
  const previousDensityRef = useRef(null)
  const previousMovementRef = useRef(null)
  const previousRiskRef = useRef(null)
  const previousMotionRef = useRef(null)
  const previousStampedeRiskRef = useRef(false)
  const transitionArmedRef = useRef(false)
  const confidenceSamplesRef = useRef([])
  const previousSystemStateRef = useRef({})
  const streamableFeedsRef = useRef({})
  const selectedFeedIdRef = useRef(1)
  const alertAudioRef = useRef(null)
  const alarmFallbackRef = useRef(null)
  const lastNotificationRef = useRef({ severity: '', message: '', at: 0 })
  const criticalSinceRef = useRef(null)
  const backendAlertInFlightRef = useRef(false)
  const lastBackendOfflineLogRef = useRef(0)

  const addIncidentEvent = useCallback((message, timestamp = EventTime()) => {
    setIncidentTimeline((prev) => [{ message, timestamp, feedId: selectedFeedIdRef.current }, ...prev].slice(0, 60))
  }, [])

  const markBackendOnline = useCallback((source, details = {}) => {
    if (backendHealthStatusRef.current !== 'online') {
      debugLog('backend status online', { source, ...details })
    }
    backendHealthStatusRef.current = 'online'
    setBackendHealthStatus('online')
  }, [])

  const markBackendOffline = useCallback((source, error) => {
    const now = Date.now()
    const message = error?.message || String(error || 'Backend unavailable')
    if (backendHealthStatusRef.current !== 'offline' || now - lastBackendOfflineLogRef.current >= BACKEND_RETRY_INTERVAL_MS) {
      debugLog('backend status offline', { source, error: message, retry_ms: BACKEND_RETRY_INTERVAL_MS })
      lastBackendOfflineLogRef.current = now
    }

    backendHealthStatusRef.current = 'offline'
    setBackendHealthStatus('offline')

    if (backendAlertInFlightRef.current) {
      debugLog('email alert skipped', { reason: 'send_in_flight' })
      return
    }

    let alertAlreadySent = false
    try {
      alertAlreadySent = localStorage.getItem(BACKEND_ALERT_SENT_KEY) === 'true'
    } catch (storageError) {
      debugLog('email alert storage check failed', { error: storageError.message })
    }

    if (alertAlreadySent) {
      debugLog('email alert skipped', { reason: 'already_sent' })
      return
    }

    backendAlertInFlightRef.current = true
    sendAlert()
      .then((sent) => {
        if (!sent) return
        try {
          localStorage.setItem(BACKEND_ALERT_SENT_KEY, 'true')
        } catch (storageError) {
          debugLog('email alert storage save failed', { error: storageError.message })
        }
        debugLog('email alert sent', { reason: 'backend_offline', source })
      })
      .catch((emailError) => {
        debugLog('email alert failed', {
          source,
          error: emailError?.message || String(emailError),
          status: emailError?.status || 'unknown',
          text: emailError?.text || '',
        })
      })
      .finally(() => {
        backendAlertInFlightRef.current = false
      })
  }, [])

  useEffect(() => {
    let cancelled = false

    const checkBackendHealth = async () => {
      try {
        debugLog('backend health check start', { endpoint: '/health' })
        const response = await fetch(`${API_BASE_URL}/health`, { cache: 'no-store' })
        const data = await readApiJson(response, { action: 'health_check', endpoint: '/health' })

        if (!response.ok || data.status !== 'ok') {
          throw new Error(data.status || `HTTP ${response.status}`)
        }

        if (cancelled) return
        markBackendOnline('health_check', { status: data.status })
      } catch (error) {
        if (cancelled) return
        markBackendOffline('health_check', error)
      }
    }

    checkBackendHealth()
    return () => {
      cancelled = true
    }
  }, [markBackendOffline, markBackendOnline])

  useEffect(() => {
    selectedFeedIdRef.current = selectedFeedId
  }, [selectedFeedId])

  const playFallbackBeep = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return
      const ctx = new AudioContext()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sawtooth'
      oscillator.frequency.setValueAtTime(880, ctx.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.9)
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.1)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start()
      oscillator.stop(ctx.currentTime + 1.15)
      alarmFallbackRef.current = ctx
      setTimeout(() => ctx.close().catch(() => {}), 1300)
    } catch {
      // Browser audio fallback is best-effort.
    }
  }, [])

  const stopAlarm = useCallback(() => {
    if (alertAudioRef.current) {
      alertAudioRef.current.pause()
      alertAudioRef.current.currentTime = 0
    }
    if (alarmFallbackRef.current?.state !== 'closed') {
      alarmFallbackRef.current.close?.().catch(() => {})
    }
    setAlarmActive(false)
  }, [])

  const playAlarm = useCallback(
    (force = false) => {
      if (alarmMuted && !force) return
      setAlarmActive(true)
      const audio = alertAudioRef.current
      if (audio) {
        audio.loop = false
        audio.currentTime = 0
        audio.play()
          .then(() => {
            window.setTimeout(() => {
              if (alertAudioRef.current) {
                alertAudioRef.current.pause()
                alertAudioRef.current.currentTime = 0
              }
              setAlarmActive(false)
            }, 4500)
          })
          .catch(() => {
            playFallbackBeep()
            window.setTimeout(() => setAlarmActive(false), 1400)
          })
        return
      }
      playFallbackBeep()
      window.setTimeout(() => setAlarmActive(false), 1400)
    },
    [alarmMuted, playFallbackBeep],
  )

  const pushNotification = (severity, message, timestamp = EventTime(), toastNow = false, options = {}) => {
    const now = Date.now()
    const last = lastNotificationRef.current
    if (last.severity === severity && last.message === message && now - last.at < 1400) {
      return
    }
    lastNotificationRef.current = { severity, message, at: now }
    debugLog('notification', { severity, message })
    setAlerts((prev) => [{ severity, message, timestamp, criticalRisk: Boolean(options.criticalRisk) }, ...prev].slice(0, 120))
    if (toastNow || severity === 'HIGH') {
      toastForSeverity(severity, message, toastNow)
    }
  }

  const resetTransitionTrackers = () => {
    setCanTriggerAlert(false)
    transitionArmedRef.current = false
    previousDensityRef.current = null
    previousMovementRef.current = null
    previousRiskRef.current = null
    previousMotionRef.current = null
    previousStampedeRiskRef.current = false
    confidenceSamplesRef.current = []
  }

  const bumpFeedStreamKey = (feedId, includeDebug = true) => {
    const nextKey = Date.now()
    setFeeds((prev) =>
      prev.map((feed) =>
        feed.id === feedId
          ? {
              ...feed,
              streamKey: nextKey,
              debugStreamKey: includeDebug ? nextKey : feed.debugStreamKey,
            }
          : feed,
      ),
    )
    return nextKey
  }

  const handleFeedSelection = (nextFeed) => {
    const nextFeedId = resolveFeedId(nextFeed)
    debugLog('feed selected', { feed_id: nextFeedId })
    setSelectedFeedId(nextFeedId)
    bumpFeedStreamKey(nextFeedId)
    resetTransitionTrackers()

    const feed = feeds.find((item) => item.id === nextFeedId)
    if (feed) {
      setBackendStatus((prev) => ({
        ...prev,
        feed_id: nextFeedId,
        active_feed_id: nextFeedId,
        state: feed.backendState || 'IDLE',
        has_video: Boolean(feed.hasBackendVideo || feed.videoUrl),
        processed_frames: feed.processedFrames,
        packets_count: feed.packetsCount,
        total_frames: feed.totalFrames,
        message: feed.message || prev.message,
        progress: isStreamableState(feed.backendState, feed.processedFrames, feed.packetsCount) ? 100 : (progressFromMessage(feed.message) ?? prev.progress),
      }))
      setStreamEnabled(isStreamableState(feed.backendState, feed.processedFrames, feed.packetsCount))
    }
  }

  const operational = useMemo(() => deriveOperationalState(metrics), [metrics])
  const selectedFeedDetails = useMemo(
    () => feeds.find((feed) => feed.id === selectedFeedId) || createFeed(selectedFeedId),
    [feeds, selectedFeedId],
  )
  const selectedFeedValue = feedSelectValue(selectedFeedId)
  const selectedCleanStreamKey = selectedFeedDetails.streamKey || 0
  const selectedDebugStreamKey = selectedFeedDetails.debugStreamKey || selectedCleanStreamKey
  const selectedStreamStatus = useMemo(
    () => {
      const backendFeedId = Number(backendStatus.feed_id ?? backendStatus.active_feed_id ?? selectedFeedId)
      const backendMatchesSelected = backendFeedId === selectedFeedId
      const backendState = backendMatchesSelected ? backendStatus.state : null
      const resolvedState = String(backendState || selectedFeedDetails.backendState || 'IDLE').toUpperCase()
      const backendProgress = Number(backendStatus.progress ?? 0)
      const fallbackProgress = progressFromMessage(selectedFeedDetails.message)
      const resolvedProgress = backendMatchesSelected
        ? (Number.isFinite(backendProgress) && backendProgress > 0 ? backendProgress : (fallbackProgress ?? 0))
        : (isStreamableState(selectedFeedDetails.backendState, selectedFeedDetails.processedFrames, selectedFeedDetails.packetsCount) ? 100 : (fallbackProgress ?? 0))
      const finalProgress = resolvedState === 'READY' ? 100 : resolvedProgress
      return {
        ...backendStatus,
        feed_id: selectedFeedId,
        active_feed_id: selectedFeedId,
        state: resolvedState,
        backendState: resolvedState,
        processed_frames: backendMatchesSelected ? (backendStatus.processed_frames ?? selectedFeedDetails.processedFrames) : selectedFeedDetails.processedFrames,
        packets_count: backendMatchesSelected ? (backendStatus.packets_count ?? selectedFeedDetails.packetsCount) : selectedFeedDetails.packetsCount,
        progress: finalProgress,
        has_video: Boolean(selectedFeedDetails.hasBackendVideo || selectedFeedDetails.videoUrl || (backendMatchesSelected && backendStatus.has_video)),
        message: selectedFeedDetails.message || (backendMatchesSelected ? backendStatus.message : '') || 'Awaiting video upload',
      }
    },
    [backendStatus, selectedFeedDetails, selectedFeedId],
  )
  const handleStorageMetricsSync = useCallback((row) => {
    if (!row) return
    const nextMetrics = normalizeClientMetrics(row)
    setMetrics(nextMetrics)
    setFeeds((prev) =>
      prev.map((feed) =>
        feed.id === Number(nextMetrics.feed_id || selectedFeedId)
          ? {
              ...feed,
              people: nextMetrics.people,
              density: nextMetrics.density,
              movement: nextMetrics.movement,
              risk: nextMetrics.risk,
              threat: nextMetrics.threat,
              action: nextMetrics.action,
              stampedeRisk: Boolean(nextMetrics.stampede_risk),
              triggerReason: nextMetrics.trigger_reason,
              fps: nextMetrics.fps,
              timestamp: toTimestampLabel(nextMetrics.timestamp),
            }
          : feed,
      ),
    )
  }, [selectedFeedId])
  const baseIncidentLevel = useMemo(() => {
    if (operational.stampede_risk || operational.risk === 'HIGH') return 'CRITICAL'
    if (operational.threat === 'WARNING') return 'WARNING'
    if (operational.risk === 'MEDIUM') return 'WATCH'
    return 'NORMAL'
  }, [operational.risk, operational.stampede_risk, operational.threat])
  const incidentLevel = emergencyProtocolActive ? 'CRITICAL' : baseIncidentLevel
  const emergencyRoomActive = operational.stampede_risk || emergencyProtocolActive
  const preventionActions = useMemo(() => preventionActionsForState(operational), [operational])

  const emergencyExplanation = useMemo(() => {
    if (!selectedFeedDetails.videoUrl && !selectedFeedDetails.hasBackendVideo) return `Selected Feed ${selectedFeedId} is stable. No emergency intervention required.`
    if (operational.stampede_risk || operational.risk === 'HIGH') return `Selected Feed ${selectedFeedId} has stampede-risk conditions. Immediate response recommended.`
    if (operational.risk === 'MEDIUM') return `Selected Feed ${selectedFeedId} requires monitoring due to elevated density or movement.`
    return `Selected Feed ${selectedFeedId} is stable. No emergency intervention required.`
  }, [operational.density, operational.movement, operational.risk, operational.stampede_risk, selectedFeedDetails.hasBackendVideo, selectedFeedDetails.videoUrl])

  const selectedIncidentTimeline = useMemo(
    () => incidentTimeline.filter((item) => Number(item.feedId || 0) === selectedFeedId),
    [incidentTimeline, selectedFeedId],
  )

  useEffect(() => {
    let cancelled = false
    let timeoutId = null

    const pollStatus = async () => {
      let nextDelay = STATUS_POLL_INTERVAL_MS
      try {
        const feedIdsToPoll = backendHealthStatusRef.current === 'offline' ? [selectedFeedId] : FEED_IDS
        const statuses = await Promise.all(
          feedIdsToPoll.map(async (fid) => {
            try {
              const res = await fetch(`${API_BASE_URL}/status?feed_id=${fid}`)
              if (!res.ok) return null
              const data = await res.json()
              return { ...data, feed_id: fid, state: String(data.state || 'IDLE').toUpperCase() }
            } catch {
              return null
            }
          }),
        )
        if (cancelled) return
        const activeStatuses = statuses.filter(Boolean)
        if (!activeStatuses.length) {
          nextDelay = BACKEND_RETRY_INTERVAL_MS
          markBackendOffline('status_poll', new Error('No /status response from backend'))
          setBackendStatus((prev) => ({
            ...prev,
            state: 'IDLE',
            message: 'Backend unavailable. Retrying in 5 seconds.',
          }))
          return
        }
        markBackendOnline('status_poll')
        let selectedStatus = activeStatuses.find((item) => Number(item.feed_id) === selectedFeedId)
        if (!selectedStatus) return
        const selectedProgress = Number(selectedStatus.progress)
        if (!Number.isFinite(selectedProgress) || selectedProgress <= 0) {
          try {
            const debugRes = await fetch(`${API_BASE_URL}/debug/feed-state?feed_id=${selectedFeedId}`)
            if (debugRes.ok) {
              const debugData = await debugRes.json()
              if (debugData && Number.isFinite(Number(debugData.progress))) {
                selectedStatus = { ...selectedStatus, progress: Number(debugData.progress) }
              }
            }
          } catch {
            // fallback is best-effort
          }
        }
        const statusState = String(selectedStatus.state || 'IDLE').toUpperCase()
        const selectedWasStreamable = Boolean(streamableFeedsRef.current[selectedFeedId])
        const selectedNowStreamable = isStreamableState(statusState, selectedStatus.processed_frames, selectedStatus.packets_count)

        setBackendStatus({ ...selectedStatus, state: statusState })
        setProcessingMode((currentMode) => {
          if (!currentMode && !selectedStatus.has_video) return ''
          const backendMode = selectedStatus.mode || currentMode
          return backendMode === MODE_CONTINUOUS ? MODE_CONTINUOUS : MODE_PROTOTYPE
        })
        setDebugVisuals({
          heatmap: Boolean(selectedStatus.heatmap_enabled),
          boxes: selectedStatus.debug_boxes_enabled !== false,
          telemetry: selectedStatus.debug_telemetry_enabled !== false,
        })
        setStreamEnabled(selectedNowStreamable)
        if (selectedNowStreamable && !selectedWasStreamable) {
          bumpFeedStreamKey(selectedFeedId)
        }

        setFeeds((prev) =>
          prev.map((feed) => {
            const status = activeStatuses.find((item) => Number(item.feed_id) === feed.id)
            if (!status) return feed
            const nextBackendState = String(status.state || 'IDLE').toUpperCase()
            const nextProcessedFrames = Number(status.processed_frames || 0)
            const nextPacketsCount = Number(status.packets_count || 0)
            const hasBackendVideo = Boolean(status.has_video)
            const wasStreamable = isStreamableState(feed.backendState, feed.processedFrames, feed.packetsCount)
            const nowStreamable = isStreamableState(nextBackendState, nextProcessedFrames, nextPacketsCount)
            const next = { ...feed }
            next.backendState = nextBackendState
            next.videoId = status.video_id || next.videoId
            next.hasBackendVideo = hasBackendVideo
            next.processedFrames = nextProcessedFrames
            next.packetsCount = nextPacketsCount
            next.totalFrames = Number(status.total_frames || 0)
            next.message = status.message || next.message
            if (!next.videoUrl && !hasBackendVideo) {
              next.status = 'EMPTY'
              return next
            }
            next.status = feedStatusFromBackendState(nextBackendState)
            if (nowStreamable && !wasStreamable) {
              next.streamKey = Date.now()
              next.debugStreamKey = next.streamKey
            }
            return next
          }),
        )

        activeStatuses.forEach((status) => {
          const fid = Number(status.feed_id)
          const nextState = String(status.state || 'IDLE').toUpperCase()
          const previousState = previousSystemStateRef.current[fid]
          const isLive = nextState === 'RUNNING' || nextState === 'LOOPING'
          const wasLive = previousState === 'RUNNING' || previousState === 'LOOPING'
          if (!wasLive && isLive) {
            pushNotification('LOW', `Feed ${fid} is now LIVE`)
          }
          previousSystemStateRef.current[fid] = nextState
          streamableFeedsRef.current[fid] = isStreamableState(nextState, status.processed_frames, status.packets_count)
        })
      } catch (error) {
        if (cancelled) return
        nextDelay = BACKEND_RETRY_INTERVAL_MS
        markBackendOffline('status_poll', error)
        setBackendStatus((prev) => ({
          ...prev,
          state: 'IDLE',
          message: 'Backend unavailable. Retrying in 5 seconds.',
        }))
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(pollStatus, nextDelay)
        }
      }
    }

    pollStatus()
    return () => {
      cancelled = true
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [markBackendOffline, markBackendOnline, selectedFeedId])

  useEffect(() => {
    let cancelled = false
    let timeoutId = null

    const pollData = async () => {
      let nextDelay = DATA_POLL_INTERVAL_MS
      try {
        if (backendHealthStatus === 'offline') {
          nextDelay = BACKEND_RETRY_INTERVAL_MS
          return
        }

        const responses = await Promise.all(
          FEED_IDS.map(async (fid) => {
            try {
              const res = await fetch(`${API_BASE_URL}/data?feed_id=${fid}`)
              if (!res.ok) return null
              const data = await res.json()
              return normalizeClientMetrics({ ...data, feed_id: fid })
            } catch {
              return null
            }
          }),
        )
        if (cancelled) return
        const validResponses = responses.filter(Boolean)
        if (!validResponses.length) {
          nextDelay = BACKEND_RETRY_INTERVAL_MS
          markBackendOffline('data_poll', new Error('No /data response from backend'))
          return
        }
        markBackendOnline('data_poll')
        const metricsByFeed = new Map(validResponses.map((item) => [Number(item.feed_id || 1), item]))
        const data = metricsByFeed.get(selectedFeedId)
        if (!data) return
        const lastFrameForFeed = Number(lastFrameIdsRef.current[selectedFeedId] || 0)
        if (typeof data.frame_id === 'number' && data.frame_id > 0) {
          if (data.frame_id !== lastFrameForFeed) {
            lastFrameIdsRef.current[selectedFeedId] = data.frame_id
            const nextMetrics = data
            const previous = previousMetricsByFeedRef.current[selectedFeedId] || null
            if (previous) {
              setTrends({
                people: trendNumber(nextMetrics.people, previous.people),
                density: trendEnum(nextMetrics.density, previous.density, { LOW: 1, MEDIUM: 2, HIGH: 3 }),
                movement: trendEnum(nextMetrics.movement, previous.movement, { NORMAL: 1, ABNORMAL: 2 }),
                risk: trendEnum(deriveOperationalState(nextMetrics).risk, deriveOperationalState(previous).risk, { LOW: 1, MEDIUM: 2, HIGH: 3 }),
              })
            } else {
              setTrends(EMPTY_TRENDS)
            }
            previousMetricsByFeedRef.current[selectedFeedId] = nextMetrics
            setMetrics(nextMetrics)
          }
        } else if (lastFrameForFeed === 0) {
          previousMetricsByFeedRef.current[selectedFeedId] = data
          setMetrics(data)
        }

        setFeeds((prev) =>
          prev.map((feed) => {
            const feedMetrics = metricsByFeed.get(feed.id)
            if (!feedMetrics || typeof feedMetrics.frame_id !== 'number' || feedMetrics.frame_id <= 0) {
              return feed
            }
            return {
              ...feed,
              people: feedMetrics.people,
              density: feedMetrics.density,
              movement: feedMetrics.movement,
              risk: feedMetrics.risk,
              threat: feedMetrics.threat,
              action: feedMetrics.action,
              stampedeRisk: Boolean(feedMetrics.stampede_risk),
              triggerReason: feedMetrics.trigger_reason,
              fps: feedMetrics.fps,
              timestamp: toTimestampLabel(feedMetrics.timestamp),
            }
          }),
        )
      } catch (error) {
        nextDelay = BACKEND_RETRY_INTERVAL_MS
        markBackendOffline('data_poll', error)
        // Keep current view stable when backend is optional.
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(pollData, nextDelay)
        }
      }
    }

    pollData()
    return () => {
      cancelled = true
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [backendHealthStatus, markBackendOffline, markBackendOnline, selectedFeedId])

  useEffect(() => {
    let cancelled = false
    let timeoutId = null

    const pollAnalytics = async () => {
      let nextDelay = ANALYTICS_POLL_INTERVAL_MS
      try {
        if (backendHealthStatus === 'offline') {
          nextDelay = BACKEND_RETRY_INTERVAL_MS
          return
        }

        const res = await fetch(`${API_BASE_URL}/analytics?feed_id=${selectedFeedId}`)
        if (!res.ok) {
          nextDelay = BACKEND_RETRY_INTERVAL_MS
          throw new Error(`Analytics request failed with HTTP ${res.status}`)
        }
        const data = await res.json()
        if (cancelled) return
        markBackendOnline('analytics_poll')
        if (Array.isArray(data)) {
          setAnalytics(data)
        } else if (Array.isArray(data?.history)) {
          setAnalytics(data.history)
        } else {
          setAnalytics([])
        }
      } catch (error) {
        nextDelay = BACKEND_RETRY_INTERVAL_MS
        markBackendOffline('analytics_poll', error)
        // keep existing graph view
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(pollAnalytics, nextDelay)
        }
      }
    }

    pollAnalytics()
    return () => {
      cancelled = true
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [backendHealthStatus, markBackendOffline, markBackendOnline, selectedFeedId])

  useEffect(() => {
    const statusState = String(selectedStreamStatus.state || '').toUpperCase()
    if (!monitoringActive || !['RUNNING', 'LOOPING'].includes(statusState) || !operational.risk) return

    const timestamp = toTimestampLabel(metrics.timestamp) === '--' ? EventTime() : toTimestampLabel(metrics.timestamp)
    const currentStampedeRisk = Boolean(operational.stampede_risk)
    if (!transitionArmedRef.current || !canTriggerAlert) {
      previousDensityRef.current = operational.density
      previousMovementRef.current = operational.movement
      previousRiskRef.current = operational.risk
      previousMotionRef.current = metrics.motion
      previousStampedeRiskRef.current = currentStampedeRisk
      transitionArmedRef.current = true
      setCanTriggerAlert(true)
      return
    }

    const previousDensity = previousDensityRef.current
    const previousMovement = previousMovementRef.current
    const previousRisk = previousRiskRef.current
    const previousMotion = previousMotionRef.current
    const previousStampedeRisk = previousStampedeRiskRef.current

    const nextEvents = []
    if (previousDensity && previousDensity !== operational.density) {
      const isEscalation = operational.density === 'HIGH' || (previousDensity === 'LOW' && operational.density === 'MEDIUM')
      const densityMessage = isEscalation ? `Feed ${selectedFeedId}: Density Increased -> ${operational.density}` : `Feed ${selectedFeedId}: Density Reduced -> ${operational.density}`
      nextEvents.push({
        severity: operational.density === 'HIGH' ? 'MEDIUM' : operational.density === 'MEDIUM' ? 'MEDIUM' : 'LOW',
        message: densityMessage,
        timestamp,
        toastNow: true,
      })
    }
    if (previousMovement && previousMovement !== operational.movement) {
      const movementMessage = operational.movement === 'ABNORMAL' ? `Feed ${selectedFeedId}: Motion Spike Detected` : `Feed ${selectedFeedId}: Movement Stabilized`
      nextEvents.push({
        severity: operational.movement === 'ABNORMAL' ? 'MEDIUM' : 'LOW',
        message: movementMessage,
        timestamp,
        toastNow: operational.movement === 'ABNORMAL',
      })
    }
    if (previousRisk && previousRisk !== operational.risk) {
      const riskMessage =
        operational.risk === 'HIGH'
          ? `Feed ${selectedFeedId}: Stampede Risk Escalated -> HIGH`
          : operational.risk === 'MEDIUM'
            ? `Feed ${selectedFeedId}: Risk Transition -> MEDIUM`
            : `Feed ${selectedFeedId}: Risk Reduced -> LOW`
      nextEvents.push({
        severity: operational.risk === 'HIGH' ? 'HIGH' : operational.risk === 'MEDIUM' ? 'MEDIUM' : 'LOW',
        message: riskMessage,
        timestamp,
        criticalRisk: operational.risk === 'HIGH' || operational.stampede_risk,
        toastNow: true,
      })
    }
    if (typeof previousMotion === 'number' && typeof metrics.motion === 'number' && metrics.motion > 12 && metrics.motion > previousMotion * 1.45) {
      const motionMessage = `Feed ${selectedFeedId}: Motion Spike Detected`
      nextEvents.push({
        severity: 'HIGH',
        message: motionMessage,
        timestamp,
        criticalRisk: true,
        toastNow: true,
      })
    }

    if (!previousStampedeRisk && currentStampedeRisk) {
      playAlarm()
      setEmergencyProtocolActive(true)
      const detailMessage = [
        `Feed ${selectedFeedId} | Zone A`,
        `People: ${metrics.people ?? '--'}`,
        `Density: ${operational.density ?? '--'}`,
        `Movement: ${operational.movement ?? '--'}`,
        `Time: ${timestamp}`,
        `Action: ${operational.action}`,
      ].join(' | ')
      nextEvents.push({
        severity: 'HIGH',
        message: 'Stampede risk detected: High density + abnormal movement.',
        timestamp,
        criticalRisk: true,
        toastNow: true,
      })
      addIncidentEvent('density threshold crossed', timestamp)
      addIncidentEvent('abnormal movement detected', timestamp)
      addIncidentEvent('stampede risk triggered', timestamp)
      addIncidentEvent('alarm sounded', timestamp)
      toastForSeverity('HIGH', detailMessage, true)
    } else if (operational.risk === 'MEDIUM' && previousRisk !== 'MEDIUM') {
      nextEvents.push({
        severity: 'MEDIUM',
        message: `Feed ${selectedFeedId}: Congestion warning - monitor zone.`,
        timestamp,
        toastNow: true,
      })
    }

    if (nextEvents.length) {
      nextEvents.forEach((evt) => pushNotification(evt.severity, evt.message, evt.timestamp, Boolean(evt.toastNow), { criticalRisk: evt.criticalRisk }))
    }

    previousDensityRef.current = operational.density
    previousMovementRef.current = operational.movement
    previousRiskRef.current = operational.risk
    previousMotionRef.current = metrics.motion
    previousStampedeRiskRef.current = currentStampedeRisk
  }, [addIncidentEvent, canTriggerAlert, metrics.motion, metrics.people, metrics.timestamp, monitoringActive, operational, playAlarm, selectedFeedId, selectedStreamStatus.state])

  useEffect(() => {
    if (typeof metrics.frame_id !== 'number' || metrics.frame_id <= 0) return
    const sample = {
      people: typeof metrics.people === 'number' ? metrics.people : 0,
      motion: typeof metrics.motion === 'number' ? metrics.motion : 0,
    }
    const next = [...confidenceSamplesRef.current, sample].slice(-12)
    confidenceSamplesRef.current = next
    if (next.length < 4) {
      setConfidence({ level: 'MEDIUM', text: 'Moderate fluctuation detected' })
      return
    }

    const peopleValues = next.map((entry) => entry.people)
    const motionValues = next.map((entry) => entry.motion)
    const peopleRange = Math.max(...peopleValues) - Math.min(...peopleValues)
    const motionRange = Math.max(...motionValues) - Math.min(...motionValues)
    const avgPeople = peopleValues.reduce((sum, value) => sum + value, 0) / peopleValues.length

    if (avgPeople < 3 || peopleRange > 42 || motionRange > 14) {
      setConfidence({ level: 'LOW', text: 'Uncertain detection conditions' })
      return
    }
    if (peopleRange <= 12 && motionRange <= 4) {
      setConfidence({ level: 'HIGH', text: 'Stable crowd pattern' })
      return
    }
    setConfidence({ level: 'MEDIUM', text: 'Moderate fluctuation detected' })
  }, [metrics.frame_id, metrics.people, metrics.motion])

  useEffect(() => {
    if (operational.stampede_risk || emergencyProtocolActive) {
      if (!criticalSinceRef.current) criticalSinceRef.current = Date.now()
    } else {
      criticalSinceRef.current = null
    }
  }, [emergencyProtocolActive, operational.stampede_risk])

  useEffect(() => {
    const tick = () => {
      if (!criticalSinceRef.current) {
        setResponseElapsed(0)
        return
      }
      setResponseElapsed(Math.max(0, Math.floor((Date.now() - criticalSinceRef.current) / 1000)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const handleUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const assignedFeedId = selectedFeedId
    if (!processingMode) {
      debugLog('upload blocked', { reason: 'mode_required', feed_id: assignedFeedId })
      setBackendStatus((prev) => ({ ...prev, message: 'Select a processing mode before uploading video.' }))
      toastForSeverity('MEDIUM', 'Select a processing mode before uploading video.', true)
      if (event?.target) {
        event.target.value = ''
      }
      return
    }

    try {
      debugLog('upload start', { feed_id: assignedFeedId, file: file.name, mode: processingMode })
      const uploadForm = new FormData()
      uploadForm.append('file', file)
      const uploadRes = await fetch(`${API_BASE_URL}/video/upload?feed_id=${assignedFeedId}`, { method: 'POST', body: uploadForm })
      const data = await readApiJson(uploadRes, { action: 'upload', endpoint: '/video/upload', feed_id: assignedFeedId })
      debugLog('upload response', {
        feed_id: assignedFeedId,
        http_status: uploadRes.status,
        backend_status: data?.status || 'missing',
        message: data?.message || '',
        mode: processingMode,
      })
      if (!uploadRes.ok) {
        throw new Error(data?.message || 'Upload failed')
      }

      const uploadBackendStatus = String(data.status || '').toLowerCase()
      const uploadStartedProcessing = uploadBackendStatus.includes('processing')
      const uploadQueued = uploadBackendStatus === 'queued'
      const uploadProcessingProblem = uploadStartedProcessing
        ? ''
        : uploadQueued
          ? 'Another feed is already processing. This upload was queued by the backend.'
          : processingMode === MODE_CONTINUOUS
            ? 'Continuous Monitoring mode saves the upload first. Click Start Feed to begin processing.'
            : `Backend returned "${data.status || 'unknown'}" instead of "processing_started".`
      if (uploadProcessingProblem) {
        debugLog('processing not started after upload', {
          feed_id: assignedFeedId,
          problem: uploadProcessingProblem,
          next_action: uploadQueued ? 'wait_for_queue' : 'click_start_feed',
        })
      } else {
        debugLog('processing started after upload', { feed_id: assignedFeedId })
        debugLog('processing start', { feed_id: assignedFeedId, video_id: data.video_id || null, source: 'upload' })
      }

      const uploadedState = uploadStartedProcessing ? 'PROCESSING' : 'UPLOADED'
      const uploadedUiStatus = uploadedState === 'PROCESSING' ? 'LOADING' : 'UPLOADED'
      const uploadMessage = data.message || (uploadStartedProcessing ? 'Processing uploaded video' : 'Video uploaded. Click Start Feed to begin processing.')
      const nextStreamKey = Date.now()
      setFeeds((prev) =>
        prev.map((feed) =>
          feed.id === assignedFeedId
            ? {
                ...feed,
                videoUrl: null,
                sourceFile: file,
                videoId: data.video_id || null,
                status: uploadedUiStatus,
                backendState: uploadedState,
                hasBackendVideo: true,
                processedFrames: 0,
                packetsCount: 0,
                totalFrames: 0,
                streamKey: nextStreamKey,
                debugStreamKey: nextStreamKey,
                message: uploadMessage,
                people: null,
                density: null,
                movement: null,
                risk: null,
                threat: 'STANDBY',
                action: 'WAITING',
                stampedeRisk: false,
                triggerReason: 'Awaiting detection',
                fps: null,
                timestamp: '--',
              }
            : feed,
        ),
      )
      handleFeedSelection(`feed-${assignedFeedId}`)
      setActiveModule(uploadStartedProcessing || uploadQueued ? 'monitoring' : 'dashboard')
      setMonitoringActive(false)
      setCanTriggerAlert(false)
      setMetrics(EMPTY_METRICS)
      setTrends(EMPTY_TRENDS)
      previousDensityRef.current = null
      previousMovementRef.current = null
      previousRiskRef.current = null
      previousMotionRef.current = null
      previousStampedeRiskRef.current = false
      transitionArmedRef.current = false
      confidenceSamplesRef.current = []
      setConfidence({ level: '--', text: 'Awaiting telemetry...' })
      previousMetricsByFeedRef.current[assignedFeedId] = null
      setBackendStatus((prev) => ({
        ...prev,
        feed_id: assignedFeedId,
        state: uploadedState,
        has_video: true,
        video_id: data.video_id || null,
        mode: processingMode,
        message: uploadMessage,
        progress: 0,
      }))
      setStreamEnabled(false)
      lastFrameIdsRef.current[assignedFeedId] = 0
      debugLog('upload complete', { feed_id: assignedFeedId, video_id: data.video_id || null, status: uploadedState })
      debugLog('upload success', { feed_id: assignedFeedId, status: uploadedState })
      const uploadNotification = uploadStartedProcessing
        ? `Processing started for Feed ${assignedFeedId}`
        : uploadQueued
          ? `Video uploaded for Feed ${assignedFeedId} and queued for processing.`
          : `Video uploaded for Feed ${assignedFeedId}. Start Feed is ready.`
      pushNotification('LOW', uploadNotification)
    } catch (error) {
      debugLog('upload failed', { feed_id: assignedFeedId, error: error.message || 'Backend not reachable.' })
      setBackendStatus((prev) => ({ ...prev, message: error.message || 'Upload failed. Backend not reachable.' }))
      pushNotification('HIGH', `Upload failed for Feed ${assignedFeedId}: ${error.message || 'Backend not reachable.'}`, EventTime(), true, { criticalRisk: false })
    } finally {
      if (event?.target) {
        event.target.value = ''
      }
    }
  }

  const handleStart = async () => {
    debugLog('start feed requested', { feed_id: selectedFeedId, mode: processingMode || 'not_selected' })
    if (!processingMode) {
      debugLog('start feed blocked', { reason: 'mode_required', feed_id: selectedFeedId })
      setBackendStatus((prev) => ({ ...prev, message: 'Select a processing mode before starting feed.' }))
      toastForSeverity('MEDIUM', 'Select a processing mode before starting feed.', true)
      return
    }
    const currentFeed = feeds.find((feed) => feed.id === selectedFeedId)
    const selectedHasBackendVideo = Boolean(currentFeed?.hasBackendVideo || backendStatus.has_video)
    if (!currentFeed?.videoUrl && !selectedHasBackendVideo) {
      debugLog('start feed blocked', { reason: 'video_required', feed_id: selectedFeedId })
      setBackendStatus((prev) => ({ ...prev, message: 'No active surveillance feed in selected slot' }))
      return
    }

    bumpFeedStreamKey(selectedFeedId)
    setBackendStatus((prev) => ({ ...prev, state: 'PROCESSING', message: `Starting feed ${selectedFeedId}...`, progress: 10 }))
    setFeeds((prev) =>
      prev.map((feed) =>
        feed.id === selectedFeedId
          ? { ...feed, status: 'LOADING', backendState: 'PROCESSING', message: `Starting feed ${selectedFeedId}...` }
          : feed,
      ),
    )

    const runBootSequence = async () => {
      const steps = [
        'Initializing Monitoring Engine...',
        'Calibrating Crowd Detection...',
        'Starting Live Monitoring...',
      ]
      for (const step of steps) {
        setBootStepMessage(step)
        await sleep(500)
      }
      setBootStepMessage('')
    }
    const bootSequenceTask = runBootSequence()

    try {
      if (currentFeed?.sourceFile && !selectedHasBackendVideo) {
        const uploadForm = new FormData()
        uploadForm.append('file', currentFeed.sourceFile)
        const uploadRes = await fetch(`${API_BASE_URL}/video/upload?feed_id=${selectedFeedId}`, { method: 'POST', body: uploadForm })
        if (uploadRes.ok) {
          setFeeds((prev) => prev.map((feed) => (feed.id === selectedFeedId ? { ...feed, hasBackendVideo: true } : feed)))
        }
      }

      const res = await fetch(`${API_BASE_URL}/video/start?feed_id=${selectedFeedId}`, { method: 'POST' })
      const data = await readApiJson(res, { action: 'start_feed', endpoint: '/video/start', feed_id: selectedFeedId })
      debugLog('start feed response', {
        feed_id: selectedFeedId,
        http_status: res.status,
        backend_status: data.status || 'missing',
        message: data.message || '',
      })
      if (res.ok && data.status === 'processing') {
        debugLog('processing start', { feed_id: selectedFeedId, video_id: data.video_id || currentFeed?.videoId || null, source: 'start_feed' })
        await bootSequenceTask
        setBootStepMessage('')
        setBackendStatus((prev) => ({
          ...prev,
          state: 'PROCESSING',
          message: data.message || 'Processing uploaded video',
          progress: data.progress || 0,
        }))
        setFeeds((prev) => prev.map((feed) => (feed.id === selectedFeedId ? { ...feed, status: 'LOADING', videoId: data.video_id || feed.videoId } : feed)))
        return
      }
      if (res.ok && data.status === 'queued') {
        debugLog('start feed queued', { feed_id: selectedFeedId, reason: data.message || 'Another feed is processing.' })
        await bootSequenceTask
        setBootStepMessage('')
        setBackendStatus((prev) => ({
          ...prev,
          state: 'UPLOADED',
          message: data.message || 'Another feed is processing. Please wait.',
          progress: 0,
        }))
        setFeeds((prev) =>
          prev.map((feed) =>
            feed.id === selectedFeedId
              ? { ...feed, status: 'LOADING', backendState: 'UPLOADED', hasBackendVideo: true, videoId: data.video_id || feed.videoId, message: data.message || feed.message }
              : feed,
          ),
        )
        setStreamEnabled(false)
        return
      }
      if (!res.ok || data.status === 'error' || data.status === 'busy') {
        debugLog('start feed not started', {
          feed_id: selectedFeedId,
          problem: data.message || 'Backend rejected start request.',
          backend_status: data.status || res.status,
        })
        await bootSequenceTask
        setBootStepMessage('')
        setBackendStatus((prev) => ({ ...prev, state: 'IDLE', message: data.message || 'Start failed', progress: 0 }))
        setFeeds((prev) =>
          prev.map((feed) =>
            feed.id === selectedFeedId && feed.videoUrl
              ? { ...feed, status: 'STOPPED', backendState: 'STOPPED', message: data.message || 'Start failed' }
              : feed,
          ),
        )
        setStreamEnabled(false)
        return
      }

      await bootSequenceTask
      debugLog('processing start', { feed_id: selectedFeedId, video_id: data.video_id || currentFeed?.videoId || null, source: 'start_feed' })
      setMonitoringActive(true)
      setCanTriggerAlert(false)
      previousDensityRef.current = null
      previousMovementRef.current = null
      previousRiskRef.current = null
      previousMotionRef.current = null
      previousStampedeRiskRef.current = false
      transitionArmedRef.current = false
      const startedLooping = data.message === 'Looping synced processed output' || data.status === 'already_running'
      setStreamEnabled(startedLooping)
      const nextStreamKey = Date.now()
      setFeeds((prev) =>
        prev.map((feed) =>
          feed.id === selectedFeedId
            ? {
                ...feed,
                status: startedLooping ? 'LIVE' : 'LOADING',
                backendState: startedLooping ? 'LOOPING' : 'PROCESSING',
                hasBackendVideo: true,
                videoId: data.video_id || feed.videoId,
                streamKey: nextStreamKey,
                debugStreamKey: nextStreamKey,
                message: data.message || feed.message,
              }
            : feed,
        ),
      )
      setBackendStatus((prev) => ({
        ...prev,
        state: startedLooping ? 'LOOPING' : 'PROCESSING',
        progress: startedLooping ? 100 : prev.progress,
        message: data.message || 'Start command issued',
      }))
      pushNotification('LOW', `Feed ${selectedFeedId} start command issued`)
    } catch {
      debugLog('start feed failed', { feed_id: selectedFeedId })
      await bootSequenceTask
      setBootStepMessage('')
      setBackendStatus((prev) => ({ ...prev, state: 'IDLE', message: 'Start failed. Backend unavailable.', progress: 0 }))
      setFeeds((prev) =>
        prev.map((feed) =>
          feed.id === selectedFeedId && feed.videoUrl
            ? { ...feed, status: 'STOPPED', backendState: 'STOPPED', message: 'Start failed. Backend unavailable.' }
            : feed,
        ),
      )
    }
  }

  const handleStop = async () => {
    debugLog('stop feed requested', { feed_id: selectedFeedId })
    try {
      await fetch(`${API_BASE_URL}/video/stop?feed_id=${selectedFeedId}`, { method: 'POST' })
      debugLog('stop feed response', { feed_id: selectedFeedId, status: 'ok' })
    } finally {
      setStreamEnabled(false)
      setMonitoringActive(false)
      setCanTriggerAlert(false)
      setBootStepMessage('')
      previousDensityRef.current = null
      previousMovementRef.current = null
      previousRiskRef.current = null
      previousMotionRef.current = null
      previousStampedeRiskRef.current = false
      transitionArmedRef.current = false
      const nextStreamKey = Date.now()
      setFeeds((prev) =>
        prev.map((feed) =>
          feed.id === selectedFeedId && feed.videoUrl
            ? { ...feed, status: 'STOPPED', backendState: 'STOPPED', streamKey: nextStreamKey, debugStreamKey: nextStreamKey, message: 'Feed stopped' }
            : feed,
        ),
      )
      setBackendStatus((prev) => ({ ...prev, state: 'STOPPED', message: 'Feed stopped', progress: 0 }))
      pushNotification('LOW', `Feed ${selectedFeedId} stopped`)
    }
  }

  const handleDeleteVideo = async (feed, event) => {
    event?.stopPropagation?.()
    const videoId = feed?.videoId || feed?.storageVideoId
    if (!videoId) {
      debugLog('delete failure', { feed_id: feed?.id, reason: 'missing_video_id' })
      alert('Wrong PIN or delete failed')
      return
    }

    const pin = window.prompt('Enter 4-digit PIN')
    if (pin === null) return

    debugLog('delete requested', { feed_id: feed.id, video_id: videoId })
    try {
      const res = await fetch(`${API_BASE_URL}/delete/${encodeURIComponent(videoId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const data = await readApiJson(res, { action: 'delete_video', endpoint: `/delete/${videoId}`, feed_id: feed.id })
      if (!res.ok || data.status !== 'deleted') {
        throw new Error(data.message || 'Delete failed')
      }

      debugLog('delete success', { feed_id: feed.id, video_id: videoId })
      setFeeds((prev) => prev.map((item) => (item.id === feed.id ? createFeed(feed.id) : item)))
      if (feed.id === selectedFeedId) {
        setBackendStatus((prev) => ({
          ...prev,
          feed_id: feed.id,
          active_feed_id: feed.id,
          state: 'IDLE',
          backendState: 'IDLE',
          has_video: false,
          video_id: null,
          processed_frames: 0,
          packets_count: 0,
          total_frames: 0,
          progress: 0,
          message: 'Video deleted',
        }))
        setMetrics(EMPTY_METRICS)
        setAnalytics([])
        setStreamEnabled(false)
        resetTransitionTrackers()
      }
      pushNotification('LOW', `Video deleted for Feed ${feed.id}`)
    } catch (error) {
      debugLog('delete failure', { feed_id: feed.id, video_id: videoId, error: error.message })
      alert('Wrong PIN or delete failed')
    }
  }

  const handleModeChange = async (mode) => {
    if (!mode) return
    debugLog('mode selected', { feed_id: selectedFeedId, mode })
    setProcessingMode(mode)
    try {
      const res = await fetch(`${API_BASE_URL}/settings/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, feed_id: selectedFeedId }),
      })
      const data = await readApiJson(res, { action: 'set_mode', endpoint: '/settings/mode', feed_id: selectedFeedId })
      if (!res.ok || data.status === 'error') {
        toastForSeverity('MEDIUM', data.message || 'Unable to change mode', true)
        return
      }
      const modeName =
        mode === MODE_CONTINUOUS
          ? 'Continuous Monitoring'
          : 'Prototype Buffered'
      setBackendStatus((prev) => ({ ...prev, mode: data.mode || mode, message: `Mode set to ${modeName}` }))
      debugLog('mode saved', { feed_id: selectedFeedId, mode: data.mode || mode })
      pushNotification('LOW', `Mode updated to ${modeName}`)
    } catch {
      debugLog('mode save failed', { feed_id: selectedFeedId, mode })
      toastForSeverity('MEDIUM', 'Unable to change mode', true)
    }
  }

  const emergencyActions = useMemo(() => {
    const highMotion = operational.movement === 'ABNORMAL' || (typeof metrics.motion === 'number' && metrics.motion > 12)
    const isCritical = operational.stampede_risk || emergencyProtocolActive
    const hasSelectedVideo = Boolean(selectedFeedDetails.videoUrl || selectedFeedDetails.hasBackendVideo)
    const isStandby = !hasSelectedVideo || operational.risk === 'LOW' || !operational.risk
    return [
      {
        id: 'crowd-control',
        label: 'Deploy Crowd Control Units',
        icon: Users,
        recommended: isCritical || operational.density === 'HIGH',
        disabled: isStandby,
      },
      {
        id: 'ambulance',
        label: 'Dispatch Ambulance',
        icon: Ambulance,
        recommended: isCritical || highMotion,
        disabled: isStandby,
      },
      {
        id: 'announcement',
        label: 'Trigger Public Announcement',
        icon: Megaphone,
        recommended: isCritical || operational.density === 'HIGH',
        disabled: isStandby,
      },
      {
        id: 'hospital',
        label: 'Notify Nearby Hospital',
        icon: Hospital,
        recommended: isCritical,
        disabled: isStandby,
      },
      {
        id: 'police',
        label: 'Alert Police',
        icon: Shield,
        recommended: isCritical || highMotion,
        disabled: isStandby,
      },
      {
        id: 'emergency-exit',
        label: 'Open Emergency Exit Routes',
        icon: AlertTriangle,
        recommended: isCritical || operational.risk === 'HIGH',
        disabled: isStandby,
      },
    ]
  }, [emergencyProtocolActive, metrics.motion, operational.density, operational.movement, operational.risk, operational.stampede_risk, selectedFeedDetails.hasBackendVideo, selectedFeedDetails.videoUrl])

  const handleEmergencyAction = (actionLabel) => {
    debugLog('emergency action', { feed_id: selectedFeedId, action: actionLabel })
    const severity = incidentLevel === 'CRITICAL' ? 'HIGH' : incidentLevel === 'WATCH' ? 'MEDIUM' : 'LOW'
    const message = `${actionLabel} initiated for Feed ${selectedFeedId}`
    pushNotification(severity, message)
    addIncidentEvent(`${actionLabel.toLowerCase()} dispatched`)
  }

  const metricCards = useMemo(
    () => [
      {
        label: 'People Count',
        value: metrics.people,
        subtext: 'Detected individuals',
        detail: `Left ${metrics.left_zone ?? '--'} | Right ${metrics.right_zone ?? '--'}`,
        trend: trends.people,
      },
      {
        label: 'Density',
        value: operational.density,
        subtext: densityLabel(operational.density),
        detail: `Adjusted: ${metrics.adjusted ?? '--'}`,
        trend: trends.density,
      },
      {
        label: 'Movement',
        value: operational.movement,
        subtext: movementLabel(operational.movement),
        detail: `Motion score: ${typeof metrics.motion === 'number' ? metrics.motion.toFixed(1) : '--'}`,
        trend: trends.movement,
      },
      {
        label: 'Risk Level',
        value: operational.risk,
        subtext: riskLabel(operational.risk),
        detail: operational.statusText || '--',
        trend: trends.risk,
      },
      {
        label: 'Stampede Risk',
        value: operational.stampede_risk ? 'TRUE' : 'FALSE',
        subtext: operational.trigger_reason || '--',
        detail: `Threat: ${operational.threat || '--'} | Action: ${operational.action || '--'}`,
        trend: operational.stampede_risk ? 'up' : 'stable',
      },
    ],
    [metrics, operational, trends],
  )

  const aiInsight = useMemo(() => {
    if (metrics.people == null) return `AI is standing by on Feed ${selectedFeedId}.`
    const density = operational.density || '--'
    const movement = operational.movement || '--'
    const risk = operational.risk || '--'
    if (operational.stampede_risk) {
      return `AI detects stampede-risk condition on Feed ${selectedFeedId}: high density combined with abnormal movement. Immediate intervention is recommended.`
    }
    if (density === 'HIGH' && movement === 'NORMAL') {
      return `Feed ${selectedFeedId} is crowded but stable: ${metrics.people} people, high density, normal movement. Monitor flow and open relief routes if needed.`
    }
    if (risk === 'MEDIUM') {
      return `AI detects watch condition on Feed ${selectedFeedId}: ${metrics.people} people, ${density} density, ${movement} movement. Keep response teams ready.`
    }
    return `AI reports stable conditions on Feed ${selectedFeedId}: ${metrics.people} people, ${density} density, ${movement} movement.`
  }, [metrics.people, operational.density, operational.movement, operational.risk, operational.stampede_risk, selectedFeedId])

  const summary = useMemo(() => {
    const active = feeds.filter((feed) => ['LIVE', 'LOADING', 'READY', 'LOOPING'].includes(feed.status) || feed.hasBackendVideo).length
    const highRisk = feeds.filter((feed) => feed.stampedeRisk || feed.risk === 'HIGH').length
    const watch = feeds.filter((feed) => feed.risk === 'MEDIUM').length
    const idle = feeds.filter((feed) => !feed.hasBackendVideo && (feed.status === 'EMPTY' || feed.status === 'STOPPED')).length
    return { total: feeds.length, active, highRisk, watch, idle }
  }, [feeds])

  const selectedHasUploaded = Boolean(selectedFeedDetails.videoUrl || selectedFeedDetails.hasBackendVideo)
  const hasSelectedMode = Boolean(processingMode)
  const cleanStream = (
    <FeedVideoPanel
      feedId={selectedFeedId}
      type="clean"
      title="Processed Feed"
      status={selectedStreamStatus}
      metrics={metrics}
      streamKey={selectedCleanStreamKey}
    />
  )

  const debugStream = (
    <FeedVideoPanel
      feedId={selectedFeedId}
      type="debug"
      title="Processed Feed (Debug)"
      status={selectedStreamStatus}
      metrics={metrics}
      streamKey={selectedDebugStreamKey}
    />
  )

  const dashboardView = (
    <section className="space-y-4">
      <AlarmControls
        alarmMuted={alarmMuted}
        alarmActive={alarmActive}
        onMuteToggle={() => setAlarmMuted((value) => !value)}
        onTest={() => {
          debugLog('alarm test requested')
          playAlarm(true)
        }}
        onStop={() => {
          debugLog('alarm stop requested')
          stopAlarm()
        }}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {cleanStream}
          <article className={`rounded-2xl border bg-[#0b100b] p-4 shadow-sm transition-all duration-300 ${operational.risk === 'HIGH' ? 'border-[#ff3333]/45 shadow-[0_0_16px_rgba(255,51,51,0.2)]' : operational.risk === 'MEDIUM' ? 'border-[#ffaa00]/45 shadow-[0_0_14px_rgba(255,170,0,0.14)]' : 'border-[#1a3a1a]'}`}>
            <div className="mb-2 flex items-center gap-2 text-[#00ff41]">
              <Bot className="h-4 w-4" />
              <p className="text-sm font-semibold">AI System Insight</p>
            </div>
            <p className="text-sm text-[#00cc33]">{aiInsight}</p>
            <p className="mt-2 text-xs text-[#004d14]">
              Recommended action:{' '}
              <span className={`font-semibold ${operational.risk === 'HIGH' ? 'text-[#ff6666]' : operational.risk === 'MEDIUM' ? 'text-[#ffd07a]' : 'text-[#00ff41]'}`}>
                {operational.action}
              </span>
            </p>
            <p className="mt-2 text-xs text-[#004d14]">
              AI Confidence:{' '}
              <span className={`font-semibold ${confidence.level === 'HIGH' ? 'text-[#00ff41]' : confidence.level === 'MEDIUM' ? 'text-[#ffd07a]' : confidence.level === 'LOW' ? 'text-[#ff6666]' : 'text-[#00cc33]'}`}>
                {confidence.level} ({confidence.text})
              </span>
            </p>
          </article>
        </div>
        <div className="space-y-4">
          <RiskIndicator
            riskLevel={operational.risk}
            threat={operational.threat}
            action={operational.action}
            statusText={operational.statusText}
            lastUpdated={toTimestampLabel(metrics.timestamp)}
            stampedeRisk={operational.stampede_risk}
          />
          <AlertsPanel alerts={alerts} />
        </div>
      </div>
      <MetricsPanel metrics={metricCards} />
    </section>
  )

  const monitoringView = (
    <section className="space-y-4">
      <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-3 text-[#00cc33]">
            <span>Total Feeds: <span className="font-semibold text-[#00ff41]">{summary.total}</span></span>
            <span>Active: <span className="font-semibold text-[#00ff41]">{summary.active}</span></span>
            <span>High Risk: <span className="font-semibold text-[#ff6666]">{summary.highRisk}</span></span>
            <span>Watch: <span className="font-semibold text-[#ffd07a]">{summary.watch}</span></span>
            <span>Idle: <span className="font-semibold text-[#00cc33]">{summary.idle}</span></span>
          </div>
        </div>
      </article>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {feeds.map((feed) => {
          const selected = feed.id === selectedFeedId
          const feedState = String(feed.backendState || '').toUpperCase()
          const live = feedState === 'LOOPING' || feedState === 'RUNNING'
          const displayStatus = feed.status
          const isProcessed = isStreamableState(feedState, feed.processedFrames, feed.packetsCount)
          const isProcessing = feedState === 'PROCESSING' || feedState === 'LOADING'
          const isEmpty = !feed.sourceFile && !isProcessed && !isProcessing
          const canDelete = Boolean(feed.videoId || feed.storageVideoId)

          // Determine if this feed should show video
          const processedFeeds = feeds.filter(f => {
            const fs = String(f.backendState || '').toUpperCase()
            return isStreamableState(fs, f.processedFrames, f.packetsCount)
          })
          const processedCount = processedFeeds.length
          const shouldShowVideo = isProcessed && (processedCount <= 3 || selected || processedFeeds.indexOf(feed) < 2)
          const isPaused = isProcessed && !shouldShowVideo

          return (
            <article
              key={feed.id}
              onClick={() => handleFeedSelection(`feed-${feed.id}`)}
              className={`flex h-[360px] cursor-pointer flex-col rounded-2xl border bg-[#0b100b] p-3 shadow-sm transition-all duration-200 ${selected ? 'border-[#00ff41]/60 shadow-[0_0_16px_rgba(0,255,65,0.15)]' : 'border-[#1a3a1a]'}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#00ff41]">{feed.name}</p>
                <div className="flex items-center gap-2">
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={(event) => handleDeleteVideo(feed, event)}
                      className="rounded border border-[#ff3333]/35 bg-[#2a0b0b] p-1 text-[#ff6666] hover:bg-[#391010]"
                      title="Delete video"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${statusBadgeTone(displayStatus)}`}>{displayStatus}</span>
                </div>
              </div>

              <div className="relative h-[230px] w-full overflow-hidden rounded-lg border border-[#1a3a1a] bg-[#050a05]">
                {isEmpty ? (
                  <div className="flex h-full w-full flex-col items-center justify-center text-center text-sm text-[#00aa33]">
                    <p className="font-semibold">No active surveillance feed</p>
                    <p className="mt-1 text-xs text-[#008822]">Awaiting video assignment...</p>
                  </div>
                ) : isProcessing ? (
                  <div className="flex h-full w-full flex-col items-center justify-center text-center text-sm text-[#00aa33]">
                    <p className="font-semibold">Processing Feed {feed.id}...</p>
                    <div className="mt-2 h-2 w-32 rounded-full bg-[#1a3a1a]">
                      <div className="h-full rounded-full bg-[#00ff41]" style={{ width: `${feed.progress || 0}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-[#008822]">{feed.progress || 0}% complete</p>
                  </div>
                ) : shouldShowVideo ? (
                  <FeedVideoPanel
                    feedId={feed.id}
                    type="clean"
                    streamKey={feed.streamKey || 0}
                    className="h-full min-h-0 aspect-auto border-0"
                  />
                ) : isPaused ? (
                  <div className="flex h-full w-full cursor-pointer items-center justify-center text-center text-sm text-[#00aa33] hover:bg-[#0a150a]">
                    <p className="font-semibold">Stream paused to reduce load</p>
                    <p className="mt-1 text-xs text-[#008822]">Click to view</p>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-[#00aa33]">
                    Select this feed to view live stream
                  </div>
                )}

                {isProcessed ? (
                  <>
                    <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-[#082208]/80 px-2 py-1 text-[10px] font-semibold text-[#00ff41]">
                      <span className={`h-2 w-2 rounded-full ${live ? 'live-dot' : 'bg-[#3d5a3d]'}`} />
                      {live ? 'LIVE' : 'READY'}
                    </div>
                    <div className="absolute right-2 top-2 rounded bg-[#0d140d]/85 px-2 py-1 text-[10px] font-semibold text-[#00ff41]">
                      FPS {feed.fps ?? '--'}
                    </div>
                    <div className="absolute left-2 bottom-2 rounded bg-[#0d140d]/85 px-2 py-1 text-[10px] font-semibold text-[#00cc33]">
                      Processed Feed
                    </div>
                    <div className="absolute right-2 bottom-2 rounded bg-[#0d140d]/85 px-2 py-1 text-[10px] font-semibold text-[#00ff41]">
                      {feed.timestamp || '--'}
                    </div>
                  </>
                ) : null}
              </div>

              <p className="mt-2 line-clamp-2 text-xs text-[#00cc33]">
                People: {feed.people ?? '--'} | Density: {feed.density ?? '--'} | Movement: {feed.movement ?? '--'} | Risk: {feed.risk ?? '--'} | Stampede: {feed.stampedeRisk ? 'TRUE' : 'FALSE'}
              </p>
            </article>
          )
        })}
      </section>
    </section>
  )

  const debugView = (
    <DebugMode
      stream={debugStream}
      metrics={metrics}
      analytics={analytics}
      debugVisuals={debugVisuals}
      selectedFeedId={selectedFeedId}
    />
  )

  const analyticsView = <Analytics backendStatus={selectedStreamStatus} selectedFeedId={selectedFeedId} />

  const responseTimerLabel = `${String(Math.floor(responseElapsed / 60)).padStart(2, '0')}:${String(responseElapsed % 60).padStart(2, '0')}`
  const incidentBorderTone =
    incidentLevel === 'CRITICAL'
      ? 'border-[#ff3333]/75 shadow-[0_0_22px_rgba(255,51,51,0.34)] animate-pulse'
      : incidentLevel === 'WATCH'
        ? 'border-[#ffaa00]/60 shadow-[0_0_16px_rgba(255,170,0,0.22)]'
        : 'border-[#1a3a1a]'

  const emergencyView = (
    <section className={`space-y-4 ${emergencyRoomActive ? 'text-[#ffb4b4]' : ''}`}>
      {!selectedHasUploaded ? (
        <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-[#00ff41]">System idle. Awaiting incident detection.</p>
          <p className="mt-2 text-sm text-[#00cc33]">Upload and start a feed to activate emergency response intelligence.</p>
        </article>
      ) : null}

      {selectedHasUploaded ? (
        <>
      <article className={`rounded-2xl border p-4 shadow-sm ${emergencyRoomActive ? 'border-[#ff3333]/70 bg-[#230707]' : 'border-[#1a3a1a] bg-[#0b100b]'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xl font-semibold text-[#00ff41]">Post-Incident Emergency Room</p>
            <p className="mt-1 text-sm text-[#00cc33]">
              {emergencyRoomActive ? 'Incident command active' : 'Monitoring standby - activates on stampede risk or manual protocol.'}
            </p>
          </div>
          <div className={`rounded-lg border px-3 py-1 text-xs font-semibold ${emergencyRoomActive ? 'border-[#ff3333]/55 bg-[#2a0b0b] text-[#ff8888]' : 'border-[#1a3a1a] bg-[#0d140d] text-[#00cc33]'}`}>
            {emergencyRoomActive ? 'COMMAND ACTIVE' : 'MONITORING'}
          </div>
        </div>
      </article>
      <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-base font-semibold text-[#00ff41]">Processed Feed</p>
          <span className="text-xs font-semibold text-[#00cc33]">Feed {selectedFeedId}</span>
        </div>
        <FeedVideoPanel
          feedId={selectedFeedId}
          type="clean"
          title="Processed Feed"
          status={selectedStreamStatus}
          metrics={metrics}
          streamKey={selectedCleanStreamKey}
          className="max-h-[360px]"
        />
      </article>
      <article className={`rounded-2xl border bg-[#0b100b] p-4 shadow-sm transition-all duration-300 ${incidentBorderTone}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BadgeAlert className={`h-5 w-5 ${incidentLevel === 'CRITICAL' ? 'text-[#ff6666]' : incidentLevel === 'WATCH' ? 'text-[#ffd07a]' : 'text-[#00ff41]'}`} />
            <p className="text-base font-semibold text-[#00ff41]">Incident Command Panel</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-3 py-1 text-xs font-semibold text-[#00cc33]">
              Backend: {(selectedStreamStatus.state || 'idle').toUpperCase()}
            </div>
            <button
              type="button"
              onClick={() => {
                debugLog('incident resolved', { feed_id: selectedFeedId })
                stopAlarm()
                setEmergencyProtocolActive(false)
                addIncidentEvent('incident marked resolved')
                pushNotification('LOW', `Feed ${selectedFeedId}: incident marked resolved`)
              }}
              className="rounded-lg border border-[#00ff41]/35 bg-[#0d140d] px-3 py-1 text-xs font-semibold text-[#00ff41] hover:bg-[#111a11]"
            >
              Mark Incident Resolved
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs text-[#00cc33] md:grid-cols-4 xl:grid-cols-7">
          <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-2"><p className="opacity-75">Incident Level</p><p className={`font-semibold ${incidentLevel === 'CRITICAL' ? 'text-[#ff6666]' : incidentLevel === 'WATCH' ? 'text-[#ffd07a]' : 'text-[#00ff41]'}`}>{incidentLevel}</p></div>
          <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-2"><p className="opacity-75">Zone / Feed</p><p className="font-semibold text-[#00ff41]">Zone A / {selectedFeedId}</p></div>
          <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-2"><p className="opacity-75">Trigger Reason</p><p className="font-semibold text-[#00ff41]">{operational.trigger_reason ?? '--'}</p></div>
          <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-2"><p className="opacity-75">People</p><p className="font-semibold text-[#00ff41]">{metrics.people ?? '--'}</p></div>
          <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-2"><p className="opacity-75">Density</p><p className="font-semibold text-[#00ff41]">{operational.density ?? '--'}</p></div>
          <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-2"><p className="opacity-75">Movement</p><p className="font-semibold text-[#00ff41]">{operational.movement ?? '--'}</p></div>
          <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-2"><p className="opacity-75">Risk</p><p className="font-semibold text-[#00ff41]">{operational.risk ?? '--'}</p></div>
          <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-2"><p className="opacity-75">Timestamp</p><p className="font-semibold text-[#00ff41]">{toTimestampLabel(metrics.timestamp)}</p></div>
        </div>
      </article>
      {(operational.stampede_risk || operational.risk === 'HIGH') ? (
        <PreventionPanel actions={preventionActions} operational={operational} compact />
      ) : (
        <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-base font-semibold text-[#00ff41]">Prevention Actions</p>
            <span className="rounded border border-[#00ff41]/35 bg-[#00ff41]/10 px-2 py-1 text-[10px] font-semibold text-[#00ff41]">
              NORMAL
            </span>
          </div>
          <p className="text-sm text-[#00cc33]">
            Selected Feed {selectedFeedId} is normal. No emergency prevention actions required right now.
          </p>
          <p className="mt-2 text-xs text-[#00aa33]">
            Continue standard monitoring and keep response teams on standby.
          </p>
        </article>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <article className={`rounded-2xl border bg-[#0b100b] p-4 shadow-sm ${emergencyRoomActive ? 'border-[#ff3333]/65 shadow-[0_0_20px_rgba(255,51,51,0.22)]' : 'border-[#1a3a1a]'}`}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-base font-semibold text-[#00ff41]">Response Actions</p>
            <button
              type="button"
              onClick={() => {
                debugLog('emergency protocol activated', { feed_id: selectedFeedId })
                setEmergencyProtocolActive(true)
                const timestamp = toTimestampLabel(metrics.timestamp) === '--' ? EventTime() : toTimestampLabel(metrics.timestamp)
                pushNotification('HIGH', 'Emergency protocol activated', timestamp, true)
                addIncidentEvent('emergency protocol activated', timestamp)
              }}
              disabled={emergencyProtocolActive}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                emergencyProtocolActive
                  ? 'cursor-not-allowed border-[#ff3333]/35 bg-[#2c0b0b] text-[#ff7777]'
                  : emergencyRoomActive
                    ? 'border-[#ff3333]/55 bg-[#2a0b0b] text-[#ff6666] hover:bg-[#391010]'
                    : 'border-[#ffaa00]/45 bg-[#221607] text-[#ffd07a] hover:bg-[#2d1c08]'
              }`}
            >
              <ShieldAlert className="h-4 w-4" />
              ACTIVATE EMERGENCY PROTOCOL
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {emergencyActions.map((item) => {
              const Icon = item.icon
              const recommendedClass = emergencyRoomActive
                ? `border-[#ff3333]/45 bg-[#2a0b0b] text-[#ff9b9b] animate-pulse`
                : 'border-[#ffaa00]/45 bg-[#221607] text-[#ffd07a]'
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleEmergencyAction(item.label)}
                  disabled={item.disabled}
                  className={`inline-flex items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition ${
                    item.disabled
                      ? 'cursor-not-allowed border-[#1a3a1a] bg-[#0d140d] text-[#3b5a3b]'
                      : item.recommended
                        ? recommendedClass
                        : 'border-[#1a3a1a] bg-[#0d140d] text-[#00cc33] hover:bg-[#111a11]'
                  }`}
                >
                  <span className="inline-flex items-center gap-2"><Icon className="h-4 w-4" />{item.label}</span>
                  {item.disabled ? (
                    <span className="rounded bg-[#1a3a1a] px-2 py-0.5 text-[10px] font-semibold text-[#6f8b6f]">STANDBY</span>
                  ) : item.recommended ? (
                    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${emergencyRoomActive ? 'bg-[#ff3333]/20' : 'bg-[#ffaa00]/20'}`}>RECOMMENDED</span>
                  ) : null}
                </button>
              )
            })}
          </div>
          <div className="mt-3 rounded-xl border border-[#1a3a1a] bg-[#050a05] p-3 text-xs text-[#00cc33]">
            <p className="mb-1 inline-flex items-center gap-2 font-semibold text-[#00ff41]"><Clock3 className="h-4 w-4" />Response Timer</p>
            <p>Time since alert: <span className={`font-semibold ${emergencyRoomActive ? 'text-[#ff6666]' : 'text-[#00ff41]'}`}>{emergencyRoomActive ? responseTimerLabel : '--:--'}</span></p>
          </div>
        </article>

        <div className="space-y-4">
          <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-[#00ff41]">
              <Hospital className="h-5 w-5 text-rose-400" />
              <p className="text-base font-semibold">Medical Resource Panel</p>
            </div>
            <div className="space-y-2 text-sm text-[#00cc33]">
              <p>Nearest: <span className="font-semibold text-[#00ff41]">City Civil Hospital</span></p>
              <p>Distance: <span className="font-semibold text-[#00ff41]">2.8 km</span></p>
              <p>Capacity: <span className={`font-semibold ${incidentLevel === 'CRITICAL' ? 'text-[#ff6666]' : 'text-[#00ff41]'}`}>{incidentLevel === 'CRITICAL' ? '84%' : '67%'}</span></p>
              <p>Available ambulances: <span className="font-semibold text-[#00ff41]">{incidentLevel === 'CRITICAL' ? 2 : 5}</span></p>
              <p>Ambulance ETA: <span className="font-semibold text-[#00ff41]">{incidentLevel === 'CRITICAL' ? '04:30' : '07:15'}</span></p>
            </div>
          </article>
          <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-[#00ff41]">
              <Ambulance className="h-5 w-5 text-amber-400" />
              <p className="text-base font-semibold">Ambulance Status</p>
            </div>
            <div className="space-y-2 text-sm text-[#00cc33]">
              <p>Available units: <span className="font-semibold text-[#00ff41]">{incidentLevel === 'CRITICAL' ? 2 : 5}</span></p>
              <p>In use: <span className="font-semibold text-[#00ff41]">{incidentLevel === 'CRITICAL' ? 6 : 3}</span></p>
              <p>ETA: <span className="font-semibold text-[#00ff41]">{incidentLevel === 'CRITICAL' ? '04:30' : '07:15'}</span></p>
            </div>
          </article>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4">
        <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-[#00ff41]">
            <Bot className="h-4 w-4" />
            <p className="text-base font-semibold">Situation Explanation</p>
          </div>
          <p className="text-sm text-[#00cc33]">{emergencyExplanation}</p>
          <p className="mt-3 text-xs text-[#00aa33]">Selected feed: {selectedFeedId} | Last update: {toTimestampLabel(metrics.timestamp)}</p>
        </article>
        <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
          <p className="mb-3 text-base font-semibold text-[#00ff41]">Incident Timeline</p>
          {selectedIncidentTimeline.length ? (
            <div className="max-h-[260px] space-y-2 overflow-auto pr-1">
              {selectedIncidentTimeline.map((item, index) => (
                <div key={`${item.timestamp}-${index}`} className="rounded-xl border border-[#1a3a1a] bg-[#0d140d] p-3 text-sm text-[#00cc33]">
                  <p className="text-xs text-[#00aa33]">{item.timestamp}</p>
                  <p className="font-semibold text-[#00ff41]">{item.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-[#1a3a1a] bg-[#0d140d] p-4 text-sm text-[#00cc33]">
              Timeline will populate when an alert, response action, or manual protocol occurs for Feed {selectedFeedId}.
            </div>
          )}
        </article>
      </section>
        </>
      ) : null}
    </section>
  )

  const recordingView = (
    <section className="space-y-4">
      <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
        <div className="flex items-center justify-end gap-2">
          <label className="text-sm font-medium text-[#00cc33]">Selected Feed</label>
          <select
            value={selectedFeedValue}
            onChange={(e) => handleFeedSelection(e.target.value)}
            className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-3 py-2 text-sm text-[#00cc33]"
          >
            {feeds.map((feed) => (
              <option key={feed.id} value={`feed-${feed.id}`}>
                Feed {feed.id} ({feed.status || 'EMPTY'})
              </option>
            ))}
          </select>
        </div>
      </article>
      <FeedVideoPanel
        feedId={selectedFeedId}
        type="clean"
        title="Recording Preview"
        status={selectedStreamStatus}
        metrics={metrics}
        streamKey={selectedCleanStreamKey}
        className="max-h-[420px]"
      />
      <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
        <p className="mb-3 text-base font-semibold text-[#00ff41]">Recording Export Options</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <button type="button" onClick={() => debugLog('recording export clicked', { type: 'clean_video', feed_id: selectedFeedId })} className="inline-flex items-center gap-2 rounded-xl border border-[#1a3a1a] bg-[#0d140d] px-4 py-3 text-sm font-semibold text-[#00cc33] hover:bg-[#111a11]">
            <Video className="h-4 w-4" />
            Clean video
          </button>
          <button type="button" onClick={() => debugLog('recording export clicked', { type: 'debug_video', feed_id: selectedFeedId })} className="inline-flex items-center gap-2 rounded-xl border border-[#1a3a1a] bg-[#0d140d] px-4 py-3 text-sm font-semibold text-[#00cc33] hover:bg-[#111a11]">
            <Download className="h-4 w-4" />
            Debug video
          </button>
          <button type="button" onClick={() => debugLog('recording export clicked', { type: 'analytics', feed_id: selectedFeedId })} className="inline-flex items-center gap-2 rounded-xl border border-[#1a3a1a] bg-[#0d140d] px-4 py-3 text-sm font-semibold text-[#00cc33] hover:bg-[#111a11]">
            <FileSpreadsheet className="h-4 w-4" />
            CSV/JSON analytics
          </button>
        </div>
        <div className="mt-3 rounded-xl border border-[#1a3a1a] bg-[#050a05] p-3 text-sm text-[#00cc33]">
          <p className="mb-1 font-semibold">Exports include:</p>
          <p className="flex items-center gap-2"><Video className="h-4 w-4 text-[#00cc33]" /> Clean video + analytics overlay</p>
          <p className="mt-1 flex items-center gap-2"><Download className="h-4 w-4 text-[#00cc33]" /> Debug video (bounding boxes)</p>
          <p className="mt-1 flex items-center gap-2"><FileJson className="h-4 w-4 text-[#00cc33]" /> Timestamped analytics file (CSV/JSON)</p>
        </div>
      </article>
    </section>
  )

  const moduleTitle = {
    dashboard: 'Dashboard',
    monitoring: 'Live Monitoring',
    debug: 'Debug Mode',
    analytics: 'Analytics',
    emergency: 'Emergency Response',
    recording: 'Recording Window',
  }[activeModule]

  const moduleView = {
    dashboard: dashboardView,
    monitoring: monitoringView,
    debug: debugView,
    analytics: analyticsView,
    emergency: emergencyView,
    recording: recordingView,
  }[activeModule]

  const statusState = String(selectedStreamStatus.state || '').toUpperCase()
  const stopAllowed = ['PROCESSING', 'LOOPING', 'RUNNING'].includes(statusState)
  const startBlocked = !hasSelectedMode || !selectedHasUploaded || ['LOOPING', 'RUNNING'].includes(statusState)
  const modeLocked = ['PROCESSING', 'LOOPING', 'RUNNING'].includes(statusState)
  const modeLabel =
    !processingMode
      ? 'Not Selected'
      : processingMode === MODE_CONTINUOUS
      ? 'Continuous Monitoring'
      : 'Prototype Buffered'

  const handleDebugClick = useCallback((event) => {
    const target = event.target?.closest?.('button, label, [role="button"]')
    if (!target || !event.currentTarget.contains(target)) return
    const label = target.getAttribute('aria-label') || target.getAttribute('title') || target.textContent?.replace(/\s+/g, ' ').trim() || target.tagName.toLowerCase()
    debugLog('click', label)
  }, [])

  const handleDebugChange = useCallback((event) => {
    const target = event.target
    if (!target) return
    const tagName = target.tagName?.toLowerCase()
    if (tagName !== 'select' && tagName !== 'input') return
    const type = target.getAttribute?.('type') || tagName
    const value = type === 'file'
      ? target.files?.[0]?.name || 'no file'
      : target.selectedOptions?.[0]?.textContent?.trim?.() || target.value
    debugLog('change', { type, value })
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0f0a] text-[#00ff41]" onClickCapture={handleDebugClick} onChangeCapture={handleDebugChange}>
      <ToastContainer />
      <div className="flex min-h-screen">
        <Sidebar
          activeModule={activeModule}
          onChange={(moduleId) => {
            debugLog('module selected', moduleId)
            setActiveModule(moduleId)
          }}
          collapsed={sidebarCollapsed}
          onToggle={() => {
            debugLog('sidebar toggled')
            setSidebarCollapsed((value) => !value)
          }}
        />

        <main className="flex-1 p-6">
          {activeModule !== 'analytics' ? (
            <header className="mb-4 rounded-2xl border border-[#1a3a1a] bg-[#0b100b] px-5 py-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-3xl font-semibold phosphor-text">{moduleTitle}</p>
                  <p className="mt-1 text-sm text-[#00cc33]">Selected Feed: FEED-{selectedFeedId} | Processed Feed</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${backendHealthStatus === 'online' ? 'border-[#00aa33] text-[#00ff41]' : backendHealthStatus === 'offline' ? 'border-[#ff3b30] text-[#ff6b63]' : 'border-[#1a3a1a] text-[#00cc33]'}`}>
                    {backendHealthStatus === 'online' ? '🟢 Online' : backendHealthStatus === 'offline' ? '🔴 Offline' : 'Checking...'}
                  </div>
                  <NotificationBell alerts={alerts} />
                </div>
              </div>
            </header>
          ) : null}

          <div className="space-y-4">
            {activeModule !== 'analytics' && activeModule !== 'monitoring' && activeModule !== 'debug' && activeModule !== 'emergency' && activeModule !== 'recording' ? (
              <ControlPanel
                selectedFeedId={selectedFeedId}
                onFeedChange={handleFeedSelection}
                onStart={handleStart}
                onStop={handleStop}
                onUpload={handleUpload}
                mode={processingMode}
                onModeChange={handleModeChange}
                modeDisabled={modeLocked}
                disabledStart={startBlocked}
                disabledStop={!stopAllowed}
                disabledUpload={!hasSelectedMode || modeLocked}
                status={selectedStreamStatus}
                feeds={feeds}
              />
            ) : null}
            {(activeModule === 'monitoring' || activeModule === 'debug') ? (
              <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-3 text-sm text-[#00cc33]">
                  <span>Mode: <span className="font-semibold text-[#00ff41]">{modeLabel}</span></span>
                  <span>Feed: <span className="font-semibold text-[#00ff41]">Feed {selectedFeedId}</span></span>
                  <span>State: <span className="font-semibold text-[#00ff41]">{statusState || 'IDLE'}</span></span>
                  <span>Progress: <span className="font-semibold text-[#00ff41]">{selectedStreamStatus.progress ?? 0}%</span></span>
                </div>
                <p className="mt-1 text-xs text-[#00aa33]">{selectedStreamStatus.message || 'Awaiting video upload'}</p>
                <div className="mt-2 h-2 overflow-hidden rounded border border-[#1a3a1a] bg-[#0a0f0a]">
                  <div
                    className="h-full bg-gradient-to-r from-[#00aa33] to-[#00ff41] transition-all duration-300"
                    style={{ width: `${selectedStreamStatus.progress || 0}%` }}
                  />
                </div>
              </article>
            ) : null}
            {moduleView}
          </div>
        </main>
      </div>

      <audio ref={alertAudioRef} src="/alert.mp3" preload="auto" onEnded={() => setAlarmActive(false)} />
    </div>
  )
}

export default App
