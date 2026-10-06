import { STAFF } from '../src/data/museum'
import { planRoute, wheelchairCoordInfo, DEFAULT_SIGNALS, type LiveSignals } from '../src/lib/planner'
import type { PartyProfile, Visit } from '../src/types'
import { uid, shortCode } from '../src/utils'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✅', msg) }
  else { fail++; console.log('  ❌', msg) }
}

function party(over: Partial<PartyProfile> = {}): PartyProfile {
  return {
    contactName: '测试', phone: '13800000000', size: 2,
    usesWheelchair: false, borrowWheelchair: false, needSign: false, needSlow: false,
    hasElder: false, hasChild: false, needParking: false, canStandLong: true, extraCompanions: 0,
    ...over
  }
}

function makeVisit(date: string, arrivalMin: number, p: PartyProfile, status: Visit['status'] = 'booked'): Visit {
  return {
    id: uid('v'), code: shortCode(), date, baseArrivalMin: arrivalMin, status, party: p,
    loans: [], events: [], createdAt: new Date().toISOString()
  }
}

const DATE = '2026-10-06'

console.log('\n场景 1：轮椅 + 慢速讲解 + 老人 + 无障碍车位 + 不能久站')
{
  const p = party({ borrowWheelchair: true, needSlow: true, hasElder: true, needParking: true, canStandLong: false })
  const plan = planRoute({ party: p, date: DATE, arrivalMin: 9 * 60 + 30, signals: DEFAULT_SIGNALS, visits: [], staff: STAFF })
  assert(plan.stops.length >= 2 && plan.stops.length <= 3, `低体力队伍排 ${plan.stops.length} 个展厅（期望 2–3）`)
  assert(!!plan.parkingSlot, `预留车位 ${plan.parkingSlot}`)
  assert(!!plan.escortId, `安排陪同：${plan.escortKind}${plan.escortName}`)
  assert(plan.totalDistance > 0 && plan.totalDistance < 800, `总步行 ${plan.totalDistance} 米（期望 <800）`)
  assert(plan.segments.some((s) => s.restNode), '路线包含休息点')
  assert(plan.segments.some((s) => s.toiletNode), '路线包含无障碍卫生间')
  assert(plan.segments.some((s) => s.kind === 'elevator'), '跨层使用电梯')
  assert(plan.trace.length > 3, `地图轨迹含 ${plan.trace.length} 条边`)
  const ramps = plan.segments.filter((s) => s.kind === 'ramp')
  assert(ramps.every((r) => r.maxSlope !== undefined), `每段坡道都标注坡度（${ramps.length} 段坡道）`)
  assert(plan.stops.every((st) => st.arriveMin >= st.leaveMin - 60 && st.arriveMin < st.leaveMin), '每厅到达早于离开')
}

console.log('\n场景 2：普通观众全覆盖')
{
  const p = party({ size: 4 })
  const plan = planRoute({ party: p, date: DATE, arrivalMin: 9 * 60 + 15, signals: DEFAULT_SIGNALS, visits: [], staff: STAFF })
  assert(plan.stops.length >= 4, `普通体力排 ${plan.stops.length} 个展厅（期望 ≥4）`)
  assert(plan.endMin <= 17 * 60, `${plan.endMin} 在闭馆前结束`)
}

console.log('\n场景 3：一部电梯故障 → 自动绕行另一部')
{
  const sig: LiveSignals = { ...DEFAULT_SIGNALS, elevatorsDown: ['el1'] }
  const p = party({ usesWheelchair: true })
  const plan = planRoute({ party: p, date: DATE, arrivalMin: 9 * 60 + 30, signals: sig, visits: [], staff: STAFF })
  assert(plan.notices.some((n) => n.includes('1号客梯临时故障')), '提示电梯故障改走 2 号')
  assert(plan.stops.length >= 2, `仍可经 2 号梯到达 ${plan.stops.length} 个展厅`)
  assert(!plan.trace.some((id) => id.startsWith('ev1')), '轨迹中不使用故障电梯')
}

console.log('\n场景 4：两部电梯全部故障 → 不崩溃，跨层展厅跳过')
{
  const sig: LiveSignals = { ...DEFAULT_SIGNALS, elevatorsDown: ['el1', 'el2'] }
  const p = party({ borrowWheelchair: true })
  const plan = planRoute({ party: p, date: DATE, arrivalMin: 9 * 60 + 30, signals: sig, visits: [], staff: STAFF })
  assert(plan.segments.length >= 0, '未崩溃，返回了计划')
  assert(plan.stops.length === 0, `楼上展厅均不可达（排 ${plan.stops.length} 个）`)
  assert(plan.skipped.length === 6, `6 个展厅全部给出跳过原因`)
}

console.log('\n场景 5：多预约同时需要轮椅 → 库存不足、排队位次、归还预计、跨馆可调')
{
  const at = 10 * 60
  // 12 组在 self 到馆前 15 分钟内错峰到馆并领完全部 12 台（仍属同一参观时段 ±30 分钟）
  const others: Visit[] = Array.from({ length: 12 }, (_, i) => makeVisit(DATE, at - 15 + (i % 3) * 5, party({ borrowWheelchair: true })))
  const p = party({ borrowWheelchair: true })
  const plan = planRoute({ party: p, date: DATE, arrivalMin: at, signals: DEFAULT_SIGNALS, visits: others, staff: STAFF })
  const info = plan.wheelchairInfo!
  assert(!!plan.wheelchairIssue, `库存不足提示：${plan.wheelchairIssue?.slice(0, 24)}…`)
  assert(info.availableAtArrival === 0, `到馆时可立即发放 0 台（实际 ${info.availableAtArrival}）`)
  assert(info.queueIndex >= 1, `当前预约排队第 ${info.queueIndex} 位（期望 ≥1）`)
  assert(info.waitMin > 0 && info.nearestReadyMin != null && info.nearestReadyMin > at, `预计等待 ${info.waitMin} 分钟，${info.nearestReadyMin} 可领`)
  assert(info.demandAtArrival >= 10, `同段（±30 分钟）${info.demandAtArrival} 组同时借用（期望 ≥10）`)
  assert(info.returnEtas.length >= 1, `给出 ${info.returnEtas.length} 条前方设备归还预计`)
  assert(info.returnEtas.every((r) => r.returnMin > at && r.waitMin > 0), '归还预计均晚于到馆时间')
  assert(info.branches.length === 3 && info.branches.every((b) => b.carrier && b.transferMin > 0), '列出 3 个其他馆区的可调设备、搬运耗时与搬运人员')
  assert(info.branchNeeded === 1, '等待较久时提示可调用其他馆区设备')
}

console.log('\n场景 5b：库存充足 → 到馆即可领取，无需排队')
{
  const others: Visit[] = Array.from({ length: 3 }, () => makeVisit(DATE, 10 * 60, party({ borrowWheelchair: true })))
  const plan = planRoute({ party: party({ borrowWheelchair: true }), date: DATE, arrivalMin: 10 * 60, signals: DEFAULT_SIGNALS, visits: others, staff: STAFF })
  const info = plan.wheelchairInfo!
  assert(info.waitMin === 0 && info.queueIndex === 0, `无需排队（等待 ${info.waitMin} 分、位次 ${info.queueIndex}）`)
  assert(info.availableAtArrival >= 8, `到馆可发 ${info.availableAtArrival} 台（期望 ≥8）`)
  assert(!plan.wheelchairIssue, '库存充足时无库存告警')
}

console.log('\n场景 5c：他组轮椅 10:30 前归还 → 11:00 到馆者可立即领取')
{
  const others: Visit[] = Array.from({ length: 10 }, () => makeVisit(DATE, 9 * 60, party({ borrowWheelchair: true })))
  const plan = planRoute({ party: party({ borrowWheelchair: true }), date: DATE, arrivalMin: 11 * 60, signals: DEFAULT_SIGNALS, visits: others, staff: STAFF })
  assert(plan.wheelchairInfo!.waitMin === 0, `晚到组承接归还设备，等待 ${plan.wheelchairInfo!.waitMin} 分钟`)
}

console.log('\n场景 5d：轮椅全部报修/消毒 → 给出抢修等待而非崩溃')
{
  const sig: LiveSignals = { ...DEFAULT_SIGNALS, wheelchairOffset: 12 }
  const plan = planRoute({ party: party({ borrowWheelchair: true }), date: DATE, arrivalMin: 10 * 60, signals: sig, visits: [], staff: STAFF })
  const info = plan.wheelchairInfo!
  assert(!!plan.wheelchairIssue, '无可用设备时给出库存不足协调提示')
  assert(info.waitMin >= 60, `抢修周转等待约 ${info.waitMin} 分钟（期望 ≥60）`)
  assert(info.returnEtas.length === 0, '无在借设备时归还预计为空')
}

console.log('\n场景 5e：协调为自带设备后释放本馆预留，他组排队位次前移')
{
  const at = 10 * 60
  const bringOwn = makeVisit(DATE, at, party({ borrowWheelchair: true, contactName: '自带者' }))
  bringOwn.wheelchairCoord = { resolution: 'bring_own', reason: '电话确认自带', at: new Date().toISOString(), actor: '服务台' }
  const others: Visit[] = [bringOwn, ...Array.from({ length: 11 }, () => makeVisit(DATE, at, party({ borrowWheelchair: true })))]
  const info = wheelchairCoordInfo({ date: DATE, visits: others, signals: DEFAULT_SIGNALS, selfWants: true, selfArrivalMin: at })
  assert(info.demandAtArrival === 12, `同段需求 ${info.demandAtArrival} 组（自带者仍计入并发需求展示）`)
  // 12 台池、11 个本馆需求 → self 视角可满足
  assert(info.waitMin === 0, `自带者不占本馆名额，第 12 组到馆可领（等待 ${info.waitMin} 分）`)
}

console.log('\n场景 5f：跨馆调入满足者不占本馆池，本馆排队不受其影响')
{
  const at = 10 * 60
  const transferred = makeVisit(DATE, at, party({ borrowWheelchair: true, contactName: '调入者' }))
  transferred.wheelchairCoord = { resolution: 'branch_transfer', reason: '跨馆调入', at: new Date().toISOString(), actor: '服务台' }
  const others: Visit[] = [transferred, ...Array.from({ length: 11 }, () => makeVisit(DATE, at, party({ borrowWheelchair: true })))]
  const plan = planRoute({ party: party({ borrowWheelchair: true }), date: DATE, arrivalMin: at, signals: DEFAULT_SIGNALS, visits: others, staff: STAFF })
  assert(plan.wheelchairInfo!.waitMin === 0, `11 个本馆需求 + 1 个跨馆调入：本馆池仍够（等待 ${plan.wheelchairInfo!.waitMin} 分）`)
  assert(!plan.wheelchairIssue, '本馆池未被跨馆调入者占用，无库存告警')
  assert(plan.notices.some((n) => n.includes('同段')), '提示同段借用组数与设备安排')
}

console.log('\n场景 5g：标记"优先借用"的预约在椅子释放时先于同刻普通预约领取')
{
  const at = 10 * 60
  // 9:00 起错峰的 12 组占满全部椅子（10:30 后陆续归还）
  const holders = Array.from({ length: 12 }, (_, i) => makeVisit(DATE, 9 * 60 + i * 2, party({ borrowWheelchair: true })))
  const normal = makeVisit(DATE, at, party({ borrowWheelchair: true, contactName: '普通排队' }))
  const vip = makeVisit(DATE, at, party({ borrowWheelchair: true, contactName: '优先借用' }))
  vip.wheelchairCoord = { resolution: 'priority_loan', reason: '老人不宜久站，电话沟通后优先', at: new Date().toISOString(), actor: '服务台' }
  const all = [...holders, normal, vip]
  const planVip = planRoute({ party: vip.party, date: DATE, arrivalMin: at, signals: DEFAULT_SIGNALS, visits: all, staff: STAFF, selfId: vip.id })
  const planNormal = planRoute({ party: normal.party, date: DATE, arrivalMin: at, signals: DEFAULT_SIGNALS, visits: all, staff: STAFF, selfId: normal.id })
  assert(planVip.wheelchairInfo!.waitMin < planNormal.wheelchairInfo!.waitMin,
    `优先组等待 ${planVip.wheelchairInfo!.waitMin} 分 < 普通组 ${planNormal.wheelchairInfo!.waitMin} 分`)
  assert(planVip.wheelchairInfo!.queueIndex < planNormal.wheelchairInfo!.queueIndex,
    `优先组位次 ${planVip.wheelchairInfo!.queueIndex} 早于普通组 ${planNormal.wheelchairInfo!.queueIndex}`)
}

console.log('\n场景 6：迟到 40 分钟 → 接应时间顺延并重查拥挤')
{
  const sig: LiveSignals = { ...DEFAULT_SIGNALS, lateMin: 40 }
  const p = party()
  const plan = planRoute({ party: p, date: DATE, arrivalMin: 9 * 60 + 30, signals: sig, visits: [], staff: STAFF })
  assert(plan.arrivalMin === 10 * 60 + 10, `实际入馆分钟 ${plan.arrivalMin}（期望 610）`)
  assert(plan.notices.some((n) => n.includes('迟到')), '提示迟到顺延')
}

console.log('\n场景 7：某展厅过度拥挤（人工 88%）→ 自动避让')
{
  const sig: LiveSignals = { ...DEFAULT_SIGNALS, crowdOverride: { hF: 0.88 } }
  const p = party({ hasChild: true }) // 儿童本来优先 hF
  const plan = planRoute({ party: p, date: DATE, arrivalMin: 10 * 60, signals: sig, visits: [], staff: STAFF })
  assert(!plan.stops.some((s) => s.hallId === 'hF'), '自然馆过挤，未排入')
  assert(plan.skipped.some((s) => s.hallId === 'hF' && s.reason.includes('过度拥挤')), '给出拥挤避让原因')
}

console.log('\n场景 8：手语讲解员请假且无冗余 → issue 降级方案')
{
  const sig: LiveSignals = { ...DEFAULT_SIGNALS, staffExtraLeave: ['s1', 's3'] }
  const p = party({ needSign: true })
  const plan = planRoute({ party: p, date: DATE, arrivalMin: 9 * 60 + 30, signals: sig, visits: [], staff: STAFF })
  assert(!!plan.escortIssue && plan.escortIssue.includes('手语'), `降级方案：${plan.escortIssue?.slice(0, 30)}…`)
}

console.log('\n场景 9：讲解员时间冲突 → 自动换班')
{
  const p1 = party({ needSlow: true, usesWheelchair: true })
  const v1 = makeVisit(DATE, 9 * 60 + 30, p1)
  const plan1 = planRoute({ party: p1, date: DATE, arrivalMin: 9 * 60 + 30, signals: DEFAULT_SIGNALS, visits: [], staff: STAFF })
  v1.route = plan1; v1.escortId = plan1.escortId
  const p2 = party({ needSlow: true })
  const plan2 = planRoute({ party: p2, date: DATE, arrivalMin: 9 * 60 + 40, signals: DEFAULT_SIGNALS, visits: [v1], staff: STAFF })
  assert(plan2.escortId !== plan1.escortId, `两组重叠预约分到不同陪同（${plan1.escortName} / ${plan2.escortName ?? '无'}）`)
}

console.log('\n场景 10：观众身体不适 → 缩减路线、加长休息')
{
  const sig: LiveSignals = { ...DEFAULT_SIGNALS, visitorUnwell: true }
  const p = party({ size: 3 })
  const plan = planRoute({ party: p, date: DATE, arrivalMin: 9 * 60 + 30, signals: sig, visits: [], staff: STAFF })
  assert(plan.reduced === true, '标记为缩减路线')
  assert(plan.stops.length <= 2, `最多 ${plan.stops.length} 个展厅（期望 ≤2）`)
  assert(plan.totalDistance <= 400, `步行 ${plan.totalDistance} 米（期望 ≤400）`)
  assert(plan.segments.some((s) => (s.stayMin ?? 0) >= 15), '安排 ≥15 分钟加长休息')
}

console.log('\n场景 11：临时闭馆 → 跳过并说明')
{
  const sig: LiveSignals = { ...DEFAULT_SIGNALS, closedHalls: ['hC'] }
  const plan = planRoute({ party: party(), date: DATE, arrivalMin: 9 * 60 + 30, signals: sig, visits: [], staff: STAFF })
  assert(!plan.stops.some((s) => s.hallId === 'hC'), '陶瓷馆闭馆，未排入')
  assert(plan.skipped.some((s) => s.hallId === 'hC' && s.reason.includes('临时闭馆')), '记录闭馆原因')
}

console.log('\n场景 12：无障碍车位约满（8 组已约）')
{
  const others = Array.from({ length: 8 }, () => makeVisit(DATE, 11 * 60, party({ needParking: true })))
  const plan = planRoute({ party: party({ needParking: true }), date: DATE, arrivalMin: 9 * 60 + 30, signals: DEFAULT_SIGNALS, visits: others, staff: STAFF })
  assert(!!plan.parkingIssue, `车位协调方案：${plan.parkingIssue?.slice(0, 20)}…`)
}

console.log('\n场景 13：陪同人临时增加不影响生成；各段时刻单调递增')
{
  const p = party({ extraCompanions: 3 })
  const plan = planRoute({ party: p, date: DATE, arrivalMin: 9 * 60 + 30, signals: DEFAULT_SIGNALS, visits: [], staff: STAFF })
  const mins = plan.segments.map((s) => s.arriveMin)
  assert(mins.every((m, i) => i === 0 || m >= mins[i - 1]), '路段到达时间单调不减')
  assert(plan.totalMin > 0, '全程时长为正')
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
