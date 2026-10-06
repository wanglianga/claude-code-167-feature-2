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
  | 'wheelchair_coord'
  | 'wheelchair_transfer'
  | 'waiting_service'
  | 'escort_assign'
  | 'parking'
  | 'assist'
  | 'incident'
  | 'complete'
  | 'note'

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

/** 排队等待本馆轮椅时，前序设备的预计归还信息 */
export interface WheelchairReturnEta {
  assetCode: string
  returnMin: number // 预计归还（当日分钟数）
  holder: string // 当前借用人（预约编号/称呼）
  waitMin: number // 相对观众到馆需等待的分钟数
}

/** 其他馆区可调用轮椅的信息 */
export interface BranchStock {
  branch: string
  available: number
  distanceKm: number
  transferMin: number // 搬运预计耗时（分钟）
  carrier: string // 默认搬运人员
  carrierPhone: string
}

/** 轮椅库存协调快照（随路线重算刷新） */
export interface WheelchairPlanInfo {
  total: number // 本馆轮椅总数
  availableAtArrival: number // 观众到馆时刻可立即发放的台数
  demandAtArrival: number // 到馆时段同时需要借用的预约组数（含自己）
  queueIndex: number // 排队位次（1 起；0 表示到馆即可领取）
  returnEtas: WheelchairReturnEta[] // 排队时前序设备的归还预计
  nearestReadyMin?: number // 最早可领取的时刻（当日分钟数）
  waitMin: number // 预计等待分钟数
  branches: BranchStock[] // 其他馆区可调设备
  branchNeeded: number // 本馆无法满足、需跨馆调入的台数（仅本预约视角：0/1）
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
  wheelchairInfo?: WheelchairPlanInfo
  signals?: string // 生成路线时的现场信号快照，用于提示"情况已变化需重新规划"
  reduced?: boolean // 因身体不适等缩减
}

export interface Loan {
  id: string
  assetCode: string
  loanedAt?: string
  returnedAt?: string
  branch?: string // 来源馆区（跨馆调入时记录调出馆区）
}

// —— 轮椅库存不足协调 ——

/** 库存不足时工作人员与观众沟通后的处置方式 */
export type WheelchairResolution =
  | 'bring_own' // 联系观众自带设备
  | 'reschedule' // 调整参观时段
  | 'priority_loan' // 安排优先借用（排队优先 / 跨馆调入后优先领取）
  | 'branch_transfer' // 调用其他馆区轮椅
  | 'pending' // 尚未协调

/** 跨馆调运状态 */
export type TransferStatus = 'requested' | 'in_transit' | 'arrived' | 'cancelled'

export interface BranchTransfer {
  id: string
  fromBranch: string
  assetCode: string
  carrier: string // 搬运人员
  carrierPhone: string
  requestMin: number // 发起调运的当日分钟数
  etaMin: number // 预计到达本馆服务台的当日分钟数
  arriveMin?: number // 实际到达
  status: TransferStatus
  waitLocation?: string // 观众当前等待位置
}

/** 等待轮椅期间服务台提供的临时服务 */
export interface WaitingService {
  id: string
  kind: 'seat' | 'water' | 'guide'
  note?: string
  at: string // ISO
}

/** 一次库存不足协调的留痕（原因等） */
export interface WheelchairCoord {
  resolution: WheelchairResolution
  reason: string
  at: string // ISO
  actor: string
  rescheduleToMin?: number // 调整后的到馆分钟数
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
  wheelchairCoord?: WheelchairCoord
  branchTransfer?: BranchTransfer
  waitingServices: WaitingService[]
  createdAt: string
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
