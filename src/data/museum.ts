import type { BranchInfo, Edge, ElevatorInfo, GraphNode, HallInfo, Staff } from '../types'

// —— 馆区节点图 ——
// 楼层：B1(-1) 特展厅 / F1(1) 大厅·咨询服务台 / F2(2) 古代馆 / F3(3) 近代馆·自然馆
export const NODES: GraphNode[] = [
  { id: 'parking', name: '无障碍停车场', floor: -1, x: 4, y: 8, kind: 'parking' },
  { id: 'entrance', name: '馆前无障碍坡道入口', floor: 1, x: 4, y: 9, kind: 'entrance' },
  { id: 'desk', name: '一层咨询服务台', floor: 1, x: 4, y: 7, kind: 'desk' },
  { id: 'el1', name: '1号客梯', floor: 1, x: 2, y: 5, kind: 'elevator' },
  { id: 'el2', name: '2号无障碍电梯', floor: 1, x: 7, y: 5, kind: 'elevator' },
  { id: 'r1', name: '一层大厅休息区', floor: 1, x: 4, y: 5, kind: 'rest' },
  { id: 'wc1', name: '一层无障碍卫生间', floor: 1, x: 6, y: 6, kind: 'toilet' },

  { id: 'el1b', name: '1号客梯(B1)', floor: -1, x: 2, y: 5, kind: 'elevator' },
  { id: 'el2b', name: '2号无障碍电梯(B1)', floor: -1, x: 7, y: 5, kind: 'elevator' },
  { id: 'hA', name: 'B1 临展厅 A · 青铜特展', floor: -1, x: 3, y: 2, kind: 'hall' },
  { id: 'hB', name: 'B1 临展厅 B · 丝路特展', floor: -1, x: 6, y: 2, kind: 'hall' },
  { id: 'rB1', name: 'B1 休息平台', floor: -1, x: 4.5, y: 3.5, kind: 'rest' },
  { id: 'wcB1', name: 'B1 无障碍卫生间', floor: -1, x: 2.2, y: 3, kind: 'toilet' },

  { id: 'el1_2', name: '1号客梯(F2)', floor: 2, x: 2, y: 5, kind: 'elevator' },
  { id: 'el2_2', name: '2号无障碍电梯(F2)', floor: 2, x: 7, y: 5, kind: 'elevator' },
  { id: 'hC', name: 'F2 古代陶瓷馆', floor: 2, x: 2.5, y: 2, kind: 'hall' },
  { id: 'hD', name: 'F2 古代书画馆', floor: 2, x: 5.5, y: 2, kind: 'hall' },
  { id: 'r2', name: 'F2 连廊休息区', floor: 2, x: 4, y: 3.6, kind: 'rest' },
  { id: 'wc2', name: 'F2 无障碍卫生间', floor: 2, x: 6.8, y: 3.2, kind: 'toilet' },

  { id: 'el1_3', name: '1号客梯(F3)', floor: 3, x: 2, y: 5, kind: 'elevator' },
  { id: 'el2_3', name: '2号无障碍电梯(F3)', floor: 3, x: 7, y: 5, kind: 'elevator' },
  { id: 'hE', name: 'F3 近代历史馆', floor: 3, x: 2.5, y: 2, kind: 'hall' },
  { id: 'hF', name: 'F3 自然探索馆', floor: 3, x: 6, y: 2, kind: 'hall' },
  { id: 'r3', name: 'F3 观景休息区', floor: 3, x: 4, y: 3.6, kind: 'rest' },
  { id: 'wc3', name: 'F3 无障碍卫生间', floor: 3, x: 2.2, y: 3.2, kind: 'toilet' }
]

// 同层：平坦通道；entrance→desk 为坡道（8% 缓坡）；跨层仅电梯（楼梯仅供疏散，不纳入无障碍路线）
export const EDGES: Edge[] = [
  { id: 'e-park', a: 'parking', b: 'entrance', kind: 'flat', distance: 45 },
  { id: 'e-ramp-in', a: 'entrance', b: 'desk', kind: 'ramp', distance: 30, slope: 8 },
  { id: 'e-desk-el1', a: 'desk', b: 'el1', kind: 'flat', distance: 55 },
  { id: 'e-desk-el2', a: 'desk', b: 'el2', kind: 'flat', distance: 60 },
  { id: 'e-desk-r1', a: 'desk', b: 'r1', kind: 'flat', distance: 40 },
  { id: 'e-r1-el2', a: 'r1', b: 'el2', kind: 'flat', distance: 35 },
  { id: 'e-el2-wc1', a: 'el2', b: 'wc1', kind: 'flat', distance: 30 },
  { id: 'e-el1-r1', a: 'el1', b: 'r1', kind: 'flat', distance: 38 },

  // B1
  { id: 'e-b-el1-a', a: 'el1b', b: 'hA', kind: 'flat', distance: 50 },
  { id: 'e-b-el2-b', a: 'el2b', b: 'hB', kind: 'flat', distance: 48 },
  { id: 'e-b-a-r', a: 'hA', b: 'rB1', kind: 'flat', distance: 42 },
  { id: 'e-b-b-r', a: 'hB', b: 'rB1', kind: 'flat', distance: 40 },
  { id: 'e-b-a-b', a: 'hA', b: 'hB', kind: 'flat', distance: 80 },
  { id: 'e-b-el1-wc', a: 'el1b', b: 'wcB1', kind: 'ramp', distance: 22, slope: 5 },
  { id: 'e-b-r-b', a: 'rB1', b: 'hB', kind: 'flat', distance: 40 },

  // F2
  { id: 'e-2-el1-c', a: 'el1_2', b: 'hC', kind: 'flat', distance: 48 },
  { id: 'e-2-el2-d', a: 'el2_2', b: 'hD', kind: 'flat', distance: 52 },
  { id: 'e-2-c-r', a: 'hC', b: 'r2', kind: 'ramp', distance: 36, slope: 6 },
  { id: 'e-2-d-r', a: 'hD', b: 'r2', kind: 'flat', distance: 34 },
  { id: 'e-2-r-wc', a: 'r2', b: 'wc2', kind: 'flat', distance: 44 },
  { id: 'e-2-c-d', a: 'hC', b: 'hD', kind: 'flat', distance: 70 },
  { id: 'e-2-el1-el2', a: 'el1_2', b: 'el2_2', kind: 'flat', distance: 95 },

  // F3
  { id: 'e-3-el1-e', a: 'el1_3', b: 'hE', kind: 'flat', distance: 46 },
  { id: 'e-3-el2-f', a: 'el2_3', b: 'hF', kind: 'flat', distance: 50 },
  { id: 'e-3-e-r', a: 'hE', b: 'r3', kind: 'flat', distance: 38 },
  { id: 'e-3-f-r', a: 'hF', b: 'r3', kind: 'ramp', distance: 35, slope: 4 },
  { id: 'e-3-r-wc', a: 'r3', b: 'wc3', kind: 'flat', distance: 42 },
  { id: 'e-3-e-f', a: 'hE', b: 'hF', kind: 'flat', distance: 75 },

  // 电梯（跨层边）
  { id: 'ev1-1b', a: 'el1', b: 'el1b', kind: 'elevator', distance: 8, elevatorId: 'el1' },
  { id: 'ev1-12', a: 'el1', b: 'el1_2', kind: 'elevator', distance: 6, elevatorId: 'el1' },
  { id: 'ev1-23', a: 'el1_2', b: 'el1_3', kind: 'elevator', distance: 6, elevatorId: 'el1' },
  { id: 'ev2-1b', a: 'el2', b: 'el2b', kind: 'elevator', distance: 8, elevatorId: 'el2' },
  { id: 'ev2-12', a: 'el2', b: 'el2_2', kind: 'elevator', distance: 6, elevatorId: 'el2' },
  { id: 'ev2-23', a: 'el2_2', b: 'el2_3', kind: 'elevator', distance: 6, elevatorId: 'el2' }
]

export const ELEVATORS: ElevatorInfo[] = [
  { id: 'el1', name: '1号客梯', floors: [-1, 1, 2, 3] },
  { id: 'el2', name: '2号无障碍电梯', floors: [-1, 1, 2, 3] }
]

export const HALLS: HallInfo[] = [
  { id: 'hA', name: 'B1 临展厅 A · 青铜特展', theme: '特展', viewMin: 30, popularity: 0.7 },
  { id: 'hB', name: 'B1 临展厅 B · 丝路特展', theme: '特展', viewMin: 30, popularity: 0.55 },
  { id: 'hC', name: 'F2 古代陶瓷馆', theme: '古代', viewMin: 35, popularity: 0.8 },
  { id: 'hD', name: 'F2 古代书画馆', theme: '古代', viewMin: 35, popularity: 0.6 },
  { id: 'hE', name: 'F3 近代历史馆', theme: '近代', viewMin: 30, popularity: 0.65 },
  { id: 'hF', name: 'F3 自然探索馆', theme: '自然', viewMin: 25, popularity: 0.9 }
]

// 轮椅库存（含已借出按预约动态扣减）
export const TOTAL_WHEELCHAIRS = 12
// 无障碍车位
export const TOTAL_PARKING = 8

// —— 轮椅库存不足协调：其他馆区可调配资源 ——
export const BRANCHES: BranchInfo[] = [
  { id: 'b-east', name: '东馆 · 现代艺术馆', wheelchairs: 6, transferMin: 25 },
  { id: 'b-river', name: '滨江分馆 · 城市记忆馆', wheelchairs: 4, transferMin: 35 },
  { id: 'b-west', name: '西馆 · 自然博物馆', wheelchairs: 3, transferMin: 45 }
]

// 可承担跨馆搬运的后勤人员 / 车辆
export const CARRIERS: string[] = [
  '刘师傅（后勤保障车）',
  '孙师傅（后勤保障车）',
  '志愿者车队 · 小高'
]

// 观众等待期间可安排的等候位置
export const WAITING_SPOTS: string[] = [
  '一层咨询服务台旁等候区',
  '一层大厅休息区',
  'B1 休息平台',
  '正门无障碍坡道休息亭'
]

// 讲解员 / 志愿者排班
export const STAFF: Staff[] = [
  {
    id: 's1', name: '李敏', role: '讲解员',
    skills: ['sign', 'slow'], onLeave: [],
    shiftStartMin: 9 * 60, shiftEndMin: 17 * 60
  },
  {
    id: 's2', name: '王建国', role: '讲解员',
    skills: ['slow', 'wheelchair'], onLeave: [],
    shiftStartMin: 9 * 60, shiftEndMin: 17 * 60
  },
  {
    id: 's3', name: '赵晓', role: '讲解员',
    skills: ['sign'], onLeave: [],
    shiftStartMin: 13 * 60, shiftEndMin: 17 * 60
  },
  {
    id: 'v1', name: '陈义工', role: '志愿者',
    skills: ['wheelchair', 'slow'], onLeave: [],
    shiftStartMin: 9 * 60, shiftEndMin: 16 * 60
  },
  {
    id: 'v2', name: '周志愿', role: '志愿者',
    skills: ['wheelchair'], onLeave: [],
    shiftStartMin: 10 * 60, shiftEndMin: 18 * 60
  }
]

export const HOURS = { openMin: 9 * 60, closeMin: 17 * 60 }

// 每个展厅"每楼层接应岗位"：到厅时由该层工作人员接应（此处仅用于展示接应能力约束）
export const HALL_FLOOR_STAFF_CAPACITY: Record<string, number> = {
  '-1': 1, '1': 2, '2': 2, '3': 2
}
