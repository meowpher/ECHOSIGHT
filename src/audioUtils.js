// Chirp generation and cross-correlation utilities
export function generateChirp(sampleRate, durationMs = 10, f0 = 18000, f1 = 20000) {
  const T = durationMs / 1000
  const len = Math.max(1, Math.round(sampleRate * T))
  const buf = new Float32Array(len)
  // linear frequency sweep: phi(t)=2π(f0 t + 0.5 k t^2) where k=(f1-f0)/T
  const k = (f1 - f0) / T
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate
    const phase = 2 * Math.PI * (f0 * t + 0.5 * k * t * t)
    // small amplitude to avoid clipping on mobile
    buf[i] = Math.sin(phase) * 0.7
  }
  return buf
}

// Simple normalized cross-correlation (template vs signal)
// Returns {lag, correlation, correlationsArray}
export function crossCorrelate(template, signal, sampleRate, blindMs = 2) {
  const m = template.length
  const n = signal.length
  if (n < m) return { lag: -1, correlation: 0, correlations: null }

  const blindSamples = Math.round((blindMs / 1000) * sampleRate)

  // Precompute template norm
  let tNorm = 0
  for (let i = 0; i < m; i++) tNorm += template[i] * template[i]
  tNorm = Math.sqrt(Math.max(1e-12, tNorm))

  let bestLag = -1
  let bestCorr = -Infinity

  // We'll compute correlation for lags from 0 .. n-m
  const outLen = n - m + 1
  const correlations = new Float32Array(outLen)

  // For each lag compute dot and normalize by product of norms
  for (let lag = 0; lag < outLen; lag++) {
    if (lag < blindSamples) { correlations[lag] = 0; continue }
    let dot = 0
    let sNorm = 0
    for (let j = 0; j < m; j++) {
      const s = signal[lag + j]
      dot += template[j] * s
      sNorm += s * s
    }
    sNorm = Math.sqrt(Math.max(1e-12, sNorm))
    const corr = dot / (tNorm * sNorm)
    correlations[lag] = corr
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }

  return { lag: bestLag, correlation: bestCorr, correlations }
}

// Helper to create an AudioBuffer from a Float32Array chirp
export function createAudioBufferFromArray(audioCtx, arr) {
  const buf = audioCtx.createBuffer(1, arr.length, audioCtx.sampleRate)
  buf.copyToChannel(arr, 0, 0)
  return buf
}
