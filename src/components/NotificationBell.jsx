import { Bell, Clock3 } from 'lucide-react'
import { useMemo, useState } from 'react'

function NotificationBell({ alerts = [] }) {
  const [open, setOpen] = useState(false)
  const items = useMemo(() => alerts.slice(0, 20), [alerts])
  const highCount = useMemo(() => alerts.filter((a) => a?.severity === 'HIGH').length, [alerts])

  const toneFor = (severity) => {
    if (severity === 'HIGH') return 'text-[#ff6666] border-[#ff3333]/35 bg-[#220b0b]'
    if (severity === 'MEDIUM') return 'text-[#ffd07a] border-[#ffaa00]/35 bg-[#221607]'
    return 'text-[#00ff41] border-[#00ff41]/30 bg-[#08150b]'
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center gap-2 rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-3 py-2 text-xs font-semibold text-[#00cc33] hover:bg-[#111a11]"
      >
        <Bell className="h-4 w-4" />
        Notifications
        {alerts.length > 0 ? (
          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${highCount > 0 ? 'bg-[#ff3333]/20 text-[#ff6666]' : 'bg-[#00ff41]/15 text-[#00ff41]'}`}>
            {alerts.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <article className="absolute right-0 z-40 mt-2 w-[360px] rounded-xl border border-[#1a3a1a] bg-[#0b100b] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-[#00ff41]">Notifications</p>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-[#00cc33]">Close</button>
          </div>
          {items.length === 0 ? (
            <p className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-3 text-sm text-[#00cc33]">No notifications</p>
          ) : (
            <div className="max-h-[380px] space-y-2 overflow-auto pr-1">
              {items.map((item, idx) => (
                <div key={`${item.timestamp}-${idx}`} className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${toneFor(item.severity || 'LOW')}`}>{item.severity || 'LOW'}</span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-[#00aa33]"><Clock3 className="h-3 w-3" />{item.timestamp}</span>
                  </div>
                  <p className="text-xs text-[#00ff41]">{item.message}</p>
                </div>
              ))}
            </div>
          )}
        </article>
      ) : null}
    </div>
  )
}

export default NotificationBell

