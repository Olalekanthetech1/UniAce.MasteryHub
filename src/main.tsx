import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import './index.css';
import 'katex/dist/katex.min.css';
import { AuthProvider } from './context/AuthContext';
import { CourseProvider } from './context/CourseContext';
import ErrorBoundary from './components/ErrorBoundary';

import { ThemeProvider } from './context/ThemeContext';
import { DemoReelProvider } from './context/DemoReelContext';

// Initialize theme immediately to prevent flash
console.log('Main.tsx: Initializing application...');
try {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  // Capture referral code from URL if present
  const params = new URLSearchParams(window.location.search);
  const refCode = params.get('ref');
  if (refCode) {
    if (sessionStorage.getItem('ref_code') !== refCode) {
      sessionStorage.setItem('ref_code', refCode);
      // Blindly increment clicks securely via backend endpoint
      fetch('/api/track-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refCode })
      }).catch(() => {});
    }
  }
  // In development, clear any stale service workers that may intercept API requests
  if (import.meta.env.DEV && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (const reg of registrations) {
        reg.unregister();
      }
    }).catch(() => {});
  }
} catch (e) {
  console.warn('Storage access denied', e);
}

console.log('Main.tsx: Starting render...');

try {
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <CourseProvider>
            <DemoReelProvider>
              <BrowserRouter><App /></BrowserRouter>
            </DemoReelProvider>
          </CourseProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>,
  );
  console.log('Main.tsx: Render call completed.');
} catch (e) {
  console.error('Main.tsx: Render failed:', e);
}
