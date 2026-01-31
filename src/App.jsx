import React, { useEffect, useRef, useState } from 'react'
import SonarEngine from './SonarEngine'

export default function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const [status, setStatus] = useState('idle')
  const [distance, setDistance] = useState(null)
  const [confidence, setConfidence] = useState(0)
  const [micRMS, setMicRMS] = useState(0)
  const [peakCorr, setPeakCorr] = useState(0)
  const [rawDistance, setRawDistance] = useState(null)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    let mounted = true
    
    // Resize canvas to match window
    const resize = () => {
      const c = canvasRef.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      c.width = Math.floor(window.innerWidth * dpr)
      c.height = Math.floor(window.innerHeight * dpr)
      const ctx = c.getContext('2d')
      ctx.scale(dpr, dpr)
    }
    
    resize()
    window.addEventListener('resize', resize)

    // Animation loop for debug overlay
    let rafId = null
    function drawLoop() {
      const c = canvasRef.current
      if (!c) return
      
      const ctx = c.getContext('2d')
      const width = window.innerWidth
      const height = window.innerHeight
      
      ctx.clearRect(0, 0, width, height)

      // Draw red circle if distance detected
      if (distance != null && scanning) {
        const cx = width / 2
        const cy = height / 2
        const maxRange = 5
        const frac = Math.min(1, distance / maxRange)
        const r = Math.min(width, height) * 0.3 * frac
        ctx.beginPath()
        ctx.fillStyle = 'rgba(220, 38, 38, 0.8)'
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(220, 38, 38, 0.6)'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // Debug Dashboard (top-left)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(10, 10, 220, 140)

      ctx.fillStyle = 'rgba(34, 197, 94, 0.95)'
      ctx.font = 'bold 14px monospace'
      ctx.fillText('DEBUG DASHBOARD', 15, 28)

      ctx.font = '12px monospace'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.fillText(`Mic RMS: ${(micRMS * 100).toFixed(1)}%`, 15, 45)
      ctx.fillText(`Peak Corr: ${peakCorr.toFixed(3)}`, 15, 60)
      ctx.fillText(`Raw Dist: ${rawDistance != null ? rawDistance.toFixed(2) + ' m' : '--'}`, 15, 75)
      ctx.fillText(`Smoothed: ${distance != null ? distance.toFixed(2) + ' m' : '--'}`, 15, 90)
      ctx.fillText(`Conf: ${confidence.toFixed(3)}`, 15, 105)
      ctx.fillText(`Status: ${status}`, 15, 120)
      ctx.fillText(`Scanning: ${scanning ? 'YES' : 'NO'}`, 15, 135)
      
      rafId = requestAnimationFrame(drawLoop)
    }
    rafId = requestAnimationFrame(drawLoop)

    return () => {
      mounted = false
      window.removeEventListener('resize', resize)
      if (rafId) cancelAnimationFrame(rafId)
      try { if (engineRef.current) engineRef.current.stop() } catch (e) {}
      try {
        const v = videoRef.current
        if (v && v.srcObject) {
          const s = v.srcObject
          if (s.getTracks) s.getTracks().forEach(t => t.stop())
          v.srcObject = null
        }
      } catch (e) {}
    }
  }, [distance, confidence, micRMS, peakCorr, rawDistance, status, scanning])

  async function startScan() {
    if (scanning) return

    setStatus('requesting-permissions')
    setScanning(true)

    try {
      // UNIFIED stream request: ONE call for both audio and video
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: {
          facingMode: 'environment'
        }
      })

      // Attach stream to video element
      const v = videoRef.current
      if (v) {
        v.srcObject = stream
        v.muted = true
        v.playsInline = true
        await v.play().catch((e) => console.warn('Video play error', e))
      }

      setStatus('initializing-sonar')
      const engine = new SonarEngine({
        recMs: 200,
        pulseMs: 40,
        f0: 15000,
        f1: 17000,
        noiseGate: 0.05,
        smoothingAlpha: 0.15
      })
      engineRef.current = engine
      await engine.initFromStream(stream)

      setStatus('running')
      // start continuous scan
      engine.startContinuousScan((res) => {
        if (!scanning) return
        setConfidence(res.confidence || 0)
        setDistance(res.smoothed == null ? null : res.smoothed)
        setMicRMS(res.micRMS || 0)
        setPeakCorr(res.peakCorr || 0)
        setRawDistance(res.rawDistance || null)
      })
    } catch (err) {
      console.error('Error:', err)
      setStatus('error')
      setScanning(false)
      alert('Permission denied or device not supported: ' + (err && err.message))
    }
  }

  async function stopScan() {
    setScanning(false)
    setStatus('stopped')
    try {
      if (engineRef.current) {
        engineRef.current.stop()
      }
    } catch (e) {}
    try {
      const v = videoRef.current
      if (v && v.srcObject) {
        const s = v.srcObject
        if (s.getTracks) s.getTracks().forEach(t => t.stop())
        v.srcObject = null
      }
    } catch (e) {}
  }

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* Video background - z-index -1 so it's behind everything */}
      <video
        ref={videoRef}
        className="fixed inset-0 w-screen h-screen object-cover"
        style={{ zIndex: -1 }}
        autoPlay
        playsInline
        muted
      />
      
      {/* Canvas overlay - z-index 10 for UI */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-screen h-screen pointer-events-none"
        style={{ zIndex: 10 }}
      />
      
      {/* Control buttons - z-index 20 to be clickable */}
      <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 flex gap-3 z-20">
        <button
          onClick={startScan}
          disabled={scanning}
          className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg text-white font-semibold shadow-lg"
        >
          {scanning ? 'Scanning...' : 'Start Scan'}
        </button>
        <button
          onClick={stopScan}
          disabled={!scanning}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 rounded-lg text-white font-semibold shadow-lg"
        >
          Stop
        </button>
      </div>
    </div>
  )
}
