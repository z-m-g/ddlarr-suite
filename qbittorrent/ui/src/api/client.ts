export interface TorrentInfo {
  hash: string
  name: string
  size: number
  progress: number
  dlspeed: number
  state: string
  category: string
  added_on: number
  save_path: string
  eta: number
  downloaded: number
  amount_left: number
  status_message?: string  // Current step: "Résolution dl-protect...", etc.
  error_message?: string   // Error details
  content_path?: string    // Full path to downloaded file
}

class ApiClient {
  private baseUrl = ''

  async login(username: string, password: string): Promise<boolean> {
    const formData = new URLSearchParams()
    formData.append('username', username)
    formData.append('password', password)

    const response = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
      credentials: 'include',
    })

    const text = await response.text()
    return text === 'Ok.'
  }

  async logout(): Promise<void> {
    await fetch(`${this.baseUrl}/api/v2/auth/logout`, {
      credentials: 'include',
    })
  }

  async getTorrents(filter?: string): Promise<TorrentInfo[]> {
    const params = new URLSearchParams()
    if (filter && filter !== 'all') {
      params.append('filter', filter)
    }

    const response = await fetch(`${this.baseUrl}/api/v2/torrents/info?${params}`, {
      credentials: 'include',
    })

    if (response.status === 403) {
      throw new Error('Not authenticated')
    }

    return response.json()
  }

  async addTorrentUrl(url: string, options: { category?: string; paused?: boolean } = {}): Promise<boolean> {
    const formData = new FormData()
    formData.append('urls', url)
    if (options.category) {
      formData.append('category', options.category)
    }
    if (options.paused) {
      formData.append('paused', 'true')
    }

    const response = await fetch(`${this.baseUrl}/api/v2/torrents/add`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })

    const text = await response.text()
    return text === 'Ok.'
  }

  async addTorrentFile(file: File, options: { category?: string; paused?: boolean } = {}): Promise<boolean> {
    const formData = new FormData()
    formData.append('torrents', file)
    if (options.category) {
      formData.append('category', options.category)
    }
    if (options.paused) {
      formData.append('paused', 'true')
    }

    const response = await fetch(`${this.baseUrl}/api/v2/torrents/add`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })

    const text = await response.text()
    return text === 'Ok.'
  }

  async pauseTorrents(hashes: string[]): Promise<void> {
    const formData = new URLSearchParams()
    formData.append('hashes', hashes.join('|'))

    await fetch(`${this.baseUrl}/api/v2/torrents/pause`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
      credentials: 'include',
    })
  }

  async resumeTorrents(hashes: string[]): Promise<void> {
    const formData = new URLSearchParams()
    formData.append('hashes', hashes.join('|'))

    await fetch(`${this.baseUrl}/api/v2/torrents/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
      credentials: 'include',
    })
  }

  async deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> {
    const formData = new URLSearchParams()
    formData.append('hashes', hashes.join('|'))
    formData.append('deleteFiles', deleteFiles ? 'true' : 'false')

    await fetch(`${this.baseUrl}/api/v2/torrents/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
      credentials: 'include',
    })
  }
}

export const apiClient = new ApiClient()
