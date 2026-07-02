import { ref, readonly } from 'vue'

// 見積ダイアログの開閉状態（モジュールスコープで共有）
const isOpen = ref(false)

function open() {
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

function toggle() {
  isOpen.value = !isOpen.value
}

export function useCostEstimate() {
  return {
    isOpen: readonly(isOpen),
    open,
    close,
    toggle,
  }
}
