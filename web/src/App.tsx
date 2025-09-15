import { Suspense, lazy, useEffect, useState } from 'react'
import './theme.css'
import { planFromSpec, readRepoFile, validateSpec, getStatus, resolveApiBase, setApiBase, clearApiBase } from './api'
const GraphView = lazy(() => import('./GraphView'))
const FourDView = lazy(() => import('./components/FourDView'))
import PlannerForm from './PlannerForm'

// Lazy-loaded pages to reduce initial bundle
const RepoBrowser = lazy(() => import('./RepoBrowser.tsx'))
const StatusPage = lazy(() => import('./StatusPage.tsx'))

type PlanResponse = { ok: boolean; reason: string; path: string[]; cost: number | null }
type EdgeReport = { src: string; dst: string; weight: number; breakdown: { velocity_fraction_c: number; gamma: number; duration_s: number; crew_time_s: number; risk_prob: number; risk_penalty?: number; warnings?: string[]; terms: { energy_term: number; time_term: number; risk_term: number } } }

function errToString(e: unknown): string {
  if (e instanceof Error) return e.message
  try { return JSON.stringify(e) } catch { return String(e) }
}

const DEFAULT_SPEC = `{
  "states": ["A", "B", "C", "D"],
  "initial": "A",
  "ABC": ["A", "B", "C"],
  "policy": {
    "mode": "real_world",
    "allow_negative_edges": true,
    "strict_invariants": true,
    "weights": { "energy": 1.0, "earth_time": 0.1, "crew_time": 0.2, "risk": 2.0 },
    "energy_scale": 1e9
  },
  "transitions": [
    {"src":"A","dst":"B","attributes":{"distance_m":3.0e11,"earth_departure_epoch_s":1700000000,"earth_arrival_epoch_s":1700864000,"risk_prob":0.01,"energy_j":4.0e12}},
    {"src":"B","dst":"C","attributes":{"distance_m":5.0e11,"duration_s":100000,"risk_prob":0.02,"energy_j":7.0e12}},
    {"src":"C","dst":"A","attributes":{"distance_m":2.0e11,"duration_s":80000,"risk_prob":0.015,"energy_j":2.0e12}},
    {"src":"A","dst":"D","attributes":{"distance_m":1.2e12,"duration_s":300000,"risk_prob":0.03,"energy_j":1.1e13}},
    {"src":"D","dst":"C","attributes":{"distance_m":6.0e11,"duration_s":150000,"risk_prob":0.025,"energy_j":6.0e12}}
  ]
}`

function Planner() {
  const [specText, setSpecText] = useState<string>(DEFAULT_SPEC)
  const [inputMode, setInputMode] = useState<'json' | 'form'>('json')
  const [result, setResult] = useState<PlanResponse | null>(null)
  const [error, setError] = useState<string>('')
  const [report, setReport] = useState<EdgeReport[] | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [warnedOnly, setWarnedOnly] = useState<boolean>(false)
  const [deferGraph, setDeferGraph] = useState<boolean>(true)

  // Utility: download an object as pretty-printed JSON
  function downloadJson(filename: string, data: unknown) {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Failed to download ${filename}: ${errToString(e)}`)
    }
  }

  async function loadPreset(path: string) {
    try {
      setLoading(true)
      setError('')
      const r = await readRepoFile(path)
      setSpecText(r.content)
      setResult(null)
      setReport(null)
  } catch {
      // Fallback inline examples if repo read fails
      if (path.endsWith('abc_spec.json')) setSpecText(`{"states":["A","B","C"],"initial":"A","ABC":["A","B","C"],"policy":{"allow_negative_edges":true,"strict_invariants":true},"transitions":[{"src":"A","dst":"B","attributes":{"duration_s":10,"risk_prob":0.01}},{"src":"B","dst":"C","attributes":{"duration_s":5,"risk_prob":0.02}},{"src":"C","dst":"A","attributes":{"duration_s":12,"risk_prob":0.01}}]}`)
      else if (path.endsWith('abcd_spec.json')) setSpecText(`{"states":["A","B","C","D"],"initial":"A","ABC":["A","B","C"],"policy":{"mode":"real_world","allow_negative_edges":true,"strict_invariants":true},"transitions":[{"src":"A","dst":"B","attributes":{"distance_m":3.0e11,"earth_departure_epoch_s":1700000000,"earth_arrival_epoch_s":1700864000,"risk_prob":0.01,"energy_j":4.0e12}},{"src":"B","dst":"C","attributes":{"distance_m":5.0e11,"duration_s":100000,"risk_prob":0.02,"energy_j":7.0e12}},{"src":"C","dst":"D","attributes":{"distance_m":3.5e11,"duration_s":65000,"risk_prob":0.015,"energy_j":3.2e12}},{"src":"D","dst":"A","attributes":{"distance_m":2.0e11,"duration_s":80000,"risk_prob":0.015,"energy_j":2.0e12}}]}`)
      else if (path.endsWith('high_beta_demo.json')) setSpecText(`{"states":["A","B","C"],"initial":"A","ABC":["A","B","C"],"policy":{"mode":"real_world","allow_negative_edges":true,"strict_invariants":true},"transitions":[{"src":"A","dst":"B","attributes":{"distance_m":9.0e12,"duration_s":36000,"risk_prob":0.08,"energy_j":2.0e13}},{"src":"B","dst":"C","attributes":{"distance_m":1.5e13,"duration_s":60000,"risk_prob":0.1,"energy_j":3.5e13}},{"src":"C","dst":"A","attributes":{"distance_m":6.0e12,"duration_s":18000,"risk_prob":0.05,"energy_j":1.2e13}}]}`)
      else if (path.endsWith('abc_negative_cycle.json')) setSpecText(`{"states":["A","B","C"],"initial":"A","ABC":["A","B","C"],"policy":{"allow_negative_edges":true,"strict_invariants":true},"transitions":[{"src":"A","dst":"B","attributes":{"energy_j":1e9,"credits":200.0,"duration_s":1,"risk_prob":0.0}},{"src":"B","dst":"A","attributes":{"energy_j":1e9,"credits":200.0,"duration_s":1,"risk_prob":0.0}},{"src":"B","dst":"C","attributes":{"energy_j":1e9,"duration_s":1,"risk_prob":0.0}},{"src":"C","dst":"A","attributes":{"energy_j":1e9,"duration_s":1,"risk_prob":0.0}}]}`)
      else if (path.endsWith('abc_real_world.json')) setSpecText(`{"states":["A","B","C"],"initial":"A","ABC":["A","B","C"],"policy":{"mode":"real_world","allow_negative_edges":true,"strict_invariants":true},"transitions":[{"src":"A","dst":"B","attributes":{"distance_m":3.0e11,"earth_departure_epoch_s":1700000000,"earth_arrival_epoch_s":1700864000,"risk_prob":0.01,"energy_j":4.0e12}},{"src":"B","dst":"C","attributes":{"distance_m":5.0e11,"duration_s":100000,"risk_prob":0.02,"energy_j":7.0e12}},{"src":"C","dst":"A","attributes":{"distance_m":2.0e11,"duration_s":80000,"risk_prob":0.015,"energy_j":2.0e12}}]}`)
      else setError('Failed to load preset')
    } finally {
      setLoading(false)
    }
  }

  async function onPlan() {
    setError('')
    try {
      const spec = JSON.parse(specText)
      const res = await planFromSpec(spec)
      setResult(res)
    } catch (e) {
      setError(errToString(e))
    }
  }

  async function onValidate() {
    setError('')
    setReport(null)
    try {
      const spec = JSON.parse(specText)
      const r = await validateSpec({ ...spec, warned_only: warnedOnly })
      setReport(r.edges as EdgeReport[])
    } catch (e) {
      setError(errToString(e))
    }
  }

  return (
    <div className="card">
      <h2>Planner</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <label style={{ color: 'var(--muted)', fontSize: 12 }}>Input</label>
        <select value={inputMode} onChange={e => setInputMode(e.target.value as 'json' | 'form')} className="mono">
          <option value="json">JSON</option>
          <option value="form">Form</option>
        </select>
      </div>
      {inputMode === 'form' && (
        <PlannerForm onSpecText={(txt) => setSpecText(txt)} />
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <label style={{ color: 'var(--muted)', fontSize: 12 }}>Preset</label>
        <select className="mono" disabled={loading} onChange={(e) => { const p = e.target.value; if (p) loadPreset(p) }} defaultValue="">
          <option value="" disabled>Choose…</option>
          <option value="examples/abc_spec.json">ABC (basic)</option>
          <option value="examples/abcd_spec.json">ABCD (multi-leg)</option>
          <option value="examples/high_beta_demo.json">High β (dilation demo)</option>
          <option value="examples/abc_negative_cycle.json">Negative Cycle (should fail)</option>
          <option value="examples/abc_real_world.json">Real World (timestamps)</option>
        </select>
        <button className="btn" disabled={loading} onClick={() => { setSpecText(DEFAULT_SPEC); setResult(null); setReport(null); }}>Reset</button>
        {loading && <span style={{ color: 'var(--muted)' }}>loading…</span>}
        <label style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={warnedOnly} onChange={e => setWarnedOnly(e.target.checked)} /> warned-only validation
        </label>
      </div>
  <textarea style={{ width: '100%', minHeight: 200, background: 'var(--bg-accent)', color: 'var(--text)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', padding: 12 }} value={specText} onChange={e => setSpecText(e.target.value)} placeholder="Paste JSON spec here or use the Form above" />
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn" onClick={onPlan}>Plan A→B→C→A</button>
        <button className="btn" onClick={onValidate}>Validate Spec</button>
        {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
      </div>
  <div className="grid" style={{ gridTemplateColumns: (result || report) ? '1fr 1fr' : '1fr' }}>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>Graph</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="Mount the graph only after first Validate/Plan to minimize initial load.">
            <input type="checkbox" checked={deferGraph} onChange={e => setDeferGraph(e.target.checked)} /> on-demand mount
          </label>
        </div>
        {(!deferGraph || result || report) ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <Suspense fallback={<div className="card">Graph loading…</div>}> 
              <GraphView spec={specText ? JSON.parse(specText) : null} plan={result} report={report ?? undefined} />
            </Suspense>
          </div>
        ) : (
          <div className="card" style={{ gridColumn: '1 / -1', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
            Graph will render after you Validate or Plan (on-demand)
          </div>
        )}
        {(result || report) ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <Suspense fallback={<div className="card">4D view loading…</div>}>
              <FourDView spec={specText} report={report} plan={result} />
            </Suspense>
          </div>
        ) : (
          <div className="card" style={{ gridColumn: '1 / -1', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
            4D view will render after you Validate or Plan
          </div>
        )}
        {(result || report) && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                className="btn"
                disabled={!result}
                onClick={() => { if (result) downloadJson('plan.json', result) }}
                title={result ? 'Download the most recent plan result as JSON' : 'Plan JSON not available yet'}
              >
                Download plan JSON
              </button>
              <button
                className="btn"
                disabled={!report}
                onClick={() => { if (report) downloadJson('validation.json', report) }}
                title={report ? 'Download the most recent validation report as JSON' : 'Validation JSON not available yet'}
              >
                Download validation JSON
              </button>
            </div>
            {result && (
              <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(result, null, 2)}</pre>
            )}
            {report && (
              <div className="card">
                <h3>Validation</h3>
                <ul>
                  {report.map((e, i) => (
                    <li key={i}>
                      <strong>{e.src}→{e.dst}</strong> cost={e.weight.toFixed(3)} β={e.breakdown.velocity_fraction_c.toFixed(6)} γ={e.breakdown.gamma.toFixed(6)} duration={e.breakdown.duration_s.toFixed(3)} crew_time={e.breakdown.crew_time_s.toFixed(3)} risk={e.breakdown.risk_prob} {e.breakdown.risk_penalty !== undefined ? `risk_penalty=${e.breakdown.risk_penalty.toFixed(4)}` : ''}
                      {e.breakdown.warnings && e.breakdown.warnings.length > 0 && (
                        <ul style={{ color: 'var(--gold)' }}>
                          {e.breakdown.warnings.map((w, j) => <li key={j}>⚠ {w}</li>)}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<'planner' | 'repo' | 'status'>('planner')
  const [status, setStatus] = useState<{version?: string; run_id?: string} | null>(null)
  const [pollOn, setPollOn] = useState<boolean>(true)
  const [downloading, setDownloading] = useState<boolean>(false)
  const [apiInput, setApiInput] = useState<string>(() => resolveApiBase() ?? '')

  useEffect(() => {
    let cancel = false
    const fetchOnce = async () => {
      try { const s = await getStatus(); if (!cancel) setStatus(s) } catch { if (!cancel) setStatus(null) }
    }
    fetchOnce()
    const id = setInterval(() => { if (pollOn) fetchOnce() }, 5000)
    return () => { cancel = true; clearInterval(id) }
  }, [pollOn])

  const handleDownloadLogs = async () => {
    try {
      setDownloading(true)
      const res = await fetch('/api/logs/download')
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'events.log'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Failed to download logs: ${errToString(e)}`)
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="container">
      <h1 className="title">Quantum Time Travel <span className="accent">QASI-Ve1</span></h1>
      {status && (
        <div style={{ opacity: 0.8, fontSize: 12, marginBottom: 8, color: 'var(--muted)' }}>
          API v{status.version} • run {status.run_id}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <button className="btn" onClick={() => setTab('planner')}>Planner</button>
        <button className="btn" onClick={() => setTab('repo')}>Repository</button>
        <button className="btn" onClick={() => setTab('status')}>Status</button>
        <a className="btn" href="https://github.com/Idyll-Intelligent-Systems/QuantumTimeTravel" target="_blank" rel="noreferrer">View on GitHub</a>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>API</label>
          <input
            className="mono"
            style={{ width: 240 }}
            type="text"
            placeholder="/api or https://host/api"
            value={apiInput}
            onChange={e => setApiInput(e.target.value)}
          />
          <button className="btn" onClick={() => { if (apiInput) { setApiBase(apiInput.trim()); location.reload() } }} disabled={!apiInput}>Save</button>
          <button className="btn" title="Clear saved API base and use defaults" onClick={() => { clearApiBase(); setApiInput(resolveApiBase() ?? ''); location.reload() }}>Reset</button>
          <label className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>Health poll</label>
          <input type="checkbox" checked={pollOn} onChange={e => setPollOn(e.target.checked)} />
          <button className="btn" onClick={handleDownloadLogs} disabled={downloading}>{downloading ? 'Downloading…' : 'Download logs'}</button>
        </div>
      </div>
      <Suspense fallback={<div className="card">Loading…</div>}>
        {tab === 'planner' ? <Planner /> : tab === 'repo' ? <RepoBrowser /> : <StatusPage />}
      </Suspense>
    </div>
  )
}

