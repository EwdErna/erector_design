import { ref, readonly } from 'vue'

type Tab = 'parts' | 'edit' | 'error'

const isOpen = ref(true)
const activeTab = ref<Tab>('parts')

// CSS変数として公開する高さ（ボトムシートの現在の高さ、px）
const heightPx = ref(0)

function open(tab?: Tab) {
  isOpen.value = true
  if (tab) activeTab.value = tab
}

function close() {
  isOpen.value = false
}

function switchTab(tab: Tab) {
  activeTab.value = tab
  isOpen.value = true
}

/**
 * OrbitControls の start イベントから呼ぶ。
 * ユーザーが3Dシーンをドラッグし始めたときにシートを閉じる。
 */
function onSceneDragStart() {
  close()
}

export function useBottomSheet() {
  return {
    isOpen: readonly(isOpen),
    activeTab: readonly(activeTab),
    heightPx: readonly(heightPx),
    open,
    close,
    switchTab,
    onSceneDragStart,
    // 内部書き込み用（BottomSheet.vue が高さを更新するため）
    _setHeight: (px: number) => { heightPx.value = px },
  }
}
