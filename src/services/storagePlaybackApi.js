import API_BASE_URL from '../config/api'

export function resolveStorageAssetUrl(path) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) {
    const sourceUrl = new URL(path)
    const configuredUrl = new URL(API_BASE_URL)
    if (sourceUrl.origin === configuredUrl.origin) return sourceUrl.toString()
    if (sourceUrl.port === '8000') {
      return `${configuredUrl.origin}${sourceUrl.pathname}${sourceUrl.search}${sourceUrl.hash}`
    }
    return sourceUrl.toString()
  }
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

async function readJsonResponse(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || data.detail || `Request failed with status ${response.status}`)
  }
  return data
}

export async function uploadStorageVideo(file, feedId) {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${API_BASE_URL}/upload?feed_id=${feedId}`, {
    method: 'POST',
    body: form,
  })
  return readJsonResponse(response)
}

export async function fetchStorageStatus(videoId) {
  const response = await fetch(`${API_BASE_URL}/status/${videoId}`)
  return readJsonResponse(response)
}

export async function fetchStorageAnalytics(analyticsUrl) {
  if (!analyticsUrl) return null
  const response = await fetch(analyticsUrl)
  return readJsonResponse(response)
}
