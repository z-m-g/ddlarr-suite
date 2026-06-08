<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTorrentsStore } from '../stores/torrents'
import type { TorrentInfo } from '../api/client'

const props = defineProps<{
  torrent: TorrentInfo
  selected?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-select'): void
}>()

const store = useTorrentsStore()
const actionPending = ref(false)

const progressPercent = computed(() => {
  if (props.torrent.state === 'uploading' || props.torrent.state === 'stoppedUP') return 100
  return Math.round(props.torrent.progress * 100)
})

const displayDownloaded = computed(() => {
  if (props.torrent.state === 'uploading' || props.torrent.state === 'stoppedUP') return props.torrent.size
  return props.torrent.downloaded
})

const statusColor = computed(() => {
  switch (props.torrent.state) {
    case 'downloading': return 'bg-blue-500'
    case 'uploading':
    case 'stoppedUP': return 'bg-green-500'
    case 'pausedDL':
    case 'pausedUP': return 'bg-yellow-500'
    case 'queuedDL': return 'bg-gray-400'
    case 'checkingDL': return 'bg-purple-500'
    case 'error': return 'bg-red-500'
    default: return 'bg-gray-500'
  }
})

const statusLabel = computed(() => {
  switch (props.torrent.state) {
    case 'downloading': return 'Downloading'
    case 'uploading':
    case 'stoppedUP': return 'Completed'
    case 'pausedDL':
    case 'pausedUP': return 'Paused'
    case 'queuedDL': return 'Queued'
    case 'checkingDL': return 'Checking'
    case 'moving': return 'Moving'
    case 'error': return 'Error'
    case 'stalledDL': return 'Stalled'
    default: return props.torrent.state
  }
})

const showStatusMessage = computed(() =>
  !!props.torrent.status_message &&
  ['checkingDL', 'downloading', 'queuedDL', 'moving'].includes(props.torrent.state)
)

const isPaused = computed(() =>
  props.torrent.state === 'pausedDL' || props.torrent.state === 'pausedUP'
)

const canPause = computed(() =>
  props.torrent.state === 'downloading' || props.torrent.state === 'queuedDL'
)

const canForceStart = computed(() =>
  props.torrent.state === 'queuedDL'
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
  actionPending.value = true
  try {
    if (isPaused.value) {
      await store.resumeTorrents([props.torrent.hash])
    } else {
      await store.pauseTorrents([props.torrent.hash])
    }
  } finally {
    actionPending.value = false
  }
}

async function handleForceStart() {
  actionPending.value = true
  try {
    await store.forceStartTorrents([props.torrent.hash])
  } finally {
    actionPending.value = false
  }
}

async function handleDelete() {
  if (confirm(`Delete "${props.torrent.name}"?`)) {
    const deleteFiles = confirm('Also delete downloaded files?')
    actionPending.value = true
    try {
      await store.deleteTorrents([props.torrent.hash], deleteFiles)
    } finally {
      actionPending.value = false
    }
  }
}
</script>

<template>
  <div
    class="bg-white rounded-lg shadow p-4"
    :class="{ 'ring-2 ring-blue-400': selected }"
  >
    <div class="flex items-start justify-between mb-2">
      <div class="flex items-start gap-3 flex-1 min-w-0">
        <!-- Checkbox -->
        <input
          type="checkbox"
          :checked="selected"
          @change="emit('toggle-select')"
          class="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer flex-shrink-0"
        />

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
          <!-- Status message (active states) -->
          <p v-if="showStatusMessage" class="text-xs text-gray-500 italic mt-1">
            {{ torrent.status_message }}
          </p>
        </div>
      </div>

      <div class="flex space-x-2 ml-4 flex-shrink-0">
        <button
          v-if="canForceStart"
          @click="handleForceStart"
          :disabled="actionPending"
          title="Start now, bypassing the queue limit"
          class="px-3 py-1 rounded text-sm font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg v-if="actionPending" class="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          <span v-else>Force start</span>
        </button>
        <button
          v-if="canPause || isPaused"
          @click="handlePauseResume"
          :disabled="actionPending"
          :class="[
            'px-3 py-1 rounded text-sm font-medium flex items-center gap-1',
            isPaused
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          ]"
        >
          <svg v-if="actionPending" class="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          <span v-else>{{ isPaused ? 'Resume' : 'Pause' }}</span>
        </button>
        <button
          @click="handleDelete"
          :disabled="actionPending"
          class="px-3 py-1 rounded text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg v-if="actionPending" class="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          <span v-else>Delete</span>
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
    <div v-if="torrent.state === 'error' && torrent.error_message" class="text-xs text-red-600 mb-2 break-words">
      {{ torrent.error_message }}
    </div>

    <!-- File path when completed -->
    <div v-if="(torrent.state === 'uploading' || torrent.state === 'stoppedUP') && torrent.content_path" class="text-xs text-gray-400 mb-2 truncate" :title="torrent.content_path">
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
