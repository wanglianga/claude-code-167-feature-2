// 领域模型：一次无障碍参观服务涉及的预约、路线、设备、人员与服务记录

export type Floor = -1 | 1 | 2 | 3

export type NodeKind =
  | 'entrance'
  | 'desk'
  | 'hall'
  | 'elevator'
  | 'rest'
  | 'toilet'
  | 'parking'
  | 'stairs'
  | 'ramp'

export interface GraphNode {
  id: string
  name: string
  floor: Floor
  x: number
  y: number
  kind: NodeKind
}

export interface Edge {
  id: string
  a: string
  b: string
  kind: 'flat' | 'ramp' | 'elevator' | 'stairs'
  distance: number // 米
  slope?: number // 百分比，坡道用
  elevatorId?: string
}

export interface HallInfo {
  id: string
  name: string
  theme: string
  viewMin: number
  popularity: number
}

export interface ElevatorInfo {
  id: string
  name: string
  floors: Floor[]
}

export interface PartyProfile {
  contactName: string
  phone: string
  size: number // 参观人数
  usesWheelchair: boolean // 自带/使用轮椅
  borrowWheelchair: boolean // 向馆方借用轮椅
  needSign: boolean // 手语讲解
  needSlow: boolean // 慢速讲解
  hasElder: boolean
  hasChild: boolean
  needParking: boolean // 近距离（无障碍）车位
  canStandLong: boolean // 能否长时间站立
  extraCompanions?: number // 入馆当天临时增加的陪同人数
}

export type EventType =
  | 'book'
  | 'checkin'
  | 'route_change'
  | 'wheelchair_loan'
  | 'wheelchair_return'
  | 'escort_assign'
  | 'parking'
  | 'assist'
  | 'incident'
  | 'complete'
  | 'note'
  | 'transfer'
  | 'care'

export interface ServiceEvent {
  id: string
  ts: string // ISO
  type: EventType
  actor: string
  text: string
}

export type VisitStatus = 'booked' | 'checked_in' | 'visiting' | 'completed' | 'cancelled'

export interface RouteSeg {
  id: string
  from: string
  to: string
  via: string[] // 途经节点
  kind: 'flat' | 'ramp' | 'elevator'
  distance: number
  maxSlope?: number
  walkMin: number
  arriveMin: number // 到达 to 节点的时刻（当日分钟数）
  isRest?: boolean
  restNode?: string
  toiletNode?: string
  assist?: string
  warning?: string
  stayMin?: number // 终点停留（休息/观展/登记）分钟
  title?: string
}

export interface HallStop {
  hallId: string
  arriveMin: number
  leaveMin: number
  crowd: number
  assist?: string
}

export interface SkippedHall {
  hallId: string
  reason: string
}

export interface RoutePlan {
  version: number
  generatedAt: string
  arrivalMin: number
  startNode: string
  endNode: string
  segments: RouteSeg[]
  stops: HallStop[]
  skipped: SkippedHall[]
  trace: string[] // 实际采用的边 id（地图高亮）
  notices: string[]
  totalDistance: number
  totalWalkMin: number
  totalMin: number
  endMin: number
  escortId?: string
  escortKind?: '讲解员' | '志愿者'
  escortName?: string
  escortIssue?: string
  parkingSlot?: string
  parkingIssue?: string
  wheelchairNeeded?: boolean
  wheelchairIssue?: string
  signals?: string // 生成路线时的现场信号快照，用于提示"情况已变化需重新规划"
  reduced?: boolean // 因身体不适等缩减
}

export interface Loan {
  id: string
  assetCode: string
  loanedAt?: string
  returnedAt?: string
}

// —— 轮椅库存不足协调 ——

/** 其他馆区（分馆）可调配的轮椅资源 */
export interface BranchInfo {
  id: string
  name: string
  wheelchairs: number // 可调配轮椅数
  transferMin: number // 单程搬运约需分钟
}

/** 跨馆调拨单：从其他馆区搬运轮椅到本馆 */
export interface TransferRequest {
  id: string
  branchId: string
  branchName: string
  count: number
  carrier: string // 搬运人员
  status: 'requested' | 'in_transit' | 'arrived' | 'cancelled'
  requestedAt: string // ISO
  etaMin: number // 预计到达（当日分钟数）
  arrivedAt?: string // ISO
  forVisitId?: string // 主要为哪位观众协调
  waitSpot?: string // 观众当前等待位置
  note?: string
}

/** 库存不足时工作人员的协调处置（须记录原因） */
export interface ShortageResolution {
  id: string
  ts: string // ISO
  kind: 'bring_own' | 'reschedule' | 'priority' | 'transfer'
  reason: string
  actor: string
  newArrivalMin?: number // reschedule：调整后的到馆分钟数
  transferId?: string // transfer：关联调拨单
}

/** 等待期间服务台提供的关怀服务（进入预约记录） */
export interface ComfortService {
  id: string
  ts: string // ISO
  kind: 'seat' | 'water' | 'mini_tour'
  text: string
}

export interface Visit {
  id: string
  code: string
  date: string // YYYY-MM-DD
  baseArrivalMin: number // 预约基准入馆分钟数（迟到等信号在此之上叠加）
  status: VisitStatus
  party: PartyProfile
  route?: RoutePlan
  loans: Loan[]
  escortId?: string
  events: ServiceEvent[]
  feedback?: string
  createdAt: string
  // 轮椅库存不足协调
  resolutions: ShortageResolution[] // 协调处置记录（含原因）
  comfortServices: ComfortService[] // 等待期间服务台提供的座椅/饮水/临时讲解
  waitingSpot?: string // 观众当前等待位置
  priorityBorrow?: boolean // 已安排优先借用
}

export interface Staff {
  id: string
  name: string
  role: '讲解员' | '志愿者'
  skills: Array<'sign' | 'slow' | 'wheelchair'>
  onLeave: string[] // 请假日期
  shiftStartMin: number
  shiftEndMin: number
}
