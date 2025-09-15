import cytoscape from 'cytoscape'
import type { ElementDefinition } from 'cytoscape'
import { useEffect, useRef, useState } from 'react'

type Attrs = Record<string, unknown>
type Spec = { states: string[]; transitions: Array<{src:string; dst:string; attributes?: Attrs}> }
type EdgeReport = { src: string; dst: string; weight: number; breakdown?: { velocity_fraction_c?: number; gamma?: number; duration_s?: number; crew_time_s?: number; risk_penalty?: number; warnings?: string[] } }
type Plan = { path: string[] }
type Props = { spec: Spec | null; plan: Plan | null; report?: EdgeReport[] }

export default function GraphView({ spec, plan, report }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [tip, setTip] = useState<{visible: boolean; x: number; y: number; lines: string[]; opacity: number}>({visible: false, x: 0, y: 0, lines: [], opacity: 0})
  const hideTimer = useRef<number | null>(null)
  const [filterWarned, setFilterWarned] = useState<boolean>(false)
  const [filterPlanned, setFilterPlanned] = useState<boolean>(false)

  // Read CSS variables for configuration (once per render)
  const rootStyle = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const tipPad = rootStyle ? parseInt(rootStyle.getPropertyValue('--tip-pad-px')) || 10 : 10
  const tipFade = rootStyle ? (rootStyle.getPropertyValue('--tip-fade-ms').trim() || '150ms') : '150ms'

  useEffect(() => {
    if (!ref.current || !spec) return
    const states: string[] = spec.states ?? []
  const t = (spec.transitions ?? []) as Array<{src:string;dst:string; attributes?: Attrs}>
    const pathSet = new Set<string>()
    const p = plan?.path ?? []
    for (let i=0;i<p.length-1;i++) pathSet.add(`${p[i]}->${p[i+1]}`)

    const costByEdge = new Map<string, number>()
    const metaByEdge = new Map<string, EdgeReport["breakdown"]>()
    for (const r of (report ?? [])) {
      const id = `${r.src}->${r.dst}`
      costByEdge.set(id, r.weight)
      if (r.breakdown) metaByEdge.set(id, r.breakdown)
    }

    const warnCountByEdge = new Map<string, number>()
    for (const r of (report ?? [])) {
      const id = `${r.src}->${r.dst}`
      const n = r.breakdown?.warnings?.length ?? 0
      if (n > 0) warnCountByEdge.set(id, n)
    }

    const elements: ElementDefinition[] = [
      ...states.map(s => ({ data: { id: s, label: s } })),
      ...t.map(e => {
        const id = `${e.src}->${e.dst}`
        const cost = costByEdge.get(id)
        const base = cost !== undefined ? `${e.src}→${e.dst}  (${cost.toFixed(2)})` : `${e.src}→${e.dst}`
        const warns = warnCountByEdge.get(id) || 0
        const label = warns > 0 ? `${base}  ⚠${warns}` : base
        const inPlan = pathSet.has(id)
        return ({ data: { id, source: e.src, target: e.dst, inPlan, label, warns } })
      })
    ]

    const cy = cytoscape({
      container: ref.current,
      elements: elements.filter(el => {
        if (el.group === 'nodes') return true
        const d = (el as unknown as { data?: { inPlan?: boolean; warns?: number } }).data ?? {}
        if (filterWarned && !((d.warns ?? 0) > 0)) return false
        if (filterPlanned && !(d.inPlan ?? false)) return false
        return true
      }),
      style: [
        { selector: 'node', style: { 'background-color': '#7a5cff', 'label': 'data(label)', 'color': '#e6e6f0', 'text-outline-color': '#0a0a0f', 'text-outline-width': 2 } },
        { selector: 'edge', style: { 'width': 2, 'line-color': '#a855f7', 'target-arrow-color': '#a855f7', 'target-arrow-shape': 'triangle', 'label': 'data(label)', 'font-size': 10, 'color': '#9aa0a6' } },
        { selector: 'edge[?inPlan]', style: { 'width': 4, 'line-color': '#ffc857', 'target-arrow-color': '#ffc857' } }
      ],
      layout: { name: 'circle' }
    })

    const buildLines = (id: string) => {
      const meta = metaByEdge.get(id)
      const cost = costByEdge.get(id)
      const lines = [
        `Edge ${id}`,
        cost !== undefined ? `Cost: ${cost.toFixed(3)}` : undefined,
        meta?.velocity_fraction_c !== undefined ? `β: ${meta.velocity_fraction_c.toFixed(6)}` : undefined,
        meta?.gamma !== undefined ? `γ: ${meta.gamma.toFixed(6)}` : undefined,
        meta?.duration_s !== undefined ? `Duration: ${meta.duration_s.toFixed(3)} s` : undefined,
        meta?.crew_time_s !== undefined ? `Crew time: ${meta.crew_time_s.toFixed(3)} s` : undefined,
        meta?.risk_penalty !== undefined ? `Risk penalty: ${meta.risk_penalty.toFixed(4)}` : undefined,
      ].filter(Boolean) as string[]
      return lines
    }

  const showTip = (edge: cytoscape.EdgeSingular) => {
      const id = edge.data('id') as string
      const lines = buildLines(id)
      if (lines.length === 0) return
      // Anchor tooltip to edge rendered midpoint for pixel-perfect placement
      const rbb = edge.renderedBoundingBox()
      const cx = (rbb.x1 + rbb.x2) / 2
      const cyMid = (rbb.y1 + rbb.y2) / 2
      const cont = ref.current
      if (cont) {
        const rect = cont.getBoundingClientRect()
        let px = rect.left + cx + 12
        let py = rect.top + cyMid + 12
        // Corner-aware clamping within viewport with small padding
  const pad = Number.isFinite(tipPad) ? tipPad : 10
        const vw = window.innerWidth
        const vh = window.innerHeight
        // Rough size estimate to clamp: 220x120
        const estW = 260
        const estH = Math.min(220, 20 + lines.length * 16)
        if (px + estW + pad > vw) px = vw - estW - pad
        if (py + estH + pad > vh) py = vh - estH - pad
        if (px < pad) px = pad
        if (py < pad) py = pad
        setTip({ visible: true, x: px, y: py, lines, opacity: 1 })
      }
    }
    const moveTip = (ev: MouseEvent | undefined) => {
      const x = ev?.clientX
      const y = ev?.clientY
      if (x == null || y == null) return
      setTip(prev => (prev.visible ? { ...prev, x: x + 12, y: y + 12 } : prev))
    }
    const hideTip = () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      // small delay to prevent flicker when moving between edges
      hideTimer.current = window.setTimeout(() => {
        setTip(prev => ({ ...prev, opacity: 0 }))
      }, 80)
    }

  cy.on('mouseover', 'edge', (e) => showTip(e.target))
  cy.on('tap', 'edge', (e) => showTip(e.target))
  cy.on('mousemove', (e) => moveTip(e.originalEvent as MouseEvent | undefined))
    cy.on('mouseout', hideTip)

    return () => { cy.destroy() }
  }, [spec, plan, report, filterWarned, filterPlanned, tipPad, tipFade])

  // Build warnings panel data
  const warningsList: Array<{ id: string; messages: string[] }> = []
  const seen = new Set<string>()
  for (const r of (report ?? [])) {
    const id = `${r.src}->${r.dst}`
    const msgs = r.breakdown?.warnings ?? []
    if (msgs.length && !seen.has(id)) {
      warningsList.push({ id, messages: msgs })
      seen.add(id)
    }
  }

  const narrow = typeof window !== 'undefined' && window.innerWidth < 1100
  const showPanel = warningsList.length > 0 && !narrow
  return <div className="card" style={{ padding: 0, position: 'relative' }}>
    <div style={{ display: 'grid', gridTemplateColumns: showPanel ? '2fr 1fr' : '1fr', gap: 8 }}>
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8 }}>
          <label className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>Edges:</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={filterWarned} onChange={e => setFilterWarned(e.target.checked)} /> warned only
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={filterPlanned} onChange={e => setFilterPlanned(e.target.checked)} /> planned only
          </label>
        </div>
        <div ref={ref} style={{ width: '100%', height: '82vh' }} />
      </div>
      {showPanel && (
        <div style={{ padding: 12, overflow: 'auto', maxHeight: '82vh' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Warnings</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warningsList.map(w => (
              <li key={w.id} style={{ marginBottom: 8 }}>
                <div style={{ color: 'var(--gold)', fontWeight: 600 }}>{w.id} ({w.messages.length})</div>
                <ul style={{ margin: 0, paddingLeft: 14 }}>
                  {w.messages.map((m, i) => <li key={w.id + '-' + i} style={{ color: 'var(--muted)' }}>⚠ {m}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  <div style={{ position: 'fixed', top: tip.y, left: tip.x, transform: `translate3d(0,0,0)`, background: 'rgba(10,10,15,0.95)', color: '#e6e6f0', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px', boxShadow: '0 10px 30px rgba(0,0,0,0.4)', zIndex: 1000, pointerEvents: 'none', opacity: tip.opacity, transition: `opacity ${tipFade} ease-in-out` }}>
      {tip.lines.map((l, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.3 }}>{l}</div>)}
    </div>
  </div>
}
