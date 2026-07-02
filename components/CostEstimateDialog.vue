<template>
  <div v-if="isOpen" class="cost-overlay" @click.self="close()">
    <div class="cost-dialog">
      <header class="cost-header">
        <span class="cost-title">部品表・概算見積</span>
        <button class="close-btn" @click="close()" title="閉じる">×</button>
      </header>

      <div class="cost-body">
        <!-- ジョイント -->
        <section class="cost-section">
          <h3>ジョイント</h3>
          <table v-if="result.jointRows.length" class="cost-table">
            <thead>
              <tr><th>名称</th><th>個数</th><th>単価</th><th>小計</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in result.jointRows" :key="row.name">
                <td>{{ row.name }}</td>
                <td class="num">{{ row.count }}</td>
                <td class="num">
                  <span v-if="row.unitPrice != null">{{ fmt(row.unitPrice) }}</span>
                  <span v-else class="badge-missing">未設定</span>
                </td>
                <td class="num">{{ row.subtotal != null ? fmt(row.subtotal) : '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty">ジョイントなし</p>
        </section>

        <!-- 利用可能な既製長さ -->
        <section class="cost-section">
          <div class="section-head">
            <h3>利用可能な既製長さ</h3>
            <button class="link-btn" @click="pricing.reset()">全てON</button>
          </div>
          <p class="hint">チェックを外した長さは探索から除外されます（必要な時のみ「取り寄せ」として使用）。</p>
          <div v-for="dia in pricedDiameters" :key="dia" class="length-row">
            <span class="dia-label">φ{{ dia }}</span>
            <label v-for="len in stockLengths(dia)" :key="len" class="len-check">
              <input
                type="checkbox"
                :checked="pricing.isEnabled(dia, len)"
                @change="pricing.toggleLength(dia, len)"
              />
              {{ len }}
            </label>
          </div>
        </section>

        <!-- パイプ切断結果 -->
        <section class="cost-section">
          <h3>パイプ（切り出し）</h3>
          <p v-if="!result.pipePlans.length" class="empty">パイプなし</p>
          <div v-for="plan in result.pipePlans" :key="plan.diameter" class="pipe-plan">
            <h4>φ{{ plan.diameter }}</h4>
            <table v-if="plan.bars.length" class="cost-table">
              <thead>
                <tr><th>既製長さ</th><th>本数</th><th>単価</th><th>小計</th><th>切り出し内訳</th></tr>
              </thead>
              <tbody>
                <tr v-for="(g, i) in groupBars(plan.bars)" :key="i" :class="{ special: g.special }">
                  <td>
                    {{ g.length }}
                    <span v-if="g.special" class="badge-special">取り寄せ</span>
                  </td>
                  <td class="num">{{ g.count }}</td>
                  <td class="num">
                    <span v-if="g.price != null">{{ fmt(g.price) }}</span>
                    <span v-else class="badge-missing">未設定</span>
                  </td>
                  <td class="num">{{ g.price != null ? fmt(g.price * g.count) : '—' }}</td>
                  <td class="pieces">{{ g.pieces.join(' + ') }}<span class="remnant"> (端材 {{ g.remnant }})</span></td>
                </tr>
              </tbody>
            </table>
            <p v-if="plan.infeasible.length" class="warn error">
              作成不可（最長既製超過）: {{ plan.infeasible.join(', ') }} mm
            </p>
            <p v-if="plan.smallPieces.length" class="warn">
              手切断困難（{{ margin.minRemnant }}mm未満）: {{ plan.smallPieces.join(', ') }} mm
            </p>
          </div>
        </section>
      </div>

      <footer class="cost-footer">
        <div class="totals">
          <div>ジョイント計: <b>{{ fmt(result.jointsTotal) }}</b><span v-if="result.jointsMissing" class="miss">＋未設定分</span></div>
          <div>パイプ計: <b>{{ fmt(result.pipesTotal) }}</b><span v-if="result.pipesMissing" class="miss">＋未設定分</span></div>
          <div class="grand">総計: <b>{{ fmt(result.grandTotal) }}</b></div>
        </div>
        <p v-if="result.anyMissing" class="warn">
          ※ 価格未設定の項目があります（data/erector_price.json）。総計には含まれていません。
        </p>
      </footer>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted } from 'vue'
import { useCostEstimate } from '~/composables/useCostEstimate'
import { useErectorPricing } from '~/stores/ErectorPricing'
import { estimate, type CutBar } from '~/utils/Erector/cuttingStock'
import { getPricedDiameters, getStockLengths, getMargin, priceData } from '~/utils/Erector/priceLoader'

const { isOpen, close } = useCostEstimate()
const pricing = useErectorPricing()
const erector = useErector()

const margin = getMargin()
const pricedDiameters = getPricedDiameters()
const stockLengths = (dia: number) => getStockLengths(dia)

onMounted(() => pricing.ensureInit())

const result = computed(() =>
  estimate(
    erector.pipes.map(p => ({ diameter: p.diameter, length: p.length })),
    erector.joints.map(j => ({ name: j.name })),
    pricing.enabledMap,
    priceData.currency,
  ),
)

function fmt(v: number | null): string {
  if (v == null) return '—'
  return `${priceData.currency === 'JPY' ? '¥' : ''}${v.toLocaleString()}`
}

type BarGroup = { length: number; special: boolean; price: number | null; pieces: number[]; remnant: number; count: number }

function groupBars(bars: CutBar[]): BarGroup[] {
  const map = new Map<string, BarGroup>()
  for (const b of bars) {
    const pieces = [...b.pieces].sort((x, y) => y - x)
    const key = `${b.length}|${b.special}|${pieces.join(',')}`
    const existing = map.get(key)
    if (existing) existing.count++
    else map.set(key, { length: b.length, special: b.special, price: b.price, pieces, remnant: b.remnant, count: 1 })
  }
  return [...map.values()].sort((a, b) => b.length - a.length)
}
</script>

<style scoped>
.cost-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.cost-dialog {
  background: #fff;
  width: min(760px, 94vw);
  max-height: 90vh;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.cost-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(72deg, #4facfe, #00f2fe);
  color: #fff;
}

.cost-title {
  font-weight: bold;
  font-size: 16px;
}

.close-btn {
  background: transparent;
  border: none;
  color: #fff;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.cost-body {
  padding: 8px 16px;
  overflow-y: auto;
}

.cost-section {
  margin: 14px 0;
}

.cost-section h3 {
  margin: 0 0 6px;
  font-size: 14px;
  border-left: 4px solid #4facfe;
  padding-left: 8px;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hint {
  font-size: 11px;
  color: #666;
  margin: 4px 0 8px;
}

.cost-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.cost-table th,
.cost-table td {
  border-bottom: 1px solid #eee;
  padding: 4px 8px;
  text-align: left;
}

.cost-table th {
  background: #f6f8fa;
  font-weight: 600;
}

.cost-table td.num {
  text-align: right;
  white-space: nowrap;
}

.cost-table tr.special td {
  background: #fff7e6;
}

.pieces {
  font-family: monospace;
  font-size: 12px;
}

.remnant {
  color: #999;
}

.length-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 6px 0;
  border-bottom: 1px dashed #eee;
}

.dia-label {
  font-weight: bold;
  width: 44px;
}

.len-check {
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.pipe-plan h4 {
  margin: 10px 0 4px;
  font-size: 13px;
}

.badge-missing {
  color: #b35f00;
  font-size: 11px;
  background: #ffe9cc;
  border-radius: 4px;
  padding: 0 5px;
}

.badge-special {
  color: #b35f00;
  font-size: 10px;
  background: #ffe0b3;
  border-radius: 4px;
  padding: 0 5px;
  margin-left: 4px;
}

.warn {
  font-size: 12px;
  color: #b35f00;
  margin: 4px 0;
}

.warn.error {
  color: #c62828;
}

.empty {
  font-size: 13px;
  color: #999;
}

.link-btn {
  background: none;
  border: none;
  color: #007bff;
  cursor: pointer;
  font-size: 12px;
  text-decoration: underline;
  padding: 0;
}

.cost-footer {
  border-top: 1px solid #eee;
  padding: 10px 16px;
  background: #fafafa;
}

.totals {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 24px;
  font-size: 13px;
}

.totals .grand {
  font-size: 15px;
}

.totals b {
  color: #007bff;
}

.miss {
  color: #b35f00;
  font-size: 11px;
  margin-left: 4px;
}
</style>
