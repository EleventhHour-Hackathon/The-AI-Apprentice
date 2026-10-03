"use client";

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('✅ Service Worker registered:', registration.scope);
          
          // Handle service worker updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('🔄 New service worker available, please refresh');
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error('❌ Service Worker registration failed:', error);
        });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type, data } = event.data;
        
        switch (type) {
          case 'UPLOAD_COMPLETE':
            console.log('✅ Background upload completed:', data.uploadId);
            break;
          case 'UPLOAD_FAILED':
            console.error('❌ Background upload failed:', data.uploadId, data.error);
            break;
          case 'UPLOAD_PROGRESS':
            console.log('📊 Background upload progress:', data.progress + '%');
            break;
        }
      });
    } else {
      console.warn('Service Worker not supported');
    }
  }, []);

  return null; // This component doesn't render anything
}