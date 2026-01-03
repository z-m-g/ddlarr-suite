<script setup lang="ts">
import { computed } from 'vue'
import { useTorrentsStore } from '../stores/torrents'
import type { TorrentInfo } from '../api/client'

const props = defineProps<{
  torrent: TorrentInfo
}>()

const store = useTorrentsStore()

const progressPercent = computed(() => {
  // Force 100% for completed torrents
  if (props.torrent.state === 'uploading') return 100
  return Math.round(props.torrent.progress * 100)
})

const displayDownloaded = computed(() => {
  // For completed, show total size as downloaded
  if (props.torrent.state === 'uploading') return props.torrent.size
  return props.torrent.downloaded
})

const statusColor = computed(() => {
  switch (props.torrent.state) {
    case 'downloading': return 'bg-blue-500'
    case 'uploading': return 'bg-green-500'
    case 'pausedDL':
    case 'pausedUP': return 'bg-yellow-500'
    case 'queuedDL': return 'bg-gray-400'
    case 'checkingDL': return 'bg-purple-500'
    case 'error': return 'bg-red-500'
    default: return 'bg-gray-500'
  }
})

const statusLabel = computed(() => {
  // If there's a status message, show it instead of the generic state
  if (props.torrent.status_message) {
    return props.torrent.status_message
  }
  switch (props.torrent.state) {
    case 'downloading': return 'Téléchargement'
    case 'uploading': return 'Terminé'
    case 'pausedDL':
    case 'pausedUP': return 'En pause'
    case 'queuedDL': return 'En attente'
    case 'checkingDL': return 'Vérification'
    case 'moving': return 'Déplacement...'
    case 'error': return 'Erreur'
    case 'stalledDL': return 'Bloqué'
    default: return props.torrent.state
  }
})

const isPaused = computed(() =>
  props.torrent.state === 'pausedDL' || props.torrent.state === 'pausedUP'
)

const canPause = computed(() =>
  props.torrent.state === 'downloading' || props.torrent.state === 'queuedDL'
)

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatSpeed(bytesPerSec: number): string {
  return formatSize(bytesPerSec) + '/s'
}

function formatEta(seconds: number): string {
  if (seconds >= 8640000) return '--'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

async function handlePauseResume() {
  if (isPaused.value) {
    await store.resumeTorrents([props.torrent.hash])
  } else {
    await store.pauseTorrents([props.torrent.hash])
  }
}

async function handleDelete() {
  if (confirm(`Delete "${props.torrent.name}"?`)) {
    const deleteFiles = confirm('Also delete downloaded files?')
    await store.deleteTorrents([props.torrent.hash], deleteFiles)
  }
}
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
    <div class="flex items-start justify-between mb-2">
      <div class="flex-1 min-w-0">
        <h3 class="font-medium text-gray-900 truncate" :title="torrent.name">
          {{ torrent.name }}
        </h3>
        <div class="flex items-center space-x-2 text-sm text-gray-500 mt-1">
          <span :class="[statusColor, 'px-2 py-0.5 rounded text-white text-xs']">
            {{ statusLabel }}
          </span>
          <span v-if="torrent.category" class="bg-gray-200 px-2 py-0.5 rounded text-xs">
            {{ torrent.category }}
          </span>
        </div>
      </div>

      <div class="flex space-x-2 ml-4">
        <button
          v-if="canPause || isPaused"
          @click="handlePauseResume"
          :class="[
            'px-3 py-1 rounded text-sm font-medium',
            isPaused
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
          ]"
        >
          {{ isPaused ? 'Resume' : 'Pause' }}
        </button>
        <button
          @click="handleDelete"
          class="px-3 py-1 rounded text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200"
        >
          Delete
        </button>
      </div>
    </div>

    <!-- Progress bar -->
    <div class="relative h-2 bg-gray-200 rounded-full overflow-hidden mb-2">
      <div
        :class="[statusColor, 'h-full transition-all duration-300']"
        :style="{ width: `${progressPercent}%` }"
      ></div>
    </div>

    <!-- Error message -->
    <div v-if="torrent.state === 'error' && torrent.error_message" class="text-sm text-red-600 mb-2">
      {{ torrent.error_message }}
    </div>

    <!-- File path when completed -->
    <div v-if="torrent.state === 'uploading' && torrent.content_path" class="text-xs text-gray-400 mb-2 truncate" :title="torrent.content_path">
      📁 {{ torrent.content_path }}
    </div>

    <!-- Stats -->
    <div class="flex items-center justify-between text-sm text-gray-500">
      <div class="flex space-x-4">
        <span>{{ progressPercent }}%</span>
        <span>{{ formatSize(displayDownloaded) }} / {{ formatSize(torrent.size) }}</span>
      </div>
      <div class="flex space-x-4">
        <span v-if="torrent.state === 'downloading'">
          {{ formatSpeed(torrent.dlspeed) }}
        </span>
        <span v-if="torrent.state === 'downloading'">
          ETA: {{ formatEta(torrent.eta) }}
        </span>
      </div>
    </div>
  </div>
</template>
