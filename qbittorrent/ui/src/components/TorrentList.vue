<script setup lang="ts">
import { useTorrentsStore } from '../stores/torrents'
import TorrentItem from './TorrentItem.vue'

const store = useTorrentsStore()

const filters = [
  { value: 'all', label: 'All' },
  { value: 'downloading', label: 'Downloading' },
  { value: 'completed', label: 'Completed' },
  { value: 'paused', label: 'Paused' },
  { value: 'errored', label: 'Errored' },
]
</script>

<template>
  <div>
    <!-- Filters -->
    <div class="flex space-x-2 mb-4">
      <button
        v-for="f in filters"
        :key="f.value"
        @click="store.setFilter(f.value)"
        :class="[
          'px-4 py-2 rounded-md font-medium transition-colors',
          store.filter === f.value
            ? 'bg-blue-600 text-white'
            : 'bg-white text-gray-700 hover:bg-gray-100'
        ]"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="store.isLoading && store.torrents.length === 0" class="text-center py-12 text-gray-500">
      Loading...
    </div>

    <!-- Empty state -->
    <div v-else-if="store.filteredTorrents.length === 0" class="text-center py-12 text-gray-500">
      No downloads
    </div>

    <!-- Torrent list -->
    <div v-else class="space-y-2">
      <TorrentItem
        v-for="torrent in store.filteredTorrents"
        :key="torrent.hash"
        :torrent="torrent"
      />
    </div>
  </div>
</template>
