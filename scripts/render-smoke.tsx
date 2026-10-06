// React 渲染冒烟：在 node 中用 renderToString 渲染全部路由，不依赖浏览器
const mem = new Map()
globalThis.localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear()
}

const React = require('react').default || require('react')
// SSR 下 useSyncExternalStore 默认取服务端快照（空 store），垫片为当前内存快照
React.useSyncExternalStore = (_sub: unknown, getSnap: () => unknown) => getSnap()
const { renderToString } = require('react-dom/server')
const { StaticRouter } = require('react-router-dom/server')
const { default: App } = require('../src/App.tsx')
const { useStore } = require('../src/store.ts')

let pass = 0, fail = 0
const assert = (c, m) => { c ? (pass++, console.log('  ✅', m)) : (fail++, console.log('  ❌', m)) }

useStore.getState().resetDemo()
useStore.getState().seedDemo()

function renderAt(path) {
  return renderToString(
    React.createElement(StaticRouter, { location: path },
      React.createElement(App))
  )
}

const home = renderAt('/')
assert(home.includes('畅观博物馆'), '首页渲染品牌名')
assert(home.includes('新建无障碍预约'), '首页含新建预约入口')
assert(home.includes('MV-'), '首页渲染演示预约编号')

const book = renderAt('/book')
assert(book.includes('无障碍参观预约'), '预约页渲染标题')
assert(book.includes('参观日期') && book.includes('参观人数'), '预约页含参观日期/人数字段')
assert(book.includes('手语讲解') && book.includes('慢速讲解'), '含手语/慢速讲解选项')
assert(book.includes('近距离无障碍车位'), '含近距离停车选项')
assert(book.includes('不能长时间站立'), '含能否长时间站立选项')
assert(book.includes('路线可行性预估'), '填写时实时给出可行性预估')

const ops = renderAt('/ops')
assert(ops.includes('馆内工作台'), '平板工作台渲染')
assert(ops.includes('今日接应任务看板'), '展厅工作人员看到接应看板与预计到达时间')
assert(ops.includes('现场态势与安全调度'), '含电梯/闭馆/拥挤/排班/库存调度')

const someId = useStore.getState().visits[0].id
const detail = renderAt(`/visit/${someId}`)
assert(detail.includes('无障碍参观服务'), '参观服务详情渲染')
assert(detail.includes('分段无障碍路线'), '手机端展示分段路线')
assert(detail.includes('坡道'), '路段提示坡度')
assert(detail.includes('休息点') && detail.includes('无障碍卫生间'), '提示休息点与卫生间位置')
assert(detail.includes('一条参观服务记录'), '预约/设备/人员/协助挂在同一条服务记录')

const id = useStore.getState().createVisit({
  date: new Date().toISOString().slice(0, 10), arrivalMin: 9 * 60 + 30,
  party: {
    contactName: '全需求测试', phone: '13700000000', size: 5,
    usesWheelchair: true, borrowWheelchair: true, needSign: true, needSlow: true,
    hasElder: true, hasChild: true, needParking: true, canStandLong: false, extraCompanions: 2
  }
})
const full = renderAt(`/visit/${id}`)
assert(full.includes('手语'), '全需求详情含手语')
assert(full.includes('馆区无障碍平面图'), '详情含馆区平面图')

// —— 轮椅库存不足协调 ——
useStore.getState().setGlobalSignals({ wheelchairOffset: 12 }, '全部轮椅报修演练')
const cid = useStore.getState().createVisit({
  date: new Date().toISOString().slice(0, 10), arrivalMin: 13 * 60,
  party: {
    contactName: '协调测试', phone: '13400000000', size: 2,
    usesWheelchair: false, borrowWheelchair: true, needSign: false, needSlow: false,
    hasElder: true, hasChild: false, needParking: false, canStandLong: false, extraCompanions: 0
  }
})
useStore.getState().requestTransfer({
  branchId: 'b-east', count: 1, carrier: '刘师傅（后勤保障车）',
  forVisitId: cid, waitSpot: '一层大厅休息区', note: '库存不足演练'
})
useStore.getState().addComfortService(cid, 'seat')
const ops2 = renderAt('/ops')
assert(ops2.includes('轮椅库存协调'), '工作台含轮椅库存协调看板')
assert(ops2.includes('归还预计时间'), '看板展示在借轮椅归还预计时间')
assert(ops2.includes('观众到馆时间'), '看板展示各预约观众到馆时间')
assert(ops2.includes('其他馆区可调配设备'), '看板展示是否可调用其他馆区设备')
assert(ops2.includes('联系观众自带设备') && ops2.includes('调整参观时段') && ops2.includes('安排优先借用'), '缺口处置含自带/调时段/优先借用')
assert(ops2.includes('搬运人员') && ops2.includes('等待位置'), '调拨单显示搬运人员与观众等待位置')
assert(ops2.includes('提供座椅') && ops2.includes('提供饮水') && ops2.includes('临时讲解'), '等待期间可提供座椅/饮水/临时讲解')
const cdetail = renderAt(`/visit/${cid}`)
assert(cdetail.includes('轮椅协调进度'), '观众端展示轮椅协调进度')
assert(cdetail.includes('搬运人员') && cdetail.includes('预计'), '观众端展示搬运人员与预计到达')
assert(cdetail.includes('座椅休息'), '观众端展示已提供的等待关怀服务')
console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
