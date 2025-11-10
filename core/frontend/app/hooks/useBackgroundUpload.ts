"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';

interface BackgroundUploadOptions {
  onProgress?: (progress: number, loaded: number, total: number) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

export function useBackgroundUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const currentUploadId = useRef<string | null>(null);

  // Initialize worker
  useEffect(() => {
    if (typeof window !== 'undefined' && window.Worker) {
      // Use dynamic import with Next.js worker syntax
      workerRef.current = new Worker(
        new URL('../workers/upload-worker.js', import.meta.url),
        { type: 'module' }
      );
      
      // Handle worker messages
      workerRef.current.addEventListener('message', (event) => {
        const { type, uploadId, progress, loaded, total, error } = event.data;
        
        switch (type) {
          case 'UPLOAD_PROGRESS':
            setUploadProgress(progress);
            console.log(`📊 Upload progress: ${progress}%`);
            break;
            
          case 'UPLOAD_COMPLETE':
            setIsUploading(false);
            setUploadProgress(100);
            console.log('✅ Background upload completed');
            toast.success('Recording uploaded successfully');
            
            // Clear from IndexedDB after successful upload
            if (uploadId) {
              clearStoredRecording(uploadId);
            }
            break;
            
          case 'UPLOAD_FAILED':
            setIsUploading(false);
            console.error('❌ Background upload failed:', error);
            toast.error(`Upload failed: ${error}`);
            break;
        }
      });
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Store recording in IndexedDB for persistence
  const storeRecording = useCallback(async (blob: Blob, metadata: any): Promise<string> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('RecordingStorage', 1);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('recordings')) {
          db.createObjectStore('recordings', { keyPath: 'id' });
        }
      };
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(['recordings'], 'readwrite');
        const store = transaction.objectStore('recordings');
        
        const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const recordingData = {
          id: uploadId,
          blob,
          metadata,
          timestamp: Date.now(),
          status: 'pending'
        };
        
        const addRequest = store.add(recordingData);
        
        addRequest.onsuccess = () => {
          console.log('📦 Recording stored in IndexedDB:', uploadId);
          resolve(uploadId);
        };
        
        addRequest.onerror = () => {
          reject(new Error('Failed to store recording'));
        };
      };
      
      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };
    });
  }, []);

  // Clear stored recording after successful upload
  const clearStoredRecording = useCallback(async (uploadId: string) => {
    const request = indexedDB.open('RecordingStorage', 1);
    
    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = db.transaction(['recordings'], 'readwrite');
      const store = transaction.objectStore('recordings');
      
      store.delete(uploadId);
      console.log('🧹 Cleared stored recording:', uploadId);
    };
  }, []);

  // Start background upload
  const startBackgroundUpload = useCallback(async (
    blob: Blob,
    preSignedData: any,
    metadata: any
  ) => {
    if (!workerRef.current) {
      throw new Error('Web Worker not available');
    }

    // Store recording first for persistence
    const uploadId = await storeRecording(blob, { ...metadata, preSignedData });
    currentUploadId.current = uploadId;
    
    setIsUploading(true);
    setUploadProgress(0);

    // Send to worker for background upload
    workerRef.current.postMessage({
      type: 'START_UPLOAD',
      data: {
        uploadId,
        blob,
        preSignedData,
        metadata
      }
    });

    console.log('🚀 Started background upload:', uploadId);
    
    return uploadId;
  }, [storeRecording]);

  // Check for pending uploads on page load
  const checkPendingUploads = useCallback(async () => {
    const request = indexedDB.open('RecordingStorage', 1);
    
    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains('recordings')) {
        return;
      }
      
      const transaction = db.transaction(['recordings'], 'readonly');
      const store = transaction.objectStore('recordings');
      const getAllRequest = store.getAll();
      
      getAllRequest.onsuccess = () => {
        const pendingRecordings = getAllRequest.result;
        
        if (pendingRecordings.length > 0) {
          console.log(`📋 Found ${pendingRecordings.length} pending uploads`);
          
          // Resume uploads
          pendingRecordings.forEach(recording => {
            if (recording.status === 'pending' && workerRef.current) {
              console.log('♻️ Resuming upload:', recording.id);
              
              workerRef.current.postMessage({
                type: 'START_UPLOAD',
                data: {
                  uploadId: recording.id,
                  blob: recording.blob,
                  preSignedData: recording.metadata.preSignedData,
                  metadata: recording.metadata
                }
              });
            }
          });
        }
      };
    };
  }, []);

  // Cancel upload
  const cancelUpload = useCallback(() => {
    if (workerRef.current && currentUploadId.current) {
      workerRef.current.postMessage({
        type: 'CANCEL_UPLOAD',
        data: { uploadId: currentUploadId.current }
      });
      setIsUploading(false);
    }
  }, []);

  return {
    startBackgroundUpload,
    checkPendingUploads,
    cancelUpload,
    isUploading,
    uploadProgress
  };
}