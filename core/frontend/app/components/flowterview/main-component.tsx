"use client";

import AudioClient from "./audio-client";
import Presentation from "./presentation-layer";
import ScreenRecorderOptimized from "./screen-recorder-optimized";
import RecordingPermission from "./recording-permission";
import usePathStore from "@/app/store/PathStore";
import useEnhancedS3Upload from "@/app/hooks/useEnhancedS3Upload";
import { useResilientUpload } from "@/app/hooks/useResilientUpload";
import { useState, useRef, useCallback, useEffect } from "react";

export default function FlowterviewComponent() {
  const { setCurrentBotTranscript, jobId, candidateId, roundNumber, interviewId } =
    usePathStore();
  const { 
    uploadRecording
  } = useEnhancedS3Upload();

  const {
    startResilientUpload,
    resumePendingUploads
  } = useResilientUpload();
  
  const [recordingPermissionGranted, setRecordingPermissionGranted] =
    useState(false);
  const [activeScreenStream, setActiveScreenStream] =
    useState<MediaStream | null>(null);
  
  // Track upload retry attempts
  const uploadRetryCountRef = useRef(0);
  const activeUploadRef = useRef<boolean>(false);

  // Skip permission screen in development
  const isDevelopment = process.env.NODE_ENV === "development";

  // Check for pending uploads on mount (only in production)
  useEffect(() => {
    // Resume any pending uploads from previous sessions
    resumePendingUploads();
  }, [resumePendingUploads]);

  const handleClearTranscripts = () => {
    setCurrentBotTranscript("");
  };

  const handleRecordingStart = (): void => {
    // Silent recording - no UI notification
  };

  const handleRecordingStop = useCallback(async (recordingBlob: Blob, isRetry: boolean = false) => {
    const sizeMB = recordingBlob.size / (1024 * 1024);

    // Validation
    if (recordingBlob.size === 0) {
      console.warn("Recording blob is empty, skipping upload");
      return;
    }

    // Reset retry counter only for new uploads, not retries
    if (!isRetry) {
      uploadRetryCountRef.current = 0;
    }

    console.log(`📤 Starting upload for ${sizeMB.toFixed(2)}MB recording`);
    activeUploadRef.current = true;

    try {
      // ALWAYS use resilient upload with service worker backup
      console.log("📦 Using resilient upload with service worker backup");
        
        // First get presigned URL
        const baseUrl = process.env.NEXT_PUBLIC_SIVERA_BACKEND_URL || 'http://localhost:8010';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        const formData = new FormData();
        formData.append('job_id', jobId);
        formData.append('candidate_id', candidateId);
        formData.append('timestamp', timestamp);
        formData.append('file_size', recordingBlob.size.toString());
        formData.append('content_type', recordingBlob.type || 'video/webm');
        formData.append('interview_type', roundNumber ? 'human_interview' : 'ai_interview');
        
        if (roundNumber) {
          formData.append('round_number', roundNumber.toString());
        }

        const response = await fetch(`${baseUrl}/api/v1/recordings/presigned-url`, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error(`Failed to get presigned URL: ${response.status}`);
        }

        const preSignedData = await response.json();
        
        // Start resilient upload - will persist in IndexedDB and resume if interrupted
        const uploadId = await startResilientUpload(
          recordingBlob,
          preSignedData,
          {
            job_id: jobId,
            candidate_id: candidateId,
            interview_id: interviewId,
            timestamp,
            file_size: recordingBlob.size.toString(),
            content_type: recordingBlob.type || 'video/webm',
            interview_type: roundNumber ? 'human_interview' : 'ai_interview',
            round_number: roundNumber?.toString()
          }
        );
        
        console.log("✅ Resilient upload started:", uploadId);
        // Don't show intrusive messages, just log
        console.log("Recording saved locally and uploading. Will resume automatically if interrupted.");
      
    } catch (error) {
      console.error("❌ Upload failed:", error);
      
      // Log additional debugging info
      console.error("Upload failure details:", {
        blobSize: recordingBlob.size,
        blobType: recordingBlob.type,
        jobId,
        candidateId,
        roundNumber,
        isRetry
      });
      
      // Don't show error toast - it's handled by the resilient upload hook
      console.log("Upload will be retried automatically on next page load.");
    } finally {
      activeUploadRef.current = false;
    }
  }, [uploadRecording, startResilientUpload, jobId, candidateId, interviewId, roundNumber, isDevelopment]);

  const handleRecordingError = useCallback((_error: string) => {
    // Log error but don't show UI
  }, []);

  const handlePermissionGranted = useCallback((screenStream: MediaStream) => {
    // Prevent setting stream multiple times
    if (activeScreenStream) {
      console.log("Screen stream already set, ignoring duplicate");
      return;
    }
    console.log("Setting screen stream and permission granted");
    setRecordingPermissionGranted(true);
    setActiveScreenStream(screenStream);
  }, [activeScreenStream]);

  const handlePermissionDenied = useCallback(() => {
    // Log but don't show UI
  }, []);

  // Only skip recording entirely if explicitly set
  const shouldSkipRecording =
    isDevelopment && process.env.NEXT_PUBLIC_SKIP_RECORDING === "true";

  // Show permission screen first (unless skipping recording entirely)
  if (!recordingPermissionGranted && !shouldSkipRecording) {
    return (
      <RecordingPermission
        onPermissionGranted={handlePermissionGranted}
        onPermissionDenied={handlePermissionDenied}
      />
    );
  }

  return (
    <main className="h-full w-full bg-[--meet-background] dark:bg-[--meet-background] relative overflow-hidden">
      {/* Hidden Recording Component - Optimized Version */}
      <ScreenRecorderOptimized
        onRecordingStart={handleRecordingStart}
        onRecordingStop={handleRecordingStop}
        onRecordingError={handleRecordingError}
        existingStream={activeScreenStream}
      />
      
      {/* Hidden upload progress tracking in console only */}
      
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-app-blue-800/40 via-app-blue-700/30 to-[#232336]/80 dark:from-app-blue-900/60 dark:via-[#292a3a]/60 dark:to-[#232336]/90 backdrop-blur-2xl" />
      <div className="h-full">
        <AudioClient onClearTranscripts={handleClearTranscripts} />
        <Presentation />
      </div>
    </main>
  );
}
