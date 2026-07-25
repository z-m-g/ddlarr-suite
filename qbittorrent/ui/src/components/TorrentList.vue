<script setup lang="ts">
import { ref, computed } from 'vue'
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

// Selection
const selectedHashes = ref<Set<string>>(new Set())

const allSelected = computed(() =>
  store.filteredTorrents.length > 0 &&
  store.filteredTorrents.every(t => selectedHashes.value.has(t.hash))
)

const someSelected = computed(() => selectedHashes.value.size > 0)

function toggleSelect(hash: string) {
  const next = new Set(selectedHashes.value)
  if (next.has(hash)) {
    next.delete(hash)
  } else {
    next.add(hash)
  }
  selectedHashes.value = next
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedHashes.value = new Set()
  } else {
    selectedHashes.value = new Set(store.filteredTorrents.map(t => t.hash))
  }
}

// Bulk actions
const bulkPending = ref(false)

async function bulkPause() {
  const hashes = [...selectedHashes.value]
  if (!hashes.length) return
  bulkPending.value = true
  try {
    await store.pauseTorrents(hashes)
    selectedHashes.value = new Set()
  } finally {
    bulkPending.value = false
  }
}

async function bulkResume() {
  const hashes = [...selectedHashes.value]
  if (!hashes.length) return
  bulkPending.value = true
  try {
    await store.resumeTorrents(hashes)
    selectedHashes.value = new Set()
  } finally {
    bulkPending.value = false
  }
}

async function bulkDelete() {
  const hashes = [...selectedHashes.value]
  if (!hashes.length) return
  if (!confirm(`Delete ${hashes.length} download(s)?`)) return
  const deleteFiles = confirm('Also delete downloaded files?')
  bulkPending.value = true
  try {
    await store.deleteTorrents(hashes, deleteFiles)
    selectedHashes.value = new Set()
  } finally {
    bulkPending.value = false
  }
}
</script>

<template>
  <div>
    <!-- Filters -->
    <!-- flex-wrap + gap (not space-x) so the row breaks onto a second line on narrow
         screens instead of overflowing the viewport -->
    <div class="flex flex-wrap gap-2 mb-4">
      <button
        v-for="f in filters"
        :key="f.value"
        @click="store.setFilter(f.value)"
        :class="[
          'px-3 sm:px-4 py-2 rounded-md font-medium transition-colors',
          store.filter === f.value
            ? 'bg-blue-600 text-white'
            : 'bg-white text-gray-700 hover:bg-gray-100'
        ]"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- Bulk action bar -->
    <Transition name="slide-down">
      <div v-if="someSelected" class="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-4">
        <span class="text-sm text-blue-700 font-medium">
          {{ selectedHashes.size }} selected
        </span>
        <div class="flex flex-wrap gap-2 ml-auto">
          <button
            @click="bulkResume"
            :disabled="bulkPending"
            class="px-3 py-1 rounded text-sm font-medium bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
          >
            Resume
          </button>
          <button
            @click="bulkPause"
            :disabled="bulkPending"
            class="px-3 py-1 rounded text-sm font-medium bg-yellow-100 text-yellow-700 hover:bg-yellow-200 disabled:opacity-50"
          >
            Pause
          </button>
          <button
            @click="bulkDelete"
            :disabled="bulkPending"
            class="px-3 py-1 rounded text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
          >
            Delete
          </button>
          <button
            @click="selectedHashes = new Set()"
            class="px-3 py-1 rounded text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </Transition>

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
      <!-- Select all header -->
      <div class="flex items-center gap-2 px-1 pb-1">
        <input
          type="checkbox"
          :checked="allSelected"
          :indeterminate="someSelected && !allSelected"
          @change="toggleSelectAll"
          class="h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer"
        />
        <span class="text-sm text-gray-500">Select all</span>
      </div>

      <TorrentItem
        v-for="torrent in store.filteredTorrents"
        :key="torrent.hash"
        :torrent="torrent"
        :selected="selectedHashes.has(torrent.hash)"
        @toggle-select="toggleSelect(torrent.hash)"
      />
    </div>
  </div>
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
