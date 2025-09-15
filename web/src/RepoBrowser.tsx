import { useState } from 'react'
import { listRepo, readRepoFile } from './api'

function errToString(e: unknown): string {
  if (e instanceof Error) return e.message
  try { return JSON.stringify(e) } catch { return String(e) }
}

export default function RepoBrowser() {
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [content, setContent] = useState<string>('')
  const [err, setErr] = useState<string>('')

  async function refresh() {
    try {
      const r = await listRepo()
      setFiles(r.files)
    } catch (e) {
      setErr(errToString(e))
    }
  }

  async function openFile(path: string) {
    setSelected(path)
    try {
      const r = await readRepoFile(path)
      setContent(r.content)
    } catch (e) {
      setErr(errToString(e))
    }
  }

  return (
    <div className="card">
      <h2>Repository</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn" onClick={refresh}>List files</button>
        {err && <span style={{ color: 'var(--red)' }}>{err}</span>}
      </div>
      <div className="grid">
        <div>
          <ul>
            {files.map(f => (
              <li key={f} style={{ cursor: 'pointer', color: 'var(--violet)' }} onClick={() => openFile(f)}>{f}</li>
            ))}
          </ul>
        </div>
        <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{selected ? content : 'Select a file'}</pre>
      </div>
    </div>
  )
}
