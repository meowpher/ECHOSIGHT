// Math utilities: chirp generation, cross-correlation, and smoothing
export function generateLinearChirp(sampleRate, durationMs = 20, f0 = 18000, f1 = 22000) {
  const T = durationMs / 1000
  const len = Math.max(1, Math.round(sampleRate * T))
  const buf = new Float32Array(len)
  const k = (f1 - f0) / T
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate
    const phase = 2 * Math.PI * (f0 * t + 0.5 * k * t * t)
    buf[i] = Math.sin(phase)
  }
  return buf
}

export function normalizedCrossCorrelation(template, signal, blindMs = 2, sampleRate = 48000) {
  const m = template.length
  const n = signal.length
  if (n < m) return { lag: -1, corr: 0, correlations: null }

  const blindSamples = Math.round((blindMs / 1000) * sampleRate)

  // Precompute template norm
  let tNorm = 0
  for (let i = 0; i < m; i++) tNorm += template[i] * template[i]
  tNorm = Math.sqrt(Math.max(1e-12, tNorm))

  let bestLag = -1
  let bestCorr = -Infinity
  const outLen = n - m + 1
  // we won't necessarily return the full correlations to save memory

  for (let lag = 0; lag < outLen; lag++) {
    if (lag < blindSamples) continue
    let dot = 0
    let sNorm = 0
    for (let j = 0; j < m; j++) {
      const s = signal[lag + j]
      dot += template[j] * s
      sNorm += s * s
    }
    sNorm = Math.sqrt(Math.max(1e-12, sNorm))
    const corr = dot / (tNorm * sNorm)
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }

  return { lag: bestLag, corr: bestCorr }
}

export function ema(prev, current, alpha = 0.2) {
  if (prev == null) return current
  return alpha * current + (1 - alpha) * prev
}

export function maxAbs(arr) {
  let m = 0
  for (let i = 0; i < arr.length; i++) {
    const v = Math.abs(arr[i])
    if (v > m) m = v
  }
  return m
}
