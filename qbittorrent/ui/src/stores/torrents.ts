import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient, type TorrentInfo } from '../api/client'
import { useToastStore } from './toast'

export const useTorrentsStore = defineStore('torrents', () => {
  const torrents = ref<TorrentInfo[]>([])
  const filter = ref('all')
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const isAuthenticated = ref(false)
  const connectionLost = ref(false)

  const filteredTorrents = computed(() => {
    if (filter.value === 'all') return torrents.value
    return torrents.value.filter(t => {
      switch (filter.value) {
        case 'downloading': return t.state === 'downloading'
        case 'completed': return t.state === 'uploading' || t.state === 'stoppedUP'
        case 'paused': return t.state === 'pausedDL' || t.state === 'pausedUP'
        case 'errored': return t.state === 'error'
        default: return true
      }
    })
  })

  const stats = computed(() => ({
    total: torrents.value.length,
    downloading: torrents.value.filter(t => t.state === 'downloading').length,
    completed: torrents.value.filter(t => t.state === 'uploading' || t.state === 'stoppedUP').length,
    paused: torrents.value.filter(t => t.state.startsWith('paused')).length,
  }))

  async function login(username: string, password: string): Promise<boolean> {
    try {
      const success = await apiClient.login(username, password)
      isAuthenticated.value = success
      if (success) {
        await fetchTorrents()
      }
      return success
    } catch (e: any) {
      error.value = e.message
      return false
    }
  }

  async function logout(): Promise<void> {
    await apiClient.logout()
    isAuthenticated.value = false
    torrents.value = []
  }

  async function fetchTorrents(showLoading = true): Promise<void> {
    try {
      if (showLoading) {
        isLoading.value = true
      }
      error.value = null
      torrents.value = await apiClient.getTorrents()
      connectionLost.value = false
    } catch (e: any) {
      if (e.message === 'Not authenticated') {
        isAuthenticated.value = false
      } else {
        connectionLost.value = true
      }
      error.value = e.message
    } finally {
      if (showLoading) {
        isLoading.value = false
      }
    }
  }

  async function addUrl(url: string, options?: { category?: string; paused?: boolean }): Promise<boolean> {
    const success = await apiClient.addTorrentUrl(url, options)
    if (success) {
      await fetchTorrents()
    }
    return success
  }

  async function addFile(file: File, options?: { category?: string; paused?: boolean }): Promise<boolean> {
    const success = await apiClient.addTorrentFile(file, options)
    if (success) {
      await fetchTorrents()
    }
    return success
  }

  async function pauseTorrents(hashes: string[]): Promise<void> {
    const toast = useToastStore()
    try {
      await apiClient.pauseTorrents(hashes)
      await fetchTorrents()
      toast.show('Download paused', 'success')
    } catch (e: any) {
      toast.show(`Failed to pause: ${e.message}`, 'error')
      throw e
    }
  }

  async function resumeTorrents(hashes: string[]): Promise<void> {
    const toast = useToastStore()
    try {
      await apiClient.resumeTorrents(hashes)
      await fetchTorrents()
      toast.show('Download resumed', 'success')
    } catch (e: any) {
      toast.show(`Failed to resume: ${e.message}`, 'error')
      throw e
    }
  }

  async function forceStartTorrents(hashes: string[]): Promise<void> {
    const toast = useToastStore()
    try {
      await apiClient.forceStartTorrents(hashes)
      await fetchTorrents()
      toast.show('Download force started', 'success')
    } catch (e: any) {
      toast.show(`Failed to force start: ${e.message}`, 'error')
      throw e
    }
  }

  async function deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> {
    const toast = useToastStore()
    try {
      await apiClient.deleteTorrents(hashes, deleteFiles)
      await fetchTorrents()
      toast.show('Download deleted', 'success')
    } catch (e: any) {
      toast.show(`Failed to delete: ${e.message}`, 'error')
      throw e
    }
  }

  function setFilter(newFilter: string): void {
    filter.value = newFilter
  }

  // Try to fetch torrents on init to check if already authenticated
  async function checkAuth(): Promise<void> {
    try {
      await apiClient.getTorrents()
      isAuthenticated.value = true
      await fetchTorrents()
    } catch {
      isAuthenticated.value = false
    }
  }

  return {
    torrents,
    filteredTorrents,
    filter,
    isLoading,
    error,
    isAuthenticated,
    connectionLost,
    stats,
    login,
    logout,
    fetchTorrents,
    addUrl,
    addFile,
    pauseTorrents,
    resumeTorrents,
    forceStartTorrents,
    deleteTorrents,
    setFilter,
    checkAuth,
  }
})
