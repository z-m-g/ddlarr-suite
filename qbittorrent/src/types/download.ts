export type DownloadState =
  | 'queued'      // Waiting to start
  | 'checking'    // Parsing torrent, resolving dl-protect, debriding
  | 'downloading' // Active download
  | 'paused'      // User paused
  | 'completed'   // Successfully finished
  | 'error'       // Failed with error
  | 'stalled';    // No progress for timeout

export interface Download {
  hash: string;
  name: string;
  originalLink: string;
  debridedLink: string | null;
  savePath: string;
  totalSize: number;
  downloadedSize: number;
  downloadSpeed: number;
  state: DownloadState;
  statusMessage: string | null;  // Current step: "Resolving dl-protect...", "Debriding...", etc.
  errorMessage: string | null;
  addedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  category: string | null;
  priority: number;
}

export interface DownloadProgress {
  hash: string;
  progress: number;        // 0-100
  downloadedBytes: number;
  totalBytes: number;
  downloadSpeed: number;   // bytes/sec
  eta: number;             // seconds remaining
}
