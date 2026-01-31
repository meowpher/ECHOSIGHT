import { generateLinearChirp, normalizedCrossCorrelation, ema, maxAbs } from './MathUtils'

const SPEED_OF_SOUND = 343.0

export default class SonarEngine {
  constructor({ sampleRate = 48000, pulseMs = 40, f0 = 15000, f1 = 17000, recMs = 200, blindMs = 2, noiseGate = 0.05, smoothingAlpha = 0.15 } = {}) {
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
    this.analyser = null

    this.ringBuffer = null
    this.ringWritePtr = 0
    this.ringLen = 0

    this.template = null
    this.running = false
    this.lastSmoothed = null
    
    // Debug metrics
    this.lastMicRMS = 0
    this.lastPeakCorr = 0
    this.lastRawDistance = null
  }

  async initFromStream(mediaStream) {
    this.mediaStream = mediaStream
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    
    // Unlock audio context (browsers require user interaction)
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }
    
    this.sampleRate = this.audioCtx.sampleRate
    this.template = generateLinearChirp(this.sampleRate, this.pulseMs, this.f0, this.f1)

    this.ringLen = Math.round(this.sampleRate * Math.max(1, this.recMs / 1000))
    this.ringBuffer = new Float32Array(this.ringLen)
    this.ringWritePtr = 0

    // Create source from media stream
    this.srcNode = this.audioCtx.createMediaStreamSource(this.mediaStream)
    
    // Create analyser for RMS metering
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = 2048
    this.srcNode.connect(this.analyser)

    // Create recording processor
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
    this.analyser.connect(this.proc)
    this.proc.connect(this.audioCtx.destination)
  }

  async playTestBeep(durationMs = 1000, frequency = 440) {
    // Resume audio context
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }

    const now = this.audioCtx.currentTime
    const duration = durationMs / 1000

    // Create oscillator and gain node
    const osc = this.audioCtx.createOscillator()
    const gain = this.audioCtx.createGain()

    osc.type = 'sine'
    osc.frequency.value = frequency
    gain.gain.value = 0.3

    // Connect: oscillator -> gain -> speakers
    osc.connect(gain)
    gain.connect(this.audioCtx.destination)

    osc.start(now)
    osc.stop(now + duration)
  }

  getRMS() {
    if (!this.analyser) return 0
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount)
    this.analyser.getByteFrequencyData(dataArray)
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length
    return average / 255
  }

  stop() {
    this.running = false
    try { if (this.proc) this.proc.disconnect() } catch (e) {}
    try { if (this.analyser) this.analyser.disconnect() } catch (e) {}
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
    const intervalMs = Math.max(250, Math.round(this.recMs + 50))

    // Ensure audio context is resumed
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }

    while (this.running) {
      // Get current RMS
      const rms = this.getRMS()
      this.lastMicRMS = rms

      // Play chirp with gain control
      try {
        const buf = this.audioCtx.createBuffer(1, this.template.length, this.sampleRate)
        buf.copyToChannel(this.template, 0)
        
        const src = this.audioCtx.createBufferSource()
        src.buffer = buf
        
        // Create gain node for volume control
        const gain = this.audioCtx.createGain()
        gain.gain.value = 1.0 // Max volume
        
        // Connect: source -> gain -> destination (speakers)
        src.connect(gain)
        gain.connect(this.audioCtx.destination)
        
        src.start()
      } catch (e) {
        console.warn('Play error', e)
      }

      // Wait for recMs to collect echoes
      await new Promise((res) => setTimeout(res, this.recMs))

      // Snapshot last recLen samples from ring buffer
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

      // Quick noise gate
      const signalMax = maxAbs(snap)
      if (signalMax < this.noiseGate) {
        this.lastPeakCorr = 0
        this.lastRawDistance = null
        const sm = ema(this.lastSmoothed, null, this.smoothingAlpha)
        this.lastSmoothed = sm
        if (onResult) onResult({ distance: null, confidence: 0, smoothed: sm, micRMS: rms, peakCorr: 0, rawDistance: null })
        await new Promise((res) => setTimeout(res, intervalMs - this.recMs))
        continue
      }

      // Cross-correlate
      const { lag, corr } = normalizedCrossCorrelation(this.template, snap, this.blindMs, this.sampleRate)
      this.lastPeakCorr = corr

      if (lag <= 0 || corr < 0.1) {
        this.lastRawDistance = null
        const sm = ema(this.lastSmoothed, null, this.smoothingAlpha)
        this.lastSmoothed = sm
        if (onResult) onResult({ distance: null, confidence: corr, smoothed: sm, micRMS: rms, peakCorr: corr, rawDistance: null })
      } else {
        const time = lag / this.sampleRate
        const distance = (time * SPEED_OF_SOUND) / 2
        this.lastRawDistance = distance
        const sm = ema(this.lastSmoothed, distance, this.smoothingAlpha)
        this.lastSmoothed = sm
        if (onResult) onResult({ distance, confidence: corr, smoothed: sm, micRMS: rms, peakCorr: corr, rawDistance: distance })
      }

      // Wait remaining interval
      await new Promise((res) => setTimeout(res, Math.max(0, intervalMs - this.recMs)))
    }
  }
}
