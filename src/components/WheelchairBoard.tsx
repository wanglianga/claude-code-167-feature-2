import { useState } from 'react'
import { useStore } from '../store'
import { BRANCHES, CARRIERS, WAITING_SPOTS } from '../data/museum'
import { wheelchairBoard } from '../lib/planner'
import type { LiveSignals } from '../lib/planner'
import type { TransferRequest, Visit } from '../types'
import { fmtMin, hhmmToMin } from '../utils'
import { Badge, Notice } from './ui'

const TRANSFER_STATUS: Record<TransferRequest['status'], { text: string; tone: 'amber' | 'blue' | 'green' | 'red' }> = {
  requested: { text: '已申请 · 待出发', tone: 'amber' },
  in_transit: { text: '搬运在途', tone: 'blue' },
  arrived: { text: '已到馆入库', tone: 'green' },
  cancelled: { text: '已取消', tone: 'red' }
}

const RESOLUTION_KIND: Record<string, string> = {
  bring_own: '联系观众自带设备',
  reschedule: '调整参观时段',
  priority: '安排优先借用',
  transfer: '跨馆调拨'
}

/** 单个缺口观众的协调处置面板 */
function ShortagePanel({ visit, shortage, onOpen }: { visit: Visit; shortage: boolean; onOpen: () => void }) {
  const requestTransfer = useStore((s) => s.requestTransfer)
  const resolveShortage = useStore((s) => s.resolveShortage)
  const addComfortService = useStore((s) => s.addComfortService)
  const setWaitingSpot = useStore((s) => s.setWaitingSpot)
  const transfers = useStore((s) => s.transfers)

  const [reason, setReason] = useState('')
  const [newTime, setNewTime] = useState('14:00')
  const [branchId, setBranchId] = useState(BRANCHES[0].id)
  const [count, setCount] = useState(1)
  const [carrier, setCarrier] = useState(CARRIERS[0])
  const [spot, setSpot] = useState(visit.waitingSpot ?? WAITING_SPOTS[0])

  const branch = BRANCHES.find((b) => b.id === branchId) ?? BRANCHES[0]
  const branchBusy = transfers
    .filter((t) => t.branchId === branch.id && (t.status === 'requested' || t.status === 'in_transit' || t.status === 'arrived'))
    .reduce((n, t) => n + t.count, 0)
  const branchLeft = Math.max(0, branch.wheelchairs - branchBusy)
  const reasonOk = reason.trim().length > 0
  const myTransfers = transfers.filter((t) => t.forVisitId === visit.id && t.status !== 'cancelled')

  return (
    <div className={`eta-card ${shortage ? 'alert' : ''}`}>
      <div className="flex between">
        <span className="t">
          <span className="code-pill">{visit.code}</span> {visit.party.contactName} · 到馆 {fmtMin(visit.route?.arrivalMin ?? visit.baseArrivalMin)}
        </span>
        <span className="flex" style={{ gap: 6 }}>
          {visit.priorityBorrow && <Badge tone="gold">⭐ 优先借用</Badge>}
          {shortage ? <Badge tone="red">缺口待协调</Badge> : <Badge tone="green">库存已可覆盖</Badge>}
          <button className="btn sm ghost" onClick={onOpen}>打开该服务 →</button>
        </span>
      </div>

      {/* 等待位置 + 关怀服务 */}
      <div className="flex mt8" style={{ gap: 8 }}>
        <span className="small">📍 观众等待位置：</span>
        <select className="sm" style={{ maxWidth: 230 }} value={visit.waitingSpot ?? spot}
          onChange={(e) => { setSpot(e.target.value); setWaitingSpot(visit.id, e.target.value) }}>
          {WAITING_SPOTS.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>
      <div className="flex mt8" style={{ gap: 6 }}>
        <span className="small">等待期间关怀：</span>
        <button className="btn sm ghost" onClick={() => addComfortService(visit.id, 'seat')}>🪑 提供座椅</button>
        <button className="btn sm ghost" onClick={() => addComfortService(visit.id, 'water')}>🥤 提供饮水</button>
        <button className="btn sm ghost" onClick={() => addComfortService(visit.id, 'mini_tour')}>🎙 临时讲解</button>
        {(visit.comfortServices ?? []).map((c) => <Badge key={c.id} tone="green">✓ {c.text}</Badge>)}
      </div>

      {/* 处置：三种馆内方案 + 跨馆调拨，均需记录原因 */}
      <div className="flex mt8" style={{ gap: 8, alignItems: 'center' }}>
        <span className="small">处置原因（记录存档）：</span>
        <input type="text" className="sm" style={{ flex: 1, minWidth: 220 }} placeholder="如：库存 0 台且 2 组观众同时在借 / 观众同意错峰…"
          value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex mt8" style={{ gap: 6 }}>
        <button className="btn sm gold" disabled={!reasonOk}
          onClick={() => { resolveShortage(visit.id, { kind: 'bring_own', reason: reason.trim() }); setReason('') }}>
          📞 联系观众自带设备
        </button>
        <span className="flex" style={{ gap: 4 }}>
          <input type="time" className="sm" style={{ width: 108 }} value={newTime} onChange={(e) => setNewTime(e.target.value)} />
          <button className="btn sm gold" disabled={!reasonOk}
            onClick={() => { resolveShortage(visit.id, { kind: 'reschedule', reason: reason.trim(), newArrivalMin: hhmmToMin(newTime) }); setReason('') }}>
            🕑 调整参观时段
          </button>
        </span>
        <button className="btn sm gold" disabled={!reasonOk || !!visit.priorityBorrow}
          onClick={() => { resolveShortage(visit.id, { kind: 'priority', reason: reason.trim() }); setReason('') }}>
          ⭐ 安排优先借用
        </button>
      </div>

      {/* 跨馆调拨 */}
      <div className="flex mt8" style={{ gap: 6 }}>
        <span className="small">🏛 调用其他馆区：</span>
        <select className="sm" style={{ maxWidth: 210 }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {BRANCHES.map((b) => <option key={b.id} value={b.id}>{b.name}（约 {b.transferMin} 分钟）</option>)}
        </select>
        <select className="sm" style={{ width: 76 }} value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {[1, 2, 3].map((n) => <option key={n} value={n}>{n} 台</option>)}
        </select>
        <select className="sm" style={{ maxWidth: 190 }} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
          {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn sm" disabled={branchLeft <= 0}
          onClick={() => requestTransfer({ branchId: branch.id, count, carrier, forVisitId: visit.id, waitSpot: visit.waitingSpot ?? spot, note: reason.trim() || undefined })}>
          {branchLeft > 0 ? `申请调拨（该馆余 ${branchLeft} 台）` : '该分馆暂无可调配设备'}
        </button>
      </div>

      {/* 该观众的调拨进度 */}
      {myTransfers.map((t) => {
        const st = TRANSFER_STATUS[t.status]
        return (
          <div key={t.id} className="small mt8" style={{ background: 'var(--blue-soft)', borderRadius: 8, padding: '6px 10px' }}>
            🚚 {t.branchName} → 本馆 {t.count} 台 · 搬运：{t.carrier} · 预计 {fmtMin(t.etaMin)} 到达 · 观众等待位置：{t.waitSpot ?? '服务台旁'} · <b>{st.text}</b>
          </div>
        )
      })}

      {/* 已记录的处置 */}
      {(visit.resolutions ?? []).length > 0 && (
        <div className="small muted mt8">
          已记录处置：
          {(visit.resolutions ?? []).map((r) => (
            <div key={r.id}>· {RESOLUTION_KIND[r.kind]}{r.newArrivalMin ? `（改至 ${fmtMin(r.newArrivalMin)}）` : ''}：{r.reason}</div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 轮椅库存不足协调看板：库存 / 归还预计 / 到馆时间 / 分馆调拨 / 缺口处置 / 等待关怀 */
export default function WheelchairBoard({ signals, today, onOpenVisit }: { signals: LiveSignals; today: string; onOpenVisit: (id: string) => void }) {
  const visits = useStore((s) => s.visits)
  const transfers = useStore((s) => s.transfers)
  const advanceTransfer = useStore((s) => s.advanceTransfer)
  const cancelTransfer = useStore((s) => s.cancelTransfer)

  const board = wheelchairBoard(signals, visits, today)
  const activeTransfers = transfers.filter((t) => t.status !== 'cancelled')
  const coordinationIds = new Set<string>([
    ...board.demand.filter((d) => d.shortage).map((d) => d.visitId),
    ...activeTransfers.filter((t) => t.status !== 'arrived' && t.forVisitId).map((t) => t.forVisitId!),
    ...visits.filter((v) => v.date === today && v.priorityBorrow && v.status !== 'cancelled').map((v) => v.id)
  ])
  const coordinationVisits = visits.filter((v) => coordinationIds.has(v.id))

  return (
    <div className="card">
      <h2>♿ 轮椅库存协调 <Badge tone={board.shortageCount > 0 ? 'red' : 'green'}>{board.shortageCount > 0 ? `缺口 ${board.shortageCount} 组` : '库存可覆盖今日需求'}</Badge></h2>
      <p className="sub">多组预约同时需要轮椅时在此统一协调：查看库存、归还预计时间与观众到馆时间；不足时可联系观众自带设备、调整参观时段、安排优先借用，或从其他馆区调拨设备（等待期间服务台提供座椅/饮水/临时讲解，全部写入该观众的同一条服务记录）。</p>

      <div className="stat-row">
        <div className="stat"><b>{board.total} 台</b><span>本馆轮椅总数</span></div>
        <div className="stat"><b>{board.loanedNow} 台</b><span>当前在借</span></div>
        <div className="stat"><b>{board.offset} 台</b><span>报修/消毒</span></div>
        <div className="stat"><b>+{board.transferBoost} 台</b><span>其他馆区调拨已到达</span></div>
        <div className="stat"><b style={{ color: board.availableNow > 0 ? 'var(--green)' : 'var(--red)' }}>{board.availableNow} 台</b><span>当前可借（今日预约 {board.reserved} 台）</span></div>
      </div>

      <div className="grid2">
        {/* 在借清单：归还预计时间 */}
        <div>
          <h3>🔁 在借轮椅与归还预计时间</h3>
          {board.loans.length === 0 && <p className="muted small">当前无在借轮椅。</p>}
          {board.loans.map((l) => (
            <div key={l.assetCode} className="flex between small" style={{ marginBottom: 4 }}>
              <span>♿ <b>{l.assetCode}</b> · {l.name} <span className="code-pill">{l.code}</span></span>
              <span className="muted">预计 {l.expectedReturnMin !== undefined ? fmtMin(l.expectedReturnMin) : '—'} 归还</span>
            </div>
          ))}
        </div>
        {/* 今日需求：观众到馆时间 */}
        <div>
          <h3>👥 今日需轮椅预约与观众到馆时间</h3>
          {board.demand.length === 0 && <p className="muted small">今日暂无借用预约。</p>}
          {board.demand.map((d) => (
            <div key={d.visitId} className="flex between small" style={{ marginBottom: 4 }}>
              <span>
                {d.name} <span className="code-pill">{d.code}</span>
                {d.priority && <Badge tone="gold">⭐ 优先</Badge>}
              </span>
              <span>
                到馆 {fmtMin(d.arrivalMin)} ·{' '}
                {d.loaned ? <Badge tone="brand">已借到</Badge>
                  : d.served ? <Badge>已服务</Badge>
                  : d.shortage ? <Badge tone="red">缺口</Badge>
                  : <Badge tone="amber">排队待取</Badge>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 其他馆区可调资源 */}
      <h3 className="mt12">🏛 其他馆区可调配设备</h3>
      <div className="flex" style={{ gap: 8 }}>
        {BRANCHES.map((b) => {
          const busy = activeTransfers.filter((t) => t.branchId === b.id).reduce((n, t) => n + t.count, 0)
          const left = Math.max(0, b.wheelchairs - busy)
          return (
            <div key={b.id} className="stat" style={{ flex: '1 1 180px' }}>
              <b>{left}/{b.wheelchairs} 台</b>
              <span>{b.name} · 搬运约 {b.transferMin} 分钟{left > 0 ? ' · 可调用' : ' · 暂无可调'}</span>
            </div>
          )
        })}
      </div>

      {/* 缺口协调 */}
      {coordinationVisits.length > 0 && (
        <>
          <h3 className="mt12">🛠 缺口协调与等待关怀</h3>
          {coordinationVisits.map((v) => (
            <ShortagePanel key={v.id} visit={v}
              shortage={board.demand.some((d) => d.visitId === v.id && d.shortage)}
              onOpen={() => onOpenVisit(v.id)} />
          ))}
        </>
      )}
      {coordinationVisits.length === 0 && board.shortageCount === 0 && (
        <Notice kind="ok">今日轮椅库存可覆盖全部借用预约；如出现缺口，可在此一键联系自带、调整时段、优先借用或跨馆调拨。</Notice>
      )}

      {/* 调拨单 */}
      {transfers.length > 0 && (
        <>
          <h3 className="mt12">🚚 跨馆调拨单</h3>
          {transfers.map((t) => {
            const st = TRANSFER_STATUS[t.status]
            const forVisit = visits.find((v) => v.id === t.forVisitId)
            return (
              <div key={t.id} className={`eta-card ${t.status === 'in_transit' || t.status === 'requested' ? '' : ''}`}>
                <div className="flex between">
                  <span className="t">{t.branchName} → 本馆 · {t.count} 台</span>
                  <Badge tone={st.tone}>{st.text}</Badge>
                </div>
                <div className="small muted mt8">
                  搬运人员：{t.carrier} · 预计到达 {fmtMin(t.etaMin)}
                  {forVisit && <> · 观众 {forVisit.party.contactName} 等待位置：{t.waitSpot ?? '一层咨询服务台旁等候区'}</>}
                  {t.note && <> · 原因：{t.note}</>}
                </div>
                <div className="flex mt8" style={{ gap: 6 }}>
                  {t.status === 'requested' && <button className="btn sm" onClick={() => advanceTransfer(t.id)}>🚚 确认出发搬运</button>}
                  {t.status === 'in_transit' && <button className="btn sm" onClick={() => advanceTransfer(t.id)}>📦 确认到馆入库（库存 +{t.count}）</button>}
                  {(t.status === 'requested' || t.status === 'in_transit') && (
                    <button className="btn sm danger" onClick={() => cancelTransfer(t.id)}>取消调拨</button>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
