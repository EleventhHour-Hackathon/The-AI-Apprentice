// Service Worker for background upload persistence
const CACHE_NAME = 'recording-uploads-v1';
const DB_NAME = 'RecordingStorage';
const UPLOAD_QUEUE = 'upload-queue';

// Install event - set up the service worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(clients.claim());
  
  // Start periodic upload check
  setInterval(() => {
    uploadPendingRecordings();
  }, 30000); // Check every 30 seconds
});

// Background sync for upload resilience
self.addEventListener('sync', async (event) => {
  if (event.tag === 'upload-recording') {
    console.log('[SW] Background sync triggered for recording upload');
    event.waitUntil(uploadPendingRecordings());
  }
});

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;
  
  if (type === 'QUEUE_UPLOAD') {
    console.log('[SW] 📨 Received upload queue request:', data.uploadId);
    console.log('[SW] 📊 Upload data size:', data.blobSize, 'bytes, type:', data.blobType);
    
    try {
      await queueUpload(data);
      console.log('[SW] ✅ Upload successfully queued and processing started');
      
      // Try to register background sync for additional resilience
      if ('sync' in self.registration) {
        try {
          await self.registration.sync.register('upload-recording');
          console.log('[SW] 🔄 Background sync registered for additional resilience');
        } catch (error) {
          console.log('[SW] ⚠️ Background sync registration failed, but immediate processing already started');
        }
      }
    } catch (error) {
      console.error('[SW] ❌ Failed to queue upload:', error);
      
      // Emergency fallback - try direct upload
      try {
        console.log('[SW] 🚨 Attempting emergency direct upload...');
        await performUpload({
          ...data,
          blobData: data.blobData,
          blobType: data.blobType,
          blobSize: data.blobSize
        });
        console.log('[SW] ✅ Emergency upload succeeded');
      } catch (emergencyError) {
        console.error('[SW] ❌ Emergency upload also failed:', emergencyError);
      }
    }
  }
});

// Queue upload for later processing
async function queueUpload(uploadData) {
  try {
    const db = await openDB();
    const tx = db.transaction([UPLOAD_QUEUE], 'readwrite');
    const store = tx.objectStore(UPLOAD_QUEUE);
    
    const queueItem = {
      id: uploadData.uploadId,
      uploadId: uploadData.uploadId,
      blobData: uploadData.blobData, // Store as ArrayBuffer
      blobType: uploadData.blobType,
      blobSize: uploadData.blobSize,
      preSignedData: uploadData.preSignedData,
      metadata: uploadData.metadata,
      timestamp: Date.now(),
      status: 'pending',
      attempts: 0
    };
    
    await store.add(queueItem);
    console.log('[SW] ✅ Upload queued successfully:', uploadData.uploadId);
    
    // IMMEDIATELY process this upload - don't wait
    console.log('[SW] 🚀 Starting immediate upload processing...');
    uploadPendingRecordings();
    
  } catch (error) {
    console.error('[SW] Failed to queue upload:', error);
    // Try immediate upload as fallback
    try {
      await performUpload({
        ...uploadData,
        blobData: uploadData.blobData,
        blobType: uploadData.blobType,
        blobSize: uploadData.blobSize
      });
      console.log('[SW] Fallback immediate upload succeeded');
    } catch (uploadError) {
      console.error('[SW] Fallback upload also failed:', uploadError);
    }
  }
}

// Process pending uploads
async function uploadPendingRecordings() {
  try {
    const db = await openDB();
    const tx = db.transaction([UPLOAD_QUEUE], 'readonly');
    const store = tx.objectStore(UPLOAD_QUEUE);
    const pendingUploads = await store.getAll();
    
    console.log(`[SW] Processing ${pendingUploads.length} pending uploads`);
    
    for (const upload of pendingUploads) {
      if (upload.status === 'pending' && upload.attempts < 3) {
        console.log(`[SW] Processing upload ${upload.uploadId}, attempt ${upload.attempts + 1}`);
        
        try {
          console.log(`[SW] 📤 Starting upload for ${upload.uploadId}...`);
          await performUpload(upload);
          await markUploadComplete(upload.id);
          console.log(`[SW] ✅ Upload completed successfully: ${upload.uploadId}`);
          
          // Notify main thread of success
          self.clients.matchAll().then(clients => {
            clients.forEach(client => {
              client.postMessage({
                type: 'UPLOAD_COMPLETE',
                data: { uploadId: upload.uploadId, success: true }
              });
            });
          });
          
        } catch (error) {
          console.error(`[SW] Upload failed for ${upload.uploadId}:`, error);
          
          // Check for specific errors that need different handling
          if (error.message.includes('403') || error.message.includes('permission denied')) {
            console.log('[SW] Permission error - marking upload as failed (will not retry)');
            await markUploadComplete(upload.id); // Remove from queue
            
            // Notify main thread of failure
            self.clients.matchAll().then(clients => {
              clients.forEach(client => {
                client.postMessage({
                  type: 'UPLOAD_FAILED',
                  data: { uploadId: upload.uploadId, error: error.message }
                });
              });
            });
          } else {
            await incrementUploadAttempts(upload.id);
            console.log(`[SW] Will retry upload ${upload.uploadId} (attempt ${upload.attempts + 1}/3)`);
            
            // Schedule retry with exponential backoff
            const retryDelay = Math.min(1000 * Math.pow(2, upload.attempts), 30000);
            setTimeout(() => {
              uploadPendingRecordings();
            }, retryDelay);
          }
        }
      } else if (upload.attempts >= 3) {
        console.log(`[SW] Upload ${upload.uploadId} exceeded max attempts, removing from queue`);
        await markUploadComplete(upload.id);
      }
    }
  } catch (error) {
    console.error('[SW] Error processing uploads:', error);
  }
}

// Perform the actual upload
async function performUpload(uploadData) {
  // Convert ArrayBuffer back to Blob for upload
  const blob = new Blob([uploadData.blobData], { type: uploadData.blobType });
  const { preSignedData, metadata } = uploadData;
  
  // Validate blob exists and has content
  if (!blob || blob.size === 0) {
    throw new Error('Invalid or empty blob for upload');
  }
  
  console.log(`[SW] Starting upload: ${blob.size} bytes, type: ${blob.type}`);
  
  if (preSignedData.upload_type === 'multipart') {
    // Handle multipart upload
    const parts = [];
    const partSize = preSignedData.part_size || 5 * 1024 * 1024;
    
    for (let i = 0; i < preSignedData.presigned_parts.length; i++) {
      const partData = preSignedData.presigned_parts[i];
      const start = i * partSize;
      const end = Math.min(start + partSize, blob.size);
      const partBlob = blob.slice(start, end);
      
      const response = await fetch(partData.url, {
        method: 'PUT',
        body: partBlob,
        headers: {
          'Content-Type': blob.type || 'video/webm',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Part ${i + 1} upload failed`);
      }
      
      parts.push({
        PartNumber: partData.part_number,
        ETag: response.headers.get('ETag') || ''
      });
    }
    
    // Complete multipart upload
    await completeMultipartUpload(preSignedData, parts, metadata);
  } else {
    // Direct upload
    const response = await fetch(preSignedData.presigned_url, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': preSignedData.content_type,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    
    // Confirm upload
    await confirmUpload(preSignedData, metadata);
  }
}

// Complete multipart upload
async function completeMultipartUpload(preSignedData, parts, metadata) {
  const baseUrl = metadata.baseUrl || 'http://localhost:8010';
  const formData = new FormData();
  
  formData.append('object_key', preSignedData.object_key);
  formData.append('upload_id', preSignedData.upload_id);
  formData.append('parts', JSON.stringify(parts));
  
  Object.keys(metadata).forEach(key => {
    if (key !== 'baseUrl' && metadata[key] !== undefined) {
      formData.append(key, metadata[key].toString());
    }
  });
  
  const response = await fetch(`${baseUrl}/api/v1/recordings/complete-multipart`, {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    throw new Error('Failed to complete multipart upload');
  }
}

// Confirm regular upload
async function confirmUpload(preSignedData, metadata) {
  const baseUrl = metadata.baseUrl || 'http://localhost:8010';
  const formData = new FormData();
  
  formData.append('object_key', preSignedData.object_key);
  formData.append('object_url', preSignedData.object_url);
  
  Object.keys(metadata).forEach(key => {
    if (key !== 'baseUrl' && metadata[key] !== undefined) {
      formData.append(key, metadata[key].toString());
    }
  });
  
  const response = await fetch(`${baseUrl}/api/v1/recordings/confirm-upload`, {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    throw new Error('Failed to confirm upload');
  }
}

// Database helpers
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2); // Match version with main app
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Handle version 1 -> 2 upgrade
      if (event.oldVersion < 2) {
        // Create recordings store if it doesn't exist (from main app)
        if (!db.objectStoreNames.contains('recordings')) {
          const recordingsStore = db.createObjectStore('recordings', { keyPath: 'id' });
          recordingsStore.createIndex('status', 'status', { unique: false });
          recordingsStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        // Create upload queue store for service worker
        if (!db.objectStoreNames.contains(UPLOAD_QUEUE)) {
          const queueStore = db.createObjectStore(UPLOAD_QUEUE, { keyPath: 'id' });
          queueStore.createIndex('status', 'status', { unique: false });
          queueStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      }
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function markUploadComplete(uploadId) {
  const db = await openDB();
  const tx = db.transaction([UPLOAD_QUEUE], 'readwrite');
  const store = tx.objectStore(UPLOAD_QUEUE);
  await store.delete(uploadId);
  console.log('[SW] Upload completed and removed from queue:', uploadId);
}

async function incrementUploadAttempts(uploadId) {
  const db = await openDB();
  const tx = db.transaction([UPLOAD_QUEUE], 'readwrite');
  const store = tx.objectStore(UPLOAD_QUEUE);
  const upload = await store.get(uploadId);
  
  if (upload) {
    upload.attempts++;
    await store.put(upload);
    console.log('[SW] Upload attempt incremented:', uploadId, upload.attempts);
  }
}