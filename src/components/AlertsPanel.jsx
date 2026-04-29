import { AlertCircle, Clock3, FileText } from 'lucide-react'

function AlertsPanel({ alerts }) {
  const criticalEvents = alerts.filter((item) => item?.criticalRisk === true)
  const visibleAlerts = criticalEvents.slice(0, 3)
  const severityTone = {
    LOW: 'border-[#00ff41]/30 bg-[#00ff41]/8 text-[#00ff41]',
    MEDIUM: 'border-[#ffaa00]/30 bg-[#ffaa00]/10 text-[#ffd07a]',
    HIGH: 'border-[#ff3333]/30 bg-[#ff3333]/10 text-[#ff6666]',
  }

  return (
    <article className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-[#00ff41]">Critical Events</p>
        <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-2 py-1 text-xs font-semibold text-[#00cc33]">
          {criticalEvents.length}
        </div>
      </div>

      {criticalEvents.length === 0 ? (
        <div className="rounded-xl border border-[#1a3a1a] bg-[#0d140d] p-5 text-center text-sm text-[#00cc33]">
          <FileText className="mx-auto mb-2 h-5 w-5 text-[#004d14]" />
          No active events
        </div>
      ) : (
        <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
          {visibleAlerts.map((alert, idx) => (
            <div key={`${alert.timestamp}-${idx}`} className="event-slide rounded-xl border border-[#1a3a1a] bg-[#0d140d] p-2.5">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 text-[#00cc33]" />
                <div className="flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[#00ff41]">{alert.message}</p>
                    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${severityTone[alert.severity || 'LOW']}`}>
                      {alert.severity || 'LOW'}
                    </span>
                  </div>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-[#00cc33]">
                    <Clock3 className="h-3 w-3" />
                    {alert.timestamp}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

export default AlertsPanel
