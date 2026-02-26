import { useEffect, useRef } from "react"

function BackgroundVideoLayer({ onVideoReady, onVideoLoaded, isMapActive }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return undefined
    }

    onVideoReady(video)

    const handleLoadedData = () => {
      onVideoLoaded?.()
    }

    video.addEventListener("loadeddata", handleLoadedData)

    return () => {
      video.removeEventListener("loadeddata", handleLoadedData)
    }
  }, [onVideoLoaded, onVideoReady])

  return (
    <div id="video-layer" className={isMapActive ? "is-map-active" : ""}>
      <video
        ref={videoRef}
        src="/videos/campus-bg.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        style={{ willChange: "transform" }}
      />
    </div>
  )
}

export default BackgroundVideoLayer
