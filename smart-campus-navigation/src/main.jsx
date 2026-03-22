if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "maplibre-gl/dist/maplibre-gl.css"
import "./index.css"
import App from "./App"
import SmoothScroll from "./components/SmoothScroll"

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SmoothScroll />
    <App />
  </StrictMode>,
)
