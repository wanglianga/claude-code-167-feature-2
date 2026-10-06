import { useState } from 'react'
import { useStore } from '../store'
import { BRANCH_WHEELCHAIRS, TOTAL_WHEELCHAIRS } from '../data/museum'
import { wheelchairCoordInfo } from '../lib/planner'
import { fmtMin, hhmmToMin, todayISO } from '../utils'
import { Badge, Notice } from './ui'
import type { Visit } from '../types'

const RESOLUTION_TEXT: Record<string, { label: string; tone: 'green' | 'blue' | 'gold' | 'amber' }> = {
  bring_own: { label: '已联系自带设备', tone: 'green' },
  reschedule: { label: '已调整参观时段', tone: 'blue' },
  priority_loan: { label: '已安排优先借用', tone: 'gold' },
  branch_transfer: { label: '跨馆调入中', tone: 'amber' },
  pending: { label: '待协调', tone: 'amber' }
}

const WAIT_KIND_LABEL = { seat: '🪑 提供座椅', water: '💧 提供饮水', guide: '🎧 临时讲解' } as const

function CoordCard({ visit }: { visit: Visit }) {
  const s = useStore()
  const today = todayISO()
  const [reason, setReason] = useState('')
  const [reschedTime, setReschedTime] = useState('13:30')
  const [waitLoc, setWaitLoc] = useState(visit.branchTransfer?.waitLocation ?? '')

  const lateOf = Object.fromEntries(s.visits.filter((v) => v.date === today).map((v) => [v.id, s.visitSignals[v.id]?.lateMin ?? 0]))
  const arrival = (visit.baseArrivalMin) + (s.visitSignals[visit.id]?.lateMin ?? 0)
  const info = wheelchairCoordInfo({
    date: visit.date, visits: s.visits,
    signals: { ...s.global, lateMin: s.visitSignals[visit.id]?.lateMin ?? 0, visitorUnwell: s.visitSignals[visit.id]?.visitorUnwell ?? false },
    selfId: visit.id, selfWants: visit.party.borrowWheelchair && visit.wheelchairCoord?.resolution !== 'bring_own',
    selfArrivalMin: arrival, selfContact: visit.party.contactName, selfCode: visit.code, lateOf
  })

  const hasLoan = visit.loans.some((l) => l.loanedAt && !l.returnedAt)
  const tr = visit.branchTransfer
  const res = visit.wheelchairCoord?.resolution ?? 'pending'
  const resMeta = RESOLUTION_TEXT[res]
  const shortage = !hasLoan && info.waitMin > 0 && (!tr || tr.status === 'cancelled')
  // 尚未拿到轮椅、仍在等待（本馆排队 或 跨馆设备未完成交接）
  const waiting = !hasLoan && (shortage || (!!tr && tr.status !== 'cancelled'))

  const requireReason = (fn: (r: string) => void) => {
    const r = reason.trim() || '库存到馆时段不足，优先保障不宜久站观众'
    fn(r)
    setReason('')
  }

  return (
    <div className={`wc-card ${shortage ? 'shortage' : ''}`}>
      <div className="flex between wrap">
        <div>
          <b style={{ fontSize: '1rem' }}>{visit.party.contactName} · {visit.party.size + (visit.party.extraCompanions ?? 0)} 人</b>
          <span className="small muted" style={{ marginLeft: 8 }}>
            <span className="code-pill">{visit.code}</span> {visit.party.phone}
          </span>
        </div>
        <div className="badges">
          <Badge tone="blue">观众到馆 {fmtMin(arrival)}</Badge>
          {res !== 'pending' && <Badge tone={resMeta.tone}>{resMeta.label}</Badge>}
          {shortage && <Badge tone="red">库存缺口 · 排队第 {info.queueIndex} 位</Badge>}
          {hasLoan && <Badge tone="green">已借出</Badge>}
        </div>
      </div>

      {/* 库存与等待信息 */}
      <div className="wc-stat-row">
        <div className="wc-stat"><b>{info.availableAtArrival}</b><span>到馆时本馆可发（台）</span></div>
        <div className="wc-stat"><b>{info.demandAtArrival}</b><span>同段（±30分）借用组数</span></div>
        <div className="wc-stat"><b>{info.waitMin === 0 ? '0' : `约${info.waitMin}分钟`}</b><span>预计等待</span></div>
        <div className="wc-stat"><b>{info.nearestReadyMin != null ? fmtMin(info.nearestReadyMin) : '—'}</b><span>最早可领取</span></div>
      </div>

      {visit.wheelchairCoord?.reason && res !== 'branch_transfer' && (
        <div className="small muted wc-reason">📝 协调原因：{visit.wheelchairCoord.reason}</div>
      )}

      {/* 归还预计 */}
      {info.returnEtas.length > 0 && !hasLoan && (
        <div className="wc-returns">
          <b className="small">♻ 前方设备归还预计：</b>
          {info.returnEtas.map((r, i) => (
            <span key={i} className="return-chip">
              {r.assetCode} · {r.holder} · 预计 <b>{fmtMin(r.returnMin)}</b> 归还（{r.waitMin <= 0 ? '即还' : `等约${r.waitMin}分`}）
            </span>
          ))}
        </div>
      )}

      {/* 跨馆调运面板 */}
      {tr && tr.status !== 'cancelled' && (
        <div className="wc-transfer">
          <div className="flex between wrap">
            <b>🚐 跨馆调运：{tr.fromBranch} → 本馆</b>
            <Badge tone={tr.status === 'arrived' ? 'green' : tr.status === 'in_transit' ? 'amber' : 'blue'}>
              {tr.status === 'requested' ? '已请求待取货' : tr.status === 'in_transit' ? '运送途中' : '已送达'}
            </Badge>
          </div>
          <div className="wc-transfer-grid">
            <div><span>设备编号</span><b>{tr.assetCode}</b></div>
            <div><span>搬运人员</span><b>{tr.carrier}（{tr.carrierPhone}）</b></div>
            <div><span>预计到达服务台</span><b className={tr.status === 'arrived' ? 'green-text' : ''}>{fmtMin(tr.etaMin)}{tr.arriveMin != null ? ` · 实际 ${fmtMin(tr.arriveMin)}` : ''}</b></div>
            <div><span>观众等待位置</span><b>{tr.waitLocation ?? '一层服务台等候区'}</b></div>
          </div>
          <div className="flex wrap" style={{ gap: 6, marginTop: 8 }}>
            {tr.status === 'requested' && <button className="btn sm" onClick={() => s.setTransferStatus(visit.id, 'in_transit')}>📦 确认已取货出发</button>}
            {tr.status === 'in_transit' && <button className="btn sm gold" onClick={() => s.setTransferStatus(visit.id, 'arrived')}>✅ 确认送达服务台</button>}
            <button className="btn sm danger ghost" onClick={() => s.setTransferStatus(visit.id, 'cancelled')}>取消调运</button>
          </div>
          <div className="flex" style={{ gap: 6, marginTop: 8 }}>
            <input type="text" placeholder="更新观众当前等待位置（如：F1 大厅休息区第 2 排）" value={waitLoc}
              onChange={(e) => setWaitLoc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && waitLoc.trim()) { s.setWaitingLocation(visit.id, waitLoc.trim()); setWaitLoc('') } }} />
            <button className="btn sm ghost" disabled={!waitLoc.trim()} onClick={() => { s.setWaitingLocation(visit.id, waitLoc.trim()); setWaitLoc('') }}>更新位置</button>
          </div>
        </div>
      )}

      {/* 其他馆区可调设备（本馆紧张时可直接发起调运；可满足时仅展示余量） */}
      {!hasLoan && (!tr || tr.status === 'cancelled') && (
        <div className="wc-branches">
          <b className="small">🏛 可调用其他馆区设备：</b>
          {!shortage && <span className="small muted">本馆库存可满足，暂无需调运；馆际余量备查 — </span>}
          <span className="small muted">
            {info.branches.map((b) => `${b.branch.replace(/（.*?）/, '')}余${b.available}台/${b.transferMin}分`).join('、')}
          </span>
          {shortage && (
          <div className="branch-list">
            {info.branches.map((b) => (
              <div key={b.branch} className="branch-item">
                <div>
                  <b>{b.branch}</b>
                  <span className="small muted"> · 余 <b className={b.available > 0 ? 'green-text' : ''}>{b.available}</b> 台 · {b.distanceKm}km · {b.transferMin} 分钟 · 搬运 {b.carrier}（{b.carrierPhone}）</span>
                </div>
                <button className="btn sm" disabled={b.available <= 0}
                  onClick={() => s.requestBranchTransfer(visit.id, b.branch, visit.branchTransfer?.waitLocation ?? '一层服务台等候区')}>
                  调用（{fmtMin(arrival + b.transferMin)} 前后到）
                </button>
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {/* 等待期间服务（座椅/饮水/临时讲解） */}
      {waiting && (
        <div className="wc-wait-services">
          <b className="small">☕ 等待期间服务台照料（计入预约记录）：</b>
          <div className="flex wrap" style={{ gap: 6, marginTop: 6 }}>
            {(Object.keys(WAIT_KIND_LABEL) as Array<keyof typeof WAIT_KIND_LABEL>).map((k) => (
              <button key={k} className="btn sm ghost" onClick={() => s.addWaitingService(visit.id, k)}>{WAIT_KIND_LABEL[k]}</button>
            ))}
          </div>
          {visit.waitingServices.length > 0 && (
            <div className="small muted" style={{ marginTop: 6 }}>
              已提供 {visit.waitingServices.length} 次：
              {visit.waitingServices.slice(-4).map((w) => ` ${WAIT_KIND_LABEL[w.kind].slice(2)}${w.note ? `(${w.note})` : ''}`).join('、')}
            </div>
          )}
        </div>
      )}

      {/* 处置方式与原因（排队待协调，或已协调需改判时） */}
      {!hasLoan && (!tr || tr.status === 'cancelled') && (shortage || res !== 'pending') && (
        <div className="wc-actions">
          <div className="flex wrap" style={{ gap: 6 }}>
            <input type="text" placeholder="沟通/处置原因（如：电话确认观众家中有折叠轮椅）" value={reason}
              onChange={(e) => setReason(e.target.value)} style={{ flex: '2 1 220px' }} />
            <input type="time" value={reschedTime} onChange={(e) => setReschedTime(e.target.value)}
              title="调整后的到馆时间" style={{ maxWidth: 110 }} />
          </div>
          <div className="flex wrap" style={{ gap: 6, marginTop: 8 }}>
            <button className="btn sm green" onClick={() => requireReason((r) => s.setWheelchairResolution(visit.id, 'bring_own', r))}>📞 联系观众自带设备</button>
            <button className="btn sm blue" disabled={!/^\d{2}:\d{2}$/.test(reschedTime)}
              onClick={() => requireReason((r) => s.setWheelchairResolution(visit.id, 'reschedule', r, { rescheduleToMin: hhmmToMin(reschedTime) }))}>
              🕐 调整参观时段至 {reschedTime}
            </button>
            <button className="btn sm gold" onClick={() => requireReason((r) => s.setWheelchairResolution(visit.id, 'priority_loan', r))}>⭐ 安排优先借用</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WheelchairDesk() {
  const s = useStore()
  const today = todayISO()
  const todays = s.visits
    .filter((v) => v.date === today && v.status !== 'cancelled')
    .filter((v) => v.party.borrowWheelchair || v.loans.some((l) => l.loanedAt && !l.returnedAt) || v.branchTransfer)
    .sort((a, b) => a.baseArrivalMin - b.baseArrivalMin)

  const onLoan = s.visits
    .filter((v) => v.date === today && v.status !== 'cancelled')
    .reduce((n, v) => n + v.loans.filter((l) => l.loanedAt && !l.returnedAt).length, 0)
  const inTransit = s.visits.filter((v) => v.branchTransfer && v.branchTransfer.status !== 'arrived' && v.branchTransfer.status !== 'cancelled' && !v.loans.some((l) => l.loanedAt && !l.returnedAt)).length
  const shortageCount = todays.filter((v) => v.wheelchairCoord?.resolution !== 'bring_own' && !v.loans.some((l) => l.loanedAt && !l.returnedAt)).length

  return (
    <div className="card wc-desk">
      <h2>♿ 轮椅库存不足协调台 <Badge tone="red">多预约同时需要时在此逐组协调</Badge></h2>
      <p className="sub">同一屏看到库存、归还预计时间、是否可调用其他馆区设备与观众到馆时间；无法满足时联系观众自带设备、调整时段或安排优先借用并记录原因；跨馆调运跟踪搬运人员、预计到达与观众等待位置；等待期间的座椅、饮水、临时讲解均写入预约记录。</p>

      <div className="wc-stat-row">
        <div className="wc-stat"><b>{TOTAL_WHEELCHAIRS - s.global.wheelchairOffset - onLoan}/{TOTAL_WHEELCHAIRS}</b><span>本馆在库可用（在借 {onLoan} · 检修 {s.global.wheelchairOffset}）</span></div>
        <div className="wc-stat"><b>{shortageCount}</b><span>今日借用预约组数</span></div>
        <div className="wc-stat"><b className={inTransit ? '' : 'muted'}>{inTransit}</b><span>跨馆调运在途</span></div>
        <div className="wc-stat"><b>{BRANCH_WHEELCHAIRS.reduce((n, b) => n + b.total, 0)}</b><span>其他馆区轮椅总台量</span></div>
      </div>

      {todays.some((v) => v.route?.wheelchairIssue && !v.loans.some((l) => l.loanedAt && !l.returnedAt)) && (
        <Notice kind="warn">有借用预约在到馆时段无法立即领到本馆轮椅，请逐组完成协调（自带 / 改时段 / 优先借用 / 跨馆调入），并在等待期间提供照料服务。</Notice>
      )}

      {todays.length === 0 && <p className="muted small">今日暂无借用轮椅的预约。可在预约页勾选"向馆方借用轮椅"后在此协调。</p>}
      <div className="wc-list">
        {todays.map((v) => <CoordCard key={v.id} visit={v} />)}
      </div>
    </div>
  )
}
