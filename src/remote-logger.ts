let activeEndpointHost = '100.117.86.67'

export function setRemoteLoggerEndpoint(endpointUrl: string) {
  try {
    const parsed = new URL(endpointUrl)
    if (parsed.hostname && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      activeEndpointHost = parsed.hostname
    }
  } catch {}
}

const PRIMARY_LOG_URL = 'http://100.117.86.67:8765/'

export function remoteLog(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', tag: string, message: string) {
  const line = `[${level}][${tag}] ${message}`
  if (level === 'ERROR') {
    console.error(line)
  } else if (level === 'WARN') {
    console.warn(line)
  } else {
    console.log(line)
  }

  if (typeof fetch === 'function') {
    const urls = [PRIMARY_LOG_URL]
    if (activeEndpointHost && activeEndpointHost !== '100.117.86.67') {
      urls.push(`http://${activeEndpointHost}:8765/`)
    }
    for (const url of urls) {
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: line,
        mode: 'cors',
      }).catch(() => {})
    }
  }
}
