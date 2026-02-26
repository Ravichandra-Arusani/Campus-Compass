import { useEffect } from "react"
import Lenis from "lenis"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)
ScrollTrigger.config({ ignoreMobileResize: true })
gsap.ticker.lagSmoothing(0)

function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      smoothWheel: true,
      smoothTouch: false,
    })
    Object.defineProperty(window, "__SMART_NAV_LENIS__", {
      value: lenis,
      writable: false,
      configurable: true,
    })

    const onLenisScroll = () => ScrollTrigger.update()
    const onRefresh = () => {
      if (typeof lenis.resize === "function") {
        lenis.resize()
      }
    }

    lenis.on("scroll", onLenisScroll)
    ScrollTrigger.addEventListener("refresh", onRefresh)

    let frameId = 0
    const raf = (time) => {
      lenis.raf(time)
      frameId = window.requestAnimationFrame(raf)
    }

    frameId = window.requestAnimationFrame(raf)
    ScrollTrigger.refresh()

    return () => {
      window.cancelAnimationFrame(frameId)
      ScrollTrigger.removeEventListener("refresh", onRefresh)
      lenis.off("scroll", onLenisScroll)
      lenis.destroy()
      if (window.__SMART_NAV_LENIS__ === lenis) {
        delete window.__SMART_NAV_LENIS__
      }
    }
  }, [])

  return null
}

export default SmoothScroll
