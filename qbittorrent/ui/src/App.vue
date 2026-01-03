<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useTorrentsStore } from './stores/torrents'
import LoginForm from './components/LoginForm.vue'
import TorrentList from './components/TorrentList.vue'
import AddTorrentModal from './components/AddTorrentModal.vue'
import Navbar from './components/Navbar.vue'

const store = useTorrentsStore()
const showAddModal = ref(false)
let pollInterval: number | null = null

onMounted(async () => {
  await store.checkAuth()
  if (store.isAuthenticated) {
    startPolling()
  }
})

onUnmounted(() => {
  stopPolling()
})

function startPolling() {
  pollInterval = window.setInterval(() => {
    store.fetchTorrents()
  }, 2000)
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

async function handleLogin() {
  if (store.isAuthenticated) {
    startPolling()
  }
}

async function handleLogout() {
  stopPolling()
  await store.logout()
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <template v-if="!store.isAuthenticated">
      <div class="flex items-center justify-center min-h-screen">
        <LoginForm @login="handleLogin" />
      </div>
    </template>
    <template v-else>
      <Navbar @logout="handleLogout" @add="showAddModal = true" />
      <main class="container mx-auto px-4 py-6">
        <TorrentList />
      </main>
      <AddTorrentModal v-if="showAddModal" @close="showAddModal = false" />
    </template>
  </div>
</template>
