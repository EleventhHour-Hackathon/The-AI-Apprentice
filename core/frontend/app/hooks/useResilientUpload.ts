"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import usePathStore from '@/app/store/PathStore';
import { logDiagnostic } from '@/app/utils/uploadDiagnostics';
import { retryS3Upload } from '@/app/utils/retryWithBackoff';

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

interface PendingUpload {
  id: string;
  blob: Blob;
  metadata: any;
  preSignedData: any;
  timestamp: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  attempts: number;
}

export function useResilientUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  const uploadAbortController = useRef<AbortController | null>(null);
  const { jobId, candidateId, roundNumber, interviewId } = usePathStore();
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Initialize IndexedDB
  const openDB = useCallback((): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('RecordingStorage', 2);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object store for recordings if it doesn't exist
        if (!db.objectStoreNames.contains('recordings')) {
          const store = db.createObjectStore('recordings', { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      
      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };
      
      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };
    });
  }, []);

  // Store upload for persistence
  const storeUpload = useCallback(async (
    blob: Blob,
    preSignedData: any,
    metadata: any
  ): Promise<string> => {
    const db = await openDB();
    const transaction = db.transaction(['recordings'], 'readwrite');
    const store = transaction.objectStore('recordings');
    
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const uploadData: PendingUpload = {
      id: uploadId,
      blob,
      metadata,
      preSignedData,
      timestamp: Date.now(),
      status: 'pending',
      attempts: 0
    };
    
    return new Promise((resolve, reject) => {
      const request = store.add(uploadData);
      
      request.onsuccess = () => {
        console.log('📦 Recording stored for upload:', uploadId);
        resolve(uploadId);
      };
      
      request.onerror = () => {
        reject(new Error('Failed to store recording'));
      };
    });
  }, [openDB]);

  // Update upload status
  const updateUploadStatus = useCallback(async (
    uploadId: string,
    status: PendingUpload['status'],
    incrementAttempts: boolean = false
  ) => {
    const db = await openDB();
    const transaction = db.transaction(['recordings'], 'readwrite');
    const store = transaction.objectStore('recordings');
    
    const getRequest = store.get(uploadId);
    
    getRequest.onsuccess = () => {
      const upload = getRequest.result;
      if (upload) {
        upload.status = status;
        if (incrementAttempts) {
          upload.attempts++;
        }
        store.put(upload);
      }
    };
  }, [openDB]);

  // Delete completed upload
  const deleteUpload = useCallback(async (uploadId: string) => {
    const db = await openDB();
    const transaction = db.transaction(['recordings'], 'readwrite');
    const store = transaction.objectStore('recordings');
    store.delete(uploadId);
    console.log('🧹 Deleted completed upload:', uploadId);
  }, [openDB]);

  // Perform upload with multipart support
  const performUpload = useCallback(async (
    uploadData: PendingUpload,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> => {
    const { blob, preSignedData, metadata } = uploadData;
    
    // Check if presigned URL has expired (URLs are valid for 30 minutes)
    const urlCreatedAt = uploadData.timestamp;
    const now = Date.now();
    const urlAge = now - urlCreatedAt;
    const maxAge = 25 * 60 * 1000; // 25 minutes (5 min buffer before 30 min expiry)
    
    if (urlAge > maxAge) {
      // Need to get a new presigned URL
      console.log('🔄 Presigned URL expired, refreshing...');
      
      // Get fresh presigned URL
      const freshPreSignedData = await getPreSignedUrlWithRetry(
        uploadData.blob,
        uploadData.metadata.job_id,
        uploadData.metadata.candidate_id,
        uploadData.metadata.round_number ? parseInt(uploadData.metadata.round_number) : undefined
      );
      
      // Update upload data with fresh URL
      uploadData.preSignedData = freshPreSignedData;
      uploadData.timestamp = Date.now(); // Reset timestamp
      
      console.log('✅ Presigned URL refreshed successfully');
    }
    
    // Create abort controller for this upload
    uploadAbortController.current = new AbortController();
    
    try {
      if (preSignedData.upload_type === 'multipart') {
        // Multipart upload for large files
        const parts: Array<{ PartNumber: number; ETag: string }> = [];
        const partSize = preSignedData.part_size || 5 * 1024 * 1024;
        let uploadedBytes = 0;
        
        for (let i = 0; i < preSignedData.presigned_parts.length; i++) {
          const partData = preSignedData.presigned_parts[i];
          const start = i * partSize;
          const end = Math.min(start + partSize, blob.size);
          const partBlob = blob.slice(start, end);
          
          const response = await retryS3Upload(
            () => fetch(partData.url, {
              method: 'PUT',
              body: partBlob,
              headers: {
                'Content-Type': blob.type || 'video/webm',
              },
              signal: uploadAbortController.current?.signal
            }),
            uploadData.id,
            partData.part_number
          );
          
          if (!response.ok) {
            // Check for specific error codes
            if (response.status === 403) {
              throw new Error(`S3 upload permission denied (403). Presigned URL may have expired or has incorrect permissions.`);
            } else if (response.status === 400) {
              throw new Error(`S3 bad request (400). Check the presigned URL parameters.`);
            }
            throw new Error(`Failed to upload part ${i + 1}: HTTP ${response.status}`);
          }
          
          parts.push({
            PartNumber: partData.part_number,
            ETag: response.headers.get('ETag') || ''
          });
          
          uploadedBytes += partBlob.size;
          const progress = Math.round((uploadedBytes / blob.size) * 100);
          
          onProgress?.({
            loaded: uploadedBytes,
            total: blob.size,
            percentage: progress
          });
          
          // Log progress for large uploads
          if (i % 10 === 0 || i === preSignedData.presigned_parts.length - 1) {
            logDiagnostic('upload_progress', {
              uploadId: uploadData.id,
              partNumber: i + 1,
              totalParts: preSignedData.presigned_parts.length,
              percentage: progress
            });
          }
        }
        
        // Complete multipart upload
        await completeMultipartUpload(preSignedData, parts, metadata);
        
      } else {
        // Direct upload for smaller files
        const xhr = new XMLHttpRequest();
        
        // Setup progress tracking
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            onProgress?.({
              loaded: event.loaded,
              total: event.total,
              percentage: Math.round((event.loaded / event.total) * 100)
            });
          }
        });
        
        // Setup abort handling
        if (uploadAbortController.current) {
          uploadAbortController.current.signal.addEventListener('abort', () => {
            xhr.abort();
          });
        }
        
        return retryS3Upload(
          () => new Promise((resolve, reject) => {
            xhr.addEventListener('load', async () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                // Confirm upload with backend
                await confirmUpload(preSignedData, metadata);
                resolve();
              } else {
                reject(new Error(`Upload failed: ${xhr.status}`));
              }
            });
            
            xhr.addEventListener('error', () => {
              reject(new Error('Network error during upload'));
            });
            
            xhr.open('PUT', preSignedData.presigned_url);
            xhr.setRequestHeader('Content-Type', preSignedData.content_type);
            xhr.send(blob);
          }),
          uploadData.id
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Upload cancelled');
      }
      throw error;
    }
  }, []);

  // Complete multipart upload
  const completeMultipartUpload = async (
    preSignedData: any,
    parts: Array<{ PartNumber: number; ETag: string }>,
    metadata: any
  ) => {
    const baseUrl = process.env.NEXT_PUBLIC_SIVERA_BACKEND_URL || 'http://localhost:8010';
    const formData = new FormData();
    
    formData.append('object_key', preSignedData.object_key);
    formData.append('upload_id', preSignedData.upload_id);
    formData.append('parts', JSON.stringify(parts));
    formData.append('job_id', metadata.job_id);
    formData.append('candidate_id', metadata.candidate_id);
    formData.append('timestamp', metadata.timestamp);
    formData.append('file_size', metadata.file_size);
    formData.append('content_type', metadata.content_type);
    formData.append('interview_type', metadata.interview_type);
    
    if (metadata.round_number) {
      formData.append('round_number', metadata.round_number);
    }
    if (metadata.interview_id) {
      formData.append('interview_id', metadata.interview_id);
    }
    
    const response = await fetch(`${baseUrl}/api/v1/recordings/complete-multipart`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('Failed to complete multipart upload');
    }
  };

  // Confirm regular upload
  const confirmUpload = async (preSignedData: any, metadata: any) => {
    const baseUrl = process.env.NEXT_PUBLIC_SIVERA_BACKEND_URL || 'http://localhost:8010';
    const formData = new FormData();
    
    formData.append('object_key', preSignedData.object_key);
    formData.append('object_url', preSignedData.object_url);
    formData.append('job_id', metadata.job_id);
    formData.append('candidate_id', metadata.candidate_id);
    formData.append('timestamp', metadata.timestamp);
    formData.append('file_size', metadata.file_size);
    formData.append('content_type', metadata.content_type);
    formData.append('interview_type', metadata.interview_type);
    
    if (metadata.round_number) {
      formData.append('round_number', metadata.round_number);
    }
    if (metadata.interview_id) {
      formData.append('interview_id', metadata.interview_id);
    }
    
    const response = await fetch(`${baseUrl}/api/v1/recordings/confirm-upload`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('Failed to confirm upload');
    }
  };

  // Start resilient upload
  const startResilientUpload = useCallback(async (
    blob: Blob,
    preSignedData: any,
    metadata: any
  ): Promise<string> => {
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log('🚀 Starting resilient upload:', uploadId);
    
    // PRIORITY 1: Immediately queue in service worker for background processing
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.active) {
          console.log('📡 Service worker is ready, sending upload data...');
          
          // Convert blob to ArrayBuffer for service worker transfer
          const arrayBuffer = await blob.arrayBuffer();
          
          registration.active.postMessage({
            type: 'QUEUE_UPLOAD',
            data: {
              uploadId,
              blobData: arrayBuffer,
              blobType: blob.type,
              blobSize: blob.size,
              preSignedData,
              metadata: {
                ...metadata,
                baseUrl: process.env.NEXT_PUBLIC_SIVERA_BACKEND_URL || 'http://localhost:8010'
              }
            }
          });
          console.log('✅ Upload queued in service worker immediately');
          
          // Give service worker a moment to process
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          console.warn('⚠️ Service worker not active');
        }
      } catch (e) {
        console.error('❌ Failed to queue in service worker:', e);
      }
    } else {
      console.warn('⚠️ Service Worker not supported');
    }
    
    // PRIORITY 2: Store in IndexedDB as backup
    try {
      await storeUpload(blob, preSignedData, metadata);
      console.log('💾 Upload stored in IndexedDB as backup');
    } catch (e) {
      console.error('❌ Failed to store in IndexedDB:', e);
    }
    
    // PRIORITY 3: Try main thread upload (will fail if tab closes)
    setIsUploading(true);
    setUploadError(null);
    setUploadProgress({ loaded: 0, total: blob.size, percentage: 0 });
    
    try {
      console.log('🔄 Starting main thread upload...');
      
      // Update status to uploading
      await updateUploadStatus(uploadId, 'uploading');
      
      // Perform the upload
      await performUpload(
        { id: uploadId, blob, preSignedData, metadata, timestamp: Date.now(), status: 'uploading', attempts: 0 },
        (progress) => setUploadProgress(progress)
      );
      
      // Mark as completed
      await updateUploadStatus(uploadId, 'completed');
      await deleteUpload(uploadId);
      
      setUploadProgress({ loaded: blob.size, total: blob.size, percentage: 100 });
      console.log('✅ Main thread upload completed successfully');
      
          } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        setUploadError(errorMessage);
        
        // Check if this is a 403 error that needs URL refresh
        if (errorMessage.includes('403') || errorMessage.includes('permission denied')) {
          console.log('🔄 403 error detected - will refresh presigned URL on retry');
          // Mark the upload timestamp as old to force URL refresh on next attempt
          const db = await openDB();
          const transaction = db.transaction(['recordings'], 'readwrite');
          const store = transaction.objectStore('recordings');
          
          const getRequest = store.get(uploadId);
          getRequest.onsuccess = () => {
            const upload = getRequest.result;
            if (upload) {
              upload.timestamp = Date.now() - (30 * 60 * 1000); // Mark as expired
              store.put(upload);
            }
          };
        }
        
        // Update status and increment attempts
        await updateUploadStatus(uploadId, 'failed', true);
        
        // Send to service worker for background processing
        if ('serviceWorker' in navigator) {
          try {
            const registration = await navigator.serviceWorker.ready;
            
            // Send upload data to service worker
            if (registration.active) {
              registration.active.postMessage({
                type: 'QUEUE_UPLOAD',
                data: {
                  uploadId,
                  blob,
                  preSignedData,
                  metadata
                }
              });
              console.log('📡 Upload queued in service worker for background processing');
            }
            
            // Register background sync
            if ('sync' in registration) {
              await (registration as any).sync.register('upload-recording');
              console.log('📡 Background sync registered');
            }
          } catch (e) {
            console.error('Failed to queue upload in service worker:', e);
          }
        }
        
        throw error;
    } finally {
      setIsUploading(false);
      uploadAbortController.current = null;
    }
    
    return uploadId;
  }, [storeUpload, updateUploadStatus, deleteUpload, performUpload]);

  // Resume pending uploads
  const resumePendingUploads = useCallback(async () => {
    const db = await openDB();
    const transaction = db.transaction(['recordings'], 'readonly');
    const store = transaction.objectStore('recordings');
    const index = store.index('status');
    
    const request = index.getAll('pending');
    
    request.onsuccess = async () => {
      const pendingUploads = request.result as PendingUpload[];
      
      if (pendingUploads.length > 0) {
        console.log(`📋 Found ${pendingUploads.length} pending uploads, resuming...`);
        
        for (const upload of pendingUploads) {
          if (upload.attempts < 3) {
            try {
              await updateUploadStatus(upload.id, 'uploading', true);
              await performUpload(upload, (progress) => setUploadProgress(progress));
              await updateUploadStatus(upload.id, 'completed');
              await deleteUpload(upload.id);
              console.log(`✅ Resumed upload completed: ${upload.id}`);
            } catch (error) {
              console.error('Failed to resume upload:', upload.id, error);
              await updateUploadStatus(upload.id, 'failed');
            }
          }
        }
      }
    };
  }, [openDB, updateUploadStatus, performUpload, deleteUpload]);

  // Cancel current upload
  const cancelUpload = useCallback(() => {
    if (uploadAbortController.current) {
      uploadAbortController.current.abort();
      setIsUploading(false);
      console.log('Upload cancelled');
    }
  }, []);

  // Check for pending uploads on mount
  useEffect(() => {
    if (!isDevelopment) {
      resumePendingUploads();
    }
  }, [resumePendingUploads, isDevelopment]);

  return {
    startResilientUpload,
    resumePendingUploads,
    cancelUpload,
    isUploading,
    uploadProgress,
    uploadError
  };
}

// Helper function to get presigned URL with retry
async function getPreSignedUrlWithRetry(
  blob: Blob,
  jobId: string,
  candidateId: string,
  roundNumber?: number,
  maxRetries: number = 3
): Promise<any> {
  const baseUrl = process.env.NEXT_PUBLIC_SIVERA_BACKEND_URL || 'http://localhost:8010';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const formData = new FormData();
      formData.append('job_id', jobId);
      formData.append('candidate_id', candidateId);
      formData.append('timestamp', timestamp);
      formData.append('file_size', blob.size.toString());
      formData.append('content_type', blob.type || 'video/webm');
      formData.append('interview_type', roundNumber ? 'human_interview' : 'ai_interview');
      
      if (roundNumber) {
        formData.append('round_number', roundNumber.toString());
      }

      const response = await fetch(`${baseUrl}/api/v1/recordings/presigned-url`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        console.log('🔗 Fresh presigned URL generated:', data.upload_type);
        return data;
      }

      throw new Error(`Failed to get presigned URL: ${response.status}`);
      
    } catch (error) {
      console.error(`❌ Presigned URL attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt === maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  throw new Error('Failed to get presigned URL after retries');
}