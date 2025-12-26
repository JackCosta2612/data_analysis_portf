export type UniverseRow = {
  ticker: string
  name: string
  assetClass: string
  region: string
  sector: string
}

export type PricesDemo = {
  dates: string[]
  series: Record<string, number[]>
}

function assetUrl(path: string) {
  // Works locally and on GitHub Pages when base != "/"
  return `${import.meta.env.BASE_URL}${path}`
}

export async function loadUniverse(): Promise<UniverseRow[]> {
  const res = await fetch(assetUrl("data/universe.json"))
  if (!res.ok) throw new Error(`Failed to load universe.json (${res.status})`)
  return res.json()
}

export async function loadPricesDemo(): Promise<PricesDemo> {
  const res = await fetch(assetUrl("data/prices_demo.json"))
  if (!res.ok) throw new Error(`Failed to load prices_demo.json (${res.status})`)
  return res.json()
}