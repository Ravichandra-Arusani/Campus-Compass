import { useEffect, useState } from 'react';

// Global custom event emitter for Toast
export const showToast = (message, type = 'info') => {
  const event = new CustomEvent('smart-nav-toast', { detail: { message, type } });
  window.dispatchEvent(event);
};

export function useToast() {
  return { showToast };
}
