// Upload Worker for background video uploads
// This worker handles upload continuation even if the main page is closed

let activeUploads = new Map();

// Handle messages from main thread
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'START_UPLOAD':
      await handleUpload(data);
      break;
    
    case 'CANCEL_UPLOAD':
      cancelUpload(data.uploadId);
      break;
    
    case 'CHECK_STATUS':
      checkUploadStatus(data.uploadId);
      break;
  }
});

async function handleUpload(uploadData) {
  const {
    uploadId,
    blob,
    preSignedData,
    metadata
  } = uploadData;

  // Store upload info
  activeUploads.set(uploadId, {
    status: 'uploading',
    progress: 0,
    startTime: Date.now()
  });

  try {
    // Use multipart upload for large files
    if (preSignedData.upload_type === 'multipart') {
      await uploadMultipart(uploadId, blob, preSignedData, metadata);
    } else {
      await uploadDirect(uploadId, blob, preSignedData);
    }

    // Complete upload
    activeUploads.set(uploadId, {
      status: 'completed',
      progress: 100,
      completedTime: Date.now()
    });

    // Notify main thread
    self.postMessage({
      type: 'UPLOAD_COMPLETE',
      uploadId,
      success: true
    });

  } catch (error) {
    activeUploads.set(uploadId, {
      status: 'failed',
      error: error.message
    });

    self.postMessage({
      type: 'UPLOAD_FAILED',
      uploadId,
      error: error.message
    });
  }
}

async function uploadDirect(uploadId, blob, preSignedData) {
  const xhr = new XMLHttpRequest();
  
  xhr.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable) {
      const progress = Math.round((event.loaded / event.total) * 100);
      
      activeUploads.set(uploadId, {
        status: 'uploading',
        progress,
        loaded: event.loaded,
        total: event.total
      });

      // Send progress update
      self.postMessage({
        type: 'UPLOAD_PROGRESS',
        uploadId,
        progress,
        loaded: event.loaded,
        total: event.total
      });
    }
  });

  return new Promise((resolve, reject) => {
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
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
  });
}

async function uploadMultipart(uploadId, blob, preSignedData, metadata) {
  const { presigned_parts, upload_id, part_size = 5 * 1024 * 1024 } = preSignedData;
  const parts = [];
  let uploadedBytes = 0;

  for (let i = 0; i < presigned_parts.length; i++) {
    const partData = presigned_parts[i];
    const start = i * part_size;
    const end = Math.min(start + part_size, blob.size);
    const partBlob = blob.slice(start, end);
    
    // Upload part
    const response = await fetch(partData.url, {
      method: 'PUT',
      body: partBlob,
      headers: {
        'Content-Type': blob.type || 'video/webm',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to upload part ${i + 1}: ${response.status}`);
    }

    const etag = response.headers.get('ETag') || '';
    parts.push({
      PartNumber: partData.part_number,
      ETag: etag
    });

    uploadedBytes += partBlob.size;
    const progress = Math.round((uploadedBytes / blob.size) * 100);

    // Update progress
    activeUploads.set(uploadId, {
      status: 'uploading',
      progress,
      loaded: uploadedBytes,
      total: blob.size
    });

    self.postMessage({
      type: 'UPLOAD_PROGRESS',
      uploadId,
      progress,
      loaded: uploadedBytes,
      total: blob.size
    });
  }

  // Complete multipart upload
  const baseUrl = metadata.baseUrl || 'http://localhost:8010';
  const formData = new FormData();
  formData.append('object_key', preSignedData.object_key);
  formData.append('upload_id', upload_id);
  formData.append('parts', JSON.stringify(parts));
  
  // Add all metadata fields
  Object.keys(metadata).forEach(key => {
    if (key !== 'baseUrl' && metadata[key] !== undefined) {
      formData.append(key, metadata[key].toString());
    }
  });

  const completeResponse = await fetch(`${baseUrl}/api/v1/recordings/complete-multipart`, {
    method: 'POST',
    body: formData
  });

  if (!completeResponse.ok) {
    throw new Error(`Failed to complete multipart upload: ${completeResponse.status}`);
  }
}

function cancelUpload(uploadId) {
  const upload = activeUploads.get(uploadId);
  if (upload && upload.status === 'uploading') {
    // Cancel logic here
    activeUploads.set(uploadId, {
      status: 'cancelled'
    });
  }
}

function checkUploadStatus(uploadId) {
  const upload = activeUploads.get(uploadId);
  self.postMessage({
    type: 'STATUS_UPDATE',
    uploadId,
    status: upload || { status: 'not_found' }
  });
}