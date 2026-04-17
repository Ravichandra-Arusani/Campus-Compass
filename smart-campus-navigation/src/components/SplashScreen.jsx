// src/components/SplashScreen.jsx
import { useEffect, useState } from "react";

export default function SplashScreen() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1700);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: '#0a0f1e', zIndex: 99999,
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      animation: 'fadeOut 0.5s ease 1.2s forwards'
    }}>
      <style>{`
        @keyframes fadeOut { to { opacity: 0; pointer-events: none; visibility: hidden; } }
        @keyframes spinPulse { 
          0% { transform: scale(0.9) rotate(0deg); opacity: 0.8; } 
          50% { transform: scale(1.1) rotate(180deg); opacity: 1; }
          100% { transform: scale(0.9) rotate(360deg); opacity: 0.8; } 
        }
      `}</style>
      <div style={{ fontSize: '5rem', animation: 'spinPulse 2.5s ease-in-out infinite' }}>🧭</div>
      <h1 style={{ color: '#f59e0b', fontSize: '2.5rem', marginTop: "1rem", letterSpacing: "2px", fontWeight: "800" }}>
        Campus Compass
      </h1>
      <p style={{ color: '#64748b', marginTop: "0.5rem", fontSize: "1.1rem" }}>Initializing navigation engine...</p>
    </div>
  );
}
