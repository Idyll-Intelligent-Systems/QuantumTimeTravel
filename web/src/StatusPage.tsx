import { useEffect, useState } from 'react'
import { getLogsTail, getStatus, getLastSpec } from './api'

function errToString(e: unknown): string {
  if (e instanceof Error) return e.message
  try { return JSON.stringify(e) } catch { return String(e) }
}

type Json = unknown
type StatusInfo = { status?: string; version?: string; run_id?: string; python?: string; last_plan?: Json; last_validate?: Json }

export default function StatusPage() {
  const [info, setInfo] = useState<StatusInfo | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [err, setErr] = useState<string>('')
  const [lastSpec, setLastSpec] = useState<Json | null>(null)
  const [webVersion, setWebVersion] = useState<{version?: string; buildTime?: string} | null>(null)

  useEffect(() => {
    let disposed = false
    const load = async () => {
      try { const s = await getStatus(); if (!disposed) setInfo(s) } catch (e) { if (!disposed) setErr(errToString(e)) }
      try { const t = await getLogsTail(200); if (!disposed) setLogs(t.lines ?? []) } catch (e) { if (!disposed) setErr(errToString(e)) }
  try { const ls = await getLastSpec(); if (!disposed) setLastSpec(ls.spec ?? null) } catch { /* ignore */ }
      try { const r = await fetch('/version.json'); if (r.ok) { const v = await r.json(); if (!disposed) setWebVersion({ version: v.version, buildTime: v.buildTime }) } } catch { /* ignore */ }
    }
    load()
    const id = setInterval(load, 8000)
    return () => { disposed = true; clearInterval(id) }
  }, [])

  return (
    <div className="card">
      <h2>Status</h2>
      {err && <div style={{ color: 'var(--red)' }}>{err}</div>}
      {webVersion && (
        <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>
          Web build v{webVersion.version ?? 'dev'} • built {webVersion.buildTime ?? 'unknown'}
        </div>
      )}
      <div className="grid">
        <div>
          <h3>Info</h3>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{info ? JSON.stringify(info, null, 2) : 'Loading…'}</pre>
        </div>
        <div>
          <h3>Recent Logs</h3>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>{logs.length ? logs.join('\n') : 'No logs'}</pre>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <h3>Last Spec</h3>
        <pre className="mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{lastSpec ? JSON.stringify(lastSpec, null, 2) : 'No last spec'}</pre>
      </div>
    </div>
  )
}
