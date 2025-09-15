import { useState } from 'react'

type Props = { onSpecText: (json: string) => void }

type Place = { name?: string; lat?: number; lon?: number }
type EdgeInputs = {
  distance_m?: number;
  duration_s?: number;
  dep?: string; // datetime-local
  arr?: string; // datetime-local
  risk_prob?: number;
  energy_j?: number;
  credits?: number;
}

function toEpochSec(dt?: string): number | undefined {
  if (!dt) return undefined
  const t = Date.parse(dt)
  if (isNaN(t)) return undefined
  return Math.floor(t / 1000)
}

function haversineMeters(a?: Place, b?: Place): number | undefined {
  if (!a?.lat || !a?.lon || !b?.lat || !b?.lon) return undefined
  const R = 6371e3
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const dφ = ((b.lat - a.lat) * Math.PI) / 180
  const dλ = ((b.lon - a.lon) * Math.PI) / 180
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
  return R * c
}

export default function PlannerForm({ onSpecText }: Props) {
  const [mode, setMode] = useState<'real_world' | 'simulation'>('real_world')
  const [allowNeg, setAllowNeg] = useState(true)
  const [strict, setStrict] = useState(true)
  const [strictForm, setStrictForm] = useState(true)
  const [showHints, setShowHints] = useState(true)
  const [weights, setWeights] = useState({ energy: 1.0, earth_time: 0.1, crew_time: 0.2, risk: 2.0 })
  const [energyScale, setEnergyScale] = useState(1e9)

  const [A, setA] = useState<Place>({ name: 'Past (A)', lat: undefined, lon: undefined })
  const [B, setB] = useState<Place>({ name: 'Present (B)', lat: undefined, lon: undefined })
  const [C, setC] = useState<Place>({ name: 'Future (C)', lat: undefined, lon: undefined })

  const [AB, setAB] = useState<EdgeInputs>({ risk_prob: 0.01 })
  const [BC, setBC] = useState<EdgeInputs>({ risk_prob: 0.02 })
  const [CA, setCA] = useState<EdgeInputs>({ risk_prob: 0.015 })

  // Validation helpers
  const hasDistance = (e: EdgeInputs, src: Place, dst: Place) => {
    if (e.distance_m != null && e.distance_m > 0) return true
    const d = haversineMeters(src, dst)
    return !!(d && d > 0)
  }
  const hasDuration = (e: EdgeInputs) => {
    if (e.duration_s != null && e.duration_s > 0) return true
    const dep = toEpochSec(e.dep)
    const arr = toEpochSec(e.arr)
    return !!(dep && arr && arr > dep)
  }
  const hasRisk = (e: EdgeInputs) => (e.risk_prob != null && e.risk_prob >= 0 && e.risk_prob < 1)

  const hasEnoughForHints = (e: EdgeInputs, src: Place, dst: Place) => {
    const distOk = hasDistance(e, src, dst)
    if (!distOk) return false
    // enough if explicit duration or both timestamps valid
    if (e.duration_s != null && e.duration_s > 0) return true
    const dep = toEpochSec(e.dep)
    const arr = toEpochSec(e.arr)
    return !!(dep && arr && arr > dep)
  }

  const legValid = (src: Place, dst: Place, e: EdgeInputs) => hasDistance(e, src, dst) && hasDuration(e) && hasRisk(e)
  const abValid = legValid(A, B, AB)
  const bcValid = legValid(B, C, BC)
  const caValid = legValid(C, A, CA)

  const canGenerate = strictForm ? (abValid && bcValid && caValid) : true

  // Anticipated warnings preview (very rough client-side hints)
  const previewWarnings = (src: Place, dst: Place, e: EdgeInputs): string[] => {
    const msgs: string[] = []
    const d = e.distance_m != null && e.distance_m > 0 ? e.distance_m : haversineMeters(src, dst)
    const durTs = (toEpochSec(e.dep) && toEpochSec(e.arr)) ? ((toEpochSec(e.arr) as number) - (toEpochSec(e.dep) as number)) : undefined
    const dur = (e.duration_s != null) ? e.duration_s : durTs
    if (d && dur && dur > 0) {
      const v = d / dur
      const c = 299_792_458
      if (v > c) msgs.push('implied superluminal average speed')
      const beta = Math.min(v / c, 0.999999)
      if (beta >= 0.9) msgs.push('high relativistic speed (beta≥0.9)')
    }
    if ((e.risk_prob ?? 0) >= 0.2) msgs.push('high mission risk (risk_prob≥0.2)')
    return msgs
  }

  function edgeAttributes(src: Place, dst: Place, e: EdgeInputs) {
    const attrs: Record<string, number> = {}
    // distance
    const d = e.distance_m != null && e.distance_m > 0 ? e.distance_m : haversineMeters(src, dst)
    if (d && d > 0) attrs.distance_m = d
    // duration
    if (e.duration_s && e.duration_s > 0) attrs.duration_s = e.duration_s
    const dep = toEpochSec(e.dep)
    const arr = toEpochSec(e.arr)
    if (!attrs.duration_s && dep && arr && arr > dep) {
      attrs.earth_departure_epoch_s = dep
      attrs.earth_arrival_epoch_s = arr
    }
    // energy, risk, credits
    if (e.energy_j != null) attrs.energy_j = e.energy_j
    if (e.risk_prob != null) attrs.risk_prob = e.risk_prob
    if (e.credits != null) attrs.credits = e.credits
    return attrs
  }

  function generateJSON() {
    if (!canGenerate) return
    const spec = {
      states: ['A', 'B', 'C'],
      initial: 'A',
      ABC: ['A', 'B', 'C'],
      policy: {
        mode,
        allow_negative_edges: allowNeg,
        strict_invariants: strict,
        weights,
        energy_scale: energyScale,
      },
      transitions: [
        { src: 'A', dst: 'B', attributes: edgeAttributes(A, B, AB) },
        { src: 'B', dst: 'C', attributes: edgeAttributes(B, C, BC) },
        { src: 'C', dst: 'A', attributes: edgeAttributes(C, A, CA) },
      ],
      meta: {
        places: {
          A, B, C,
        },
      },
    }
    onSpecText(JSON.stringify(spec, null, 2))
  }

  const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--muted)' }
  const inputStyle: React.CSSProperties = { width: '100%', padding: 6, borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', background: 'var(--bg-accent)', color: 'var(--text)' }

  // Build unmet summary
  const unmet: string[] = []
  if (!abValid) unmet.push('A→B')
  if (!bcValid) unmet.push('B→C')
  if (!caValid) unmet.push('C→A')

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h3>Form mode</h3>
      <p style={{ marginTop: -6, color: 'var(--muted)' }}>Build a spec with friendly fields. Coordinates are Earth lat/lon (WGS84). Date/time are local time and converted to epoch seconds.</p>

      <div className="grid">
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={labelStyle}>Mode</div>
              <select value={mode} onChange={e => setMode(e.target.value as 'real_world' | 'simulation')} style={inputStyle}>
                <option value="real_world">Real world (adaptive weights)</option>
                <option value="simulation">Simulation</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Energy scale</div>
              <input type="number" value={energyScale} onChange={e => setEnergyScale(parseFloat(e.target.value))} style={inputStyle} />
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={allowNeg} onChange={e => setAllowNeg(e.target.checked)} /> allow negative edges
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={strict} onChange={e => setStrict(e.target.checked)} /> strict invariants
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="When off, you can generate partial specs for experimentation.">
              <input type="checkbox" checked={strictForm} onChange={e => setStrictForm(e.target.checked)} /> strict form mode
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="Toggle client-side hints shown under each leg.">
              <input type="checkbox" checked={showHints} onChange={e => setShowHints(e.target.checked)} /> show hints
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={labelStyle}>Weights (energy, earth_time, crew_time, risk)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <input type="number" value={weights.energy} onChange={e => setWeights({ ...weights, energy: parseFloat(e.target.value) })} style={inputStyle} />
              <input type="number" value={weights.earth_time} onChange={e => setWeights({ ...weights, earth_time: parseFloat(e.target.value) })} style={inputStyle} />
              <input type="number" value={weights.crew_time} onChange={e => setWeights({ ...weights, crew_time: parseFloat(e.target.value) })} style={inputStyle} />
              <input type="number" value={weights.risk} onChange={e => setWeights({ ...weights, risk: parseFloat(e.target.value) })} style={inputStyle} />
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Places</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[{ key: 'A', place: A, set: setA }, { key: 'B', place: B, set: setB }, { key: 'C', place: C, set: setC }].map(({ key, place, set }) => (
              <div key={key} className="card" style={{ padding: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{key}</div>
                <div style={labelStyle}>Name (optional)</div>
                <input style={inputStyle} value={place.name || ''} onChange={e => set({ ...place, name: e.target.value })} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                  <div>
                    <div style={labelStyle}>Latitude</div>
                    <input type="number" style={inputStyle} value={place.lat ?? ''} onChange={e => set({ ...place, lat: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                  </div>
                  <div>
                    <div style={labelStyle}>Longitude</div>
                    <input type="number" style={inputStyle} value={place.lon ?? ''} onChange={e => set({ ...place, lon: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Legs</div>
        {!canGenerate && (
          <div style={{ color: 'var(--gold)', fontSize: 13, marginBottom: 6 }}>
            Missing required fields for: {unmet.join(', ')}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[{ key: 'A→B', val: AB, set: setAB, src: A, dst: B, ok: abValid }, { key: 'B→C', val: BC, set: setBC, src: B, dst: C, ok: bcValid }, { key: 'C→A', val: CA, set: setCA, src: C, dst: A, ok: caValid }].map(({ key, val, set, src, dst, ok }) => (
            <div key={key} className="card" style={{ padding: 8 }} data-leg-key={key} data-leg-invalid={ok ? 'false' : 'true'}>
              <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{key}</span>
                {ok ? <span title="Leg valid" style={{ color: '#18c36b' }}>✓</span> : <span title="Requires distance, duration, risk" style={{ color: 'var(--gold)' }}>•</span>}
              </div>
              <div style={labelStyle}>Distance (m) [optional if lat/lon set]</div>
              <input data-field="distance" type="number" style={inputStyle} value={val.distance_m ?? ''} onChange={e => set({ ...val, distance_m: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
              {!hasDistance(val, src, dst) && (
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Tip: set lat/lon for both endpoints or provide a distance.</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                <div>
                  <div style={labelStyle}>Duration (s)</div>
                  <input data-field="duration" type="number" style={inputStyle} value={val.duration_s ?? ''} onChange={e => set({ ...val, duration_s: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                </div>
                <div>
                  <div style={labelStyle}>Risk probability [0..1)</div>
                  <input data-field="risk" type="number" step="0.001" min={0} max={0.999} style={inputStyle} value={val.risk_prob ?? ''} onChange={e => set({ ...val, risk_prob: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                </div>
              </div>
              {!hasDuration(val) && (
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Tip: provide duration or both departure and arrival timestamps.</div>
              )}
              {!hasRisk(val) && (
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Tip: risk must be in [0,1).</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                <div>
                  <div style={labelStyle}>Depart (datetime)</div>
                  <input data-field="dep" type="datetime-local" style={inputStyle} value={val.dep ?? ''} onChange={e => set({ ...val, dep: e.target.value })} />
                </div>
                <div>
                  <div style={labelStyle}>Arrive (datetime)</div>
                  <input data-field="arr" type="datetime-local" style={inputStyle} value={val.arr ?? ''} onChange={e => set({ ...val, arr: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                <div>
                  <div style={labelStyle}>Energy (J)</div>
                  <input type="number" style={inputStyle} value={val.energy_j ?? ''} onChange={e => set({ ...val, energy_j: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                </div>
                <div>
                  <div style={labelStyle}>Credits (±)</div>
                  <input type="number" style={inputStyle} value={val.credits ?? ''} onChange={e => set({ ...val, credits: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                </div>
              </div>
              {(() => {
                if (!showHints) return null
                if (!hasEnoughForHints(val, src, dst)) return null
                const hints = previewWarnings(src, dst, val)
                if (!hints.length) return null
                return (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--gold)' }}>
                    Possible issues:
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                      {hints.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </div>
                )
              })()}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn" onClick={generateJSON} disabled={!canGenerate} title={!canGenerate ? `Complete required fields for: ${unmet.join(', ')}` : 'Generate JSON'}>Generate JSON</button>
        {!canGenerate && (
          <button className="btn" style={{ padding: '0.5rem 0.75rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text)' }}
            onClick={() => {
              // Determine first invalid leg and target its first missing field
              type Missing = { distance: boolean; duration: boolean; risk: boolean }
              const legs: Array<{ key: string; ok: boolean; missing: Missing }> = [
                { key: 'A→B', ok: abValid, missing: { distance: !hasDistance(AB, A, B), duration: !hasDuration(AB), risk: !hasRisk(AB) } },
                { key: 'B→C', ok: bcValid, missing: { distance: !hasDistance(BC, B, C), duration: !hasDuration(BC), risk: !hasRisk(BC) } },
                { key: 'C→A', ok: caValid, missing: { distance: !hasDistance(CA, C, A), duration: !hasDuration(CA), risk: !hasRisk(CA) } },
              ]
              const firstInvalid = legs.find(l => !l.ok)
              if (!firstInvalid) return
              const container = document.querySelector(`[data-leg-key="${firstInvalid.key}"]`) as HTMLElement | null
              if (!container) return
              container.scrollIntoView({ behavior: 'smooth', block: 'center' })
              const fieldOrder: Array<'distance' | 'duration' | 'risk'> = ['distance', 'duration', 'risk']
              const toFocus = fieldOrder.find(f => firstInvalid.missing[f])
              const target = toFocus ? (container.querySelector(`[input][data-field="${toFocus}"]`) as HTMLInputElement | null) || (container.querySelector(`[data-field="${toFocus}"]`) as HTMLInputElement | null) : null
              if (target) {
                target.focus()
                const orig = target.style.animation
                target.style.animation = 'field-pulse 800ms ease-out 1'
                window.setTimeout(() => { target.style.animation = orig }, 850)
              }
            }}>Why disabled?</button>
        )}
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>Click to populate the JSON editor below. You can still tweak values manually.</span>
      </div>
    </div>
  )
}
