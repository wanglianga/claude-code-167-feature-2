import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { StatusBadge, Badge, EmptyHint, Notice } from '../components/ui'
import { prettyDate, weekdayCN, fmtMin } from '../utils'
import { STAFF, TOTAL_WHEELCHAIRS, TOTAL_PARKING } from '../data/museum'
import { wheelchairAvailable, parkingAvailable } from '../lib/planner'

export default function HomePage() {
  const visits = useStore((s) => s.visits)
  const global = useStore((s) => s.global)

  const sorted = [...visits].sort((a, b) =>
    a.date === b.date ? a.baseArrivalMin - b.baseArrivalMin : a.date.localeCompare(b.date)
  )
  const active = sorted.filter((v) => v.status !== 'cancelled' && v.status !== 'completed')
  const past = sorted.filter((v) => v.status === 'completed' || v.status === 'cancelled')

  const today = new Date()
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const wAvail = wheelchairAvailable({ elevatorsDown: global.elevatorsDown, closedHalls: global.closedHalls, crowdOverride: global.crowdOverride, staffExtraLeave: global.staffExtraLeave, wheelchairOffset: global.wheelchairOffset, transferBoost: global.transferBoost, visitorUnwell: false, lateMin: 0 }, visits, todayISO)
  const pAvail = parkingAvailable(visits, todayISO)

  return (
    <div>
      <section className="hero">
        <h1>让每一位观众从容地看展</h1>
        <p>预约时告知需求，系统结合电梯、坡道、拥挤度、闭展、轮椅库存与讲解员排班，为您生成带距离、坡度、休息点和卫生间位置的分段无障碍路线；入馆后服务台与各楼层工作人员按同一条服务记录接力协助。</p>
        <div className="badges">
          <Badge>♿ 轮椅借用 {wAvail}/{TOTAL_WHEELCHAIRS} 台可用</Badge>
          <Badge>🅿️ 无障碍车位余 {pAvail}/{TOTAL_PARKING}</Badge>
          <Badge>🛗 电梯 {2 - global.elevatorsDown.length}/2 运行</Badge>
          <Badge>🧑‍🏫 讲解/志愿 {STAFF.length - global.staffExtraLeave.length} 人当班</Badge>
        </div>
      </section>

      {global.elevatorsDown.length > 0 && (
        <Notice kind="warn">馆内有电梯临时故障，新老预约的路线已自动改走备用电梯，请观众留意短信与页面提示。</Notice>
      )}

      <div className="flex between mt16">
        <h2 className="section-title" style={{ margin: 0 }}>我的参观服务</h2>
        <Link className="btn" to="/book">＋ 新建无障碍预约</Link>
      </div>

      {sorted.length === 0 && (
        <EmptyHint>
          <p style={{ fontSize: '2rem', margin: '8px 0' }}>🏛</p>
          还没有预约。点击"新建无障碍预约"，只需 1 分钟填写参观需求。
        </EmptyHint>
      )}

      {active.map((v) => {
        const escort = STAFF.find((s) => s.id === (v.escortId ?? v.route?.escortId))
        const openLoan = v.loans.find((l) => l.loanedAt && !l.returnedAt)
        return (
          <Link key={v.id} to={`/visit/${v.id}`} className="card" style={{ display: 'block', color: 'inherit' }}>
            <div className="flex between">
              <div className="flex" style={{ gap: 10 }}>
                <span className="code-pill">{v.code}</span>
                <StatusBadge status={v.status} />
              </div>
              <span className="small muted">{prettyDate(v.date)} · {weekdayCN(v.date)} · {fmtMin(v.baseArrivalMin)}</span>
            </div>
            <div className="badges mt12">
              <Badge tone="brand">👥 {v.party.size + (v.party.extraCompanions ?? 0)} 人</Badge>
              {(v.party.usesWheelchair || v.party.borrowWheelchair) && <Badge tone="gold">♿ {v.party.borrowWheelchair ? '借用轮椅' : '使用轮椅'}</Badge>}
              {v.party.needSign && <Badge tone="blue">🤟 手语讲解</Badge>}
              {v.party.needSlow && <Badge tone="blue">🐢 慢速讲解</Badge>}
              {v.party.hasElder && <Badge>👴 有老人</Badge>}
              {v.party.hasChild && <Badge>👶 有儿童</Badge>}
              {v.party.needParking && <Badge tone="green">🅿️ {v.route?.parkingSlot ?? '车位协调中'}</Badge>}
              {!v.party.canStandLong && <Badge tone="amber">🪑 不宜久站</Badge>}
            </div>
            <div className="small muted mt8">
              {v.route ? `路线 v${v.route.version}：${v.route.stops.length} 个展厅 · 约 ${v.route.totalDistance} 米 · ${fmtMin(v.route.arrivalMin)}–${fmtMin(v.route.endMin)}` : '路线生成中…'}
              {escort && <> · 陪同：{escort.role}{escort.name}</>}
              {openLoan && <> · 已借轮椅 {openLoan.assetCode}</>}
              {v.route && v.route.version > 1 && <b className="danger-text"> · 已根据现场情况重规划</b>}
            </div>
          </Link>
        )
      })}

      {past.length > 0 && (
        <>
          <h2 className="section-title">历史服务记录（下次接待可延续）</h2>
          {past.map((v) => (
            <Link key={v.id} to={`/visit/${v.id}`} className="card" style={{ display: 'block', color: 'inherit', opacity: 0.85 }}>
              <div className="flex between">
                <div className="flex" style={{ gap: 10 }}>
                  <span className="code-pill">{v.code}</span>
                  <StatusBadge status={v.status} />
                  <b>{v.party.contactName || '观众'} {v.party.size + (v.party.extraCompanions ?? 0)} 人</b>
                </div>
                <span className="small muted">{prettyDate(v.date)}</span>
              </div>
              {v.feedback && <p className="small muted mt8" style={{ marginBottom: 0 }}>📝 偏好延续：{v.feedback}</p>}
            </Link>
          ))}
        </>
      )}

      <p className="small muted mt16">
        手机端：观众通过本页查看预约与清晰路线；到馆后在 <Link to="/ops">馆内工作台</Link>（工作人员平板）核验预约、借轮椅、安排陪同与接应。
      </p>
    </div>
  )
}
