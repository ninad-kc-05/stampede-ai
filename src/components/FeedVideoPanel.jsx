import StreamViewer from './StreamViewer'

function FeedVideoPanel({
  feedId,
  type = 'clean',
  title = '',
  status = {},
  metrics = {},
  className = '',
  streamKey = 0,
}) {
  return (
    <div className={`relative aspect-video min-h-[360px] w-full overflow-hidden rounded-xl border border-[#1a3a1a] bg-[#050a05] ${className}`}>
      <StreamViewer
        feedId={feedId}
        type={type}
        streamKey={streamKey}
        className="h-full w-full object-cover"
      />
    </div>
  )
}

export default FeedVideoPanel
