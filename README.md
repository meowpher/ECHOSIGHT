# Acoustic Radar (Client-side)

Mobile-first acoustic radar that emits a short ultrasonic chirp and measures the echo using cross-correlation to estimate distance to the nearest object. Runs entirely in the browser (React + Vite + Tailwind).

Features
- React + Vite app ready for Vercel deployment
- Tailwind CSS dark UI, mobile responsive
- Web Audio API: emits 10ms linear chirp (18kHz → 20kHz)
- Client-side cross-correlation with 2ms blind zone

Quick start

```bash
cd /path/to/project
npm install
npm run dev
# Open http://localhost:5173
```

Build for production (Vercel will run this automatically):

```bash
npm run build
```

Notes
- Microphone access requires HTTPS (or localhost). The app will alert if not served over HTTPS.
- Ultrasonic frequencies may be inaudible on many devices. Performance varies by phone speaker/mic hardware.

Files of interest
- `src/App.jsx` — UI and scanning logic
- `src/audioUtils.js` — chirp generation & cross-correlation math

Deploying to Vercel

1. Connect your Git repository to Vercel (https://vercel.com/new).
2. Ensure the project root contains `package.json` and `vercel.json` (already included).
3. Vercel will run `npm run build` (or `vercel-build`) and publish the `dist` folder.

Optional: add a one-click deploy button to your README (replace <YOUR_REPO_URL>):

```md
[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/git/external?repository-url=<YOUR_REPO_URL>)
```

If you want me to connect the repo and trigger a deployment, provide the repository URL or authorize Vercel and I can assist with setup steps.
