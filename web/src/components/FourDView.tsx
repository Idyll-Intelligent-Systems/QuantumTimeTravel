import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
// NOTE: OrbitControls is code-split via dynamic import to reduce base chunk size

// Types
export type PlanResponse = { ok: boolean; reason: string; path: string[]; cost: number | null }
export type EdgeReport = { src: string; dst: string; weight: number; breakdown: { velocity_fraction_c: number; gamma: number; duration_s: number; crew_time_s: number; risk_prob: number; warnings?: string[] } }

type Spec = { states?: string[]; transitions?: Array<{ src: string; dst: string; attributes?: Record<string, number> }> }

// Small hook to persist UI state across tab switches
function usePersistentState<T>(key: string, initial: T) {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ }
  }, [key, val])
  return [val, setVal] as const
}

type OrbitControlsLike = {
  update: () => void
  dispose: () => void
  addEventListener: (type: string, listener: (...args: unknown[]) => void) => void
  removeEventListener?: (type: string, listener: (...args: unknown[]) => void) => void
  target: THREE.Vector3
  enableDamping?: boolean
  dampingFactor?: number
  enablePan?: boolean
  minDistance?: number
  maxDistance?: number
}

function useThreeScene() {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<{
    renderer?: THREE.WebGLRenderer
    scene?: THREE.Scene
    camera?: THREE.PerspectiveCamera
    controls?: OrbitControlsLike
    raf?: number
  }>({})

  useEffect(() => {
    const mountEl = mountRef.current!
    let disposeControls: (() => void) | null = null
    const setup = async () => {
      const width = mountEl.clientWidth || 800
      const height = mountEl.clientHeight || 400
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setSize(width, height)
      renderer.setPixelRatio(window.devicePixelRatio)
      mountEl.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0a0b10)

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000)
      camera.position.set(0, 10, 22)

      const light = new THREE.DirectionalLight(0xffffff, 0.9)
      light.position.set(10, 20, 10)
      scene.add(light)
      scene.add(new THREE.AmbientLight(0x404040))

      const grid = new THREE.GridHelper(40, 40, 0x444444, 0x222222)
      grid.position.y = -2
      scene.add(grid)

      const axes = new THREE.AxesHelper(8)
      scene.add(axes)

      // Dynamic import OrbitControls only in the browser
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
  const controls: OrbitControlsLike = new OrbitControls(camera, renderer.domElement) as unknown as OrbitControlsLike
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.enablePan = true
      controls.minDistance = 5
      controls.maxDistance = 100

      const render = () => { renderer.render(scene, camera) }
      // Load persisted camera pose (if any)
      try {
        const raw = localStorage.getItem('fourD.camera')
        if (raw) {
          const saved = JSON.parse(raw)
          if (saved?.pos && saved?.target) {
            camera.position.set(saved.pos.x ?? 0, saved.pos.y ?? 10, saved.pos.z ?? 22)
            controls.target.set(saved.target.x ?? 0, saved.target.y ?? 0, saved.target.z ?? 0)
            controls.update?.()
          }
        }
      } catch { /* ignore */ }

      let lastSave = 0
      const onControlsChange = () => {
        render()
        const now = performance.now()
        if (now - lastSave > 300) {
          lastSave = now
          try {
            const payload = {
              pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
              target: { x: controls.target.x, y: controls.target.y, z: controls.target.z }
            }
            localStorage.setItem('fourD.camera', JSON.stringify(payload))
          } catch { /* ignore */ }
        }
      }
      controls.addEventListener('change', onControlsChange)

      const loop = () => {
        controls.update()
        render()
        stateRef.current.raf = requestAnimationFrame(loop)
      }
      loop()

      const onResize = () => {
        const w = mountEl.clientWidth
        const h = mountEl.clientHeight
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
        render()
      }
      window.addEventListener('resize', onResize)

      stateRef.current = { renderer, scene, camera, controls, raf: stateRef.current.raf }
      disposeControls = () => controls.dispose()

      return () => {
        window.removeEventListener('resize', onResize)
        try { controls.removeEventListener?.('change', onControlsChange) } catch { /* ignore */ }
      }
    }

  setup().then(() => {}).catch(() => { /* ignore dynamic import/setup failure */ })

    return () => {
      if (stateRef.current.raf) cancelAnimationFrame(stateRef.current.raf)
  try { disposeControls?.() } catch { /* ignore */ }
      const mount = mountEl
      const renderer = stateRef.current.renderer
      if (renderer && mount) {
  try { renderer.dispose() } catch { /* ignore */ }
  try { mount.removeChild(renderer.domElement) } catch { /* ignore */ }
      }
    }
  }, [])

  return { mountRef, stateRef }
}

function layoutNodes(states: string[]) {
  const n = states.length
  const r = 8
  const positions = new Map<string, THREE.Vector3>()
  states.forEach((s, i) => {
    const theta = (i / Math.max(1, n)) * Math.PI * 2
    positions.set(s, new THREE.Vector3(r * Math.cos(theta), 0, r * Math.sin(theta)))
  })
  return positions
}

// Infer node absolute times using any provided timestamps and durations
function deriveNodeTimes(trans: Array<{ src: string; dst: string; attributes?: Record<string, number> }>) {
  const nodeTimes = new Map<string, number>()
  // Seed with any explicit departure/arrival times
  for (const t of trans) {
    const a = t.attributes || {}
    const dep = a.earth_departure_epoch_s
    const arr = a.earth_arrival_epoch_s
    if (typeof dep === 'number') nodeTimes.set(t.src, Math.min(nodeTimes.get(t.src) ?? dep, dep))
    if (typeof arr === 'number') nodeTimes.set(t.dst, Math.min(nodeTimes.get(t.dst) ?? arr, arr))
  }
  // Relaxation using durations up to a bounded number of times
  for (let pass = 0; pass < trans.length * 2; pass++) {
    let updated = false
    for (const t of trans) {
      const a = t.attributes || {}
      const dur = a.duration_s ?? (
        typeof a.earth_departure_epoch_s === 'number' && typeof a.earth_arrival_epoch_s === 'number'
          ? a.earth_arrival_epoch_s - a.earth_departure_epoch_s
          : undefined
      )
      if (dur === undefined) continue
      const ts = nodeTimes.get(t.src)
      const td = nodeTimes.get(t.dst)
      if (ts !== undefined && td === undefined) { nodeTimes.set(t.dst, ts + dur); updated = true }
      if (td !== undefined && ts === undefined) { nodeTimes.set(t.src, td - dur); updated = true }
    }
    if (!updated) break
  }
  // Check if we actually derived any absolute reference
  const values = Array.from(nodeTimes.values())
  const haveAbsolute = values.length > 0 && values.every(v => Number.isFinite(v))
  return { nodeTimes, haveAbsolute }
}

export default function FourDView({ spec, report, plan }: { spec: string | Spec; report?: EdgeReport[] | null; plan?: PlanResponse | null }) {
  const { mountRef, stateRef } = useThreeScene()
  const [mode, setMode] = usePersistentState<'spatial' | 'space-time'>('fourD.mode', 'spatial')
  const [showLabels, setShowLabels] = usePersistentState<boolean>('fourD.labels', false)
  const [playing, setPlaying] = usePersistentState<boolean>('fourD.playing', false)
  const [speed, setSpeed] = usePersistentState<number>('fourD.speed', 1.0)
  const [follow, setFollow] = usePersistentState<boolean>('fourD.follow', false)
  const [followDist, setFollowDist] = usePersistentState<number>('fourD.followDist', 6)
  const [bankIntensity, setBankIntensity] = usePersistentState<number>('fourD.bank', 0.4)
  const [hudPos, setHudPos] = usePersistentState<'top' | 'bottom'>('fourD.hudPos', 'top')
  const [routeT, setRouteT] = useState(0)
  const [routeTotal, setRouteTotal] = useState(0)
  const [routeHasTimes, setRouteHasTimes] = useState(false)
  const [timeRange, setTimeRange] = useState<{ have: boolean; start?: number; end?: number } | null>(null)
  const routeTRef = useRef(0)
  useEffect(() => { routeTRef.current = routeT }, [routeT])
  // Note: resetCamera defined above near helpers
  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const segsRef = useRef<Array<{ from: THREE.Vector3; to: THREE.Vector3; dur: number; dep?: number; arr?: number; uId: string; vId: string; beta: number; gamma: number; risk?: number }>>([])
  const boundsRef = useRef<number[]>([])
  const absStartRef = useRef<number | undefined>(undefined)
  const hudRef = useRef<{ segIndex: number; beta?: number; gamma?: number; earthElapsed: number; crewElapsed?: number; risk?: number; label?: string }>({ segIndex: 0, earthElapsed: 0 })
  const [hud, setHud] = useState(hudRef.current)
  const [showWarnDetails, setShowWarnDetails] = usePersistentState<boolean>('fourD.warnDetails', false)
  const hudThrottleRef = useRef<number>(0)
  const prevPlayingRef = useRef<boolean>(false)

  const resetCamera = () => {
    const cam = stateRef.current.camera
    const ctr = stateRef.current.controls
    if (cam) cam.position.set(0, 10, 22)
    if (ctr) ctr.target.set(0, 0, 0)
  }

  const fitRoute = () => {
    const cam = stateRef.current.camera
    const ctr = stateRef.current.controls
    const segs = segsRef.current
    if (!cam || !ctr || !segs || segs.length === 0) return
    const box = new THREE.Box3()
    for (const s of segs) { box.expandByPoint(s.from); box.expandByPoint(s.to) }
    const center = new THREE.Vector3(); box.getCenter(center)
    const size = new THREE.Vector3(); box.getSize(size)
    const fov = (cam.fov || 45) * Math.PI / 180
    const aspect = cam.aspect || 16/9
    const maxDim = Math.max(size.y, size.x / aspect, size.z / aspect)
    const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.4
    const dir = cam.position.clone().sub(ctr.target.clone()).normalize()
    cam.position.copy(center.clone().add(dir.multiplyScalar(Math.max(dist, 6))))
    ctr.target.copy(center)
    ctr.update?.()
  }

  const takeScreenshot = () => {
    const renderer = stateRef.current.renderer
    if (!renderer) return
    try {
      const dataURL = renderer.domElement.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = dataURL
      a.download = `fourD-screenshot-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch { /* ignore */ }
  }

  const parsed = useMemo(() => {
    try { return typeof spec === 'string' ? JSON.parse(spec) : spec } catch { return null }
  }, [spec])

  useEffect(() => {
    const scn = stateRef.current.scene
    if (!scn || !parsed) return
    // Keep lights/grid/axes; remove dynamic children beyond the first few
    while (scn.children.length > 6) scn.remove(scn.children[scn.children.length - 1])

    const states: string[] = parsed.states || []
    const trans: Array<{ src: string; dst: string; attributes?: Record<string, number> }> = parsed.transitions || []
    const layout = layoutNodes(states)
    const c = 299_792_458
    const hour = 3600

    // Derive node absolute times from mix of timestamps and durations
    const { nodeTimes, haveAbsolute } = deriveNodeTimes(trans)

    // Determine absolute time bounds if available
    let tMin = Number.POSITIVE_INFINITY
    let tMax = Number.NEGATIVE_INFINITY
    if (haveAbsolute) {
      for (const [, t] of nodeTimes) { tMin = Math.min(tMin, t); tMax = Math.max(tMax, t) }
      // Guard in case only one time exists; expand slightly
      if (!(tMax > tMin)) { tMax = tMin + 1 }
    }
    const timeScale = 1 / hour
    setTimeRange({ have: haveAbsolute, start: Number.isFinite(tMin) ? tMin : undefined, end: Number.isFinite(tMax) ? tMax : undefined })

    // Nodes
    const sphere = new THREE.SphereGeometry(0.4, 16, 16)
    const nodeMat = new THREE.MeshStandardMaterial({ color: 0x44ccff })
    states.forEach(s => {
      const pos = (layout.get(s) || new THREE.Vector3()).clone()
      if (mode === 'space-time' && haveAbsolute) {
        const t = nodeTimes.get(s)
        if (t !== undefined) pos.z += (t - tMin) * timeScale
      }
      const mesh = new THREE.Mesh(sphere, nodeMat)
      mesh.position.copy(pos)
      scn.add(mesh)
    })

    // Edges
    const riskColor = new THREE.Color(0xffaa00)
    const linesToPulse: THREE.Sprite[] = []
  const labelCleanups: Array<() => void> = []
  trans.forEach(t => {
      const a = t.attributes || {}
      const d = a.distance_m
      const dur = a.duration_s ?? (typeof a.earth_departure_epoch_s === 'number' && typeof a.earth_arrival_epoch_s === 'number' ? (a.earth_arrival_epoch_s - a.earth_departure_epoch_s) : undefined)
      const v = (d && dur && dur > 0) ? d / dur : 0
      const beta = v > 0 ? Math.min(v / c, 0.999999) : 0
      const gamma = beta > 0 ? 1.0 / Math.sqrt(1 - beta * beta) : 1.0
      const risk = (a.risk_prob ?? 0)
      const warn = (report || []).find(r => r.src === t.src && r.dst === t.dst && r.breakdown.warnings && r.breakdown.warnings.length > 0)

      const fromBase = layout.get(t.src) || new THREE.Vector3()
      const toBase = layout.get(t.dst) || new THREE.Vector3()
      const from = fromBase.clone()
      const to = toBase.clone()
      if (mode === 'space-time' && haveAbsolute) {
        // Prefer explicit per-edge times; else fallback to node times +/- duration
        const dep = typeof a.earth_departure_epoch_s === 'number' ? a.earth_departure_epoch_s : nodeTimes.get(t.src)
        const arr = typeof a.earth_arrival_epoch_s === 'number' ? a.earth_arrival_epoch_s : (
          dep !== undefined && dur !== undefined ? dep + dur : nodeTimes.get(t.dst)
        )
        if (dep !== undefined) from.z += (dep - tMin) * timeScale
        if (arr !== undefined) to.z += (arr - tMin) * timeScale
      }

      const g = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()])
      const color = warn ? new THREE.Color(0xff5555) : new THREE.Color().setHSL(0.6 - beta * 0.6, 1.0, 0.5)
      const mat = new THREE.LineBasicMaterial({ color })
      const line = new THREE.Line(g, mat)
      scn.add(line)

      if (warn) {
        const spriteMat = new THREE.SpriteMaterial({ color: riskColor })
        const sprite = new THREE.Sprite(spriteMat)
        sprite.position.copy(from.clone().add(to).multiplyScalar(0.5))
        sprite.scale.set(0.8, 0.8, 0.8)
        scn.add(sprite)
        linesToPulse.push(sprite)
      }

  if (showLabels) {
        const text = `β=${beta.toFixed(3)} γ=${gamma.toFixed(2)} dur=${dur ?? 0}s risk=${risk}`
        let canvas = labelCanvasRef.current
        if (!canvas) { canvas = document.createElement('canvas'); labelCanvasRef.current = canvas }
        const ctx = canvas.getContext('2d')!
        ctx.font = '12px monospace'
        const metrics = ctx.measureText(text)
        canvas.width = Math.ceil(metrics.width) + 8
        canvas.height = 20
        ctx.font = '12px monospace'
        ctx.fillStyle = 'rgba(10,11,16,0.8)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#fff'
        ctx.fillText(text, 4, 14)
        const tex = new THREE.Texture(canvas)
        tex.needsUpdate = true
        const smat = new THREE.SpriteMaterial({ map: tex, depthTest: false })
        const label = new THREE.Sprite(smat)
        label.position.copy(from.clone().add(to).multiplyScalar(0.5))
        label.scale.set(4, 1.2, 1)
        scn.add(label)
        labelCleanups.push(() => {
          try { scn.remove(label) } catch { /* ignore remove label */ }
          try { (smat.map as THREE.Texture | null)?.dispose?.() } catch { /* ignore dispose map */ }
          try { smat.dispose() } catch { /* ignore dispose material */ }
        })
      }
    })

    // Time axis rail
  if (mode === 'space-time' && haveAbsolute) {
      const axisMat = new THREE.LineBasicMaterial({ color: 0x8888ff })
      const axisGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -1.5, 0),
        new THREE.Vector3(0, -1.5, (tMax - tMin) * timeScale)
      ])
      const axis = new THREE.Line(axisGeom, axisMat)
      scn.add(axis)
      const tickStep = 6 * hour
      const start = Math.ceil(tMin / tickStep) * tickStep
      for (let t = start; t <= tMax; t += tickStep) {
        const z = (t - tMin) * timeScale
        const tickGeom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-0.5, -1.5, z),
          new THREE.Vector3(0.5, -1.5, z)
        ])
        scn.add(new THREE.Line(tickGeom, new THREE.LineBasicMaterial({ color: 0x6666aa })))
        const date = new Date(t * 1000)
        const text = date.toISOString().replace('T', ' ').replace('Z', '')
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')!
        ctx.font = '10px monospace'
        const metrics = ctx.measureText(text)
        canvas.width = Math.ceil(metrics.width) + 8
        canvas.height = 16
        ctx.font = '10px monospace'
        ctx.fillStyle = 'rgba(10,11,16,0.85)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#ccc'
        ctx.fillText(text, 4, 12)
        const tex = new THREE.Texture(canvas)
        tex.needsUpdate = true
        const smat = new THREE.SpriteMaterial({ map: tex, depthTest: false })
        const label = new THREE.Sprite(smat)
        label.position.set(1.2, -1.5, z)
        label.scale.set(5, 1, 1)
        scn.add(label)
      }
    }

    // Route animation
  const cleanupFns: Array<() => void> = []
    if (plan && plan.ok && plan.path && plan.path.length > 1) {
  type Seg = { from: THREE.Vector3; to: THREE.Vector3; dur: number; dep?: number; arr?: number; uId: string; vId: string; beta: number; gamma: number; risk?: number }
      const segs: Seg[] = []
      const path = plan.path
  let absStart: number | undefined
  let absEnd: number | undefined
      for (let i = 0; i < path.length - 1; i++) {
    const u = path[i], vId = path[i + 1]
    const edge = trans.find(t => t.src === u && t.dst === vId)
        if (!edge) continue
        const a = edge.attributes || {}
        const dur = a.duration_s ?? ((typeof a.earth_departure_epoch_s === 'number' && typeof a.earth_arrival_epoch_s === 'number') ? (a.earth_arrival_epoch_s - a.earth_departure_epoch_s) : undefined) ?? 0
        const fromBase = layout.get(u) || new THREE.Vector3()
    const toBase = layout.get(vId) || new THREE.Vector3()
        const from = fromBase.clone()
        const to = toBase.clone()
  const dep: number | undefined = (typeof a.earth_departure_epoch_s === 'number') ? a.earth_departure_epoch_s : nodeTimes.get(u)
  const arr: number | undefined = (typeof a.earth_arrival_epoch_s === 'number') ? a.earth_arrival_epoch_s : (dep !== undefined ? dep + dur : nodeTimes.get(vId))
        if (mode === 'space-time' && haveAbsolute) {
          if (dep !== undefined) from.z += (dep - tMin) * timeScale
          if (arr !== undefined) to.z += (arr - tMin) * timeScale
        }
  if (dep !== undefined) { absStart = (absStart === undefined ? dep : Math.min(absStart, dep)) }
  if (arr !== undefined) { absEnd = (absEnd === undefined ? arr : Math.max(absEnd, arr)) }
        // Compute beta and gamma for HUD
        const d = a.distance_m
        const vel = (d && dur && dur > 0) ? d / dur : 0
        const beta = vel > 0 ? Math.min(vel / c, 0.999999) : 0
        const gamma = beta > 0 ? 1.0 / Math.sqrt(1 - beta * beta) : 1.0
        const risk = a.risk_prob
        segs.push({ from, to, dur: Math.max(0, dur), dep, arr, uId: u, vId, beta, gamma, risk })
      }

      if (segs.length > 0) {
        const pts: THREE.Vector3[] = []
        pts.push(segs[0].from.clone())
        for (const s of segs) pts.push(s.to.clone())
        const g = new THREE.BufferGeometry().setFromPoints(pts)
        const m = new THREE.LineBasicMaterial({ color: 0xffffff })
        const routeLine = new THREE.Line(g, m)
        scn.add(routeLine)
        cleanupFns.push(() => { scn.remove(routeLine); g.dispose(); m.dispose() })
      }

  const ship = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), new THREE.MeshStandardMaterial({ color: 0xff66aa, emissive: 0x330022 }))
      ship.position.copy(segs[0].from)
      scn.add(ship)
      cleanupFns.push(() => { scn.remove(ship) })

      const total = (absStart !== undefined && absEnd !== undefined) ? (absEnd - absStart) : segs.reduce((acc, s) => acc + s.dur, 0)
      setRouteTotal(total)
      setRouteHasTimes((absStart !== undefined && absEnd !== undefined) || haveAbsolute)
      setRouteT(0)
      segsRef.current = segs
      absStartRef.current = absStart
      // Build segment boundaries for step controls (relative or absolute seconds)
      const bounds: number[] = []
      if (absStart !== undefined) {
        for (const s of segs) { if (s.dep !== undefined) bounds.push(s.dep - absStart) }
        if (absEnd !== undefined) bounds.push(absEnd - absStart)
      } else {
        let acc = 0
        bounds.push(0)
        for (const s of segs) { acc += s.dur; bounds.push(acc) }
      }
      boundsRef.current = bounds

      let rafId: number | null = null
      let last = performance.now()
      const updateShip = () => {
        const now = performance.now()
        const dt = Math.min(0.1, (now - last) / 1000) * speed
        last = now
        let t = routeTRef.current
        if (playing && total > 0) {
          t = (t + dt) % total
          setRouteT(t)
          routeTRef.current = t
        }
        let seg: Seg | undefined
        let local = 0
        if (absStart !== undefined) {
          const currentAbs = absStart + t
          seg = segs.find(s => (s.dep !== undefined && s.arr !== undefined) ? (currentAbs >= s.dep! && currentAbs <= s.arr!) : false)
          if (!seg) {
            for (const s of segs) { if (s.dep !== undefined && s.arr !== undefined && currentAbs >= s.arr) seg = s }
          }
          if (seg && seg.dep !== undefined && seg.arr !== undefined) local = (currentAbs - seg.dep) / Math.max(1e-6, (seg.arr - seg.dep))
        } else {
          let accum = 0
          for (const s of segs) {
            if (t <= accum + s.dur) { seg = s; local = (t - accum) / Math.max(1e-6, s.dur); break }
            accum += s.dur
          }
        }
        if (!seg) seg = segs[segs.length - 1]
        const pos = seg.from.clone().lerp(seg.to, THREE.MathUtils.clamp(local, 0, 1))
        ship.position.copy(pos)
        // Update HUD (approximate crew time cumulative)
        const segIndex = Math.max(0, segs.indexOf(seg))
        // Earth elapsed in seconds (relative to route start)
        const earthElapsed = t
        // Crew elapsed: sum over previous segments of dur/gamma + current fraction
        let crewElapsed = 0
        for (let i = 0; i < segIndex; i++) crewElapsed += segs[i].dur / Math.max(1e-6, segs[i].gamma)
        crewElapsed += (seg.dur * Math.max(0, Math.min(1, local))) / Math.max(1e-6, seg.gamma)
        hudRef.current = { segIndex, beta: seg.beta, gamma: seg.gamma, earthElapsed, crewElapsed, risk: seg.risk, label: `${seg.uId}→${seg.vId}` }
        // Throttle HUD updates when playing to reduce React updates
        const nowMs = performance.now()
        const shouldUpdateHud = !playing || (nowMs - (hudThrottleRef.current || 0) > 33)
        if (shouldUpdateHud) {
          hudThrottleRef.current = nowMs
          setHud(hudRef.current)
        }
        // Follow camera: ease camera towards ship and keep target on ship
        if (follow) {
          const cam = stateRef.current.camera
          const ctr = stateRef.current.controls
          if (cam && ctr) {
            const target = pos.clone()
            // Directional offset: behind along -forward plus a small upward elevation
            const forward = seg.to.clone().sub(seg.from).normalize()
            // Compute a sideways banking component using change in forward
            const prevSeg = segs[Math.max(0, segIndex - 1)]
            const prevForward = prevSeg ? prevSeg.to.clone().sub(prevSeg.from).normalize() : forward.clone()
            // side = normalized cross of up and forward (right-handed)
            const up = new THREE.Vector3(0, 1, 0)
            const side = new THREE.Vector3().crossVectors(up, forward).normalize()
            const turnAmount = 1 - Math.max(-1, Math.min(1, prevForward.dot(forward))) // 0 (straight) .. 2 (sharp turn)
            const bankSide = side.multiplyScalar(bankIntensity * turnAmount)
            const elevate = new THREE.Vector3(0, 2.5, 0)
            const behindVec = forward.clone().multiplyScalar(-Math.max(1, followDist)).add(elevate).add(bankSide)
            cam.position.lerp(target.clone().add(behindVec), 0.18)
            ctr.target.lerp(target, 0.22)
            ctr.update?.()
          }
        }
        rafId = requestAnimationFrame(updateShip)
      }
      rafId = requestAnimationFrame(updateShip)
      cleanupFns.push(() => { if (rafId) cancelAnimationFrame(rafId) })

      // Pulse warning sprites
      if (linesToPulse.length) {
        let t0 = 0
        let raf: number | null = null
        const pulse = () => {
          t0 += 0.03 * (playing ? speed : 1)
          for (const sprite of linesToPulse) {
            const s = 0.6 + Math.abs(Math.sin(t0)) * 0.6
            sprite.scale.set(s, s, s)
            ;(sprite.material as THREE.SpriteMaterial).opacity = 0.5 + 0.5 * Math.abs(Math.sin(t0))
          }
          raf = requestAnimationFrame(pulse)
        }
        raf = requestAnimationFrame(pulse)
        cleanupFns.push(() => { if (raf) cancelAnimationFrame(raf) })
      }
    }

    cleanupFns.push(() => { labelCleanups.forEach(fn => fn()) })
    return () => { cleanupFns.forEach(fn => fn()) }
  }, [parsed, report, stateRef, mode, showLabels, playing, speed, plan, follow, followDist, bankIntensity])

  // Step/jump controls using computed bounds
  const stepToIndex = useMemo(() => (idx: number) => {
    const b = boundsRef.current
    if (!b.length) return
    const clamped = Math.max(0, Math.min(b.length - 1, idx))
    const t = b[clamped]
    setRouteT(t)
    routeTRef.current = t
    setPlaying(false)
  }, [setRouteT, setPlaying])
  const stepPrev = useMemo(() => () => stepToIndex(hud.segIndex), [hud.segIndex, stepToIndex])
  const stepNext = useMemo(() => () => stepToIndex(hud.segIndex + 1), [hud.segIndex, stepToIndex])
  const jumpStart = useMemo(() => () => stepToIndex(0), [stepToIndex])
  const jumpEnd = useMemo(() => () => stepToIndex(boundsRef.current.length - 1), [stepToIndex])

  // Keyboard shortcuts: Space play/pause, [ prev, ] next, Home/End
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); setPlaying((prev: boolean) => !prev) }
      else if (e.key === '[') { e.preventDefault(); stepPrev() }
      else if (e.key === ']') { e.preventDefault(); stepNext() }
      else if (e.key === 'Home') { e.preventDefault(); jumpStart() }
      else if (e.key === 'End') { e.preventDefault(); jumpEnd() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jumpEnd, jumpStart, setPlaying, stepNext, stepPrev])

  // Auto-pause when tab hidden; restore when visible
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        prevPlayingRef.current = playing
        if (playing) setPlaying(false)
      } else {
        if (prevPlayingRef.current) setPlaying(true)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [playing, setPlaying])

  const timeInfo = (() => {
    if (!timeRange || !timeRange.have || mode !== 'space-time' || !timeRange.start || !timeRange.end) return ''
    const startISO = new Date(timeRange.start * 1000).toISOString().replace('T', ' ').replace('Z', '')
    const endISO = new Date(timeRange.end * 1000).toISOString().replace('T', ' ').replace('Z', '')
    const deltaH = ((timeRange.end - timeRange.start) / 3600).toFixed(1)
    return `| t: ${startISO} → ${endISO} (Δ ${deltaH}h)`
  })()

  return (
    <div className="card" style={{ minHeight: 320 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>4D View (space × time)</span>
        <label style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>mode</span>
          <select value={mode} onChange={e => setMode(e.target.value === 'space-time' ? 'space-time' : 'spatial')}>
            <option value="spatial">Spatial only</option>
            <option value="space-time">Space × Time</option>
          </select>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} /> labels
        </label>
        <button className="btn" onClick={() => setPlaying(p => !p)}>{playing ? 'Pause' : 'Play'}</button>
        <button className="btn" onClick={stepPrev} title="[">Prev</button>
        <button className="btn" onClick={stepNext} title="]">Next</button>
        <button className="btn" onClick={jumpStart} title="Home">Start</button>
        <button className="btn" onClick={jumpEnd} title="End">End</button>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>speed</span>
          <input type="range" min={0.2} max={3} step={0.1} value={speed} onChange={e => setSpeed(parseFloat(e.target.value))} />
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> follow
        </label>
        {follow && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="Camera offset distance">
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>offset</span>
            <input type="range" min={4} max={12} step={0.5} value={followDist} onChange={e => setFollowDist(parseFloat(e.target.value))} />
          </label>
        )}
        {follow && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="Banking intensity">
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>bank</span>
            <input type="range" min={0} max={1} step={0.05} value={bankIntensity} onChange={e => setBankIntensity(parseFloat(e.target.value))} />
          </label>
        )}
        <button className="btn" onClick={resetCamera}>Reset Camera</button>
        <button className="btn" onClick={fitRoute} disabled={!plan || !plan.ok}>Fit Route</button>
        <button className="btn" onClick={takeScreenshot}>Screenshot</button>
        <button className="btn" onClick={() => setHudPos(p => p === 'top' ? 'bottom' : 'top')} title="Toggle HUD position">HUD: {hudPos}</button>
        {timeInfo && (<span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>{timeInfo}</span>)}
      </div>
      <div style={{ position: 'relative', width: '100%', height: 360 }}>
        <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
        {routeTotal > 0 && (
          <div style={{ position: 'absolute', left: 8, right: 8, [hudPos === 'top' ? 'top' : 'bottom']: 8, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none' } as React.CSSProperties}>
            <div className="mono" style={{ color: '#e6e6f0', background: 'rgba(10,11,16,0.65)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '6px 8px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', pointerEvents: 'auto' }}>
              <span style={{ padding: '2px 6px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}>seg {hud.segIndex + 1}/{Math.max(1, segsRef.current.length)} {hud.label ? `[${hud.label}]` : ''}</span>
              {hud.beta !== undefined && <span style={{ padding: '2px 6px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}>β {hud.beta.toFixed(3)}</span>}
              {hud.gamma !== undefined && <span style={{ padding: '2px 6px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}>γ {hud.gamma.toFixed(2)}</span>}
              <span style={{ padding: '2px 6px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}>t⊕ {hud.earthElapsed.toFixed(1)}s</span>
              {hud.crewElapsed !== undefined && <span style={{ padding: '2px 6px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}>tcrew {hud.crewElapsed.toFixed(1)}s</span>}
              {(() => {
                const seg = segsRef.current[hud.segIndex]
                if (!seg || !report) return null
                const warn = (report || []).find(r => r.src === seg.uId && r.dst === seg.vId && r.breakdown?.warnings && r.breakdown.warnings.length > 0)
                if (!warn) return null
                const count = warn.breakdown?.warnings?.length ?? 0
                return (
                  <span onClick={() => setShowWarnDetails((v: boolean) => !v)} style={{ padding: '2px 6px', border: '1px solid rgba(255,200,87,0.4)', borderRadius: 6, color: 'var(--gold)', cursor: 'pointer' }}>⚠ {count}</span>
                )
              })()}
            </div>
            {showWarnDetails && (() => {
              const seg = segsRef.current[hud.segIndex]
              if (!seg || !report) return null
              const warn = (report || []).find(r => r.src === seg.uId && r.dst === seg.vId && r.breakdown?.warnings && r.breakdown.warnings.length > 0)
              if (!warn) return null
              return (
                <div style={{ color: 'var(--gold)', background: 'rgba(10,11,16,0.65)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '6px 8px', pointerEvents: 'auto' }}>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(warn.breakdown?.warnings ?? []).map((w, i) => (
                      <li key={`warn-${i}`} style={{ color: 'var(--muted)' }}>⚠ {w}</li>
                    ))}
                  </ul>
                </div>
              )
            })()}
          </div>
        )}
      </div>
      {routeTotal > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <label className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>timeline</label>
          <input style={{ flex: 1 }} type="range" min={0} max={routeTotal} step={0.1} value={routeT} onChange={e => { const v = parseFloat(e.target.value); setRouteT(v); routeTRef.current = v; setPlaying(false) }} />
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', minWidth: 120, textAlign: 'right' }}>{routeT.toFixed(1)}s {routeHasTimes ? '(abs)' : '(rel)'}</span>
        </div>
      )}
      {routeTotal > 0 && (
        <div className="mono" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
          [, ] prev/next • Space play/pause • Home/End jump
        </div>
      )}
      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
        • Orbit controls enabled (drag to rotate, scroll to zoom, right-drag to pan). Edge color encodes β; warnings pulse. Space×Time mode offsets Z by time with an axis rail. Labels show β, γ, duration, risk. If a plan is present, a route marker animates and the timeline scrubber controls its position. New: follow-camera toggle, step/jump controls ([, ], Home, End), and a live HUD with β, γ, elapsed Earth/crew times, and risk.
      </div>
    </div>
  )
}
