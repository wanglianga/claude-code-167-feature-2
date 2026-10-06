import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, emptyParty } from '../store'
import { planRoute, wheelchairAvailable, parkingAvailable } from '../lib/planner'
import { STAFF, TOTAL_WHEELCHAIRS, TOTAL_PARKING } from '../data/museum'
import type { PartyProfile } from '../types'
import { fmtDist, fmtMin, hhmmToMin, todayISO } from '../utils'
import { Badge, Notice } from '../components/ui'

function Toggle({ checked, onChange, title, desc }: { checked: boolean; onChange: (v: boolean) => void; title: string; desc: string }) {
  return (
    <label className={`switch-row ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
      <span className="txt"><b>{title}</b><span>{desc}</span></span>
    </label>
  )
}

export default function BookPage() {
  const navigate = useNavigate()
  const createVisit = useStore((s) => s.createVisit)
  const visits = useStore((s) => s.visits)
  const global = useStore((s) => s.global)

  const [date, setDate] = useState(todayISO())
  const [time, setTime] = useState('09:30')
  const [party, setParty] = useState<PartyProfile>(emptyParty())
  const set = <K extends keyof PartyProfile>(k: K, v: PartyProfile[K]) => setParty((p) => ({ ...p, [k]: v }))

  const signals = {
    elevatorsDown: global.elevatorsDown,
    closedHalls: global.closedHalls,
    crowdOverride: global.crowdOverride,
    staffExtraLeave: global.staffExtraLeave,
    wheelchairOffset: global.wheelchairOffset,
    visitorUnwell: false,
    lateMin: 0
  }

  const preview = useMemo(() => planRoute({
    party, date, arrivalMin: hhmmToMin(time), signals, visits, staff: STAFF
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [party, date, time, JSON.stringify(global), visits.length])

  const wAvail = wheelchairAvailable(signals, visits, date)
  const pAvail = parkingAvailable(visits, date)
  const valid = party.contactName.trim() !== '' && /^1\d{10}$/.test(party.phone) && party.size >= 1

  const submit = () => {
    const id = createVisit({ date, arrivalMin: hhmmToMin(time), party })
    navigate(`/visit/${id}`)
  }

  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="card">
        <h2>无障碍参观预约</h2>
        <p className="sub">请如实填写观众情况，所有信息仅用于安排路线、设备与陪同服务，全程由同一条服务记录跟进。</p>

        <div className="grid2">
          <div className="field">
            <label>参观日期</label>
            <input type="date" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>预计到馆时间</label>
            <input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label>联系人姓名</label>
            <input type="text" placeholder="如：张女士" value={party.contactName} onChange={(e) => set('contactName', e.target.value)} />
          </div>
          <div className="field">
            <label>手机号</label>
            <input type="tel" placeholder="11 位手机号，用于到馆接应" maxLength={11} value={party.phone}
              onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>

        <div className="field">
          <label>参观人数 <span className="hint">（含本人，不含后续临时增加的陪同）</span></label>
          <div className="stepper">
            <button type="button" onClick={() => set('size', Math.max(1, party.size - 1))} aria-label="减少">−</button>
            <span className="val">{party.size}</span>
            <button type="button" onClick={() => set('size', Math.min(12, party.size + 1))} aria-label="增加">＋</button>
          </div>
        </div>

        <hr className="divider" />

        <Toggle checked={party.usesWheelchair} onChange={(v) => set('usesWheelchair', v)}
          title="♿ 我将使用轮椅（自带）" desc="路线全程保证无台阶通道，优先无障碍电梯与低位观展位" />
        <Toggle checked={party.borrowWheelchair} onChange={(v) => set('borrowWheelchair', v)}
          title={`🏷 需要向馆方借用轮椅（库存余 ${wAvail}/${TOTAL_WHEELCHAIRS}）`}
          desc={wAvail <= 0 ? '当前库存紧张：提交后自动排队调剂，路线按最短步行+休息点生成' : '入馆当天在一层服务台凭证领取并调试'} />
        <Toggle checked={party.needSign} onChange={(v) => set('needSign', v)}
          title="🤟 需要手语讲解" desc="优先排班手语讲解员；无法排班时安排图文讲解卡与志愿者陪同" />
        <Toggle checked={party.needSlow} onChange={(v) => set('needSlow', v)}
          title="🐢 需要慢速讲解" desc="放慢讲解与行进速度，观展时间延长约 30%" />
        <Toggle checked={party.hasElder} onChange={(v) => set('hasElder', v)}
          title="👴 同行有老人" desc="降低行进速度、加密休息点与卫生间途经" />
        <Toggle checked={party.hasChild} onChange={(v) => set('hasChild', v)}
          title="👶 同行有儿童" desc="优先安排自然探索馆等亲子展厅，就近安排卫生间" />
        <Toggle checked={party.needParking} onChange={(v) => set('needParking', v)}
          title={`🅿️ 需要近距离无障碍车位（余 ${pAvail}/${TOTAL_PARKING}）`}
          desc="车位位于 B1 临近电梯；约满时安排正门落客与志愿者代泊车指引" />
        <Toggle checked={!party.canStandLong} onChange={(v) => set('canStandLong', !v)}
          title="🪑 不能长时间站立 / 行走" desc="路线按低体力节奏生成：缩短步行、每段之间安排座椅休息" />

        <button className="btn block mt12" disabled={!valid} onClick={submit}>
          {valid ? '生成可行路线并提交预约' : '请填写姓名与正确的手机号'}
        </button>
        {!valid && <p className="toast-note">提交后可随时在手机上查看分段路线；入馆当天服务台凭手机号核验。</p>}
      </div>

      {/* —— 实时可行性预估 —— */}
      <div>
        <div className="card">
          <h2>路线可行性预估 <Badge tone="brand">随填写实时更新</Badge></h2>
          <p className="sub">系统综合展厅电梯、坡道、拥挤程度、临时闭馆、轮椅库存、讲解员排班与楼层接应能力实时计算。</p>

          <div className="stat-row">
            <div className="stat"><b>{preview.stops.length}</b><span>可安排展厅</span></div>
            <div className="stat"><b>{fmtDist(preview.totalDistance)}</b><span>路线总距离</span></div>
            <div className="stat"><b>{preview.totalMin} 分钟</b><span>全程总时长</span></div>
            <div className="stat"><b>{fmtMin(preview.arrivalMin)}–{fmtMin(preview.endMin)}</b><span>建议时段</span></div>
          </div>

          <div className="badges">
            {party.borrowWheelchair && (preview.wheelchairInfo
              ? (preview.wheelchairInfo.waitMin > 0
                ? <Badge tone="red">♿ 排队第 {preview.wheelchairInfo.queueIndex} 位 · 等约 {preview.wheelchairInfo.waitMin} 分钟</Badge>
                : <Badge tone="green">♿ 到馆可发 {preview.wheelchairInfo.availableAtArrival} 台</Badge>)
              : <Badge tone="green">♿ 轮椅可保障</Badge>)}
            {party.borrowWheelchair && preview.wheelchairInfo && preview.wheelchairInfo.waitMin > 15 && (
              <Badge tone="amber">🏛 {preview.wheelchairInfo.branches.filter((b) => b.available > 0).length} 个馆区可调设备</Badge>
            )}
            {party.needParking && (preview.parkingIssue
              ? <Badge tone="amber">🅿️ 车位需协调</Badge>
              : <Badge tone="green">🅿️ 车位 {preview.parkingSlot}</Badge>)}
            {preview.escortId
              ? <Badge tone="blue">🤝 {preview.escortKind}{preview.escortName} 陪同</Badge>
              : (party.needSign || party.needSlow || party.borrowWheelchair || party.usesWheelchair) && <Badge tone="amber">🤝 陪同需协调</Badge>}
            {global.elevatorsDown.length > 0 && <Badge tone="red">🛗 有电梯故障绕行</Badge>}
          </div>

          <div className="mt12">
            {preview.notices.slice(0, 5).map((n, i) => (
              <Notice key={i} kind={n.startsWith('⚠') ? 'warn' : n.includes('陪同安排') || n.includes('充足') ? 'ok' : 'info'}>{n.replace(/^⚠\s*/, '')}</Notice>
            ))}
          </div>

          <hr className="divider" />
          <h3>预计参观顺序</h3>
          {preview.stops.length === 0 && <p className="muted small">当前选择下暂无可排入展厅，请调整到馆时间或现场咨询服务台。</p>}
          {preview.stops.map((st, i) => (
            <div key={st.hallId} className="eta-card">
              <div className="flex between">
                <span className="t">{i + 1}. 展厅接应节点</span>
                <span className="small">{fmtMin(st.arriveMin)} 到达</span>
              </div>
              <div className="small muted">{st.assist}</div>
            </div>
          ))}
          {preview.skipped.length > 0 && (
            <div className="mt8">
              <b className="small">已主动避开：</b>
              {preview.skipped.map((s) => <div key={s.hallId} className="small muted">· {s.reason}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
