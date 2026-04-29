import { Upload, Play, Pause, Video, Crosshair } from 'lucide-react'
import StreamViewer from './StreamViewer'

const riskGlow = {
  LOW: 'shadow-[0_0_20px_rgba(0,255,65,0.15)] border-[#00ff41]/20',
  MEDIUM: 'shadow-[0_0_25px_rgba(255,170,0,0.2)] border-[#ffaa00]/20',
  HIGH: 'shadow-[0_0_30px_rgba(255,51,51,0.3)] border-[#ff3333]/30',
}

function CameraFeed({
  zone,
  riskLevel,
  heatmapPoints,
  videoRef,
  videoUrl,
  onVideoUpload,
  videoTime,
  feedId = 1,
}) {
  const showLegacyPlaceholder = false

  return (
    <article
      className={`relative overflow-hidden rounded-sm border border-[#1a3a1a] bg-[#0b100b] p-4 transition-all duration-500 ${riskGlow[riskLevel]}`}
    >
      <div className="mb-4 flex items-center justify-between border-b border-[#1a3a1a] pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-[#ff3333]/30 bg-[#ff3333]/10">
            <div className="h-2 w-2 rounded-full bg-[#ff3333] animate-pulse"></div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-[#00ff41] tracking-wider">▸ SURVEILLANCE FEED</h3>
            <p className="text-xs text-[#004d14]">SECTOR: {zone}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-[#1a3a1a] bg-[#0d140d] px-3 py-1.5 text-xs font-medium text-[#00cc33] transition hover:border-[#00ff41] hover:text-[#00ff41]">
            <Upload className="h-3 w-3" />
            LOAD FEED
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={onVideoUpload}
            />
          </label>
        </div>
      </div>

      <div className="relative min-h-[450px] overflow-hidden rounded-sm border border-[#1a3a1a] bg-[#0a0f0a]">
        {/* Priority: Uploaded video > Backend stream > placeholder */}
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="h-[450px] w-full object-cover"
            autoPlay
            muted
          />
        ) : (
          <StreamViewer
            feedId={feedId}
            type="clean"
            status={{ state: 'READY', packets_count: 1 }}
            className="h-[450px] w-full"
            showPlaceholder
          />
        )}
        {showLegacyPlaceholder && (
          <div className="flex h-[450px] flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 rounded-sm border border-[#1a3a1a] bg-[#0d140d] p-4">
              <Play className="h-8 w-8 text-[#004d14]" />
            </div>
            <h4 className="text-sm font-medium text-[#00cc33]">▸ NO SIGNAL</h4>
            <p className="mt-2 text-xs text-[#004d14]">
              ► INSERT VIDEO FEED TO INITIATE AI ANALYSIS
            </p>
          </div>
        )}

        {/* CRT Grid Overlay */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(0,255,65,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,65,0.02)_1px,transparent_1px)] bg-[size:20px_20px]" />
        
        {/* Vignette Effect */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.6)_100%)]" />

        {/* Heatmap Points */}
        {heatmapPoints.map((point) => (
          <span
            key={point.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff3333] blur-md"
            style={{
              top: point.top,
              left: point.left,
              width: point.size,
              height: point.size,
              opacity: point.opacity,
            }}
          />
        ))}

        {/* Live Indicator */}
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-sm border border-[#ff3333]/50 bg-[#ff3333]/20 px-2 py-1 text-xs font-bold text-[#ff3333]">
          <div className="h-1.5 w-1.5 rounded-full bg-[#ff3333] animate-pulse"></div>
          LIVE
        </div>
        
        {/* Timestamp */}
        <div className="absolute right-3 top-3 rounded-sm border border-[#1a3a1a] bg-[#0a0f0a]/80 px-2 py-1 text-xs text-[#00cc33] font-mono">
          T+ {Math.floor(videoTime)}s
        </div>

        {/* Corner Brackets - Military Style */}
        <div className="absolute left-3 top-3 h-6 w-6 border-l border-t border-[#00ff41]/50"></div>
        <div className="absolute right-3 top-3 h-6 w-6 border-r border-t border-[#00ff41]/50"></div>
        <div className="absolute bottom-3 left-3 h-6 w-6 border-l border-b border-[#00ff41]/50"></div>
        <div className="absolute bottom-3 right-3 h-6 w-6 border-r border-b border-[#00ff41]/50"></div>

        {/* Crosshair Center */}
        <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2">
          <Crosshair className="h-full w-full text-[#00ff41]/20" />
        </div>
      </div>
    </article>
  )
}

export default CameraFeed
