import { useEffect, useRef } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)

function CinematicLanding() {
  const sectionRef = useRef(null)
  const vantaRef = useRef(null)
  const retryTimeoutRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let attempts = 0

    const initVanta = () => {
      if (cancelled) {
        return
      }

      if (window.VANTA?.NET) {
        vantaRef.current = window.VANTA.NET({
          el: "#hero-bg",
          mouseControls: false,
          touchControls: false,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          scale: 1,
          scaleMobile: 1,
          color: 0xff7a1a,
          backgroundColor: 0x070709,
          points: 8,
          maxDistance: 18,
          spacing: 15,
          showDots: true,
          speed: 2.5,
        })
        return
      }

      attempts += 1
      if (attempts < 30) {
        retryTimeoutRef.current = window.setTimeout(initVanta, 100)
      }
    }

    initVanta()

    return () => {
      cancelled = true
      if (retryTimeoutRef.current) {
        window.clearTimeout(retryTimeoutRef.current)
      }
      if (vantaRef.current) {
        vantaRef.current.destroy()
        vantaRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleRouteState = (e) => {
      if (!vantaRef.current) return

      if (e.detail?.active) {
        if (typeof vantaRef.current.pause === "function") {
          vantaRef.current.pause()
        }
      } else {
        if (typeof vantaRef.current.play === "function") {
          vantaRef.current.play()
        }
      }
    }

    window.addEventListener("smart-nav:route-state", handleRouteState)
    return () => window.removeEventListener("smart-nav:route-state", handleRouteState)
  }, [])

  useEffect(() => {
    if (!sectionRef.current) {
      return undefined
    }

    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "+=1200",
          scrub: 1.2,
          pin: true,
          pinSpacing: false,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      })

      timeline
        .to("#hero-bg", { scale: 1.12, transformOrigin: "center center", ease: "none" }, 0)
        .to(".hero-content", { y: -200, opacity: 0, ease: "none" }, 0)
        .to(".hero-parallax-one", { y: -140, opacity: 0.8, ease: "none" }, 0)
        .to(".hero-parallax-two", { y: -80, opacity: 0.6, ease: "none" }, 0)
        .to(".hero-wrapper", { opacity: 0, ease: "none" }, 0.6)
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section className="hero-wrapper" ref={sectionRef}>
      <div id="hero-bg" />
      <div className="hero-parallax hero-parallax-one" aria-hidden="true" />
      <div className="hero-parallax hero-parallax-two" aria-hidden="true" />
      <div className="hero-content">
        <h1>Campus Navigation and Smart Mapping System</h1>
      </div>
    </section>
  )
}

export default CinematicLanding
