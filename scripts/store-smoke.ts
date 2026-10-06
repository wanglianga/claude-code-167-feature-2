// store 运行时冒烟测试（node + localStorage 垫片）
const mem = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k, v) => void mem.set(k, v),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear()
} as unknown as Storage

const { useStore } = await import('../src/store.ts')
const { todayISO } = await import('../src/utils.ts')

let pass = 0, fail = 0
const assert = (c: boolean, m: string) => { c ? (pass++, console.log('  ✅', m)) : (fail++, console.log('  ❌', m)) }

useStore.getState().resetDemo()
useStore.getState().seedDemo()
let st = useStore.getState()
assert(st.visits.length === 10, `seedDemo 生成 10 组今日演示预约（实际 ${st.visits.length}）`)

const today = todayISO()
const id = st.createVisit({
  date: today, arrivalMin: 14 * 60,
  party: {
    contactName: '测试观众', phone: '13900000000', size: 2,
    usesWheelchair: false, borrowWheelchair: true, needSign: false, needSlow: true,
    hasElder: true, hasChild: false, needParking: true, canStandLong: false, extraCompanions: 0
  }
})
st = useStore.getState()
const v0 = st.visits.find((v) => v.id === id)!
assert(!!v0.route && v0.route.version === 1, '新预约生成路线 v1')
assert(v0.events.some((e) => e.type === 'book'), '写入预约事件')
assert(!!v0.route?.parkingSlot && !!v0.route.escortId, '同时排到车位与陪同')

// 电梯故障 → 全局联动重规划
useStore.getState().setGlobalSignals({ elevatorsDown: ['el1'] }, '1号客梯故障演练')
st = useStore.getState()
const v1 = st.visits.find((v) => v.id === id)!
assert(v1.route!.version === 2 && v1.events.some((e) => e.type === 'route_change'), '故障后该预约升级 v2 并留路线调整记录')
assert(!v1.route!.trace.some((t) => t.startsWith('ev1')), 'v2 轨迹不含故障电梯')

// 核验 + 借轮椅
useStore.getState().checkIn(id)
useStore.getState().loanWheelchair(id)
st = useStore.getState()
const v2 = st.visits.find((v) => v.id === id)!
assert(v2.status === 'checked_in', '服务台核验入馆')
assert(v2.loans.length === 1 && !!v2.loans[0].loanedAt, `借出轮椅 ${v2.loans[0]?.assetCode}`)

// 迟到
useStore.getState().setVisitSignals(id, { lateMin: 30 }, '迟到演练')
st = useStore.getState()
const v3 = st.visits.find((v) => v.id === id)!
assert(v3.route!.arrivalMin === 14 * 60 + 30, `接应顺延至 ${v3.route!.arrivalMin}（期望 870）`)

// 身体不适 → 缩减
const before = v3.route!.stops.length
useStore.getState().setVisitSignals(id, { visitorUnwell: true }, '不适演练')
st = useStore.getState()
const v4 = st.visits.find((v) => v.id === id)!
assert(v4.route!.reduced && v4.route!.stops.length <= before, `身体不适后展厅 ${before}→${v4.route!.stops.length}`)

// 陪同人临时增加
useStore.getState().setExtraCompanions(id, 2)
st = useStore.getState()
assert(st.visits.find((v) => v.id === id)!.party.extraCompanions === 2, '临时增加陪同 2 人已入同一服务')

// 突发协助
useStore.getState().recordAssist(id, '三楼坡道协助推行并在休息区测量血压')
st = useStore.getState()
assert(st.visits.find((v) => v.id === id)!.events.some((e) => e.type === 'assist'), '突发协助写入服务记录')

// 归还 + 完成 + 反馈
useStore.getState().returnWheelchair(id, v4.loans[0].id)
useStore.getState().setStatus(id, 'completed')
useStore.getState().addFeedback(id, '偏好慢速讲解，希望下次仍安排王老师')
st = useStore.getState()
const v5 = st.visits.find((v) => v.id === id)!
assert(!!v5.loans[0].returnedAt, '轮椅归还入库有时间戳')
assert(v5.status === 'completed' && v5.feedback?.includes('王老师'), '归档并保留参观后偏好，供下次延续')
assert(v5.events.every((e) => typeof e.text === 'string' && e.ts), `全链路事件 ${v5.events.length} 条均完整`)

// —— 轮椅库存不足协调全链路 ——
const zhao = useStore.getState().visits.find((v) => v.party.contactName === '赵大伯')!
assert(!!zhao, '演示数据含库存紧张时段的借用预约（赵大伯）')
assert((zhao.route!.wheelchairInfo?.waitMin ?? 0) > 0, `赵大伯到馆时段本馆轮椅需等待约 ${zhao.route!.wheelchairInfo?.waitMin} 分钟`)
assert((zhao.route!.wheelchairInfo?.branches.length ?? 0) === 3, '列出其他馆区可调设备')

// 等待期间：座椅、饮水、临时讲解 → 全部写入预约记录
useStore.getState().addWaitingService(zhao.id, 'seat')
useStore.getState().addWaitingService(zhao.id, 'water', '温水')
useStore.getState().addWaitingService(zhao.id, 'guide', '大厅青铜复制品讲解')
st = useStore.getState()
const zhao1 = st.visits.find((v) => v.id === zhao.id)!
assert(zhao1.waitingServices.length === 3, '座椅/饮水/临时讲解 3 次等候服务已记录')
assert(zhao1.events.filter((e) => e.type === 'waiting_service').length === 3, '3 条等候服务事件挂在同一条服务记录')

// 联系观众自带设备并记录原因 → 释放本馆预留并重算
useStore.getState().setWheelchairResolution(zhao.id, 'bring_own', '电话确认观众家中有折叠轮椅，自行带来')
st = useStore.getState()
const zhao2 = st.visits.find((v) => v.id === zhao.id)!
assert(zhao2.wheelchairCoord?.resolution === 'bring_own' && zhao2.wheelchairCoord.reason.includes('折叠轮椅'), '自带设备处置与原因已记录')
assert(zhao2.events.some((e) => e.type === 'wheelchair_coord' && e.text.includes('自带')), '轮椅协调事件写入服务记录')

// 另一组：调整参观时段 → 到馆分钟更新、路线重算
const qin = useStore.getState().visits.find((v) => v.party.contactName === '秦阿姨')!
useStore.getState().setWheelchairResolution(qin.id, 'reschedule', '观众同意错峰至下午', { rescheduleToMin: 13 * 60 + 30 })
st = useStore.getState()
const qin1 = st.visits.find((v) => v.id === qin.id)!
assert(qin1.baseArrivalMin === 13 * 60 + 30, `参观时段调整为 13:30（实际 ${qin1.baseArrivalMin}）`)
assert(qin1.route!.arrivalMin === 13 * 60 + 30, '路线接应时间随时段重算')

// 另一组：优先借用
const he = useStore.getState().visits.find((v) => v.party.contactName === '何女士')!
useStore.getState().setWheelchairResolution(he.id, 'priority_loan', '老人不能久站，电话沟通后给予排队优先')
st = useStore.getState()
assert(st.visits.find((v) => v.id === he.id)!.wheelchairCoord?.resolution === 'priority_loan', '优先借用已登记并记录原因')

// 跨馆调运：请求 → 出发（搬运人员/ETA/等待位置）→ 送达 → 借出调入设备
const gao = useStore.getState().visits.find((v) => v.party.contactName === '高先生')!
useStore.getState().requestBranchTransfer(gao.id, '东馆区（城市分馆）', 'F1 大厅休息区第 3 排')
st = useStore.getState()
const gao1 = st.visits.find((v) => v.id === gao.id)!
assert(!!gao1.branchTransfer && gao1.branchTransfer.assetCode.startsWith('WC-E'), `已发起东馆区调运 ${gao1.branchTransfer?.assetCode}`)
assert(gao1.branchTransfer!.carrier === '郑师傅' && gao1.branchTransfer!.etaMin > gao1.branchTransfer!.requestMin, '记录搬运人员与预计到达时间')
assert(gao1.branchTransfer!.waitLocation?.includes('休息区'), '记录观众当前等待位置')
assert(gao1.events.some((e) => e.type === 'wheelchair_transfer' && e.text.includes('郑师傅')), '调运事件含搬运人员信息')

useStore.getState().setWaitingLocation(gao.id, '一层无障碍卫生间门口休息凳')
useStore.getState().setTransferStatus(gao.id, 'in_transit')
useStore.getState().setTransferStatus(gao.id, 'arrived')
st = useStore.getState()
const gao2 = st.visits.find((v) => v.id === gao.id)!
assert(gao2.branchTransfer!.status === 'arrived' && gao2.branchTransfer!.arriveMin != null, '调运状态推进到已送达并记录实际到达')
assert(gao2.events.some((e) => e.text.includes('卫生间门口休息凳')), '等待位置更新进入服务记录')

useStore.getState().loanWheelchair(gao.id)
st = useStore.getState()
const gao3 = st.visits.find((v) => v.id === gao.id)!
assert(gao3.loans.some((l) => l.assetCode === gao1.branchTransfer!.assetCode && l.branch === '东馆区（城市分馆）'), '借出的即为跨馆调入轮椅且记录来源馆区')
assert(gao3.events.some((e) => e.type === 'wheelchair_loan' && e.text.includes('东馆区')), '借出事件标注调入馆区')

// 演示预约不应被 seed 两次
useStore.getState().seedDemo()
assert(useStore.getState().visits.length === 11, `不重复播种（实际 ${useStore.getState().visits.length}）`)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
