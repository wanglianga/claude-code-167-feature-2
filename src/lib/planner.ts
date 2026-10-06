import { BRANCH_WHEELCHAIRS, EDGES, ELEVATORS, HALLS, HALL_FLOOR_STAFF_CAPACITY, HOURS, NODES, TOTAL_PARKING, TOTAL_WHEELCHAIRS } from '../data/museum'
import type {
  BranchStock, Edge, Floor, GraphNode, HallInfo, HallStop, PartyProfile, RoutePlan, RouteSeg, Staff, Visit, WheelchairPlanInfo, WheelchairReturnEta
} from '../types'
import { fmtMin, uid } from '../utils'

// —— 现场实时信号（工作人员可调整）——
export interface LiveSignals {
  elevatorsDown: string[] // 故障电梯 id
  closedHalls: string[] // 临时闭展 hall id
  crowdOverride: Record<string, number> // 人工设定的拥挤度 0..1
  staffExtraLeave: string[] // 临时请假 staff id
  wheelchairOffset: number // 额外不可用（报修/消毒）为正；提前归还为负
  visitorUnwell: boolean // 观众身体不适 → 缩减路线、加强休息
  lateMin: number // 观众迟到分钟
}

export const DEFAULT_SIGNALS: LiveSignals = {
  elevatorsDown: [],
  closedHalls: [],
  crowdOverride: {},
  staffExtraLeave: [],
  wheelchairOffset: 0,
  visitorUnwell: false,
  lateMin: 0
}

export function signalSnapshot(s: LiveSignals): string {
  return JSON.stringify({
    e: [...s.elevatorsDown].sort(),
    c: [...s.closedHalls].sort(),
    cr: Object.fromEntries(Object.entries(s.crowdOverride).sort()),
    l: [...s.staffExtraLeave].sort(),
    w: s.wheelchairOffset,
    u: s.visitorUnwell
  })
}

const nodeMap = new Map<string, GraphNode>(NODES.map((n) => [n.id, n] as [string, GraphNode]))
const hallMap = new Map<string, HallInfo>(HALLS.map((h) => [h.id, h] as [string, HallInfo]))

const REST_NODE: Record<Floor, string> = { [-1]: 'rB1', 1: 'r1', 2: 'r2', 3: 'r3' }
const WC_NODE: Record<Floor, string> = { [-1]: 'wcB1', 1: 'wc1', 2: 'wc2', 3: 'wc3' }
const HALL_FLOOR: Record<string, Floor> = { hA: -1, hB: -1, hC: 2, hD: 2, hE: 3, hF: 3 }

interface Adj {
  edge: Edge
  to: string
}

function buildAdj(elevatorsDown: string[]): Map<string, Adj[]> {
  const adj = new Map<string, Adj[]>()
  for (const n of NODES) adj.set(n.id, [])
  for (const e of EDGES) {
    if (e.kind === 'elevator' && e.elevatorId && elevatorsDown.includes(e.elevatorId)) continue
    adj.get(e.a)!.push({ edge: e, to: e.b })
    adj.get(e.b)!.push({ edge: e, to: e.a })
  }
  return adj
}

function dijkstra(adj: Map<string, Adj[]>, from: string, to: string): string[] | null {
  if (from === to) return [from]
  const dist = new Map<string, number>([[from, 0]])
  const prev = new Map<string, string>()
  const visited = new Set<string>()
  const nodes = NODES.map((n) => n.id)
  for (let k = 0; k < nodes.length; k++) {
    let u: string | null = null
    let best = Infinity
    for (const id of nodes) {
      if (visited.has(id)) continue
      const d = dist.get(id) ?? Infinity
      if (d < best) { best = d; u = id }
    }
    if (u === null || u === to) break
    visited.add(u)
    for (const { edge, to: v } of adj.get(u)!) {
      const w = edge.kind === 'elevator' ? 14 : edge.distance // 乘梯综合代价（等候+乘坐）
      const nd = (dist.get(u) ?? Infinity) + w
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd)
        prev.set(v, u)
      }
    }
  }
  if (!prev.has(to) && from !== to) return null
  const path = [to]
  let cur = to
  while (cur !== from) {
    cur = prev.get(cur)!
    if (!cur) return null
    path.unshift(cur)
  }
  return path
}

// 确定性拥挤度：日常双峰（10:30 / 14:30）+ 展厅差异 + 人工覆盖
function gauss(x: number, mu: number, sigma: number): number {
  const d = x - mu
  return Math.exp(-(d * d) / (2 * sigma * sigma))
}
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997
  return h
}
export function crowdAt(hallId: string, min: number, override?: Record<string, number>): number {
  if (override && override[hallId] !== undefined) return override[hallId]
  const h = hallMap.get(hallId)!
  const wave = 0.55 + 0.45 * Math.max(gauss(min, 10 * 60 + 30, 55), gauss(min, 14 * 60 + 30, 60))
  const jitter = (hashStr(hallId) % 9) / 100
  return Math.min(0.98, Math.max(0.05, h.popularity * wave + jitter - 0.04))
}

export function crowdLabel(c: number): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  if (c >= 0.8) return { text: '过度拥挤', tone: 'bad' }
  if (c >= 0.6) return { text: '较拥挤', tone: 'warn' }
  if (c >= 0.35) return { text: '适中', tone: 'ok' }
  return { text: '宽松', tone: 'ok' }
}

interface PlanCtx {
  adj: Map<string, Adj[]>
  party: PartyProfile
  signals: LiveSignals
  speed: number // 米/分钟
  lowStamina: boolean
  usesChair: boolean
  walkBudget: number
  notices: string[]
  floorOccupancy: Map<string, number> // floor-window → 已有接应组数
}

type EndpointMeta = { node: string; stay: number; title: string; toilet?: string; rest?: string }

function edgeBetween(path: string[], i: number): Edge {
  return EDGES.find((e) => (e.a === path[i] && e.b === path[i + 1]) || (e.b === path[i] && e.a === path[i + 1]))!
}

/** 把一条节点路径切分为带说明的路段：连续步行合并，连续乘梯合并 */
function legSegments(path: string[], t0: number, ctx: PlanCtx, endpointMeta?: EndpointMeta[]) {
  const segs: RouteSeg[] = []
  const edgeIds: string[] = []
  let t = t0
  let dist = 0

  const runs: string[][] = []
  let run = [path[0]]
  let runClass: 'walk' | 'elev' = edgeBetween(path, 0).kind === 'elevator' ? 'elev' : 'walk'
  for (let i = 0; i < path.length - 1; i++) {
    const cls: 'walk' | 'elev' = edgeBetween(path, i).kind === 'elevator' ? 'elev' : 'walk'
    if (cls !== runClass) {
      runs.push(run)
      run = [path[i]]
      runClass = cls
    }
    run.push(path[i + 1])
  }
  runs.push(run)

  for (const g of runs) {
    const fromId = g[0]
    const toId = g[g.length - 1]
    const via = g.slice(1, -1)
    let d = 0
    let maxSlope: number | undefined
    let elevEdges = 0
    let elevId: string | undefined
    const elevFloorsSet = new Set<Floor>()
    for (let i = 0; i < g.length - 1; i++) {
      const edge = EDGES.find((e) => (e.a === g[i] && e.b === g[i + 1]) || (e.b === g[i] && e.a === g[i + 1]))!
      edgeIds.push(edge.id)
      d += edge.distance
      if (edge.slope !== undefined) maxSlope = Math.max(maxSlope ?? 0, edge.slope)
      if (edge.kind === 'elevator') {
        elevEdges += 1
        elevId = edge.elevatorId
        elevFloorsSet.add(nodeMap.get(g[i])!.floor)
        elevFloorsSet.add(nodeMap.get(g[i + 1])!.floor)
      }
    }
    const elevFloors = Array.from(elevFloorsSet).sort((a, b) => a - b)

    let walkMin: number
    let warning: string | undefined
    let assist: string | undefined
    const kind: RouteSeg['kind'] = elevEdges > 0 ? 'elevator' : maxSlope !== undefined ? 'ramp' : 'flat'
    if (elevEdges > 0) {
      walkMin = 1.5 + 2 * elevEdges // 候梯 + 乘梯
      const evName = ELEVATORS.find((e) => e.id === elevId)?.name ?? '电梯'
      const floorText = elevFloors.map((f) => (f < 0 ? 'B1' : `F${f}`)).join(' → ')
      assist = `乘坐${evName}（${floorText}），陪同人员协助按键、挡门与进出`
      if (elevId && ctx.signals.elevatorsDown.includes(elevId)) warning = '该电梯曾报故障，请现场确认运行状态'
    } else {
      let factor = 1
      if (maxSlope !== undefined && maxSlope >= 6) factor *= ctx.usesChair ? 1.25 : 1.4
      walkMin = d / ctx.speed / factor
      if (maxSlope !== undefined) {
        if (ctx.usesChair) assist = `坡道坡度 ${maxSlope}%，陪同人员推行、上坡注意倒退助力`
        else if (ctx.lowStamina) warning = `坡道坡度 ${maxSlope}%，请扶扶手放慢脚步`
      }
    }
    t += walkMin
    dist += d

    const toNode = nodeMap.get(toId)!
    const isRestNode = toNode.kind === 'rest'
    const isToiletNode = toNode.kind === 'toilet'
    const meta = endpointMeta?.find((x) => x.node === toId)
    segs.push({
      id: uid('seg'),
      from: nodeMap.get(fromId)!.name,
      to: toNode.name,
      via: via.map((v) => nodeMap.get(v)!.name),
      kind,
      distance: Math.round(d),
      maxSlope,
      walkMin: Math.round(walkMin * 10) / 10,
      arriveMin: Math.round(t),
      warning,
      assist,
      isRest: meta?.rest !== undefined || isRestNode,
      restNode: meta?.rest !== undefined || isRestNode ? toNode.name : undefined,
      toiletNode: meta?.toilet !== undefined || isToiletNode ? toNode.name : undefined,
      stayMin: meta?.stay,
      title: meta?.title
    })
    if (meta?.stay) t += meta.stay
  }
  return { segs, t, dist, edgeIds }
}

function pathLeg(ctx: PlanCtx, from: string, to: string, t: number, metas?: EndpointMeta[]) {
  const path = dijkstra(ctx.adj, from, to)
  if (!path) return null
  return legSegments(path, t, ctx, metas)
}

function returnReserve(ctx: PlanCtx, fromHall: string): number {
  const path = dijkstra(ctx.adj, fromHall, 'desk')
  if (!path) return Infinity
  let min = 0
  let d = 0
  for (let i = 0; i < path.length - 1; i++) {
    const edge = edgeBetween(path, i)
    if (edge.kind === 'elevator') min += 3
    else d += edge.distance
  }
  min += d / ctx.speed
  if (ctx.lowStamina) min += 10
  return min
}

// —— 设备 / 车位可用性 ——
// 保守的全天静态口径（角标/预约页用）；精确的到馆时刻排队与归还预计见 wheelchairCoordInfo
export function wheelchairAvailable(signals: LiveSignals, visits: Visit[], date: string, selfId?: string): number {
  const reserved = visits.filter(
    (v) => v.id !== selfId && v.date === date && v.status !== 'cancelled' && v.party.borrowWheelchair
      && v.wheelchairCoord?.resolution !== 'bring_own'
      && v.wheelchairCoord?.resolution !== 'branch_transfer'
  ).length
  const loaned = visits
    .filter((v) => v.id !== selfId && v.date === date && v.status !== 'cancelled')
    .reduce((n, v) => n + v.loans.filter((l) => l.loanedAt && !l.returnedAt).length, 0)
  // 预留者本身包含已借出者，静态口径取两者较大值，避免重复扣减
  return Math.max(0, TOTAL_WHEELCHAIRS - signals.wheelchairOffset - Math.max(reserved, loaned))
}

// 归还后消毒、脚踏/刹车调试的周转时间
const CHAIR_TURN_MIN = 2

interface ChairRow {
  visitId: string
  label: string
  arrival: number
  end: number
  hasChair: boolean // 已手持轮椅（含已到达的跨馆调入）
  external: boolean // 由跨馆调入满足，不占本馆池
  priority: boolean
  assetCode?: string
}

/** 当日轮椅需求行：预约借用（未改为自带）+ 现场已借出（含应急借用） */
function chairRows(visits: Visit[], date: string, lateOf: Record<string, number>): ChairRow[] {
  const rows: ChairRow[] = []
  for (const v of visits) {
    if (v.date !== date || v.status === 'cancelled') continue
    const openLoan = v.loans.find((l) => l.loanedAt && !l.returnedAt)
    const coord = v.wheelchairCoord
    const bringOwn = coord?.resolution === 'bring_own'
    const external = coord?.resolution === 'branch_transfer'
    const wants = v.party.borrowWheelchair && !bringOwn
    if (!wants && !openLoan) continue
    let arrival = v.baseArrivalMin + (lateOf[v.id] ?? 0)
    if (coord?.resolution === 'reschedule' && coord.rescheduleToMin != null) arrival = coord.rescheduleToMin
    const end = v.route ? Math.max(v.route.endMin, arrival + 30) : arrival + 90
    rows.push({
      visitId: v.id,
      label: `${v.party.contactName || '观众'}（${v.code}）`,
      arrival,
      end,
      hasChair: !!openLoan,
      external: external && !openLoan,
      priority: coord?.resolution === 'priority_loan',
      assetCode: openLoan?.assetCode
    })
  }
  return rows
}

/**
 * 轮椅库存协调模拟（按到馆时间轴分配，而非全天静态预留）：
 * 到馆即领 / 排队位次 / 前序归还预计 / 最早可领时间 / 其他馆区可调资源。
 * 被标记"优先借用"的预约在椅子释放时优先获得。
 */
export function wheelchairCoordInfo(opts: {
  date: string
  visits: Visit[]
  signals: LiveSignals
  selfId?: string
  selfWants: boolean
  selfArrivalMin: number
  selfContact?: string
  selfCode?: string
  lateOf?: Record<string, number>
}): WheelchairPlanInfo {
  const { date, visits, signals } = opts
  const lateOf = opts.lateOf ?? {}
  const rows = chairRows(visits.filter((v) => v.id !== opts.selfId), date, lateOf)

  // 合成"当前预约"行（预约页预览时尚未入库；已入库的 self 已被排除，统一在此加入）
  if (opts.selfWants) {
    const selfInStore = opts.selfId ? visits.find((v) => v.id === opts.selfId) : undefined
    const coord = selfInStore?.wheelchairCoord
    const openLoan = selfInStore?.loans.find((l) => l.loanedAt && !l.returnedAt)
    rows.push({
      visitId: opts.selfId ?? '__preview__',
      label: `${opts.selfContact ?? '当前预约'}（${opts.selfCode ?? '预览'}）`,
      arrival: opts.selfArrivalMin,
      end: selfInStore?.route ? Math.max(selfInStore.route.endMin, opts.selfArrivalMin + 30) : opts.selfArrivalMin + 90,
      hasChair: !!openLoan,
      external: coord?.resolution === 'branch_transfer' && !openLoan,
      priority: coord?.resolution === 'priority_loan',
      assetCode: openLoan?.assetCode
    })
  }

  const selfId = opts.selfId ?? (opts.selfWants ? '__preview__' : undefined)
  const inHouse = rows.filter((r) => !r.external)
  const holders = inHouse.filter((r) => r.hasChair)
  let pool = Math.max(0, TOTAL_WHEELCHAIRS - signals.wheelchairOffset - holders.length)

  const arrivals = inHouse
    .filter((r) => !r.hasChair)
    .sort((a, b) => a.arrival - b.arrival)

  // —— 事件轴模拟：到达入队 → 椅子回池 → 按"优先标记、到达先后"分配 ——
  const readyAt = new Map<string, number>()
  const releaseAt = new Map<string, number>()
  for (const h of holders) { readyAt.set(h.visitId, h.arrival); releaseAt.set(h.visitId, h.end + CHAIR_TURN_MIN) }

  const orderKey = (r: ChairRow) => Number(r.priority) * 1e6 - r.arrival // 大者优先
  let ai = 0
  const waiting: ChairRow[] = []
  const heap: Array<{ at: number; row: ChairRow }> = []
  const REPAIR_MIN = 60 // 池内轮椅全部报修/消毒中的抢修周转估算

  while (ai < arrivals.length || waiting.length > 0) {
    const tArr = arrivals[ai]?.arrival
    const tRel = heap[0]?.at
    const t = tArr != null && (tRel == null || tArr <= tRel) ? tArr : tRel!

    while (ai < arrivals.length && arrivals[ai].arrival <= t) waiting.push(arrivals[ai++])
    heap.sort((a, b) => a.at - b.at)
    while (heap[0] && heap[0].at <= t) { pool += 1; heap.shift() }

    if (pool === 0 && heap.length === 0) {
      // 无在借设备可等：全部椅子被报修/消毒占用，按抢修周转依次发放
      waiting.sort((a, b) => orderKey(b) - orderKey(a) || a.label.localeCompare(b.label))
      for (const r of waiting) {
        const ready = t + REPAIR_MIN
        readyAt.set(r.visitId, ready)
        releaseAt.set(r.visitId, ready + (r.end - r.arrival) + CHAIR_TURN_MIN)
      }
      waiting.length = 0
      continue
    }

    while (pool > 0 && waiting.length > 0) {
      waiting.sort((a, b) => orderKey(b) - orderKey(a) || a.label.localeCompare(b.label))
      const r = waiting.shift()!
      pool -= 1
      readyAt.set(r.visitId, t)
      releaseAt.set(r.visitId, t + (r.end - r.arrival) + CHAIR_TURN_MIN)
      heap.push({ at: releaseAt.get(r.visitId)!, row: r })
    }
  }

  // —— 以下均为对"当前预约 self"的视角推导 ——
  const A = opts.selfArrivalMin
  const selfRow = selfId ? inHouse.find((r) => r.visitId === selfId) : undefined
  const selfReady = selfId ? readyAt.get(selfId) : undefined
  const waitMin = selfReady != null ? Math.max(0, Math.round(selfReady - A)) : 0

  // 到馆瞬间仍被他人占用（已发未还）的椅子数 → 可立即发放数
  const occupiedAtArrival = inHouse.filter(
    (r) => r.visitId !== selfId && (readyAt.get(r.visitId) ?? Infinity) <= A && (releaseAt.get(r.visitId) ?? Infinity) > A
  ).length
  const selfFreeAtArrival = selfRow?.hasChair ? 0 : Math.max(0, TOTAL_WHEELCHAIRS - signals.wheelchairOffset - occupiedAtArrival)

  // 排队位次：到馆时已在等候、且先于自己领到椅子的人数 + 1
  let selfQueueIndex = 0
  if (!selfRow?.hasChair && selfReady != null && selfReady > A && selfRow) {
    const ahead = arrivals
      .filter((r) => r.visitId !== selfId && r.arrival <= A && (readyAt.get(r.visitId) ?? Infinity) > A)
      .filter((r) => {
        const ro = readyAt.get(r.visitId)!
        return ro < selfReady || (ro === selfReady && orderKey(r) > orderKey(selfRow))
      }).length
    selfQueueIndex = ahead + 1
  }

  // 排队时前方设备的归还预计（到馆后、自己可领前/同时回池的椅子）
  const returnEtas: WheelchairReturnEta[] = selfQueueIndex > 0 && selfReady != null
    ? inHouse
      .filter((r) => r.visitId !== selfId)
      .map((r) => ({ at: releaseAt.get(r.visitId) ?? r.end + CHAIR_TURN_MIN, row: r }))
      .filter((x) => x.at > A && x.at <= selfReady + 1)
      .sort((a, b) => a.at - b.at || orderKey(b.row) - orderKey(a.row))
      .slice(0, selfQueueIndex)
      .map((x) => ({
        assetCode: x.row.assetCode ?? '预约周转',
        returnMin: Math.round(x.at),
        holder: x.row.label,
        waitMin: Math.max(0, Math.round(x.at - A))
      }))
    : []

  // 到馆时段（±30 分钟）同时需要轮椅的组数（含自己；含跨馆调入满足者，以体现并发需求）
  const demandAtArrival = opts.selfWants
    ? 1 + rows.filter((r) => r.visitId !== selfId && Math.abs(r.arrival - A) <= 30).length
    : rows.filter((r) => Math.abs(r.arrival - A) <= 30).length

  // 其他馆区可调资源（可用余量按日期确定性波动，至少保留 1 台可援）
  const branches: BranchStock[] = BRANCH_WHEELCHAIRS.map((b) => {
    const committed = hashStr(b.branch + date) % Math.max(1, b.total - 1)
    return {
      branch: b.branch,
      available: b.total - committed,
      distanceKm: b.distanceKm,
      transferMin: b.transferMin,
      carrier: b.carrier,
      carrierPhone: b.carrierPhone
    }
  })
  const anyBranch = branches.some((b) => b.available > 0)

  return {
    total: TOTAL_WHEELCHAIRS,
    availableAtArrival: Math.round(selfFreeAtArrival),
    demandAtArrival,
    queueIndex: selfQueueIndex,
    returnEtas,
    nearestReadyMin: selfReady != null ? Math.round(selfReady) : undefined,
    waitMin,
    branches,
    branchNeeded: (!selfRow?.hasChair && waitMin > 15 && anyBranch) ? 1 : 0
  }
}



export function parkingAvailable(visits: Visit[], date: string, selfId?: string): number {
  const used = visits.filter(
    (v) => v.id !== selfId && v.date === date && v.status !== 'cancelled' && v.party.needParking
  ).length
  return Math.max(0, TOTAL_PARKING - used)
}

function staffBusyWindows(v: Visit): Array<[number, number]> {
  if (!v.route) return []
  return [[v.route.arrivalMin - 10, v.route.endMin + 10]]
}

export function pickEscort(
  party: PartyProfile,
  date: string,
  startMin: number,
  endMin: number,
  staff: Staff[],
  visits: Visit[],
  signals: LiveSignals,
  selfId?: string
): { id?: string; name?: string; kind?: '讲解员' | '志愿者'; issue?: string } {
  const need = party.needSign || party.needSlow || party.usesWheelchair || party.borrowWheelchair || !party.canStandLong || party.hasElder
  if (!need) return {}
  const onLeave = (s: Staff) => s.onLeave.includes(date) || signals.staffExtraLeave.includes(s.id)
  const overlap = (s: Staff) =>
    visits.some(
      (v) =>
        v.id !== selfId && v.date === date && v.status !== 'cancelled' && v.escortId === s.id &&
        staffBusyWindows(v).some(([a, b]) => startMin < b && endMin > a)
    )
  const candidates = staff.filter(
    (s) => !onLeave(s) && s.shiftStartMin <= startMin && s.shiftEndMin >= endMin && !overlap(s)
  )
  const score = (s: Staff): number => {
    let x = 0
    if (s.role === '讲解员') x += 3
    if (party.needSign && s.skills.includes('sign')) x += 6
    if (party.needSlow && s.skills.includes('slow')) x += 3
    if ((party.usesWheelchair || party.borrowWheelchair) && s.skills.includes('wheelchair')) x += 3
    if (party.hasChild && s.role === '志愿者') x += 1
    return x
  }

  if (party.needSign) {
    const signer = candidates.filter((s) => s.skills.includes('sign')).sort((a, b) => score(b) - score(a))[0]
    if (signer) return { id: signer.id, name: signer.name, kind: signer.role }
    const reason = staff.some((s) => s.skills.includes('sign') && onLeave(s))
      ? '当日手语讲解员临时请假'
      : '手语讲解员该时段排班已约满'
    const volunteer = candidates.sort((a, b) => score(b) - score(a))[0]
    return {
      id: volunteer?.id, name: volunteer?.name, kind: volunteer?.role,
      issue: `${reason}：改由${volunteer ? volunteer.role + volunteer.name + '陪同并配合图文讲解卡' : '服务台提供图文讲解卡（暂无陪同余量）'}，正式手语讲解建议提前 3 天预约`
    }
  }

  const best = candidates.sort((a, b) => score(b) - score(a))[0]
  if (best) return { id: best.id, name: best.name, kind: best.role }
  return {
    issue: '讲解员当日请假/排班已满，暂无陪同余量：服务台将发放自助讲解器，每层展厅工作人员可提供定点协助'
  }
}

export interface PlanInput {
  party: PartyProfile
  date: string
  arrivalMin: number
  signals: LiveSignals
  visits: Visit[]
  staff: Staff[]
  selfId?: string
  version?: number
  lateByVisit?: Record<string, number> // 当日各预约的迟到分钟（用于库存排队时间轴）
}

export function planRoute(input: PlanInput): RoutePlan {
  const { party, signals, visits, staff, selfId } = input
  const version = input.version ?? 1
  const notices: string[] = []
  const adj = buildAdj(signals.elevatorsDown)

  const usesChair = party.usesWheelchair || party.borrowWheelchair
  const lowStamina = usesChair || !party.canStandLong || party.hasElder
  const speed = usesChair ? 48 : party.needSlow || party.hasElder ? 42 : 60
  const walkBudget = signals.visitorUnwell ? 350 : usesChair ? 2400 : lowStamina ? 700 : 1500

  const ctx: PlanCtx = {
    adj, party, signals, speed, lowStamina, usesChair, walkBudget, notices,
    floorOccupancy: new Map()
  }

  // 已有预约对楼层接应能力的占用
  for (const v of visits) {
    if (v.id === selfId || v.date !== input.date || v.status === 'cancelled' || !v.route) continue
    for (const st of v.route.stops) {
      const f = HALL_FLOOR[st.hallId]
      const key = `${f}:${Math.floor(st.arriveMin / 30)}`
      ctx.floorOccupancy.set(key, (ctx.floorOccupancy.get(key) ?? 0) + 1)
    }
  }

  const arrivalMin = Math.max(HOURS.openMin, input.arrivalMin + signals.lateMin)
  if (signals.lateMin > 0) notices.push(`观众迟到约 ${signals.lateMin} 分钟，已将入馆与各段接应时间顺延，自 ${fmtMin(arrivalMin)} 起算`)
  if (signals.visitorUnwell) notices.push('⚠ 观众反馈身体不适：已缩减为最近的 1–2 个展厅、加长休息，服务台备轮椅与医药箱')

  // —— 轮椅库存（含多预约同时需求的排队/归还/跨馆协调）——
  const wInfo = party.borrowWheelchair
    ? wheelchairCoordInfo({
        date: input.date, visits, signals, selfId,
        selfWants: true,
        selfArrivalMin: arrivalMin,
        selfContact: party.contactName,
        lateOf: { ...(input.lateByVisit ?? {}), ...(selfId ? { [selfId]: signals.lateMin } : {}) }
      })
    : undefined
  const availW = wInfo?.availableAtArrival ?? wheelchairAvailable(signals, visits, input.date, selfId)
  let wheelchairIssue: string | undefined
  const selfVisit = selfId ? visits.find((v) => v.id === selfId) : undefined
  const coordRes = selfVisit?.wheelchairCoord?.resolution
  if (party.borrowWheelchair && coordRes === 'bring_own') {
    notices.push('已与观众确认改用自带轮椅/助行设备，馆方轮椅预留已释放；路线仍按全程无台阶通道生成')
  } else if (party.borrowWheelchair && wInfo) {
    const hasOpenLoan = !!selfVisit?.loans.some((l) => l.loanedAt && !l.returnedAt)
    const tr = selfVisit?.branchTransfer
    if (hasOpenLoan) {
      notices.push('轮椅已借出并在使用中，参观结束请归还服务台')
    } else if (tr && tr.status !== 'cancelled') {
      const stateText = tr.status === 'arrived'
        ? `跨馆调入轮椅 ${tr.assetCode} 已送达服务台，请观众凭预约领取`
        : `跨馆调运进行中：${tr.fromBranch}轮椅 ${tr.assetCode}，搬运人员 ${tr.carrier} 预计 ${fmtMin(tr.etaMin)} 送达（等待位置：${tr.waitLocation ?? '服务台等候区'}）`
      notices.push(stateText)
      if (tr.status !== 'arrived') {
        wheelchairIssue = `本馆轮椅排队等待较长，已调用${tr.fromBranch}设备：${stateText}`
      }
    } else if (wInfo.waitMin === 0) {
      notices.push(`轮椅库存可满足（到馆可发 ${wInfo.availableAtArrival} 台，同段约 ${wInfo.demandAtArrival} 组借用），入馆后在服务台凭证领取`)
    } else {
      const retText = wInfo.returnEtas.length
        ? `前方 ${wInfo.returnEtas.length} 台预计 ${wInfo.returnEtas.map((r) => fmtMin(r.returnMin)).join('/')} 归还`
        : '正在周转消毒'
      wheelchairIssue =
        `馆方轮椅到馆时段紧张：排队第 ${wInfo.queueIndex} 位，预计等待约 ${wInfo.waitMin} 分钟（${fmtMin(wInfo.nearestReadyMin!)} 可领，${retText}）；` +
        (wInfo.branchNeeded
          ? `可调用其他馆区设备（${wInfo.branches.filter((b) => b.available > 0).map((b) => `${b.branch.replace(/（.*?）/, '')}余${b.available}台/${b.transferMin}分钟`).join('、')}）。工作人员将联系确认：自带设备 / 调整时段 / 优先借用，等待期间提供座椅、饮水与临时讲解`
          : '工作人员将联系确认：自带设备 / 调整时段 / 优先借用，等待期间提供座椅、饮水与临时讲解')
      notices.push('⚠ ' + wheelchairIssue)
    }
  }
  if (!party.borrowWheelchair && !party.usesWheelchair && lowStamina) {
    notices.push('温馨提示：根据"不能长时间站立/有老人"的情况，服务台可免费借用轮椅或折叠凳')
  }

  // —— 无障碍车位 ——
  let parkingSlot: string | undefined
  let parkingIssue: string | undefined
  if (party.needParking) {
    const used = TOTAL_PARKING - parkingAvailable(visits, input.date, selfId)
    if (used < TOTAL_PARKING) {
      parkingSlot = `P-${String(used + 1).padStart(2, '0')}`
      notices.push(`无障碍车位已预留：${parkingSlot}（B1 临近电梯）`)
    } else {
      parkingIssue = '近距离无障碍车位已约满：车辆可在正门落客区临时停靠（志愿者接应），社会车位 B2 仍有空余'
      notices.push('⚠ ' + parkingIssue)
    }
  }

  // —— 电梯故障提示 ——
  for (const id of signals.elevatorsDown) {
    const ev = ELEVATORS.find((e) => e.id === id)!
    const other = ELEVATORS.find((e) => e.id !== id)
    notices.push(`⚠ ${ev.name}临时故障，全程改走${other?.name ?? '备用通道'}，部分展厅可能需要绕行`)
  }

  const segs: RouteSeg[] = []
  const stops: HallStop[] = []
  const skipped: Array<{ hallId: string; reason: string }> = []
  const trace: string[] = []
  let t = arrivalMin
  let walkUsed = 0

  // 起点：停车场 → 坡道入口 → 服务台
  let curNode = 'entrance'
  if (party.needParking) {
    const leg = pathLeg(ctx, 'parking', 'entrance', t)
    if (!leg) {
      notices.push('⚠ 停车场通道暂不可用，请由正门落客区进入')
    } else {
      segs.push(...leg.segs); trace.push(...leg.edgeIds); t = leg.t; walkUsed += leg.dist
    }
  }
  const chairReady = wInfo ? wInfo.waitMin === 0 : availW > 0
  const checkinStay = 10 + (party.borrowWheelchair && chairReady ? 5 : 0)
  const inLeg = pathLeg(ctx, curNode, 'desk', t, [
    { node: 'desk', stay: checkinStay, title: '服务台核验预约、安检与设备发放' }
  ])
  if (inLeg) {
    const last = inLeg.segs[inLeg.segs.length - 1]
    if (last) {
      last.assist = `服务台核验预约${party.borrowWheelchair && chairReady ? '、借出轮椅并调试刹车脚踏' : party.borrowWheelchair ? '、登记轮椅排队/协调' : ''}${party.needParking ? '、登记车位' : ''}`
    }
    segs.push(...inLeg.segs); trace.push(...inLeg.edgeIds); t = inLeg.t; walkUsed += inLeg.dist
    curNode = 'desk'
  }

  // —— 展厅选择：按楼层从低到高；带儿童优先自然馆 ——
  const maxHalls = signals.visitorUnwell ? 2 : lowStamina ? 3 : 6
  const order = party.hasChild ? ['hF', 'hA', 'hB', 'hC', 'hD', 'hE'] : ['hA', 'hB', 'hC', 'hD', 'hE', 'hF']
  let hallsDone = 0
  let lastToilet = t

  for (const hallId of order) {
    if (hallsDone >= maxHalls) { skipped.push({ hallId, reason: '体力/时间预算有限，本次从容参观部分展厅，余下展厅欢迎下次再来' }); continue }
    if (signals.closedHalls.includes(hallId)) { skipped.push({ hallId, reason: '该展区临时闭馆（维护/布展）' }); continue }
    const crowdNow0 = crowdAt(hallId, t, signals.crowdOverride)
    if (crowdNow0 >= 0.8) { skipped.push({ hallId, reason: `预计 ${fmtMin(t)} 该展厅过度拥挤（${Math.round(crowdNow0 * 100)}%），已避开并建议错峰` }); continue }

    const f = HALL_FLOOR[hallId]
    const winKey = `${f}:${Math.floor(t / 30)}`
    const cap = HALL_FLOOR_STAFF_CAPACITY[String(f)] ?? 1
    if ((ctx.floorOccupancy.get(winKey) ?? 0) >= cap) {
      skipped.push({ hallId, reason: `该时段 ${f < 0 ? 'B1' : 'F' + f} 楼层接应位已满，为保证陪同质量暂不排入` })
      continue
    }

    // 途经休息点 / 卫生间
    const metas: EndpointMeta[] = []
    const waypoints: string[] = []
    const fromNode = nodeMap.get(curNode)!
    let wpNode = curNode
    if (lowStamina && curNode !== 'desk' && hallsDone >= 1) {
      const r = REST_NODE[fromNode.floor]
      if (dijkstra(adj, curNode, r) && dijkstra(adj, r, hallId)) {
        waypoints.push(r)
        metas.push({ node: r, stay: signals.visitorUnwell ? 15 : 10, title: '坐下休息、补水', rest: r })
        wpNode = r
      }
    }
    if (t - lastToilet > 55 && (lowStamina || party.hasElder || party.hasChild)) {
      const wc = WC_NODE[nodeMap.get(wpNode)!.floor]
      if (dijkstra(adj, wpNode, wc) && dijkstra(adj, wc, hallId)) {
        waypoints.push(wc)
        metas.push({ node: wc, stay: 6, title: '途经无障碍卫生间', toilet: wc })
        wpNode = wc
        lastToilet = t
      }
    }

    // 拼路径
    const probe = (() => {
      let from = curNode
      let tt = t
      let dd = 0
      let all: RouteSeg[] = []
      const ids: string[] = []
      for (const wp of [...waypoints, hallId]) {
        const leg = pathLeg(ctx, from, wp, tt, metas.filter((o) => o.node === wp))
        if (!leg) return null
        all = all.concat(leg.segs); ids.push(...leg.edgeIds); tt = leg.t; dd += leg.dist
        from = wp
      }
      return { all, tt, dd, ids }
    })()
    if (!probe) { skipped.push({ hallId, reason: '电梯临时故障导致无法无障碍到达，绕行后仍不可达' }); continue }

    const hinfo = hallMap.get(hallId)!
    let viewMin = hinfo.viewMin
    if (party.needSlow) viewMin = Math.round(viewMin * 1.3)
    if (party.needSign) viewMin = Math.round(viewMin * 1.15)
    if (crowdNow0 >= 0.6) viewMin = Math.round(viewMin * 1.1)
    const reserve = returnReserve(ctx, hallId)
    if (!Number.isFinite(reserve)) { skipped.push({ hallId, reason: '电梯故障后无返回路线' }); continue }
    if (walkUsed + probe.dd > walkBudget) { skipped.push({ hallId, reason: '继续前往将超出观众可承受步行距离，已优先保证体力' }); continue }
    if (probe.tt + viewMin + reserve > HOURS.closeMin - 10) { skipped.push({ hallId, reason: '闭馆前无法从容参观并返回，建议改约更早时段' }); continue }

    segs.push(...probe.all)
    trace.push(...probe.ids)
    t = probe.tt
    walkUsed += probe.dd
    const arriveHall = Math.round(t)
    t += viewMin
    const crowd = crowdAt(hallId, arriveHall, signals.crowdOverride)
    stops.push({
      hallId,
      arriveMin: arriveHall,
      leaveMin: Math.round(t),
      crowd: Math.round(crowd * 100) / 100,
      assist: `${f < 0 ? 'B1' : 'F' + f} 展厅工作人员在${hinfo.name.split(' · ')[0]}入口接应（预计 ${fmtMin(arriveHall)} 到达）${crowd >= 0.6 ? '；现场较拥挤，协助从无障碍观展位进入' : ''}`
    })
    ctx.floorOccupancy.set(winKey, (ctx.floorOccupancy.get(winKey) ?? 0) + 1)
    segs.push({
      id: uid('seg'), from: hinfo.name, to: hinfo.name, via: [],
      kind: 'flat', distance: 0, walkMin: viewMin, arriveMin: Math.round(t),
      stayMin: viewMin,
      title: `参观讲解${party.needSign ? '（手语）' : party.needSlow ? '（慢速）' : ''}`,
      warning: crowd >= 0.6 ? `展厅拥挤度 ${Math.round(crowd * 100)}%，讲解员控制节奏、安排休息座椅` : undefined
    })
    curNode = hallId
    hallsDone += 1
  }

  // —— 收尾：返回服务台（低体力者途经休息点）——
  if (curNode !== 'desk') {
    const wps: string[] = []
    const ov: EndpointMeta[] = []
    if (lowStamina) {
      const r = REST_NODE[nodeMap.get(curNode)!.floor]
      if (dijkstra(adj, curNode, r) && dijkstra(adj, r, 'desk')) {
        wps.push(r)
        ov.push({ node: r, stay: 8, title: '离馆前休息', rest: r })
      }
    }
    let from = curNode
    for (const wp of [...wps, 'desk']) {
      const leg = pathLeg(ctx, from, wp, t, ov.filter((o) => o.node === wp))
      if (leg) { segs.push(...leg.segs); trace.push(...leg.edgeIds); t = leg.t; walkUsed += leg.dist; from = wp }
    }
    const last = segs[segs.length - 1]
    if (last) last.assist = `返回服务台${party.borrowWheelchair ? '、归还轮椅' : ''}、领取参观纪念与反馈卡`
  }

  // —— 讲解员 / 志愿者排班 ——
  const escort = pickEscort(party, input.date, arrivalMin, Math.round(t), staff, visits, signals, selfId)
  if (escort.id) notices.push(`陪同安排：${escort.kind}${escort.name}（${fmtMin(arrivalMin)}–${fmtMin(Math.round(t))} 全程陪同）`)
  if (escort.issue) notices.push('⚠ ' + escort.issue)

  const totalWalkMin = segs.reduce((n, s) => n + s.walkMin, 0)
  return {
    version,
    generatedAt: new Date().toISOString(),
    arrivalMin: Math.round(arrivalMin),
    startNode: party.needParking ? '无障碍停车场' : '馆前无障碍坡道入口',
    endNode: '一层咨询服务台',
    segments: segs,
    stops,
    skipped,
    trace,
    notices,
    totalDistance: Math.round(walkUsed),
    totalWalkMin: Math.round(totalWalkMin),
    totalMin: Math.round(t - arrivalMin),
    endMin: Math.round(t),
    escortId: escort.id,
    escortKind: escort.kind,
    escortName: escort.name,
    escortIssue: escort.issue,
    parkingSlot,
    parkingIssue,
    wheelchairNeeded: party.borrowWheelchair,
    wheelchairIssue,
    wheelchairInfo: wInfo,
    signals: signalSnapshot(signals),
    reduced: signals.visitorUnwell
  }
}
