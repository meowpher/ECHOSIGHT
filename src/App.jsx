import React, { useEffect, useRef, useState } from 'react'
import SonarEngine from './SonarEngine'

export default function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const [status, setStatus] = useState('idle')
  const [distance, setDistance] = useState(null)
  const [confidence, setConfidence] = useState(0)

  useEffect(() => {
    let mounted = true
    async function startAll() {
      setStatus('requesting-permissions')
      try {
        // request audio and camera simultaneously
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          video: { facingMode: { ideal: 'environment' } }
        })

        if (!mounted) return

        // attach stream to video
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          v.muted = true
          v.playsInline = true
          await v.play().catch(() => {})
        }

        setStatus('initializing-sonar')
        const engine = new SonarEngine({ recMs: 150, pulseMs: 20, f0: 18000, f1: 22000, noiseGate: 0.02, smoothingAlpha: 0.15 })
        engineRef.current = engine
        await engine.initFromStream(stream)

        setStatus('running')
        // start continuous scan
        engine.startContinuousScan((res) => {
          if (!mounted) return
          setConfidence(res.confidence || 0)
          setDistance(res.smoothed == null ? null : res.smoothed)
        })
      } catch (err) {
        console.error(err)
        setStatus('error')
        alert('Camera/Microphone access failed: ' + (err && err.message))
      }
    }

    startAll()

    const resize = () => {
      const c = canvasRef.current
      const v = videoRef.current
      if (!c || !v) return
      const rect = v.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      c.width = Math.floor(rect.width * dpr)
      c.height = Math.floor(rect.height * dpr)
      const ctx = c.getContext('2d')
      ctx.scale(dpr, dpr)
    }
    window.addEventListener('resize', resize)

    // animation for overlay
    let rafId = null
    function drawLoop() {
      const c = canvasRef.current
      const v = videoRef.current
      if (c && v) {
        const ctx = c.getContext('2d')
        const width = c.width / (window.devicePixelRatio || 1)
        const height = c.height / (window.devicePixelRatio || 1)
        ctx.clearRect(0, 0, width, height)

        // semi-transparent green overlay radar UI
        ctx.fillStyle = 'rgba(0,0,0,0)'
        ctx.fillRect(0, 0, width, height)

        const cx = width / 2
        const cy = height * 0.8
        const radius = Math.min(width, height) * 0.35

        // rings
        ctx.strokeStyle = 'rgba(34,197,94,0.6)'
        ctx.lineWidth = 2
        for (let r = radius; r > 0; r -= radius / 4) {
          ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); ctx.stroke()
        }

        // pointer based on distance
        if (distance != null) {
          const maxRange = 5
          const frac = Math.min(1, distance / maxRange)
          const r = radius * (1 - frac)
          const angle = Math.PI * 1.5
          const bx = cx + Math.cos(angle) * r
          const by = cy + Math.sin(angle) * r
          ctx.beginPath(); ctx.fillStyle = 'rgba(34,197,94,0.95)'; ctx.arc(bx, by, 10, 0, Math.PI * 2); ctx.fill()
        }

        // text
        ctx.fillStyle = 'rgba(16,185,129,0.95)'
        ctx.font = '18px system-ui'
        ctx.fillText(distance != null ? distance.toFixed(2) + ' m' : '-- m', 12, 28)
        ctx.font = '12px system-ui'
        ctx.fillText('conf: ' + (confidence ? confidence.toFixed(2) : '0.00'), 12, 44)
        ctx.fillText('status: ' + status, 12, 60)
      }
      rafId = requestAnimationFrame(drawLoop)
    }
    rafId = requestAnimationFrame(drawLoop)

    return () => {
      mounted = false
      window.removeEventListener('resize', resize)
      if (rafId) cancelAnimationFrame(rafId)
      try { if (engineRef.current) engineRef.current.stop() } catch (e) {}
      // stop tracks from video
      try {
        const v = videoRef.current
        if (v && v.srcObject) {
          const s = v.srcObject
          if (s.getTracks) s.getTracks().forEach(t => t.stop())
          v.srcObject = null
        }
      } catch (e) {}
    }
  }, [])

  return (
    <div className="fixed inset-0 bg-black">
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none opacity-90" />
    </div>
  )
}
