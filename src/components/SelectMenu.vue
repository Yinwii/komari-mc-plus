<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";

/**
 * 现代化自定义下拉：按钮 + 玻璃弹层（Teleport 到 body，fixed 定位），
 * 跟随亮 / 暗 / 壁纸主题。替代原生 <select>，避免原生下拉无法跟随主题的问题。
 * options: [{ value, label }]
 */
const props = defineProps({
  modelValue: { type: [String, Number], default: "" },
  options: { type: Array, required: true },
  ariaLabel: { type: String, default: "" },
  title: { type: String, default: "" },
  placeholder: { type: String, default: "未设置" },
});
const emit = defineEmits(["update:modelValue"]);

const open = ref(false);
const rootEl = ref(null);
const btnEl = ref(null);
const popStyle = ref({});
const openUpward = ref(false);
// 弹层 Teleport 到 body 后脱离 .monitor-app 作用域，需复制主题类（is-dark / has-wallpaper / mc-theme）。
const popTheme = ref([]);

const currentLabel = computed(() => {
  const hit = props.options.find((option) => String(option.value) === String(props.modelValue));
  return hit ? hit.label : props.placeholder;
});

function updatePosition() {
  const el = btnEl.value;
  if (!el) return;
  const themeRoot = el.closest(".monitor-app");
  popTheme.value = themeRoot ? ["is-dark", "has-wallpaper", "mc-theme"].filter((name) => themeRoot.classList.contains(name)) : [];
  const rect = el.getBoundingClientRect();
  const popHeight = Math.min(props.options.length * 34 + 12, 264);
  const spaceBelow = window.innerHeight - rect.bottom;
  openUpward.value = spaceBelow < popHeight + 12 && rect.top > popHeight + 12;
  popStyle.value = {
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`,
    top: openUpward.value ? `${rect.top - popHeight - 8}px` : `${rect.bottom + 6}px`,
    minWidth: `${rect.width}px`,
  };
}

function toggle() {
  if (open.value) {
    open.value = false;
    return;
  }
  updatePosition();
  open.value = true;
  nextTick(updatePosition);
}

function choose(option) {
  emit("update:modelValue", option.value);
  open.value = false;
}

function onDocPointer(event) {
  if (open.value && rootEl.value && !rootEl.value.contains(event.target)) open.value = false;
}

function closeOnScroll(event) {
  if (!open.value) return;
  // 弹层自身滚动不关闭。
  if (event.target.closest && event.target.closest(".select-menu-pop")) return;
  open.value = false;
}

function onKeydown(event) {
  if (event.key === "Escape" && open.value) {
    event.stopPropagation();
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", onDocPointer);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", closeOnScroll);
  window.addEventListener("scroll", closeOnScroll, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocPointer);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", closeOnScroll);
  window.removeEventListener("scroll", closeOnScroll, true);
});
</script>

<template>
  <div ref="rootEl" class="select-menu">
    <button
      ref="btnEl"
      type="button"
      class="select-menu-btn"
      :aria-label="ariaLabel || title"
      :aria-expanded="open"
      :title="title || currentLabel"
      @click="toggle"
    >
      <span class="select-menu-label">{{ currentLabel }}</span>
      <ChevronDown :size="13" class="select-menu-caret" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <Transition name="select-pop">
        <ul v-if="open" class="select-menu-pop" :class="[...popTheme, openUpward ? 'is-up' : '']" :style="popStyle" role="listbox">
          <li v-for="option in options" :key="String(option.value)">
            <button
              type="button"
              role="option"
              :aria-selected="String(option.value) === String(modelValue)"
              :class="{ 'is-active': String(option.value) === String(modelValue) }"
              @click="choose(option)"
            >
              <span>{{ option.label }}</span>
              <Check v-if="String(option.value) === String(modelValue)" :size="13" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </Transition>
    </Teleport>
  </div>
</template>
