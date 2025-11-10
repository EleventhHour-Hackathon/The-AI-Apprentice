"use client";

import { useState, useEffect } from 'react';
import { exportDiagnosticReport, getDiagnostics } from '@/app/utils/uploadDiagnostics';

export default function UploadMonitor() {
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load diagnostics
    const loadDiagnostics = () => {
      const report = exportDiagnosticReport();
      setDiagnostics(report);
    };

    // Check health status
    const checkHealth = async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_SIVERA_BACKEND_URL || 'http://localhost:8010';
        const response = await fetch(`${baseUrl}/api/v1/recordings/health-check`);
        const data = await response.json();
        setHealthStatus(data);
      } catch (error) {
        console.error('Failed to fetch health status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadDiagnostics();
    checkHealth();

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      loadDiagnostics();
      checkHealth();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (status: string) => {
    const colors = {
      healthy: 'bg-green-500',
      degraded: 'bg-yellow-500',
      unhealthy: 'bg-red-500',
      warning: 'bg-orange-500'
    };
    return (
      <span className={`px-2 py-1 rounded text-white text-sm ${colors[status as keyof typeof colors] || 'bg-gray-500'}`}>
        {status}
      </span>
    );
  };

  const clearDiagnostics = () => {
    getDiagnostics().clearDiagnostics();
    const report = exportDiagnosticReport();
    setDiagnostics(report);
  };

  if (isLoading) {
    return <div className="p-4">Loading monitor...</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Upload System Monitor</h1>
        <button
          onClick={clearDiagnostics}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Clear Diagnostics
        </button>
      </div>

      {/* System Health */}
      {healthStatus && (
        <div className="mb-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">
            System Health {getStatusBadge(healthStatus.status)}
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(healthStatus.components || {}).map(([name, component]: [string, any]) => (
              <div key={name} className="border rounded p-4">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-medium capitalize">{name}</h3>
                  {getStatusBadge(component.status)}
                </div>
                
                {component.status === 'unhealthy' && component.error && (
                  <p className="text-red-600 text-sm mt-2">{component.error}</p>
                )}
                
                {name === 'database' && (
                  <div className="text-sm text-gray-600 mt-2">
                    <p>Recent: {component.recent_recordings}</p>
                    <p>Last Hour: {component.last_hour_uploads}</p>
                    <p>Failed: {component.failed_uploads}</p>
                  </div>
                )}
                
                {name === 's3' && component.status === 'healthy' && (
                  <div className="text-sm text-gray-600 mt-2">
                    <p>Bucket: {component.bucket}</p>
                    <p>Region: {component.region}</p>
                  </div>
                )}
                
                {name === 'local_storage' && (
                  <div className="text-sm text-gray-600 mt-2">
                    <p>Free: {component.free_space_gb}GB</p>
                    <p>Used: {component.used_percentage}%</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recording Metrics */}
      {diagnostics && (
        <>
          <div className="mb-6 bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Recording Sessions</h2>
            
            {diagnostics.metrics.recordings.length === 0 ? (
              <p className="text-gray-500">No recordings in this session</p>
            ) : (
              <div className="space-y-2">
                {diagnostics.metrics.recordings.map((recording: any, idx: number) => (
                  <div key={idx} className="border rounded p-3">
                    <div className="flex justify-between">
                      <span>Duration: {recording.duration?.toFixed(1)}s</span>
                      <span>Size: {(recording.size / (1024 * 1024)).toFixed(1)}MB</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upload Metrics */}
          <div className="mb-6 bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Upload History</h2>
            
            {diagnostics.metrics.uploads.length === 0 ? (
              <p className="text-gray-500">No uploads in this session</p>
            ) : (
              <div className="space-y-2">
                {diagnostics.metrics.uploads.map((upload: any, idx: number) => (
                  <div key={idx} className="border rounded p-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-medium">
                          {(upload.size / (1024 * 1024)).toFixed(1)}MB
                        </span>
                        <span className="ml-2 text-gray-600">
                          ({upload.duration?.toFixed(1)}s)
                        </span>
                      </div>
                      <span className={`px-2 py-1 rounded text-sm ${
                        upload.status === 'success' ? 'bg-green-100 text-green-800' :
                        upload.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {upload.status}
                      </span>
                    </div>
                    {upload.error && (
                      <p className="text-red-600 text-sm mt-1">{upload.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error Summary */}
          {diagnostics.metrics.errors.totalErrors > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4 text-red-600">
                Errors ({diagnostics.metrics.errors.totalErrors})
              </h2>
              
              <div className="mb-4">
                <h3 className="font-medium mb-2">Error Types:</h3>
                <div className="space-y-1">
                  {Object.entries(diagnostics.metrics.errors.errorsByType).map(([type, count]) => (
                    <div key={type} className="flex justify-between text-sm">
                      <span className="text-gray-600">{type}</span>
                      <span className="font-medium">{count as number}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h3 className="font-medium mb-2">Recent Errors:</h3>
                <div className="space-y-2">
                  {diagnostics.metrics.errors.recentErrors.slice(0, 5).map((error: any, idx: number) => (
                    <div key={idx} className="text-sm border-l-2 border-red-500 pl-2">
                      <p className="font-medium">{error.type}</p>
                      <p className="text-gray-600">
                        {new Date(error.timestamp).toLocaleTimeString()}
                      </p>
                      {error.details.error && (
                        <p className="text-red-600">{error.details.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}