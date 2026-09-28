<script setup>
import { Box, Images, Moon, RefreshCw, Settings, Sun, Wallet } from "lucide-vue-next";

const adminUrl = __KOMARI_ADMIN_URL__;

defineProps({ appearance: { type: String, required: true }, isLoading: Boolean, wallpaperOn: Boolean });
defineEmits(["set-appearance", "refresh", "open-admin", "open-value", "switch-wallpaper", "toggle-wallpaper"]);
</script>

<template>
  <div class="toolbar">
    <button title="剩余价值评估" aria-label="剩余价值评估" @click="$emit('open-value')"><Wallet :size="17" :stroke-width="1.8" aria-hidden="true" /></button>
    <button title="刷新数据" aria-label="刷新数据" :disabled="isLoading" @click="$emit('refresh')"><RefreshCw :class="{ 'is-spinning': isLoading }" :size="17" :stroke-width="1.8" aria-hidden="true" /></button>
    <button
      title="Bing 壁纸：点击换一张，右键开/关壁纸"
      aria-label="切换 Bing 壁纸"
      :class="{ 'theme-active': wallpaperOn }"
      @click="$emit('switch-wallpaper')"
      @contextmenu.prevent="$emit('toggle-wallpaper')"
    >
      <Images :size="17" :stroke-width="1.8" aria-hidden="true" />
    </button>
    <button title="浅色主题" aria-label="浅色主题" :aria-pressed="appearance === 'light'" :class="{ 'theme-active': appearance === 'light' }" @click="$emit('set-appearance', 'light')"><Sun :size="18" :stroke-width="1.8" aria-hidden="true" /></button>
    <button title="深色主题" aria-label="深色主题" :aria-pressed="appearance === 'dark'" :class="{ 'theme-active': appearance === 'dark' }" @click="$emit('set-appearance', 'dark')"><Moon :size="18" :stroke-width="1.8" aria-hidden="true" /></button>
    <button title="MC 主题" aria-label="MC 主题" :aria-pressed="appearance === 'mc'" :class="{ 'mc-toggle-active': appearance === 'mc' }" @click="$emit('set-appearance', 'mc')">
      <Box :size="18" :stroke-width="1.8" aria-hidden="true" />
    </button>
    <a :href="adminUrl" target="_blank" rel="noopener noreferrer" title="进入后台" aria-label="进入后台" @click="$emit('open-admin')"><Settings :size="17" :stroke-width="1.8" aria-hidden="true" /></a>
  </div>
</template>
