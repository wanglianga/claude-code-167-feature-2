import { Link, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useStore } from '../store'
import { STAFF } from '../data/museum'
import MuseumMap from '../components/MuseumMap'
import RouteTimeline from '../components/RouteTimeline'
import { Badge, Notice, StatusBadge, EmptyHint } from '../components/ui'
import { prettyDate, weekdayCN, fmtMin } from '../utils'
import type { EventType } from '../types'

const EVENT_META: Record<EventType, { label: string; tone?: 'brand' | 'gold' | 'red' | 'amber' | 'green' | 'blue' }> = {
  book: { label: '预约', tone: 'blue' },
  checkin: { label: '入馆核验', tone: 'gold' },
  route_change: { label: '路线调整', tone: 'red' },
  wheelchair_loan: { label: '轮椅借出', tone: 'brand' },
  wheelchair_return: { label: '轮椅归还', tone: 'brand' },
  wheelchair_coord: { label: '轮椅协调', tone: 'amber' },
  wheelchair_transfer: { label: '跨馆调运', tone: 'gold' },
  waiting_service: { label: '等候服务', tone: 'green' },
  escort_assign: { label: '陪同安排', tone: 'green' },
  parking: { label: '车位', tone: 'green' },
  assist: { label: '现场协助', tone: 'gold' },
  incident: { label: '突发情况', tone: 'red' },
  complete: { label: '参观结束', tone: 'brand' },
  note: { label: '服务记录', tone: 'amber' }
}

function ServiceLog({ visitId }: { visitId: string }) {
  const visit = useStore((s) => s.visits.find((v) => v.id === visitId))!
  const events = [...visit.events].sort((a, b) => a.ts.localeCompare(b.ts))
  return (
    <div className="card">
      <h2>一条参观服务记录 <Badge tone="brand">预约前 · 入馆中 · 参观后全程留痕</Badge></h2>
      <p className="sub">预约、路线、设备借用、人员安排与突发协助都挂在同一条服务下，下次接待可延续。</p>
      <ul className="log">
        {events.map((e) => (
          <li key={e.id}>
            <div className="flex" style={{ gap: 8 }}>
              <Badge tone={EVENT_META[e.type].tone}>{EVENT_META[e.type].label}</Badge>
              <span className="when">{new Date(e.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} · <span className="who">{e.actor}</span></span>
            </div>
            <div className="mt8">{e.text}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function VisitDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const visit = useStore((s) => s.visits.find((v) => v.id === id))
  const global = useStore((s) => s.global)
  const vs = useStore((s) => (id ? s.visitSignals[id] : undefined))
  const setVisitSignals = useStore((s) => s.setVisitSignals)
  const cancelVisit = useStore((s) => s.cancelVisit)
  const addEvent = useStore((s) => s.addEvent)
  const addFeedback = useStore((s) => s.addFeedback)

  const [lateInput, setLateInput] = useState(15)
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState(visit?.feedback ?? '')

  if (!visit) {
    return <EmptyHint>未找到该参观服务。<br /><Link to="/">返回首页</Link></EmptyHint>
  }

  const escort = STAFF.find((s) => s.id === (visit.escortId ?? visit.route?.escortId))
  const openLoan = visit.loans.find((l) => l.loanedAt && !l.returnedAt)
  const crowdMap = Object.fromEntries(visit.route?.stops.map((st) => [st.hallId, st.crowd]) ?? [])
  const planChanged = visit.route ? visit.route.signals !== JSON.stringify({
    e: [...global.elevatorsDown].sort(), c: [...global.closedHalls].sort(),
    cr: Object.fromEntries(Object.entries(global.crowdOverride).sort()),
    l: [...global.staffExtraLeave].sort(), w: global.wheelchairOffset,
    u: vs?.visitorUnwell ?? false
  }) : false

  return (
    <div>
      <div className="card">
        <div className="flex between">
          <div className="flex" style={{ gap: 10 }}>
            <span className="code-pill">{visit.code}</span>
            <StatusBadge status={visit.status} />
          </div>
          <Link className="btn sm ghost" to="/">← 返回</Link>
        </div>
        <h2 className="mt12" style={{ marginBottom: 2 }}>{visit.party.contactName || '观众'} 的无障碍参观服务</h2>
        <p className="sub">{prettyDate(visit.date)} · {weekdayCN(visit.date)} · 预约到馆 {fmtMin(visit.baseArrivalMin)}{(vs?.lateMin ?? 0) > 0 && <> · 已迟到 {vs!.lateMin} 分钟</>} · 联系电话 {visit.party.phone}</p>

        <div className="badges">
          <Badge tone="brand">👥 {visit.party.size + (visit.party.extraCompanions ?? 0)} 人{visit.party.extraCompanions ? `（含临时增加 ${visit.party.extraCompanions} 人）` : ''}</Badge>
          {(visit.party.usesWheelchair || visit.party.borrowWheelchair) && <Badge tone="gold">♿ {visit.party.borrowWheelchair ? '借用轮椅' : '自带轮椅'}</Badge>}
          {visit.party.needSign && <Badge tone="blue">🤟 手语</Badge>}
          {visit.party.needSlow && <Badge tone="blue">🐢 慢速讲解</Badge>}
          {visit.party.hasElder && <Badge>👴 老人</Badge>}
          {visit.party.hasChild && <Badge>👶 儿童</Badge>}
          {visit.party.needParking && <Badge tone="green">🅿️ {visit.route?.parkingSlot ?? '车位协调中'}</Badge>}
          {!visit.party.canStandLong && <Badge tone="amber">🪑 不宜久站</Badge>}
        </div>

        <div className="grid3 mt12">
          <div className="stat"><b>{escort ? `${escort.role}${escort.name}` : visit.route?.escortIssue ? '协调中' : '无需陪同'}</b><span>讲解 / 陪同安排</span></div>
          <div className="stat"><b>{openLoan ? openLoan.assetCode : visit.party.borrowWheelchair ? '待领取' : '—'}</b><span>轮椅借用状态</span></div>
          <div className="stat"><b>{visit.route ? `${visit.route.stops.length} 厅 / ${visit.route.totalDistance}m` : '—'}</b><span>展厅覆盖 / 步行量</span></div>
        </div>

        {visit.route?.escortIssue && <Notice kind="warn">陪同排班提示：{visit.route.escortIssue}</Notice>}
        {visit.route?.wheelchairIssue && <Notice kind="warn">设备提示：{visit.route.wheelchairIssue}</Notice>}
        {visit.route?.parkingIssue && <Notice kind="warn">车位提示：{visit.route.parkingIssue}</Notice>}
        {planChanged && visit.status !== 'cancelled' && visit.status !== 'completed' && (
          <Notice kind="info">现场情况（电梯、闭馆、拥挤、排班）较预约时发生变化，当前展示的路线已由调度台按最新情况重新核算。</Notice>
        )}
      </div>

      {/* —— 轮椅库存协调进度（观众端可见） —— */}
      {visit.party.borrowWheelchair && (visit.route?.wheelchairInfo || visit.branchTransfer || visit.waitingServices.length > 0 || visit.wheelchairCoord) && (
        <div className="card">
          <h2>♿ 轮椅借用协调进度</h2>
          {(() => {
            const info = visit.route?.wheelchairInfo
            const tr = visit.branchTransfer
            const hasLoan = visit.loans.some((l) => l.loanedAt && !l.returnedAt)
            const resolutionLabel: Record<string, string> = {
              bring_own: '您已与服务台确认自带轮椅/助行设备，馆方预留已释放',
              reschedule: `已协商调整到馆时间为 ${fmtMin(visit.baseArrivalMin)}，我们按新时段预留设备与接应`,
              priority_loan: '已为您登记优先借用，轮椅回库/调入后将第一时间通知您',
              branch_transfer: '已为您从其他馆区调运轮椅',
              pending: '服务台正在为您协调轮椅'
            }
            return (
              <>
                {info && !hasLoan && info.waitMin === 0 && visit.wheelchairCoord?.resolution !== 'bring_own' && (
                  <Notice kind="ok">到馆后即可在服务台领取轮椅（当前可发 {info.availableAtArrival} 台），无需等待。</Notice>
                )}
                {info && !hasLoan && info.waitMin > 0 && visit.wheelchairCoord?.resolution !== 'bring_own' && (!tr || tr.status === 'cancelled') && (
                  <Notice kind="warn">
                    您到馆时段借用轮椅的观众较多：排队第 {info.queueIndex} 位，预计等待约 {info.waitMin} 分钟（{fmtMin(info.nearestReadyMin!)} 左右可领）。
                    {info.returnEtas.length > 0 && (
                      <> 前方 {info.returnEtas.map((r) => `${r.assetCode} 预计 ${fmtMin(r.returnMin)} 归还`).join('；')}。</>
                    )}
                    服务台会主动与您联系协调，您也可先在等候区休息。
                  </Notice>
                )}
                {visit.wheelchairCoord && resolutionLabel[visit.wheelchairCoord.resolution] && (
                  <Notice kind={visit.wheelchairCoord.resolution === 'bring_own' ? 'ok' : 'info'}>
                    {resolutionLabel[visit.wheelchairCoord.resolution]}
                    {visit.wheelchairCoord.resolution !== 'branch_transfer' && <>（工作人员记录：{visit.wheelchairCoord.reason}）</>}
                  </Notice>
                )}
                {tr && tr.status !== 'cancelled' && (
                  <div className="wc-transfer">
                    <div className="flex between wrap">
                      <b>🚐 {tr.fromBranch} 轮椅 {tr.assetCode} 调运进度</b>
                      <Badge tone={tr.status === 'arrived' ? 'green' : tr.status === 'in_transit' ? 'amber' : 'blue'}>
                        {tr.status === 'requested' ? '已请求待取货' : tr.status === 'in_transit' ? '运送途中' : '已送达服务台'}
                      </Badge>
                    </div>
                    <div className="wc-transfer-grid">
                      <div><span>搬运人员</span><b>{tr.carrier}（{tr.carrierPhone}）</b></div>
                      <div><span>预计到达</span><b>{fmtMin(tr.etaMin)}{tr.arriveMin != null ? ` · ${fmtMin(tr.arriveMin)} 已到` : ''}</b></div>
                      <div><span>您的等待位置</span><b>{tr.waitLocation ?? '一层服务台等候区'}</b></div>
                    </div>
                  </div>
                )}
                {visit.waitingServices.length > 0 && (
                  <div className="small muted" style={{ marginTop: 10 }}>
                    ☕ 等待期间服务台已为您提供 {visit.waitingServices.length} 次照料：
                    {visit.waitingServices.map((w) => ` ${({ seat: '座椅', water: '饮水', guide: '临时讲解' } as const)[w.kind]}${w.note ? `(${w.note})` : ''}`).join('、')}（均已计入您的预约记录）。
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {visit.status === 'booked' && (
        <div className="card">
          <h2>📱 观众自助（手机端）</h2>
          <p className="sub">如行程有变化，可在此一键告知服务台，系统会同步调整接应时间、路线与排班。</p>
          <div className="flex" style={{ gap: 8 }}>
            <input type="number" min={5} max={120} value={lateInput} onChange={(e) => setLateInput(Number(e.target.value))} style={{ maxWidth: 100 }} />
            <button className="btn ghost sm" onClick={() => setVisitSignals(visit.id, { lateMin: lateInput }, `观众自助报备迟到约 ${lateInput} 分钟，各节点接应时间顺延`)}>我可能迟到（分钟）</button>
            <button className="btn danger sm" onClick={() => setVisitSignals(visit.id, { lateMin: 0 }, '观众已恢复准时，接应时间复原')}>取消迟到</button>
          </div>
          <div className="flex mt8" style={{ gap: 8 }}>
            <button className="btn gold sm" onClick={() => setVisitSignals(visit.id, { visitorUnwell: true }, '观众报备身体不适：立即缩减路线、加密休息，服务台准备轮椅与医药箱并安排专人关注')}>我身体不适，需要加强协助</button>
            <button className="btn ghost sm" onClick={() => setVisitSignals(visit.id, { visitorUnwell: false }, '观众反馈已恢复，路线恢复正常节奏')}>已恢复</button>
          </div>
          <hr className="divider" />
          <div className="flex" style={{ gap: 8 }}>
            <input type="text" placeholder="给服务台留言（如：需冷藏药品、听障需字幕屏）" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn ghost sm" disabled={!note.trim()} onClick={() => { addEvent(visit.id, 'note', `观众留言：${note.trim()}`, '观众'); setNote('') }}>发送</button>
          </div>
          <hr className="divider" />
          <button className="btn danger sm" onClick={() => { cancelVisit(visit.id); navigate('/') }}>取消本次预约</button>
        </div>
      )}

      {visit.route && (
        <MuseumMap trace={visit.route.trace} elevatorsDown={global.elevatorsDown} closedHalls={global.closedHalls} crowd={crowdMap} />
      )}

      {visit.route && <RouteTimeline plan={visit.route} />}

      <div className="card">
        <h2>入馆当天小贴士</h2>
        <div className="small muted">
          <p style={{ marginTop: 0 }}>① 到馆后请直接到一层咨询服务台，出示预约编号 <span className="code-pill">{visit.code}</span> 或手机号 {visit.party.phone} 核验。</p>
          <p>② {visit.party.borrowWheelchair ? '服务台将为您借出轮椅并协助调试；' : ''}{escort ? `${escort.role}${escort.name} 将在服务台与您对接全程陪同；` : '每层展厅工作人员可提供定点协助；'}{visit.route?.parkingSlot ? `驾车请停 ${visit.route.parkingSlot} 无障碍车位。` : ''}</p>
          <p style={{ marginBottom: 0 }}>③ 每段路线都标注了距离、坡度、休息点与无障碍卫生间；展厅工作人员可在各时间点看到您的预计到达与需要协助的节点。</p>
        </div>
      </div>

      <ServiceLog visitId={visit.id} />

      <div className="card">
        <h2>参观后反馈（用于下次更好接待）</h2>
        {visit.status === 'completed' ? (
          <>
            <p className="sub">您的偏好与建议会写入服务档案，下次预约自动延续（如惯用轮椅、偏好慢速、易疲劳楼层等）。</p>
            <textarea placeholder="例如：希望下次仍安排王讲解；三楼坡道下行较累，希望下次多休息一次……"
              value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <button className="btn mt8" disabled={!feedback.trim() || feedback === visit.feedback}
              onClick={() => { addFeedback(visit.id, feedback.trim()); }}>保存到我的服务档案</button>
            {visit.feedback && <p className="small green-text mt8" style={{ color: 'var(--green)' }}>✅ 已保存：{visit.feedback}</p>}
          </>
        ) : (
          <p className="muted small">参观完成、服务台归档后，可在此填写反馈。工作人员也可在 <Link to="/ops">馆内工作台</Link> 完成归档。</p>
        )}
      </div>
    </div>
  )
}
