<script setup>
import GroupIcon from "./GroupIcon.vue";

defineProps({
  groups: { type: Array, required: true },
  activeGroup: { type: String, default: "all" },
  iconMode: { type: String, default: "唯一地区旗" },
});
defineEmits(["select"]);
</script>

<template>
  <section class="group-bar">
    <button
      :class="{ active: activeGroup === 'all' }"
      @click="$emit('select', 'all')"
    >
      全部节点
      <i>{{ groups.reduce((sum, group) => sum + group.count, 0) }}</i></button
    ><button
      v-for="group in groups"
      :key="group.code"
      :class="{ active: activeGroup === group.code }"
      @click="$emit('select', group.code)"
    >
      <GroupIcon :group="group" :mode="iconMode" />
      <span class="group-code">{{ group.code }}</span> <i>{{ group.count }}</i>
    </button>
  </section>
</template>
