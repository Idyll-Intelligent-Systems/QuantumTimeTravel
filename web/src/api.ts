type Spec = { states?: string[]; initial?: string; ABC?: string[]; policy?: Record<string, unknown>; transitions?: Array<{ src: string; dst: string; attributes?: Record<string, unknown> }> } | unknown

const API_BASE_KEY = 'apiBase'

export function resolveApiBase(): string | null {
  if (typeof window === 'undefined') return '/api'
  try {
    const url = new URL(window.location.href)
    const qp = url.searchParams.get('api')
    if (qp) {
      localStorage.setItem(API_BASE_KEY, qp)
      return qp.replace(/\/$/, '')
    }
  } catch { /* ignore */ }
  try {
    const saved = localStorage.getItem(API_BASE_KEY)
    if (saved) return saved.replace(/\/$/, '')
  } catch { /* ignore */ }
  // Defaults: dev/docker environments use /api; GitHub Pages needs explicit override
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return '/api'
  if (host.endsWith('github.io')) return null
  return '/api'
}

export function setApiBase(base: string) {
  localStorage.setItem(API_BASE_KEY, base)
}
export function clearApiBase() {
  localStorage.removeItem(API_BASE_KEY)
}

function apiUrl(path: string) {
  const base = resolveApiBase()
  if (!base) throw new Error('API unavailable: configure an API base via ?api=https://host/api or Settings → API URL.')
  return `${base.replace(/\/$/, '')}${path}`
}

export async function planFromSpec(spec: Spec) {
  const r = await fetch(apiUrl('/plan'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function validateSpec(spec: unknown) {
  const r = await fetch(apiUrl('/spec/validate'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function listRepo() {
  const r = await fetch(apiUrl('/repo/list'))
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function readRepoFile(path: string) {
  const r = await fetch(apiUrl(`/repo/file?path=${encodeURIComponent(path)}`))
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getStatus() {
  const r = await fetch(apiUrl('/status'))
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getLogsTail(limit = 200) {
  const r = await fetch(apiUrl(`/logs/tail?limit=${limit}`))
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getLastSpec() {
  const r = await fetch(apiUrl('/spec/last'))
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
