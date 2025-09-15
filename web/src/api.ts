type Spec = { states?: string[]; initial?: string; ABC?: string[]; policy?: Record<string, unknown>; transitions?: Array<{ src: string; dst: string; attributes?: Record<string, unknown> }> } | unknown
export async function planFromSpec(spec: Spec) {
  const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function validateSpec(spec: unknown) {
  const r = await fetch("/api/spec/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listRepo() {
  const r = await fetch("/api/repo/list");
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function readRepoFile(path: string) {
  const r = await fetch(`/api/repo/file?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getStatus() {
  const r = await fetch('/api/status');
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getLogsTail(limit = 200) {
  const r = await fetch(`/api/logs/tail?limit=${limit}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getLastSpec() {
  const r = await fetch('/api/spec/last');
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
