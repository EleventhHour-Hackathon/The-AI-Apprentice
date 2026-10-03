interface DiagnosticEvent {
  timestamp: number;
  type: 'recording_start' | 'recording_stop' | 'upload_start' | 'upload_progress' | 
        'upload_complete' | 'upload_error' | 'chunk_received' | 'buffer_overflow' |
        'stream_health' | 'presigned_url_generated' | 'multipart_initiated';
  details: any;
  sessionId: string;
}

class UploadDiagnostics {
  private events: DiagnosticEvent[] = [];
  private sessionId: string;
  private maxEvents = 1000;

  constructor() {
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem('upload-diagnostics');
      if (stored) {
        const data = JSON.parse(stored);
        this.events = data.events || [];
      }
    } catch (e) {
      console.error('Failed to load diagnostics:', e);
    }
  }

  private saveToStorage() {
    try {
      const data = {
        events: this.events.slice(-this.maxEvents),
        sessionId: this.sessionId,
        lastUpdated: Date.now()
      };
      localStorage.setItem('upload-diagnostics', JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save diagnostics:', e);
    }
  }

  logEvent(type: DiagnosticEvent['type'], details: any) {
    const event: DiagnosticEvent = {
      timestamp: Date.now(),
      type,
      details,
      sessionId: this.sessionId
    };

    this.events.push(event);
    
    // Keep only recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    this.saveToStorage();

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Diagnostics] ${type}:`, details);
    }

    // Send critical errors to backend
    if (type === 'upload_error' || type === 'buffer_overflow') {
      this.sendTelemetry(event);
    }
  }

  private async sendTelemetry(event: DiagnosticEvent) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SIVERA_BACKEND_URL || 'http://localhost:8010';
      await fetch(`${baseUrl}/api/v1/telemetry/upload-diagnostic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });
    } catch (e) {
      // Silently fail - don't interrupt user flow
    }
  }

  getRecordingMetrics() {
    const recordingEvents = this.events.filter(e => 
      e.type === 'recording_start' || e.type === 'recording_stop'
    );

    const sessions: any[] = [];
    let currentSession: any = null;

    for (const event of recordingEvents) {
      if (event.type === 'recording_start') {
        currentSession = {
          startTime: event.timestamp,
          details: event.details
        };
      } else if (event.type === 'recording_stop' && currentSession) {
        currentSession.endTime = event.timestamp;
        currentSession.duration = (event.timestamp - currentSession.startTime) / 1000;
        currentSession.size = event.details.size;
        sessions.push(currentSession);
        currentSession = null;
      }
    }

    return sessions;
  }

  getUploadMetrics() {
    const uploadEvents = this.events.filter(e => 
      e.type === 'upload_start' || e.type === 'upload_complete' || e.type === 'upload_error'
    );

    const uploads: any[] = [];
    const uploadMap = new Map();

    for (const event of uploadEvents) {
      const uploadId = event.details.uploadId;
      if (!uploadId) continue;

      if (event.type === 'upload_start') {
        uploadMap.set(uploadId, {
          startTime: event.timestamp,
          size: event.details.size,
          type: event.details.uploadType
        });
      } else if (event.type === 'upload_complete' || event.type === 'upload_error') {
        const upload = uploadMap.get(uploadId);
        if (upload) {
          upload.endTime = event.timestamp;
          upload.duration = (event.timestamp - upload.startTime) / 1000;
          upload.status = event.type === 'upload_complete' ? 'success' : 'failed';
          upload.error = event.details.error;
          uploads.push(upload);
          uploadMap.delete(uploadId);
        }
      }
    }

    // Add incomplete uploads
    for (const [uploadId, upload] of uploadMap.entries()) {
      upload.status = 'incomplete';
      upload.duration = (Date.now() - upload.startTime) / 1000;
      uploads.push(upload);
    }

    return uploads;
  }

  getErrorSummary() {
    const errors = this.events.filter(e => 
      e.type === 'upload_error' || e.type === 'buffer_overflow'
    );

    const errorTypes = new Map<string, number>();
    
    for (const error of errors) {
      const errorType = error.details.error || error.details.reason || 'unknown';
      errorTypes.set(errorType, (errorTypes.get(errorType) || 0) + 1);
    }

    return {
      totalErrors: errors.length,
      errorsByType: Object.fromEntries(errorTypes),
      recentErrors: errors.slice(-10)
    };
  }

  exportDiagnostics() {
    return {
      sessionId: this.sessionId,
      events: this.events,
      metrics: {
        recordings: this.getRecordingMetrics(),
        uploads: this.getUploadMetrics(),
        errors: this.getErrorSummary()
      },
      timestamp: Date.now()
    };
  }

  clearDiagnostics() {
    this.events = [];
    localStorage.removeItem('upload-diagnostics');
  }
}

// Singleton instance
let diagnosticsInstance: UploadDiagnostics | null = null;

export function getDiagnostics(): UploadDiagnostics {
  if (!diagnosticsInstance) {
    diagnosticsInstance = new UploadDiagnostics();
  }
  return diagnosticsInstance;
}

export function logDiagnostic(type: DiagnosticEvent['type'], details: any) {
  getDiagnostics().logEvent(type, details);
}

export function exportDiagnosticReport() {
  return getDiagnostics().exportDiagnostics();
}