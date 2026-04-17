import { useEffect, useState } from 'react';

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleToast = (e) => {
      const { message, type } = e.detail;
      const id = Date.now();
      setToasts((prev) => [...prev, { id, message, type }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    };

    window.addEventListener('smart-nav-toast', handleToast);
    return () => window.removeEventListener('smart-nav-toast', handleToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
      `}</style>
      {toasts.map((toast) => (
        <div key={toast.id} style={{
          background: '#1e293b', color: '#f8fafc', padding: '12px 16px', borderRadius: '8px',
          borderLeft: toast.type === 'error' ? '4px solid #ef4444' : '4px solid #f59e0b',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
          fontSize: '14px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px',
          animation: 'slideInRight 0.3s ease-out forwards',
        }}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
