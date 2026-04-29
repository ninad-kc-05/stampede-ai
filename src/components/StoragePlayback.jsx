import { useMemo, useRef, useState } from 'react'

function normalizeMetricRow(row, feedId) {
  if (!row) return null
  return {
    ...row,
    adjusted_count: row.adjusted_count ?? row.adjusted,
    density_score: row.density_score ?? row.adjusted,
    motion_score: row.motion_score ?? row.motion,
    feed_id: row.feed_id ?? feedId,
  }
}

function StoragePlayback({
  feed,
  title = 'Processed Feed',
  subtitle = 'Storage Playback',
  timestampLabel = '--',
  zoneLabel,
  onMetricsSync,
  className = '',
  heightClass = 'h-[460px]',
  showHeader = true,
  showDebugInfo = true,
  showPlaceholder = true,
  videoClassName = 'w-full h-full object-cover',
}) {
  const videoRef = useRef(null)
  const [currentRow, setCurrentRow] = useState(null)
  const analytics = feed?.storageAnalytics || null
  const frames = useMemo(() => (Array.isArray(analytics?.frames) ? analytics.frames : []), [analytics])
  const fps = Number(analytics?.fps || feed?.storageFps || 24)
  const videoUrl = feed?.processedVideoUrl || null
  const analyticsUrl = feed?.analyticsUrl || null
  const videoId = feed?.videoId || feed?.storageVideoId || null
  const isProcessing = feed?.storageStatus === 'processing' || feed?.backendState === 'PROCESSING'
  const progress = Number(feed?.storageProgress ?? feed?.progress ?? 0)
  const displayRow = normalizeMetricRow(currentRow || frames[0], feed?.id)
  const statusLabel = videoUrl ? (feed?.status === 'LOOPING' ? 'LOOPING' : 'READY') : isProcessing ? 'PROCESSING' : 'IDLE'
  const timestamp = timestampLabel !== '--' ? timestampLabel : feed?.timestamp || displayRow?.timestamp || '--'
  const fpsLabel = displayRow?.fps ?? feed?.fps ?? feed?.storageFps ?? '--'

  const handleTimeUpdate = (event) => {
    if (!frames.length || !Number.isFinite(fps) || fps <= 0) return
    const nextIndex = Math.min(frames.length - 1, Math.max(0, Math.floor(event.currentTarget.currentTime * fps)))
    const nextRow = frames[nextIndex]
    if (!nextRow || nextRow.frame_id === currentRow?.frame_id) return
    setCurrentRow(nextRow)
    onMetricsSync?.(normalizeMetricRow(nextRow, feed?.id))
  }

  return (
    <article className={`${showHeader ? 'rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm' : ''} ${className}`}>
      {showHeader ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-[#00ff41]">{title}</p>
            <p className="text-sm text-[#00cc33]">{subtitle}</p>
          </div>
          <span className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-3 py-1 text-xs font-semibold text-[#00ff41]">
            Feed {feed?.id ?? '--'}
          </span>
        </div>
      ) : null}

      <div className={`relative w-full overflow-hidden rounded-lg border border-[#1a3a1a] bg-[#050a05] ${heightClass}`}>
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            autoPlay
            loop
            muted
            playsInline
            controls={false}
            className={videoClassName}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={(event) => handleTimeUpdate(event)}
          />
        ) : isProcessing ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[#00cc33]">
            <div className="w-full max-w-md">
              <p className="font-semibold text-[#00ff41]">Processing Feed {feed?.id ?? '--'}...</p>
              <p className="mt-1 text-xs text-[#00aa33]">{feed?.message || 'Saving processed video and analytics to storage'}</p>
              <div className="mt-3 h-2 overflow-hidden rounded border border-[#1a3a1a] bg-[#0a0f0a]">
                <div className="h-full bg-gradient-to-r from-[#00aa33] to-[#00ff41]" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
              </div>
            </div>
          </div>
        ) : showPlaceholder ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[#00cc33]">
            <div>
              <p className="font-semibold text-[#00ff41]">SYSTEM STATUS: IDLE</p>
              <p className="mt-1">Awaiting video input...</p>
              <p className="mt-1 text-xs text-[#00aa33]">No active surveillance feed detected.</p>
            </div>
          </div>
        ) : null}

        {videoUrl ? (
          <>
            <span className="pointer-events-none absolute left-2 top-2 rounded border border-[#00ff41]/40 bg-[#082208]/85 px-2 py-1 text-[10px] font-semibold text-[#00ff41]">
              {statusLabel}
            </span>
            <span className="pointer-events-none absolute left-2 bottom-2 rounded border border-[#1a3a1a] bg-[#0d140d]/85 px-2 py-1 text-[10px] font-semibold text-[#00cc33]">
              {zoneLabel || `Feed ${feed?.id ?? '--'}`}
            </span>
            <span className="pointer-events-none absolute right-2 bottom-2 rounded border border-[#1a3a1a] bg-[#0d140d]/85 px-2 py-1 text-[10px] font-semibold text-[#00ff41]">
              {timestamp} | FPS {fpsLabel}
            </span>
          </>
        ) : null}
      </div>

      {showDebugInfo ? (
        <div className="mt-2 space-y-1 break-all text-[11px] font-semibold text-[#00aa33]">
          <p>videoId: <span className="text-[#00ff41]">{videoId || '--'}</span></p>
          <p>processedVideoUrl: <span className="text-[#00ff41]">{videoUrl || '--'}</span></p>
          <p>analyticsUrl: <span className="text-[#00ff41]">{analyticsUrl || '--'}</span></p>
        </div>
      ) : null}
    </article>
  )
}

export default StoragePlayback
