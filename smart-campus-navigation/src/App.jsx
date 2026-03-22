import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import BackgroundVideoLayer from "./components/BackgroundVideoLayer"
import RoomAvailability from "./components/RoomAvailability"
import CinematicLanding from "./components/CinematicLanding"
import Help from "./components/Help"
import IndoorNavigation from "./components/IndoorNavigation"
import AdminPanel from "./components/AdminPanel"
import StickyTabs from "./components/StickyTabs"
import {
  bootstrapAuth,
  getAuthSnapshot,
  subscribeAuthState,
} from "./services/authService"

const CampusMap = lazy(() => import("./components/CampusMap"))
const Analytics = lazy(() => import("./tabs/Analytics"))
const AUTO_SCROLL_TO_MAP = false

gsap.registerPlugin(ScrollTrigger)
ScrollTrigger.defaults({ pinSpacing: true })

function App() {
  const appRootRef = useRef(null)
  const didScrollRef = useRef(false)
  const [activeTab, setActiveTab] = useState("map")
  const [hasOpenedAnalytics, setHasOpenedAnalytics] = useState(false)
  const [videoElement, setVideoElement] = useState(null)
  const [authState, setAuthState] = useState(() => getAuthSnapshot())
  const [indoorStartNode, setIndoorStartNode] = useState(null)
  const [isNavigating, setIsNavigating] = useState(false)

  useEffect(() => {
    const handleRouteState = (e) => setIsNavigating(e.detail?.active || false)
    window.addEventListener("smart-nav:route-state", handleRouteState)
    return () => window.removeEventListener("smart-nav:route-state", handleRouteState)
  }, [])

  const canViewAnalytics = Boolean(authState.isAuthenticated && authState.isStaff)
  const resolvedActiveTab =
    !canViewAnalytics && activeTab === "analytics" ? "map" : activeTab

  const tabs = useMemo(() => {
    const baseTabs = [
      { id: "map", label: "MAP" },
      { id: "indoor", label: "INDOOR NAVIGATION" },
      { id: "classroom", label: "ROOM AVAILABILITY" },
      { id: "admin", label: "ADMIN" },
      { id: "help", label: "HELP" },
    ]

    if (canViewAnalytics) {
      baseTabs.push({ id: "analytics", label: "ANALYTICS" })
    }

    return baseTabs
  }, [canViewAnalytics])

  const refreshScrollLayout = useCallback(() => {
    requestAnimationFrame(() => {
      ScrollTrigger.refresh()
    })
  }, [])

  useEffect(() => {
    if (!appRootRef.current) {
      return undefined
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".tabs-shell",
        { opacity: 0, y: 90 },
        {
          opacity: 1,
          y: 0,
          ease: "power3.out",
          scrollTrigger: {
            trigger: "#dashboard",
            start: "top 85%",
            end: "top 55%",
            scrub: true,
          },
        }
      )
    }, appRootRef)

    return () => ctx.revert()
  }, [])

  useEffect(() => {
    let ignore = false

    const unsubscribe = subscribeAuthState((snapshot) => {
      if (!ignore) {
        setAuthState(snapshot)
      }
    })

    bootstrapAuth()
      .catch(() => undefined)
      .finally(() => undefined)

    return () => {
      ignore = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      ScrollTrigger.refresh()
    })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [resolvedActiveTab, hasOpenedAnalytics, canViewAnalytics])

  useEffect(() => {
    if (!AUTO_SCROLL_TO_MAP) {
      return
    }
    if (didScrollRef.current) {
      return
    }
    didScrollRef.current = true

    const scrollToMap = () => {
      const mapSection = document.getElementById("map-section")
      if (!mapSection) {
        return false
      }

      requestAnimationFrame(() => {
        if (window.__SMART_NAV_LENIS__?.scrollTo) {
          window.__SMART_NAV_LENIS__.scrollTo(mapSection, { duration: 1.2 })
          return
        }

        mapSection.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
      })

      return true
    }

    if (scrollToMap()) {
      return
    }

    let attempts = 0
    const retryTimer = window.setInterval(() => {
      attempts += 1

      if (scrollToMap() || attempts >= 20) {
        window.clearInterval(retryTimer)
      }
    }, 100)

    return () => {
      window.clearInterval(retryTimer)
    }
  }, [])

  const handleTabChange = useCallback((tabId) => {
    setActiveTab(tabId)

    if (tabId === "analytics") {
      setHasOpenedAnalytics(true)
    }
  }, [])

  const handleVideoLoaded = useCallback(() => {
    refreshScrollLayout()
  }, [refreshScrollLayout])

  const handleHandoffToIndoor = useCallback((payload) => {
    setIndoorStartNode(payload?.entranceNode || null)
    setActiveTab("indoor")
  }, [])

  return (
    <>
      <BackgroundVideoLayer
        onVideoReady={setVideoElement}
        onVideoLoaded={handleVideoLoaded}
        isMapActive={resolvedActiveTab === "map"}
      />

      <main className="app-root" ref={appRootRef}>
        <CinematicLanding videoElement={videoElement} />

        <section className="dashboard-section" id="dashboard">
          <div className="tabs-shell">
            <div style={{ display: isNavigating ? 'none' : 'block' }}>
              <StickyTabs activeTab={resolvedActiveTab} onChange={handleTabChange} tabs={tabs} />
            </div>

            <div className="tab-content">
              {resolvedActiveTab === "map" && (
                <Suspense
                  fallback={
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Loading Map...</h2>
                        <p>Initializing outdoor campus view.</p>
                      </div>
                    </section>
                  }
                >
                  <section className="panel" id="map-section">
                    <div className="panel-head">
                      <h2>Campus Map</h2>
                      <p>Outdoor campus view for inter-building context.</p>
                    </div>
                    <div className="map-surface">
                      <CampusMap onHandoffToIndoor={handleHandoffToIndoor} />
                    </div>
                  </section>
                </Suspense>
              )}
              {resolvedActiveTab === "indoor" && <IndoorNavigation startNode={indoorStartNode} />}
              {resolvedActiveTab === "classroom" && <RoomAvailability />}
              {resolvedActiveTab === "admin" && <AdminPanel />}
              {resolvedActiveTab === "help" && <Help />}
              {resolvedActiveTab === "analytics" && canViewAnalytics && hasOpenedAnalytics && (
                <Suspense
                  fallback={
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Loading Analytics...</h2>
                        <p>Preparing route intelligence dashboards.</p>
                      </div>
                    </section>
                  }
                >
                  <Analytics />
                </Suspense>
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  )
}

export default App
