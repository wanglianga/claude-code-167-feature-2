import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BRANCH_ASSET_PREFIX, BRANCH_WHEELCHAIRS, STAFF } from './data/museum'
import { planRoute } from './lib/planner'
import type { LiveSignals } from './lib/planner'
import type { EventType, PartyProfile, TransferStatus, Visit, WaitingService } from './types'
import { fmtMin, shortCode, todayISO, uid } from './utils'

export interface GlobalSignals {
  elevatorsDown: string[]
  closedHalls: string[]
  crowdOverride: Record<string, number>
  staffExtraLeave: string[]
  wheelchairOffset: number
}

const DEFAULT_GLOBAL: GlobalSignals = {
  elevatorsDown: [],
  closedHalls: [],
  crowdOverride: {},
  staffExtraLeave: [],
  wheelchairOffset: 0
}

export interface VisitSignals {
  lateMin: number
  visitorUnwell: boolean
}

interface StoreState {
  visits: Visit[]
  global: GlobalSignals
  visitSignals: Record<string, VisitSignals>
  hydrated: boolean

  createVisit: (input: { date: string; arrivalMin: number; party: PartyProfile }) => string
  updateBooking: (id: string, patch: { date?: string; arrivalMin?: number; party?: Partial<PartyProfile> }, cause?: string) => void
  cancelVisit: (id: string) => void
  checkIn: (id: string) => void
  setStatus: (id: string, status: Visit['status']) => void
  loanWheelchair: (id: string) => void
  returnWheelchair: (id: string, loanId: string) => void
  setWheelchairResolution: (
    id: string,
    resolution: 'bring_own' | 'reschedule' | 'priority_loan',
    reason: string,
    opts?: { rescheduleToMin?: number }
  ) => void
  requestBranchTransfer: (id: string, branch: string, waitLocation: string) => void
  setTransferStatus: (id: string, status: TransferStatus) => void
  setWaitingLocation: (id: string, location: string) => void
  addWaitingService: (id: string, kind: WaitingService['kind'], note?: string) => void
  replanBorrowers: (date: string, cause: string, excludeId?: string) => void
  assignEscort: (id: string, staffId: string) => void
  addEvent: (id: string, type: EventType, text: string, actor?: string) => void
  recordAssist: (id: string, text: string) => void
  setGlobalSignals: (patch: Partial<GlobalSignals>, cause: string) => void
  setVisitSignals: (id: string, patch: Partial<VisitSignals>, cause: string) => void
  setExtraCompanions: (id: string, n: number) => void
  addFeedback: (id: string, text: string) => void
  resetDemo: () => void
  seedDemo: () => void
}

function mergeSignals(global: GlobalSignals, vs?: VisitSignals): LiveSignals {
  return {
    elevatorsDown: global.elevatorsDown,
    closedHalls: global.closedHalls,
    crowdOverride: global.crowdOverride,
    staffExtraLeave: global.staffExtraLeave,
    wheelchairOffset: global.wheelchairOffset,
    lateMin: vs?.lateMin ?? 0,
    visitorUnwell: vs?.visitorUnwell ?? false
  }
}

function addEvent(visit: Visit, type: EventType, text: string, actor = '系统'): Visit {
  return {
    ...visit,
    events: [...visit.events, { id: uid('ev'), ts: new Date().toISOString(), type, actor, text }]
  }
}

function lateMapOf(state: StoreState, date: string): Record<string, number> {
  const m: Record<string, number> = {}
  for (const v of state.visits) {
    if (v.date === date) m[v.id] = state.visitSignals[v.id]?.lateMin ?? 0
  }
  return m
}

function replanWithin(state: StoreState, visit: Visit, vs: VisitSignals | undefined, cause: string): Visit {
  const plan = planRoute({
    party: visit.party,
    date: visit.date,
    arrivalMin: visit.baseArrivalMin,
    signals: mergeSignals(state.global, vs),
    visits: state.visits,
    staff: STAFF,
    selfId: visit.id,
    version: visit.route ? visit.route.version + 1 : 1,
    lateByVisit: lateMapOf(state, visit.date)
  })
  let next: Visit = { ...visit, route: plan, escortId: plan.escortId }
  if (cause) next = addEvent(next, 'route_change', `路线 v${plan.version}：${cause}`, '调度台')
  return next
}

function makeVisit(state: StoreState, date: string, arrivalMin: number, party: PartyProfile): Visit {
  const id = uid('v')
  const plan = planRoute({
    party, date, arrivalMin,
    signals: mergeSignals(state.global),
    visits: state.visits, staff: STAFF, selfId: id,
    lateByVisit: lateMapOf(state, date)
  })
  const visit: Visit = {
    id, code: shortCode(), date, baseArrivalMin: arrivalMin, status: 'booked', party, route: plan,
    escortId: plan.escortId, loans: [], waitingServices: [],
    events: [{ id: uid('ev'), ts: new Date().toISOString(), type: 'book', actor: '观众', text: `提交预约：${party.size} 人，${date} 到馆` }],
    createdAt: new Date().toISOString()
  }
  return visit
}

/** 只重算路线（含轮椅协调提示），不升版本、不追加路线变更事件 */
function replanSilent(state: StoreState, visit: Visit, vs: VisitSignals | undefined): Visit {
  const plan = planRoute({
    party: visit.party,
    date: visit.date,
    arrivalMin: visit.baseArrivalMin,
    signals: mergeSignals(state.global, vs),
    visits: state.visits,
    staff: STAFF,
    selfId: visit.id,
    version: visit.route?.version ?? 1,
    lateByVisit: lateMapOf(state, visit.date)
  })
  return { ...visit, route: plan, escortId: plan.escortId }
}

function emptyParty(): PartyProfile {  return {
    contactName: '', phone: '', size: 1,
    usesWheelchair: false, borrowWheelchair: false,
    needSign: false, needSlow: false,
    hasElder: false, hasChild: false,
    needParking: false, canStandLong: true, extraCompanions: 0
  }
}

export { emptyParty }

const SEED_FLAG = 'museum_seed_v1'

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      visits: [],
      global: DEFAULT_GLOBAL,
      visitSignals: {},
      hydrated: false,

      createVisit: ({ date, arrivalMin, party }) => {
        const v = makeVisit(get(), date, arrivalMin, party)
        let visit = addEvent(v, 'note', `系统生成无障碍路线 v1：${v.route?.stops.length ?? 0} 个展厅、约 ${v.route?.totalDistance ?? 0} 米`, '系统')
        if (v.route?.parkingSlot) visit = addEvent(visit, 'parking', `预留无障碍车位 ${v.route.parkingSlot}`, '服务台')
        if (v.route?.escortId) visit = addEvent(visit, 'escort_assign', `已排班：${v.route.escortKind}${v.route.escortName}`, '调度台')
        set((s) => ({ visits: [...s.visits, visit] }))
        return v.id
      },

      updateBooking: (id, patch, cause) => {
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id) return v
            const next: Visit = {
              ...v,
              date: patch.date ?? v.date,
              baseArrivalMin: patch.arrivalMin ?? v.baseArrivalMin,
              party: { ...v.party, ...patch.party }
            }
            return replanWithin({ ...s, visits: s.visits }, next, s.visitSignals[id], cause ?? '预约信息变更，已重新核算路线与排班')
          })
        }))
      },

      cancelVisit: (id) => {
        set((s) => ({
          visits: s.visits.map((v) => (v.id === id ? addEvent({ ...v, status: 'cancelled' }, 'note', '预约已取消', '观众') : v))
        }))
      },

      checkIn: (id) => {
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id) return v
            let next = addEvent({ ...v, status: 'checked_in' }, 'checkin', '服务台核验预约、核验身份与安检通过', '服务台')
            if (v.party.needParking && v.route?.parkingSlot) next = addEvent(next, 'parking', `车位 ${v.route.parkingSlot} 已确认入场`, '门岗')
            if (v.route?.escortId) {
              const st = STAFF.find((x) => x.id === v.route!.escortId)
              next = addEvent(next, 'escort_assign', `${v.route.escortKind}${v.route.escortName ?? st?.name ?? ''}已到服务台对接`, '调度台')
            }
            return next
          })
        }))
      },

      setStatus: (id, status) => {
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id) return v
            let next: Visit = { ...v, status }
            if (status === 'completed') next = addEvent(next, 'complete', '参观结束，服务记录归档，欢迎下次再来', '服务台')
            if (status === 'visiting') next = addEvent(next, 'note', '正式开始参观，各楼层工作人员按预计到达时间接应', '讲解员')
            return next
          })
        }))
      },

      loanWheelchair: (id) => {
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id) return v
            const inbound = v.branchTransfer
            const code = inbound?.assetCode ?? 'WC-' + Math.random().toString(36).slice(2, 6).toUpperCase()
            const loan = {
              id: uid('loan'), assetCode: code, loanedAt: new Date().toISOString(),
              branch: inbound?.fromBranch
            }
            let next: Visit = { ...v, loans: [...v.loans, loan] }
            next = addEvent(next, 'wheelchair_loan', `借出轮椅 ${code}${inbound ? `（${inbound.fromBranch}调入）` : ''}，已协助调节脚踏、刹车并示范`, '服务台')
            return next
          })
        }))
      },

      returnWheelchair: (id, loanId) => {
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id) return v
            const loan = v.loans.find((l) => l.id === loanId)
            if (!loan || loan.returnedAt) return v
            let next: Visit = {
              ...v,
              loans: v.loans.map((l) => (l.id === loanId ? { ...l, returnedAt: new Date().toISOString() } : l))
            }
            next = addEvent(next, 'wheelchair_return', `轮椅 ${loan.assetCode}${loan.branch ? `（${loan.branch}调入）` : ''} 已归还并检查入库`, '服务台')
            return next
          })
        }))
      },

      setWheelchairResolution: (id, resolution, reason, opts) => {
        const v0 = get().visits.find((v) => v.id === id)
        if (!v0) return
        const rescheduleToMin = resolution === 'reschedule' ? opts?.rescheduleToMin : undefined
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id) return v
            const coord: Visit['wheelchairCoord'] = {
              resolution,
              reason: reason.trim() || '未填写原因',
              at: new Date().toISOString(),
              actor: '服务台',
              rescheduleToMin
            }
            const baseArrivalMin = rescheduleToMin ?? v.baseArrivalMin
            const labelMap = {
              bring_own: '联系观众自带轮椅/助行设备',
              reschedule: `与观众协商调整参观时段至 ${fmtMin(rescheduleToMin ?? v.baseArrivalMin)}`,
              priority_loan: '安排优先借用（排队优先发放/优先安排跨馆调入）'
            } as const
            let next: Visit = {
              ...v,
              baseArrivalMin,
              wheelchairCoord: coord
            }
            next = addEvent(next, 'wheelchair_coord', `${labelMap[resolution]}；原因记录：${coord.reason}`, '服务台')
            const vs = s.visitSignals[id]
            return replanWithin(
              { ...s, visits: s.visits.map((x) => (x.id === id ? next : x)) },
              next,
              resolution === 'reschedule' ? { lateMin: 0, visitorUnwell: vs?.visitorUnwell ?? false } : vs,
              resolution === 'reschedule'
                ? '观众同意调整参观时段，接应时间、轮椅排队与排班已重新核算'
                : resolution === 'bring_own'
                  ? '观众改为自带设备，馆方轮椅预留释放，库存与排队已重新核算'
                  : '已登记优先借用，轮椅排队顺序已提前并重算库存协调'
            )
          }),
          // 调整时段即视为迟到报备失效
          ...(resolution === 'reschedule' && get().visitSignals[id]
            ? { visitSignals: { ...get().visitSignals, [id]: { ...get().visitSignals[id]!, lateMin: 0 } } }
            : {})
        }))
        get().replanBorrowers(v0.date, `「${v0.party.contactName}」轮椅协调结论更新，当日借用排队已重新核算`, id)
      },

      requestBranchTransfer: (id, branchName, waitLocation) => {
        const info = BRANCH_WHEELCHAIRS.find((b) => b.branch === branchName)
        const v0 = get().visits.find((v) => v.id === id)
        if (!info || !v0) return
        const now = new Date()
        const nowMin = now.getHours() * 60 + now.getMinutes()
        const n = (get().visits.reduce((c, v) => c + (v.branchTransfer ? 1 : 0), 0) % 9) + 1
        const assetCode = `${BRANCH_ASSET_PREFIX[info.branch] ?? 'WC-X'}${String(100 + nowMin % 80 + n).padStart(3, '0')}`
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id) return v
            const transfer: Visit['branchTransfer'] = {
              id: uid('tr'),
              fromBranch: info.branch,
              assetCode,
              carrier: info.carrier,
              carrierPhone: info.carrierPhone,
              requestMin: nowMin,
              etaMin: nowMin + info.transferMin,
              status: 'requested',
              waitLocation: waitLocation.trim() || '一层服务台等候区'
            }
            let next: Visit = {
              ...v,
              branchTransfer: transfer,
              wheelchairCoord: {
                resolution: 'branch_transfer',
                reason: v.wheelchairCoord?.reason || '本馆轮椅到馆时段无法满足，启动馆际调拨',
                at: new Date().toISOString(),
                actor: '服务台'
              }
            }
            next = addEvent(next, 'wheelchair_coord', `确认调用其他馆区设备：${info.branch}轮椅 ${assetCode}；原因：${next.wheelchairCoord!.reason}`, '服务台')
            next = addEvent(
              next,
              'wheelchair_transfer',
              `已发起跨馆调运：搬运人员 ${info.carrier}（${info.carrierPhone}）从${info.branch}（${info.distanceKm} 公里）取送，预计 ${fmtMin(transfer.etaMin)} 到达一层服务台；观众当前等待位置：${transfer.waitLocation}`,
              '调度台'
            )
            return next
          })
        }))
        // 跨馆调入走独立通道：目标预约刷新提示（不升路线版本），其他借用预约仅在排队变化时重算
        const after = get()
        const target = after.visits.find((v) => v.id === id)!
        const targetReplanned = replanSilent(after, target, after.visitSignals[id])
        set((s) => ({ visits: s.visits.map((v) => (v.id === id ? targetReplanned : v)) }))
        get().replanBorrowers(v0.date, `馆际调运设备在途（${assetCode}），当日借用排队已重新核算`, id)
      },

      setTransferStatus: (id, status) => {
        const v0 = get().visits.find((v) => v.id === id)
        if (!v0?.branchTransfer) return
        const tr = v0.branchTransfer
        const now = new Date()
        const nowMin = now.getHours() * 60 + now.getMinutes()
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id || !v.branchTransfer) return v
            let next: Visit = {
              ...v,
              branchTransfer: status === 'arrived'
                ? { ...v.branchTransfer, status, arriveMin: nowMin }
                : { ...v.branchTransfer, status }
            }
            if (status === 'in_transit') {
              next = addEvent(next, 'wheelchair_transfer', `搬运人员 ${tr.carrier} 已取到轮椅 ${tr.assetCode} 并出发，预计 ${fmtMin(tr.etaMin)} 到达服务台；观众等待位置：${tr.waitLocation ?? '服务台等候区'}`, `${tr.fromBranch}`)
            } else if (status === 'arrived') {
              next = addEvent(next, 'wheelchair_transfer', `跨馆调入轮椅 ${tr.assetCode} 已于 ${fmtMin(nowMin)} 送达一层服务台，可通知在${tr.waitLocation ?? '等候区'}等待的观众前来领取`, '服务台')
            } else if (status === 'cancelled') {
              next = addEvent(next, 'wheelchair_transfer', `跨馆调运 ${tr.assetCode} 已取消，设备退回${tr.fromBranch}`, '调度台')
              next = {
                ...next,
                wheelchairCoord: { resolution: 'pending', reason: '原跨馆调运已取消，需重新协调', at: new Date().toISOString(), actor: '服务台' }
              }
            } else if (status === 'requested') {
              next = addEvent(next, 'wheelchair_transfer', `已重新发起 ${tr.assetCode} 的调运请求`, '调度台')
            }
            return next
          })
        }))
        if (status === 'cancelled') {
          const after = get()
          const target = after.visits.find((v) => v.id === id)!
          const replanned = replanWithin(after, target, after.visitSignals[id], '跨馆调运取消，轮椅协调方案与排队已重新核算')
          set((s) => ({ visits: s.visits.map((v) => (v.id === id ? replanned : v)) }))
          get().replanBorrowers(v0.date, '一笔跨馆轮椅调运取消，当日借用排队已重新核算', id)
        } else {
          // 运送状态变化（出发/送达）：静默刷新目标预约的协调提示
          const after = get()
          const target = after.visits.find((v) => v.id === id)!
          const replanned = replanSilent(after, target, after.visitSignals[id])
          set((s) => ({ visits: s.visits.map((v) => (v.id === id ? replanned : v)) }))
        }
      },

      setWaitingLocation: (id, location) => {
        const loc = location.trim()
        if (!loc) return
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id || !v.branchTransfer) return v
            const next: Visit = { ...v, branchTransfer: { ...v.branchTransfer, waitLocation: loc } }
            return addEvent(next, 'wheelchair_transfer', `更新观众当前等待位置：${loc}（搬运人员 ${v.branchTransfer.carrier} 与服务台据此对接）`, '服务台')
          })
        }))
      },

      addWaitingService: (id, kind, note) => {
        const label = { seat: '提供休息座椅', water: '提供饮用水', guide: '安排临时讲解' } as const
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id) return v
            const ws: WaitingService = { id: uid('ws'), kind, note: note?.trim() || undefined, at: new Date().toISOString() }
            const text = `等待轮椅期间服务台${label[kind]}${note?.trim() ? `（${note.trim()}）` : ''}，已计入本次预约记录`
            let next: Visit = { ...v, waitingServices: [...v.waitingServices, ws] }
            next = addEvent(next, 'waiting_service', text, '服务台')
            return next
          })
        }))
      },

      assignEscort: (id, staffId) => {
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id || !v.route) return v
            const st = STAFF.find((x) => x.id === staffId)
            if (!st) return v
            const route = { ...v.route, escortId: st.id, escortName: st.name, escortKind: st.role, escortIssue: undefined }
            let next: Visit = { ...v, route, escortId: st.id }
            next = addEvent(next, 'escort_assign', `人工改派：${st.role}${st.name} 全程陪同`, '调度台')
            return next
          })
        }))
      },

      addEvent: (id, type, text, actor) => {
        set((s) => ({ visits: s.visits.map((v) => (v.id === id ? addEvent(v, type, text, actor ?? '工作人员') : v)) }))
      },

      recordAssist: (id, text) => {
        set((s) => ({ visits: s.visits.map((v) => (v.id === id ? addEvent(v, 'assist', text, '展厅工作人员') : v)) }))
      },

      setGlobalSignals: (patch, cause) => {
        const global = { ...get().global, ...patch }
        // 受影响（未取消、未完成）的预约全部重算
        const affected = get().visits.filter((v) => v.status !== 'cancelled' && v.status !== 'completed')
        const interim: StoreState = { ...get(), global, visits: get().visits }
        const byId = new Map(affected.map((v) => [v.id, replanWithin(interim, v, get().visitSignals[v.id], cause)]))
        set((s) => ({
          global,
          visits: s.visits.map((v) => byId.get(v.id) ?? v)
        }))
      },

      // 轮椅协调结论变化后，仅重算当日其他借用预约；且排队信息确实变化时才升版本/留痕
      replanBorrowers: (date, cause, excludeId) => {
        const s0 = get()
        const targets = s0.visits.filter(
          (v) => v.date === date && v.id !== excludeId && v.status !== 'cancelled' && v.status !== 'completed'
            && v.party.borrowWheelchair && v.wheelchairCoord?.resolution !== 'bring_own'
        )
        const byId = new Map<string, Visit>()
        for (const v of targets) {
          const next = replanWithin({ ...s0, visits: s0.visits }, v, s0.visitSignals[v.id], cause)
          const a = v.route
          const b = next.route
          const changed = !a || !b ||
            a.wheelchairInfo?.queueIndex !== b.wheelchairInfo?.queueIndex ||
            a.wheelchairInfo?.waitMin !== b.wheelchairInfo?.waitMin ||
            a.wheelchairInfo?.nearestReadyMin !== b.wheelchairInfo?.nearestReadyMin ||
            !!a.wheelchairIssue !== !!b.wheelchairIssue
          // 未实质变化：保留原版本、原事件，只刷新协调快照（去掉 replanWithin 末尾追加的路线变更事件）
          byId.set(v.id, changed
            ? next
            : { ...v, route: { ...b, version: a.version, generatedAt: a.generatedAt }, events: next.events.slice(0, -1) })
        }
        if (byId.size === 0) return
        set((s) => ({ visits: s.visits.map((v) => byId.get(v.id) ?? v) }))
      },

      setVisitSignals: (id, patch, cause) => {
        set((s) => {
          const prev = s.visitSignals[id] ?? { lateMin: 0, visitorUnwell: false }
          const vs: VisitSignals = { ...prev, ...patch }
          const visitSignals = { ...s.visitSignals, [id]: vs }
          const target = s.visits.find((v) => v.id === id)
          if (!target || target.status === 'cancelled') return { visitSignals }
          const replanned = replanWithin({ ...s, visitSignals }, target, vs, cause)
          return { visitSignals, visits: s.visits.map((v) => (v.id === id ? replanned : v)) }
        })
      },

      setExtraCompanions: (id, n) => {
        const v = get().visits.find((x) => x.id === id)
        if (!v) return
        get().updateBooking(id, { party: { extraCompanions: Math.max(0, n) } }, `陪同人员临时${n > (v.party.extraCompanions ?? 0) ? '增加' : '调整'}为 ${n} 人，已复核队伍规模与接应安排`)
      },

      addFeedback: (id, text) => {
        set((s) => ({
          visits: s.visits.map((v) => (v.id === id ? addEvent({ ...v, feedback: text }, 'note', `参观后反馈与偏好记录：${text}`, '观众') : v))
        }))
      },

      resetDemo: () => {
        localStorage.removeItem(SEED_FLAG)
        set({ visits: [], global: DEFAULT_GLOBAL, visitSignals: {} })
      },

      seedDemo: () => {
        if (localStorage.getItem(SEED_FLAG) || get().visits.length > 0) return
        const today = todayISO()
        // 演示场景：12 台轮椅中 7 台季度检修/深度消毒，叠加多组同时借用，形成库存不足协调
        const seedGlobal: GlobalSignals = { ...DEFAULT_GLOBAL, wheelchairOffset: 7 }
        const state0: StoreState = { ...get(), visits: [], global: seedGlobal }
        const nowIso = () => new Date().toISOString()
        const mk = (arrival: number, party: PartyProfile, status: Visit['status'], mutate?: (v: Visit) => Visit): Visit => {
          const v = makeVisit({ ...state0, visits: state0.visits }, today, arrival, party)
          state0.visits = [...state0.visits, v]
          let next = v
          if (status === 'checked_in' || status === 'visiting' || status === 'completed') {
            next = addEvent({ ...next, status: status === 'completed' ? 'completed' : status }, 'checkin', '服务台核验预约、安检通过', '服务台')
          }
          if (status === 'visiting') next = addEvent(next, 'note', '已开始参观', '讲解员')
          if (status === 'completed') next = addEvent(next, 'complete', '参观结束并归档', '服务台')
          if (mutate) next = mutate(next)
          state0.visits[state0.visits.length - 1] = next
          return next
        }
        mk(9 * 60 + 30, {
          ...emptyParty(), contactName: '张女士', phone: '13800000219', size: 2,
          borrowWheelchair: true, needSlow: true, hasElder: true, needParking: true, canStandLong: false
        }, 'checked_in', (v) => {
          let n = v
          const loan = { id: uid('loan'), assetCode: 'WC-1042', loanedAt: nowIso() }
          n = { ...n, loans: [loan] }
          n = addEvent(n, 'wheelchair_loan', '借出轮椅 WC-1042', '服务台')
          return n
        })
        // 早班已在借的两组（用于产生"归还预计时间"）
        mk(9 * 60 + 0, {
          ...emptyParty(), contactName: '孙老师团', phone: '13600007710', size: 1,
          borrowWheelchair: true
        }, 'visiting', (v) => {
          let n: Visit = { ...v, loans: [{ id: uid('loan'), assetCode: 'WC-1018', loanedAt: nowIso() }] }
          n = addEvent(n, 'wheelchair_loan', '借出轮椅 WC-1018（晨练时段团体借用）', '服务台')
          return n
        })
        mk(9 * 60 + 20, {
          ...emptyParty(), contactName: '郭爷爷', phone: '13600007724', size: 2,
          borrowWheelchair: true, hasElder: true, canStandLong: false
        }, 'checked_in', (v) => {
          let n: Visit = { ...v, loans: [{ id: uid('loan'), assetCode: 'WC-2077', loanedAt: nowIso() }] }
          n = addEvent(n, 'wheelchair_loan', '借出轮椅 WC-2077', '服务台')
          return n
        })
        // 到馆即领（库存紧张下仍有少量周转）
        mk(9 * 60 + 40, {
          ...emptyParty(), contactName: '何女士', phone: '13600007731', size: 2,
          borrowWheelchair: true, hasElder: true
        }, 'booked')
        mk(9 * 60 + 50, {
          ...emptyParty(), contactName: '高先生', phone: '13600007748', size: 1,
          borrowWheelchair: true
        }, 'booked')
        // 钱奶奶：已发起跨馆调运、在等待区接受临时服务
        mk(9 * 60 + 50, {
          ...emptyParty(), contactName: '钱奶奶', phone: '13600007755', size: 2,
          borrowWheelchair: true, hasElder: true, canStandLong: false
        }, 'booked', (v) => {
          let n: Visit = {
            ...v,
            wheelchairCoord: { resolution: 'branch_transfer', reason: '本馆轮椅预计等待超 40 分钟，观众不宜久站，经电话确认同意调用东馆区设备', at: nowIso(), actor: '服务台' },
            branchTransfer: {
              id: uid('tr'), fromBranch: '东馆区（城市分馆）', assetCode: 'WC-E106',
              carrier: '郑师傅', carrierPhone: '135-0011-2201',
              requestMin: 9 * 60 + 35, etaMin: 10 * 60 + 0, status: 'in_transit',
              waitLocation: '一层大厅休息区（靠服务台第 2 排座椅）'
            },
            waitingServices: [
              { id: uid('ws'), kind: 'seat', at: nowIso() },
              { id: uid('ws'), kind: 'water', note: '温水', at: nowIso() },
              { id: uid('ws'), kind: 'guide', note: '志愿者先讲解大厅青铜复制品', at: nowIso() }
            ]
          }
          n = addEvent(n, 'wheelchair_coord', '确认调用其他馆区设备：东馆区（城市分馆）轮椅 WC-E106；原因：本馆轮椅预计等待超 40 分钟，观众不宜久站，经电话确认同意调用东馆区设备', '服务台')
          n = addEvent(n, 'wheelchair_transfer', '搬运人员 郑师傅 已取到轮椅 WC-E106 并出发，预计 10:00 到达服务台；观众等待位置：一层大厅休息区（靠服务台第 2 排座椅）', '东馆区（城市分馆）')
          n = addEvent(n, 'waiting_service', '等待轮椅期间服务台提供休息座椅，已计入本次预约记录', '服务台')
          n = addEvent(n, 'waiting_service', '等待轮椅期间服务台提供饮用水（温水），已计入本次预约记录', '服务台')
          n = addEvent(n, 'waiting_service', '等待轮椅期间服务台安排临时讲解（志愿者先讲解大厅青铜复制品），已计入本次预约记录', '服务台')
          return n
        })
        // 赵大伯：10:00 到馆，本馆排队待协调（面板主演示对象）
        mk(10 * 60 + 0, {
          ...emptyParty(), contactName: '赵大伯', phone: '13600007762', size: 2,
          borrowWheelchair: true, hasElder: true, canStandLong: false
        }, 'booked')
        mk(10 * 60 + 10, {
          ...emptyParty(), contactName: '秦阿姨', phone: '13600007779', size: 3,
          borrowWheelchair: true, hasElder: true, hasChild: true
        }, 'booked')
        mk(10 * 60 + 0, {
          ...emptyParty(), contactName: '林先生', phone: '13900008851', size: 3,
          usesWheelchair: true, needSign: true, hasChild: false, canStandLong: true
        }, 'booked')
        mk(11 * 60 + 15, {
          ...emptyParty(), contactName: '吴阿姨', phone: '13700003340', size: 4,
          needSlow: true, hasElder: true, hasChild: true, canStandLong: false
        }, 'booked')
        // 跨馆调入等协调状态是在成约后写入的，需据此重算一次路线提示
        state0.visits = state0.visits.map((v) => {
          if (!v.wheelchairCoord || v.status === 'cancelled') return v
          const plan = planRoute({
            party: v.party, date: v.date, arrivalMin: v.baseArrivalMin,
            signals: mergeSignals(seedGlobal), visits: state0.visits, staff: STAFF, selfId: v.id
          })
          return { ...v, route: plan, escortId: plan.escortId }
        })
        set({ visits: state0.visits, global: seedGlobal })
        localStorage.setItem(SEED_FLAG, '1')
      }
    }),
    {
      name: 'museum-access-visit-v2',
      partialize: (s) => ({ visits: s.visits, global: s.global, visitSignals: s.visitSignals }),
      onRehydrateStorage: () => (state) => {
        state?.seedDemo()
      }
    }
  )
)
