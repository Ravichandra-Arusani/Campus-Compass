// Add this to src/main.jsx or index.html
// Registers service worker for tile caching

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('Tile cache SW registered'))
      .catch(err => console.warn('SW registration failed:', err))
  })
}

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "leaflet/dist/leaflet.css"
import "./index.css"
import App from "./App"
import SmoothScroll from "./components/SmoothScroll"

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SmoothScroll />
    <App />
  </StrictMode>,
)

