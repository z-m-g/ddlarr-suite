<script setup lang="ts">
import { useTorrentsStore } from '../stores/torrents'

const emit = defineEmits<{
  logout: []
  add: []
}>()

const store = useTorrentsStore()
</script>

<template>
  <nav class="bg-blue-600 text-white shadow-lg">
    <div class="container mx-auto px-4">
      <div class="flex items-center justify-between h-16">
        <div class="flex items-center space-x-4">
          <h1 class="text-xl font-bold">DDL-qBittorrent</h1>
          <div class="hidden md:flex space-x-2 text-sm">
            <span class="bg-blue-500 px-2 py-1 rounded">{{ store.stats.total }} total</span>
            <span class="bg-green-500 px-2 py-1 rounded">{{ store.stats.downloading }} downloading</span>
            <span class="bg-gray-500 px-2 py-1 rounded">{{ store.stats.completed }} completed</span>
          </div>
        </div>

        <div class="flex items-center space-x-4">
          <button
            @click="emit('add')"
            class="bg-green-500 hover:bg-green-600 px-4 py-2 rounded-md font-medium"
          >
            + Add
          </button>
          <button
            @click="emit('logout')"
            class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded-md font-medium"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>
