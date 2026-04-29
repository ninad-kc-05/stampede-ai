import { LoaderCircle } from 'lucide-react'

function BackendStatus({ status, hasUploaded }) {
  const isStandby =
    status.state === 'idle' || status.state === 'loading' || status.state === 'ready' || status.state === 'stopped' || status.state === 'buffering'
  if (!isStandby) return null

  const isLoading = status.state === 'loading' || status.state === 'ready' || status.state === 'buffering'
  const headline =
    status.state === 'idle'
      ? 'SYSTEM STATUS: IDLE'
      : status.state === 'stopped'
        ? 'Feed stopped'
        : status.state === 'buffering'
          ? 'Processing... buffering stream'
        : 'Initializing monitoring engine...'

  const message =
    status.state === 'idle'
      ? 'Awaiting video input... No active surveillance feed detected.'
      : status.message

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#050a05]/90">
      <div className="w-[420px] rounded-sm border border-[#1a3a1a] bg-[#0b100b] p-6 text-center">
        {isLoading ? (
          <LoaderCircle className="mx-auto mb-3 h-8 w-8 animate-spin text-[#00ff41]" />
        ) : (
          <div className="mx-auto mb-3 h-8 w-8 rounded-full border border-[#1a3a1a] bg-[#0d140d]" />
        )}
        <p className="text-base font-semibold text-[#00ff41]">{headline}</p>
        <p className="mt-2 text-sm text-[#00cc33]">{message}</p>
        <div className="mt-4 h-3 overflow-hidden rounded-sm border border-[#1a3a1a] bg-[#0a0f0a]">
          <div
            className="h-full bg-gradient-to-r from-[#00aa33] to-[#00ff41] transition-all duration-300"
            style={{ width: `${status.progress || 0}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-[#004d14]">{status.progress || 0}%</p>
        {!hasUploaded && status.state === 'idle' ? (
          <p className="mt-2 text-xs text-[#00cc33]">Standby mode: waiting for video upload.</p>
        ) : null}
      </div>
    </div>
  )
}

export default BackendStatus
