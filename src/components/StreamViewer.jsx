import { useState, useEffect, useMemo } from 'react'
import API_BASE_URL from '../config/api'

const BACKEND_RETRY_INTERVAL_MS = 5000

function StreamViewer({
  feedId,
  type = 'clean',
  streamKey = 0,
  className = '',
}) {
  const numericFeedId = Number(feedId)
  const hasValidFeedId = Number.isInteger(numericFeedId) && numericFeedId > 0

  const [reloadKey, setReloadKey] = useState(0)

  // Only update reloadKey when feedId or type actually changes
  useEffect(() => {
    setReloadKey(prev => prev + 1)
  }, [feedId, type])

  // Stable URL that only changes when feedId, type, or reloadKey changes
  const url = useMemo(() => {
    const base = type === 'debug'
      ? `${API_BASE_URL}/video/debug-stream`
      : `${API_BASE_URL}/video/stream`
    return `${base}?feed_id=${numericFeedId}&v=${reloadKey}`
  }, [numericFeedId, type, reloadKey])

  if (!hasValidFeedId) {
    return (
      <div className={`relative w-full h-full bg-black overflow-hidden rounded-lg ${className}`}>
        <div className="flex h-full w-full items-center justify-center text-sm text-[#00cc33]">
          Invalid feed
        </div>
      </div>
    )
  }

  // Error handler: retry only on actual error
  const handleError = () => {
    console.log('[frontend] stream retry', { feed_id: numericFeedId, type, retry_ms: BACKEND_RETRY_INTERVAL_MS })
    setTimeout(() => setReloadKey(prev => prev + 1), BACKEND_RETRY_INTERVAL_MS)
  }

  return (
    <div className={`relative w-full h-full bg-black overflow-hidden rounded-lg ${className}`}>
      <img
        key={`${type}-${numericFeedId}-${streamKey}`}
        src={url}
        className="w-full h-full object-cover block"
        alt="feed"
        onError={handleError}
      />
    </div>
  )
}

export default StreamViewer
