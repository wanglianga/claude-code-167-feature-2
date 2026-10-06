import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { STAFF, HALLS, ELEVATORS, TOTAL_WHEELCHAIRS, TOTAL_PARKING } from '../data/museum'
import { crowdLabel, parkingAvailable, wheelchairAvailable } from '../lib/planner'
import type { LiveSignals } from '../lib/planner'
import MuseumMap from '../components/MuseumMap'
import WheelchairDesk from '../components/WheelchairDesk'
import { Badge, Notice, StatusBadge } from '../components/ui'
import { fmtMin, prettyDate, todayISO, weekdayCN } from '../utils'

const CROWD_PRESETS = [
  { label: '自动', value: -1 },
  { label: '宽松 20%', value: 0.2 },
  { label: '适中 50%', value: 0.5 },
  { label: '较拥挤 70%', value: 0.7 },
  { label: '过度拥挤 88%', value: 0.88 }
]

function signalsOf(global: ReturnType<typeof useStore.getState>['global'], lateMin = 0, unwell = false): LiveSignals {
  return { ...global, lateMin, visitorUnwell: unwell }
}

export default function OpsPage() {
  const s = useStore()
  const today = todayISO()
  const [selId, setSelId] = useState<string | undefined>(undefined)
  const [assistText, setAssistText] = useState('')

  const todays = useMemo(
    () => s.visits.filter((v) => v.date === today).sort((a, b) => a.baseArrivalMin - b.baseArrivalMin),
    [s.visits, today]
  )
  const selectedId = selId ?? todays[0]?.id ?? s.visits[0]?.id
  const visit = s.visits.find((v) => v.id === selectedId)
  const vs = selectedId ? s.visitSignals[selectedId] : undefined

  const sig = signalsOf(s.global, vs?.lateMin ?? 0, vs?.visitorUnwell ?? false)
  const wAvail = wheelchairAvailable(sig, s.visits, today, selectedId)
  const pAvail = parkingAvailable(s.visits, today)

  const toggleArr = (key: 'elevatorsDown' | 'closedHalls' | 'staffExtraLeave', id: string) => {
    const arr = s.global[key]
    const next = arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]
    const cause =
      key === 'elevatorsDown' ? (arr.includes(id) ? `${ELEVATORS.find((e) => e.id === id)?.name}恢复运行，路线恢复正常` : `${ELEVATORS.find((e) => e.id === id)?.name}临时故障，所有在馆/预约路线改走备用电梯`)
      : key === 'closedHalls' ? (arr.includes(id) ? `${HALLS.find((h) => h.id === id)?.name}重新开放` : `${HALLS.find((h) => h.id === id)?.name}临时闭馆，已从路线移除并调整接应`)
      : (arr.includes(id) ? `${STAFF.find((x) => x.id === id)?.name}取消请假回到岗位` : `${STAFF.find((x) => x.id === id)?.role}${STAFF.find((x) => x.id === id)?.name}临时请假，相关预约已自动改派人员`)
    s.setGlobalSignals({ [key]: next }, cause)
  }

  const setCrowd = (hallId: string, value: number) => {
    const crowdOverride = { ...s.global.crowdOverride }
    if (value < 0) delete crowdOverride[hallId]
    else crowdOverride[hallId] = value
    s.setGlobalSignals({ crowdOverride }, value < 0 ? '取消人工拥挤度设定，恢复自动测算' : `人工设定${HALLS.find((h) => h.id === hallId)?.name}拥挤度，已据此避让/重排路线`)
  }

  // —— 今日接应任务看板：展厅工作人员视角 ——
  const etaBoard = todays
    .filter((v) => v.status !== 'cancelled' && v.route)
    .flatMap((v) =>
      v.route!.stops.map((st) => ({
        key: v.id + st.hallId, visit: v, hallId: st.hallId, arrive: st.arriveMin, leave: st.leaveMin, crowd: st.crowd, assist: st.assist
      }))
    )
    .sort((a, b) => a.arrive - b.arrive)

  const nowMin = (() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })()

  return (
    <div>
      <div className="hero" style={{ background: 'linear-gradient(120deg,#3a3327,#5b4d38)' }}>
        <h1>馆内工作台（服务台 / 展厅工作人员平板）</h1>
        <p>{prettyDate(today)} · {weekdayCN(today)} · 同一屏完成预约核验、轮椅借还、讲解排班、接应提醒与突发处置；所有动作自动回流到该观众的同一条参观服务记录。</p>
        <div className="badges">
          <Badge>今日预约 {todays.filter((v) => v.status !== 'cancelled').length} 组</Badge>
          <Badge tone={wAvail > 0 ? 'green' : 'red'}>♿ 轮椅可用 {wAvail}/{TOTAL_WHEELCHAIRS}</Badge>
          <Badge tone={pAvail > 0 ? 'green' : 'red'}>🅿️ 车位余 {pAvail}/{TOTAL_PARKING}</Badge>
          <Badge tone={s.global.elevatorsDown.length ? 'red' : 'green'}>🛗 电梯 {2 - s.global.elevatorsDown.length}/2 运行</Badge>
          <Badge tone={s.global.staffExtraLeave.length ? 'amber' : 'green'}>🧑‍🏫 {STAFF.length - s.global.staffExtraLeave.length}/{STAFF.length} 人在岗</Badge>
        </div>
      </div>

      {/* —— 现场信号 —— */}
      <div className="card">
        <h2>现场态势与安全调度 <Badge tone="red">变更会自动重算全部相关预约</Badge></h2>
        <p className="sub">把文化服务与现场安全结合：电梯、闭展、拥挤、库存、排班任一变化，路线（展厅覆盖 × 观众体力 × 设备可用 × 拥挤度 × 接应能力）即时更新。</p>
        <div className="ctrl-grid">
          {ELEVATORS.map((e) => {
            const on = s.global.elevatorsDown.includes(e.id)
            return (
              <button key={e.id} className={`ctrl-tile ${on ? 'on' : ''}`} onClick={() => toggleArr('elevatorsDown', e.id)}>
                <div className="t">🛗 {e.name}<span>{on ? '点击恢复' : '点击设为故障'}</span></div>
                <div className="d">{on ? '故障中：路线全部改走另一部电梯，无法到达的展厅自动跳过' : '运行中：跨层无障碍通行'}</div>
              </button>
            )
          })}
          {HALLS.map((h) => {
            const on = s.global.closedHalls.includes(h.id)
            return (
              <button key={h.id} className={`ctrl-tile ${on ? 'on' : ''}`} onClick={() => toggleArr('closedHalls', h.id)}>
                <div className="t">🚧 {h.name.split(' · ')[1] ?? h.name}<span>{on ? '点击恢复开放' : '点击临时闭馆'}</span></div>
                <div className="d">{on ? '临时闭馆中：已从所有路线移除并提示改约' : '正常开放'}</div>
              </button>
            )
          })}
          {STAFF.map((st) => {
            const on = s.global.staffExtraLeave.includes(st.id)
            return (
              <button key={st.id} className={`ctrl-tile ${on ? 'on' : ''}`} onClick={() => toggleArr('staffExtraLeave', st.id)}>
                <div className="t">{st.role === '讲解员' ? '🧑‍🏫' : '🙋'} {st.name}（{st.skills.map((k) => ({ sign: '手语', slow: '慢速', wheelchair: '轮椅' }[k])).join('/')}）<span>{on ? '请假中，点击复岗' : '在岗，点击设请假'}</span></div>
                <div className="d">班次 {fmtMin(st.shiftStartMin)}–{fmtMin(st.shiftEndMin)}{on ? '；其陪同任务已尝试自动改派' : ''}</div>
              </button>
            )
          })}
        </div>

        <div className="grid2 mt12">
          <div>
            <h3>展厅拥挤度人工设定</h3>
            {HALLS.map((h) => (
              <div key={h.id} className="flex between" style={{ marginBottom: 6 }}>
                <span className="small" style={{ flex: 1 }}>{h.name.split(' · ')[1] ?? h.name}</span>
                <select className="sm" style={{ width: 150 }}
                  value={s.global.crowdOverride[h.id] ?? -1}
                  onChange={(e) => setCrowd(h.id, Number(e.target.value))}>
                  {CROWD_PRESETS.map((p) => <option key={p.label} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div>
            <h3>轮椅库存调节（报修 / 消毒 / 提前归还）</h3>
            <div className="flex" style={{ gap: 8 }}>
              <button className="btn danger sm" onClick={() => s.setGlobalSignals({ wheelchairOffset: s.global.wheelchairOffset + 1 }, '一台轮椅报修/送修，可用库存减少，相关借用预约重新核算')}>− 1 台报修</button>
              <button className="btn ghost sm" disabled={s.global.wheelchairOffset <= 0}
                onClick={() => s.setGlobalSignals({ wheelchairOffset: Math.max(0, s.global.wheelchairOffset - 1) }, '轮椅修复归库，可用库存恢复')}>＋ 修复归库</button>
            </div>
            <p className="small muted mt8">当前额外不可用 {s.global.wheelchairOffset} 台；库存不足时系统自动把借用预约转为"排队调剂 + 最短步行路线"。</p>
          </div>
        </div>
      </div>

      {/* —— 轮椅库存不足协调台 —— */}
      <WheelchairDesk />

      {/* —— 接应任务看板 —— */}
      <div className="card">
        <h2>📋 今日接应任务看板 <span className="small muted">（展厅工作人员）</span></h2>
        <p className="sub">按预计到达时间排序；请提前 2–3 分钟到展厅入口无障碍观展位接应。</p>
        {etaBoard.length === 0 && <p className="muted small">今日暂无已排路线的预约。</p>}
        {etaBoard.map((e) => {
          const c = crowdLabel(e.crowd)
          const overdue = e.arrive < nowMin && e.leave < nowMin && e.visit.status !== 'completed'
          return (
            <div key={e.key} className={`eta-card ${c.tone === 'bad' || overdue ? 'alert' : ''}`}>
              <div className="flex between">
                <span className="t">{fmtMin(e.arrive)}–{fmtMin(e.leave)} · {HALLS.find((h) => h.id === e.hallId)?.name}</span>
                <span className="small"><span className="code-pill">{e.visit.code}</span> {e.visit.party.contactName} · {e.visit.party.size + (e.visit.party.extraCompanions ?? 0)} 人</span>
              </div>
              <div className="small muted mt8">
                🤝 {e.assist}
              </div>
              <div className="flex mt8" style={{ gap: 8 }}>
                <Badge tone={c.tone === 'bad' ? 'red' : c.tone === 'warn' ? 'amber' : 'green'}>拥挤 {Math.round(e.crowd * 100)}% · {c.text}</Badge>
                {e.visit.route?.escortName && <Badge tone="blue">陪同：{e.visit.route.escortKind}{e.visit.route.escortName}</Badge>}
                {(e.visit.party.usesWheelchair || e.visit.party.borrowWheelchair) && <Badge tone="gold">♿ 轮椅</Badge>}
                {overdue && <Badge tone="red">已过时段未归档</Badge>}
                <button className="btn sm ghost" onClick={() => setSelId(e.visit.id)}>打开该服务 →</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* —— 单条服务操作 —— */}
      <div className="ops-layout">
        <div>
          <h2 className="section-title">今日 / 全部预约</h2>
          {[...todays, ...s.visits.filter((v) => v.date !== today)].map((v) => (
            <button key={v.id} className={`visit-item ${v.id === selectedId ? 'sel' : ''}`} onClick={() => setSelId(v.id)}>
              <div className="row">
                <b>{v.party.contactName || '未命名'} · {v.party.size + (v.party.extraCompanions ?? 0)} 人</b>
                <StatusBadge status={v.status} />
              </div>
              <div className="small muted mt8">
                <span className="code-pill">{v.code}</span> {prettyDate(v.date)} {fmtMin(v.baseArrivalMin)}
                {v.date === today && ' · 今日'}
              </div>
              <div className="badges mt8">
                {(v.party.usesWheelchair || v.party.borrowWheelchair) && <Badge tone="gold">♿</Badge>}
                {v.party.needSign && <Badge tone="blue">手语</Badge>}
                {v.party.needSlow && <Badge tone="blue">慢速</Badge>}
                {!v.party.canStandLong && <Badge tone="amber">不宜久站</Badge>}
                {v.loans.some((l) => l.loanedAt && !l.returnedAt) && <Badge tone="brand">已借轮椅</Badge>}
                {v.route && v.route.version > 1 && <Badge tone="red">路线 v{v.route.version}</Badge>}
              </div>
            </button>
          ))}
          {s.visits.length === 0 && <p className="muted small">暂无预约。可在 <Link to="/book">预约页</Link> 新建。</p>}
        </div>

        <div>
          {visit && visit.route && (
            <>
              <div className="card">
                <div className="flex between">
                  <h2 style={{ margin: 0 }}>服务处置 · <span className="code-pill">{visit.code}</span></h2>
                  <StatusBadge status={visit.status} />
                </div>
                <p className="sub">{visit.party.contactName} · {visit.party.phone} · 路线 v{visit.route.version} · {visit.route.stops.length} 厅 · {visit.route.totalDistance} 米 · {fmtMin(visit.route.arrivalMin)}–{fmtMin(visit.route.endMin)}</p>

                <div className="grid3">
                  <div className="stat"><b>{visit.route.escortName ? `${visit.route.escortKind}${visit.route.escortName}` : '—'}</b><span>当前陪同</span></div>
                  <div className="stat"><b>{visit.loans.filter((l) => l.loanedAt && !l.returnedAt).length}</b><span>在借轮椅</span></div>
                  <div className="stat"><b>{visit.party.size + (visit.party.extraCompanions ?? 0)} 人</b><span>实际队伍（含临时陪同）</span></div>
                </div>

                {/* 服务台流程 */}
                <h3>① 服务台核验与设备</h3>
                <div className="flex" style={{ gap: 8 }}>
                  {visit.status === 'booked' && <button className="btn" onClick={() => s.checkIn(visit.id)}>✅ 核验预约并办理入馆</button>}
                  {visit.status === 'checked_in' && <button className="btn" onClick={() => s.setStatus(visit.id, 'visiting')}>🚶 开始参观</button>}
                  {(visit.status === 'visiting' || visit.status === 'checked_in') && <button className="btn ghost" onClick={() => s.setStatus(visit.id, 'completed')}>🏁 参观完成归档</button>}
                  {visit.status === 'completed' && <button className="btn ghost sm" onClick={() => s.setStatus(visit.id, 'visiting')}>撤销归档</button>}
                </div>
                <div className="flex mt8" style={{ gap: 8 }}>
                  {visit.party.borrowWheelchair && visit.loans.filter((l) => l.loanedAt && !l.returnedAt).length === 0 && (() => {
                    const inboundArrived = visit.branchTransfer?.status === 'arrived'
                    const disabled = wAvail <= 0 && !inboundArrived
                    return (
                      <button className="btn gold sm" disabled={disabled} onClick={() => s.loanWheelchair(visit.id)}>
                        {inboundArrived ? `♿ 发放跨馆调入轮椅 ${visit.branchTransfer!.assetCode}` : disabled ? '预约借用：库存不足，可在协调台安排优先/跨馆调入' : '♿ 按预约借出轮椅'}
                      </button>
                    )
                  })()}
                  {!visit.party.borrowWheelchair && visit.loans.filter((l) => l.loanedAt && !l.returnedAt).length === 0 && (
                    <button className="btn gold sm" disabled={wAvail <= 0} onClick={() => s.loanWheelchair(visit.id)}>
                      {wAvail <= 0 ? '现场借用：库存不足' : '♿ 现场应急借出轮椅（如不适/疲劳）'}
                    </button>
                  )}
                  {visit.loans.filter((l) => l.loanedAt && !l.returnedAt).map((l) => (
                    <button key={l.id} className="btn ghost sm" onClick={() => s.returnWheelchair(visit.id, l.id)}>↩ 归还轮椅 {l.assetCode}</button>
                  ))}
                </div>

                <hr className="divider" />
                <h3>② 讲解员 / 志愿者排班</h3>
                <div className="flex" style={{ gap: 8 }}>
                  <select style={{ maxWidth: 260 }} value={visit.route.escortId ?? ''}
                    onChange={(e) => e.target.value && s.assignEscort(visit.id, e.target.value)}>
                    {!visit.route.escortId && <option value="">未安排陪同</option>}
                    {STAFF.map((st) => (
                      <option key={st.id} value={st.id} disabled={s.global.staffExtraLeave.includes(st.id)}>
                        {st.role}{st.name}（{st.skills.map((k) => ({ sign: '手语', slow: '慢速', wheelchair: '轮椅' }[k])).join('/')}）{s.global.staffExtraLeave.includes(st.id) ? '· 请假中' : ''}
                      </option>
                    ))}
                  </select>
                  {visit.route.escortId && (
                    <button className="btn danger sm" onClick={() => toggleArr('staffExtraLeave', visit.route!.escortId!)}>该陪同临时请假（自动改派）</button>
                  )}
                </div>
                {visit.route.escortIssue && <Notice kind="warn">{visit.route.escortIssue}</Notice>}

                <hr className="divider" />
                <h3>③ 队伍与观众状况</h3>
                <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="small">临时增加陪同：</span>
                  <button className="btn sm ghost" onClick={() => s.setExtraCompanions(visit.id, (visit.party.extraCompanions ?? 0) - 1)}>−</button>
                  <b>{visit.party.extraCompanions ?? 0}</b>
                  <button className="btn sm ghost" onClick={() => s.setExtraCompanions(visit.id, (visit.party.extraCompanions ?? 0) + 1)}>＋</button>
                  <span className="small muted">（影响队伍规模与接应安排）</span>
                </div>
                <div className="flex mt8" style={{ gap: 8 }}>
                  <span className="small">观众迟到：</span>
                  {[0, 15, 30, 45].map((m) => (
                    <button key={m} className={`btn sm ${vs?.lateMin === m ? '' : 'ghost'}`}
                      onClick={() => s.setVisitSignals(visit.id, { lateMin: m }, m === 0 ? '迟到解除，接应时间恢复' : `观众迟到约 ${m} 分钟，各展厅预计到达时间顺延并重查拥挤度/排班`)}>{m === 0 ? '准时' : `${m} 分钟`}</button>
                  ))}
                </div>
                <div className="flex mt8" style={{ gap: 8 }}>
                  <button className={`btn sm ${vs?.visitorUnwell ? 'danger' : 'ghost'}`}
                    onClick={() => s.setVisitSignals(visit.id, { visitorUnwell: !(vs?.visitorUnwell ?? false) }, (vs?.visitorUnwell ? '观众身体已恢复，路线恢复正常' : '观众身体不适：立即缩减展厅、加长休息，就近安排座椅/医药箱并加强陪同'))}>
                    {vs?.visitorUnwell ? '⚠ 身体不适处置中（点击解除）' : '➕ 标记观众身体不适'}
                  </button>
                </div>

                <hr className="divider" />
                <h3>④ 突发协助记录（同步写入该条服务）</h3>
                <div className="flex" style={{ gap: 6 }}>
                  {['展厅内提供轮椅/座椅休息', '电梯口接应并协助乘梯', '坡道协助推行', '联系驻馆医护处理不适', '卫生间专人引导', '遗失物品登记协助'].map((t) => (
                    <button key={t} className="btn sm ghost" onClick={() => s.recordAssist(visit.id, t)}>{t}</button>
                  ))}
                </div>
                <div className="flex mt8" style={{ gap: 8 }}>
                  <input type="text" placeholder="自定义突发情况与处置经过…" value={assistText}
                    onChange={(e) => setAssistText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && assistText.trim()) { s.recordAssist(visit.id, assistText.trim()); setAssistText('') } }} />
                  <button className="btn sm" disabled={!assistText.trim()} onClick={() => { s.recordAssist(visit.id, assistText.trim()); setAssistText('') }}>记录</button>
                </div>

                <div className="mt12">
                  {visit.route.notices.map((n, i) => (
                    <Notice key={i} kind={n.startsWith('⚠') ? 'warn' : n.includes('陪同安排') || n.includes('充足') ? 'ok' : 'info'}>{n.replace(/^⚠\s*/, '')}</Notice>
                  ))}
                </div>

                <hr className="divider" />
                <div className="flex between">
                  <h3 style={{ margin: 0 }}>需要协助的节点（推送给对应楼层）</h3>
                  <Link className="btn sm ghost" to={`/visit/${visit.id}`}>查看观众端完整路线</Link>
                </div>
                {visit.route.stops.map((st) => (
                  <div key={st.hallId} className="eta-card">
                    <b>{fmtMin(st.arriveMin)}</b> · {HALLS.find((h) => h.id === st.hallId)?.name}
                    <div className="small muted">{st.assist}</div>
                  </div>
                ))}
                {visit.route.segments.filter((seg) => seg.warning || seg.kind === 'ramp').map((seg) => (
                  <div key={seg.id} className="small muted" style={{ marginBottom: 4 }}>· {seg.to}：{seg.warning ?? `坡道 ${seg.maxSlope}%，注意推行/搀扶`}</div>
                ))}
              </div>

              <MuseumMap
                trace={visit.route.trace}
                elevatorsDown={s.global.elevatorsDown}
                closedHalls={s.global.closedHalls}
                crowd={Object.fromEntries(visit.route.stops.map((st) => [st.hallId, st.crowd]))}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
