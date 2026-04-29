import StreamViewer from './StreamViewer'

function LiveStream({
  title = 'Processed Feed',
  subtitle = 'Processed Feed',
  status,
  feedId,
  streamType = 'clean',
  streamKey = 0,
  streamEnabled,
  hasUploaded,
  previewUrl = null,
  timestampLabel,
  zoneLabel = 'Zone A - Main Entrance',
  risk = null,
  fps = 0,
  statusStrip = null,
  bootMessage = '',
  waitingMessage = 'Waiting for processed feed',
  className = '',
}) {
  const state = String(status?.state || '').toUpperCase()
  const hasProcessedFrames = Number(status?.processed_frames || 0) > 0
  const packetsCount = Number(status?.packets_count || 0)
  const hasCachedPackets = packetsCount > 0
  const showStream = streamEnabled && ((['READY', 'LOOPING', 'RUNNING'].includes(state) && (hasCachedPackets || hasProcessedFrames)) || (state === 'STOPPED' && (hasCachedPackets || hasProcessedFrames)))
  const processingWithoutPackets = state === 'PROCESSING' && !hasCachedPackets
  const canRenderStream = Boolean(feedId) && hasUploaded
  const riskContainerTone =
    risk === 'HIGH'
      ? 'border-[#ff3333]/60 shadow-[0_0_26px_rgba(255,51,51,0.35)] animate-pulse'
      : risk === 'MEDIUM'
        ? 'border-[#ffaa00]/60 shadow-[0_0_20px_rgba(255,170,0,0.25)]'
        : 'border-[#00ff41]/35 shadow-[0_0_12px_rgba(0,255,65,0.18)]'
  const stripTone =
    risk === 'HIGH'
      ? 'border-[#ff3333]/50 text-[#ff6666] shadow-[0_0_20px_rgba(255,51,51,0.25)]'
      : risk === 'MEDIUM'
        ? 'border-[#ffaa00]/50 text-[#ffd07a] shadow-[0_0_16px_rgba(255,170,0,0.2)]'
        : 'border-[#00ff41]/40 text-[#00ff41] shadow-[0_0_14px_rgba(0,255,65,0.14)]'

  const message = !hasUploaded
    ? ''
    : state === 'PROCESSING'
      ? 'Processing uploaded video'
      : state === 'STOPPED'
        ? 'Feed stopped'
        : state === 'READY'
          ? 'Ready to play processed feed'
        : waitingMessage
  const liveNow = ['LOOPING', 'RUNNING'].includes(state)
  const stripModeLabel = liveNow ? 'LIVE' : 'STANDBY'

  return (
    <article className={`rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-base font-semibold text-[#00ff41]">{title}</p>
          <p className="text-sm text-[#00cc33]">{subtitle}</p>
        </div>
        <div className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-3 py-1 text-xs font-semibold text-[#00ff41]">{timestampLabel}</div>
      </div>

      {statusStrip ? (
        <div className={`mb-3 rounded-lg border bg-[#0d140d] px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-all duration-300 ${stripTone}`}>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${liveNow ? 'live-dot' : 'bg-[#3d5a3d]'}`} />
            <span className={liveNow ? 'text-[#00ff41]' : 'text-[#6f8b6f]'}>{stripModeLabel}</span>
            <span className="text-[#00cc33]">|</span>
            <span>{statusStrip}</span>
          </div>
        </div>
      ) : null}

      <div className={`relative aspect-video w-full max-h-[420px] overflow-hidden rounded-xl border bg-[#050a05] transition-all duration-300 ${riskContainerTone}`}>
        {canRenderStream ? (
          <StreamViewer
            feedId={feedId}
            type={streamType}
            status={status}
            streamKey={streamKey}
            className="h-full w-full"
            showPlaceholder
          />
        ) : processingWithoutPackets ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[#00cc33]">
            <div>
              <p className="text-sm font-semibold text-[#00ff41]">Processing {zoneLabel.replace('Zone A - ', '')}...</p>
              <p className="mt-1 text-xs text-[#00aa33]">Preparing processed stream frames</p>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-sm text-[#00cc33]">
            {!hasUploaded ? (
              <div className="terminal-fade text-center">
                <div className="mx-auto mb-3 h-7 w-7 rounded-full border border-[#1a3a1a] bg-[#0d140d]" />
                <p className="text-sm font-semibold text-[#00cc33]">SYSTEM STATUS: IDLE</p>
                <p className="terminal-typing mt-1 text-[#00cc33]">Awaiting video input...</p>
                <p className="mt-1 text-[#00aa33]">No active surveillance feed detected.</p>
              </div>
            ) : (
              message
            )}
          </div>
        )}
        {bootMessage && !canRenderStream ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#050a05]/86 backdrop-blur-[1px]">
            <div className="rounded-xl border border-[#1a3a1a] bg-[#0b100b]/90 px-5 py-3 text-sm font-semibold text-[#00ff41] shadow-[0_0_18px_rgba(0,255,65,0.16)]">
              {bootMessage}
            </div>
          </div>
        ) : null}
        {!canRenderStream && risk === 'HIGH' ? <div className="pointer-events-none absolute inset-0 bg-[#ff1f1f]/10" /> : null}
        {!canRenderStream && risk === 'MEDIUM' ? <div className="pointer-events-none absolute inset-0 bg-[#ffaa00]/8" /> : null}
        <div className={`absolute left-3 top-3 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[11px] font-semibold ${liveNow ? 'border border-[#00ff41]/45 bg-[#082208]/75 text-[#00ff41]' : 'border border-[#2e3a2e] bg-[#111611]/75 text-[#6f8b6f]'}`}>
          <span className={`h-2 w-2 rounded-full ${liveNow ? 'live-dot' : 'bg-[#3d5a3d]'}`} />
          {liveNow ? 'LIVE' : 'STANDBY'}
        </div>
        <div className="absolute right-3 top-3 rounded-md border border-[#1a3a1a] bg-[#0d140d]/90 px-2 py-1 text-[11px] font-semibold text-[#00ff41]">
          Processed Feed
        </div>
        <div className="absolute left-3 bottom-3 rounded-md border border-[#1a3a1a] bg-[#0d140d]/90 px-2 py-1 text-[11px] font-semibold text-[#00cc33]">
          {zoneLabel}
        </div>
        <div className="absolute right-3 bottom-3 rounded-md border border-[#1a3a1a] bg-[#0d140d]/90 px-2 py-1 text-[11px] font-semibold text-[#00ff41]">
          FPS {fps || '--'}
        </div>
      </div>
    </article>
  )
}

export default LiveStream
