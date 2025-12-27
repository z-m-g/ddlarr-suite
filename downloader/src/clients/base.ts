export interface DownloadClient {
  name: string;
  isEnabled(): boolean;
  testConnection(): Promise<boolean>;
  addDownload(url: string, filename?: string): Promise<boolean>;
}
