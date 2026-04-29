import { Play, Square } from 'lucide-react'
import StorageUpload from './StorageUpload'

function ControlPanel({
  selectedFeedId,
  onFeedChange,
  onStart,
  onStop,
  onUpload,
  mode,
  onModeChange,
  modeDisabled,
  disabledStart,
  disabledStop,
  disabledUpload,
  status,
  feeds = [],
}) {
  const isProcessing = String(status.state || '').toUpperCase() === 'PROCESSING'
  return (
    <section className="rounded-2xl border border-[#1a3a1a] bg-[#0b100b] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={disabledStart}
            className="inline-flex items-center gap-2 rounded-lg border border-[#00ff41]/40 bg-[#00ff41]/15 px-4 py-2 text-sm font-semibold text-[#00ff41] shadow-sm hover:bg-[#00ff41]/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Start Feed
          </button>

          <button
            type="button"
            onClick={onStop}
            disabled={disabledStop}
            className="inline-flex items-center gap-2 rounded-lg border border-[#ff3333]/40 bg-[#ff3333]/15 px-4 py-2 text-sm font-semibold text-[#ff3333] shadow-sm hover:bg-[#ff3333]/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Square className="h-4 w-4" />
            Stop Feed
          </button>

          <StorageUpload onUpload={onUpload} disabled={disabledUpload} />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[#00cc33]">Selected Feed</label>
          <select
            value={`feed-${selectedFeedId || 1}`}
            onChange={(e) => onFeedChange(e.target.value)}
            className="rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-3 py-2 text-sm text-[#00cc33]"
          >
            {(feeds.length ? feeds : [1, 2, 3, 4, 5, 6].map((id) => ({ id, status: 'EMPTY' }))).map((feed) => (
              <option key={feed.id} value={`feed-${feed.id}`}>
                Feed {feed.id} ({feed.status || 'EMPTY'})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3 max-w-[240px]">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#00cc33]">Processing Mode</label>
          <select
            value={mode}
            onChange={(e) => onModeChange?.(e.target.value)}
            disabled={modeDisabled}
            className="w-full rounded-lg border border-[#1a3a1a] bg-[#0d140d] px-3 py-2 text-sm text-[#00cc33] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="" disabled>Select mode</option>
            <option value="prototype_buffered">Prototype Buffered</option>
            <option value="continuous_monitoring">Continuous Monitoring</option>
          </select>
        </div>
      </div>
      <p className="mt-3 text-sm text-[#004d14]">
        System state: <span className="font-semibold text-[#00ff41]">{status.state?.toUpperCase?.() || 'IDLE'}</span>
      </p>
      {isProcessing ? (
        <div className="mt-2 h-2 overflow-hidden rounded border border-[#1a3a1a] bg-[#0a0f0a]">
          <div className="h-full bg-gradient-to-r from-[#00aa33] to-[#00ff41] transition-all duration-300" style={{ width: `${status.progress || 0}%` }} />
        </div>
      ) : null}
    </section>
  )
}

export default ControlPanel
