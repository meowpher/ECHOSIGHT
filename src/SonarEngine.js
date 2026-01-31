import { generateLinearChirp, normalizedCrossCorrelation, ema, maxAbs } from './MathUtils'

const SPEED_OF_SOUND = 343.0

export default class SonarEngine {
  constructor({ sampleRate = 48000, pulseMs = 20, f0 = 18000, f1 = 22000, recMs = 150, blindMs = 2, noiseGate = 0.1, smoothingAlpha = 0.2 } = {}) {
    this.sampleRate = sampleRate
    this.pulseMs = pulseMs
    this.f0 = f0
    this.f1 = f1
    this.recMs = recMs
    this.blindMs = blindMs
    this.noiseGate = noiseGate
    this.smoothingAlpha = smoothingAlpha

    this.audioCtx = null
    this.mediaStream = null
    this.srcNode = null
    this.proc = null

    this.ringBuffer = null
    this.ringWritePtr = 0
    this.ringLen = 0

    this.template = null
    this.running = false
    this.lastSmoothed = null
  }

  async initFromStream(mediaStream) {
    this.mediaStream = mediaStream
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    // use actual sample rate
    this.sampleRate = this.audioCtx.sampleRate
    // prepare template
    this.template = generateLinearChirp(this.sampleRate, this.pulseMs, this.f0, this.f1)

    // prepare ring buffer to hold recMs samples
    this.ringLen = Math.round(this.sampleRate * Math.max(1, this.recMs / 1000))
    this.ringBuffer = new Float32Array(this.ringLen)
    this.ringWritePtr = 0

    // create source and processor
    this.srcNode = this.audioCtx.createMediaStreamSource(this.mediaStream)
    const bufSize = 4096
    this.proc = this.audioCtx.createScriptProcessor(bufSize, 1, 1)
    this.proc.onaudioprocess = (e) => {
      const inCh = e.inputBuffer.getChannelData(0)
      let offset = 0
      while (offset < inCh.length) {
        const toCopy = Math.min(inCh.length - offset, this.ringLen - this.ringWritePtr)
        this.ringBuffer.set(inCh.subarray(offset, offset + toCopy), this.ringWritePtr)
        this.ringWritePtr += toCopy
        if (this.ringWritePtr >= this.ringLen) this.ringWritePtr = 0
        offset += toCopy
      }
    }
    this.srcNode.connect(this.proc)
    // do not connect processor to destination to avoid feedback
    this.proc.connect(this.audioCtx.destination)
  }

  stop() {
    this.running = false
    try { if (this.proc) this.proc.disconnect() } catch (e) {}
    try { if (this.srcNode) this.srcNode.disconnect() } catch (e) {}
    try { if (this.audioCtx && this.audioCtx.state !== 'closed') this.audioCtx.close() } catch (e) {}
    this.audioCtx = null
    this.mediaStream = null
  }

  async startContinuousScan(onResult) {
    if (!this.mediaStream) throw new Error('MediaStream not initialized. Call initFromStream(stream) first.')
    if (!this.template) this.template = generateLinearChirp(this.sampleRate, this.pulseMs, this.f0, this.f1)
    this.running = true

    const recLen = Math.round(this.sampleRate * (this.recMs / 1000))
    const intervalMs = Math.max(200, Math.round(this.recMs + 20)) // aim for ~4-5Hz

    while (this.running) {
      // play chirp
      try {
        const buf = this.audioCtx.createBuffer(1, this.template.length, this.sampleRate)
        buf.copyToChannel(this.template, 0)
        const src = this.audioCtx.createBufferSource()
        src.buffer = buf
        src.connect(this.audioCtx.destination)
        src.start()
      } catch (e) {
        console.warn('Play error', e)
      }

      // wait for recMs to collect echoes
      await new Promise((res) => setTimeout(res, this.recMs))

      // snapshot last recLen samples from ring buffer
      const snap = new Float32Array(recLen)
      let start = this.ringWritePtr - recLen
      if (start < 0) start += this.ringLen
      if (start + recLen <= this.ringLen) {
        snap.set(this.ringBuffer.subarray(start, start + recLen))
      } else {
        const firstPart = this.ringLen - start
        snap.set(this.ringBuffer.subarray(start, this.ringLen), 0)
        snap.set(this.ringBuffer.subarray(0, recLen - firstPart), firstPart)
      }

      // quick noise gate on recorded signal amplitude
      const signalMax = maxAbs(snap)
      if (signalMax < this.noiseGate) {
        // below noise gate; report null
        const sm = ema(this.lastSmoothed, null, this.smoothingAlpha)
        this.lastSmoothed = sm
        if (onResult) onResult({ distance: null, confidence: 0, smoothed: sm })
        await new Promise((res) => setTimeout(res, intervalMs - this.recMs))
        continue
      }

      // cross-correlate
      const { lag, corr } = normalizedCrossCorrelation(this.template, snap, this.blindMs, this.sampleRate)

      if (lag <= 0 || corr < 0.15) {
        // weak or invalid
        const sm = ema(this.lastSmoothed, null, this.smoothingAlpha)
        this.lastSmoothed = sm
        if (onResult) onResult({ distance: null, confidence: corr, smoothed: sm })
      } else {
        const time = lag / this.sampleRate
        const distance = (time * SPEED_OF_SOUND) / 2
        const sm = ema(this.lastSmoothed, distance, this.smoothingAlpha)
        this.lastSmoothed = sm
        if (onResult) onResult({ distance, confidence: corr, smoothed: sm })
      }

      // wait remaining interval
      await new Promise((res) => setTimeout(res, Math.max(0, intervalMs - this.recMs)))
    }
  }
}
