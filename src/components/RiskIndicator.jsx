import { AlertTriangle, CheckCircle2, Eye, ShieldAlert } from 'lucide-react'

function iconForThreat(threat, className) {
  if (threat === 'CRITICAL') return <ShieldAlert className={className} />
  if (threat === 'WATCH' || threat === 'WARNING' || threat === 'CHECK') return <Eye className={className} />
  return <CheckCircle2 className={className} />
}

function toneForRisk(risk, stampedeRisk) {
  if (stampedeRisk || risk === 'HIGH') return 'text-[#ff3333] bg-[#ff3333]/10 border-[#ff3333]/30'
  if (risk === 'MEDIUM') return 'text-[#ffaa00] bg-[#ffaa00]/10 border-[#ffaa00]/30'
  return 'text-[#00ff41] bg-[#00ff41]/8 border-[#00ff41]/30'
}

function RiskIndicator({ riskLevel, threat, action, statusText, lastUpdated, stampedeRisk = false }) {
  const tone = toneForRisk(riskLevel, stampedeRisk)
  const dynamicFx =
    stampedeRisk || riskLevel === 'HIGH'
      ? 'risk-panel-high'
      : riskLevel === 'MEDIUM'
        ? 'risk-panel-medium'
        : 'risk-panel-low'

  return (
    <article className={`rounded-2xl border p-4 shadow-sm transition-all duration-300 ${dynamicFx} ${tone}`}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">Threat Analysis</p>
        <AlertTriangle className="h-4 w-4" />
      </div>

      <div className="mb-4 rounded-xl border border-current/30 bg-[#0d140d] p-4 text-center">
        {iconForThreat(threat, 'mx-auto mb-2 h-8 w-8')}
        <p className="text-2xl font-bold">{threat || 'STANDBY'}</p>
        <p className="mt-1 text-sm opacity-80">Risk: {riskLevel || '--'}</p>
        <p className="mt-1 text-xs opacity-80">Stampede Risk: {stampedeRisk ? 'TRUE' : 'FALSE'}</p>
        <p className="mt-1 text-xs opacity-80">{statusText || 'Awaiting live telemetry'}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg border border-current/30 bg-[#0d140d] p-2">
          <p className="text-xs uppercase opacity-75">Action</p>
          <p className="font-semibold">{action || 'WAITING'}</p>
        </div>
        <div className="rounded-lg border border-current/30 bg-[#0d140d] p-2">
          <p className="text-xs uppercase opacity-75">Level</p>
          <p className="font-semibold">{riskLevel || '--'}</p>
        </div>
      </div>
      <p className="mt-3 text-xs opacity-70">Last updated: {lastUpdated || '--'}</p>
    </article>
  )
}

export default RiskIndicator
