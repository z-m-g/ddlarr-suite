// qBittorrent WebUI API types for Sonarr/Radarr compatibility

export interface QBTorrentInfo {
  hash: string;
  name: string;
  size: number;
  progress: number;           // 0.0 to 1.0
  dlspeed: number;            // bytes/sec
  upspeed: number;            // always 0 for DDL
  priority: number;
  num_seeds: number;          // always 0
  num_complete: number;       // always 0
  num_leechs: number;         // always 0
  num_incomplete: number;     // always 0
  ratio: number;              // always 0
  eta: number;                // seconds, 8640000 = infinity
  state: QBTorrentState;
  seq_dl: boolean;
  f_l_piece_prio: boolean;
  category: string;
  tags: string;
  super_seeding: boolean;
  force_start: boolean;
  save_path: string;
  added_on: number;           // unix timestamp
  completion_on: number;      // unix timestamp or -1
  tracker: string;
  dl_limit: number;
  up_limit: number;
  downloaded: number;
  uploaded: number;
  downloaded_session: number;
  uploaded_session: number;
  amount_left: number;
  completed: number;
  ratio_limit: number;
  seen_complete: number;
  last_activity: number;
  total_size: number;
  time_active: number;
  seeding_time: number;
  content_path: string;
  magnet_uri: string;
  // Custom fields for DDL-qBittorrent UI
  status_message?: string;    // Current step: "Résolution dl-protect...", "Débridage...", etc.
  error_message?: string;     // Error details
}

export type QBTorrentState =
  | 'error'
  | 'missingFiles'
  | 'uploading'
  | 'pausedUP'
  | 'queuedUP'
  | 'stalledUP'
  | 'checkingUP'
  | 'forcedUP'
  | 'allocating'
  | 'downloading'
  | 'metaDL'
  | 'pausedDL'
  | 'queuedDL'
  | 'stalledDL'
  | 'checkingDL'
  | 'forcedDL'
  | 'checkingResumeData'
  | 'moving'
  | 'unknown';

export interface QBTorrentProperties {
  hash: string;
  name: string;
  save_path: string;
  creation_date: number;
  piece_size: number;
  comment: string;
  total_wasted: number;
  total_uploaded: number;
  total_uploaded_session: number;
  total_downloaded: number;
  total_downloaded_session: number;
  up_limit: number;
  dl_limit: number;
  time_elapsed: number;
  seeding_time: number;
  nb_connections: number;
  nb_connections_limit: number;
  share_ratio: number;
  addition_date: number;
  completion_date: number;
  created_by: string;
  dl_speed_avg: number;
  dl_speed: number;
  eta: number;
  last_seen: number;
  peers: number;
  peers_total: number;
  pieces_have: number;
  pieces_num: number;
  reannounce: number;
  seeds: number;
  seeds_total: number;
  total_size: number;
  up_speed_avg: number;
  up_speed: number;
}

export interface QBPreferences {
  save_path: string;
  temp_path_enabled: boolean;
  temp_path: string;
  max_active_downloads: number;
  max_active_torrents: number;
  max_active_uploads: number;
  web_ui_username: string;
}

export interface QBAddTorrentOptions {
  urls?: string;
  torrents?: Buffer[];
  savepath?: string;
  category?: string;
  paused?: boolean;
  skip_checking?: boolean;
  root_folder?: boolean;
  rename?: string;
  tags?: string;
}
