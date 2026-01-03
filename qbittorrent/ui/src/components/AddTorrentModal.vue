<script setup lang="ts">
import { ref } from 'vue'
import { useTorrentsStore } from '../stores/torrents'

const emit = defineEmits<{
  close: []
}>()

const store = useTorrentsStore()
const url = ref('')
const file = ref<File | null>(null)
const category = ref('')
const paused = ref(false)
const loading = ref(false)
const error = ref('')

function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files[0]) {
    file.value = target.files[0]
  }
}

async function handleSubmit() {
  error.value = ''
  loading.value = true

  try {
    let success = false
    const options = { category: category.value || undefined, paused: paused.value }

    if (file.value) {
      success = await store.addFile(file.value, options)
    } else if (url.value) {
      success = await store.addUrl(url.value, options)
    } else {
      error.value = 'Please provide a URL or file'
      loading.value = false
      return
    }

    if (success) {
      emit('close')
    } else {
      error.value = 'Failed to add download'
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
      <div class="flex items-center justify-between p-4 border-b">
        <h2 class="text-lg font-semibold">Add Download</h2>
        <button @click="emit('close')" class="text-gray-500 hover:text-gray-700">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="p-4 space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">URL</label>
          <input
            v-model="url"
            type="url"
            placeholder="https://..."
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div class="text-center text-gray-500 text-sm">or</div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Torrent File</label>
          <input
            type="file"
            accept=".torrent"
            @change="handleFileChange"
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Category (optional)</label>
          <input
            v-model="category"
            type="text"
            placeholder="sonarr, radarr..."
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div class="flex items-center">
          <input
            v-model="paused"
            type="checkbox"
            id="paused"
            class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label for="paused" class="ml-2 text-sm text-gray-700">Start paused</label>
        </div>

        <div v-if="error" class="text-red-500 text-sm">{{ error }}</div>

        <div class="flex justify-end space-x-2 pt-4">
          <button
            type="button"
            @click="emit('close')"
            class="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            :disabled="loading"
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {{ loading ? 'Adding...' : 'Add' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
