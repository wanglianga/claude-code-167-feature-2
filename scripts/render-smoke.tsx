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
assert(ops.includes('轮椅库存不足协调台'), '含轮椅库存不足协调台')
assert(ops.includes('观众到馆'), '协调台展示观众到馆时间')
assert(ops.includes('归还预计'), '展示前方轮椅归还预计时间')
assert(ops.includes('可调用其他馆区设备'), '展示是否可调用其他馆区设备')
assert(ops.includes('搬运人员'), '跨馆调运展示搬运人员')
assert(ops.includes('观众等待位置'), '跨馆调运展示当前观众等待位置')
assert(ops.includes('提供座椅') && ops.includes('提供饮水') && ops.includes('临时讲解'), '等待期间可提供座椅/饮水/临时讲解并计入记录')
assert(ops.includes('联系观众自带设备') && ops.includes('调整参观时段') && ops.includes('安排优先借用'), '库存不足时三种协调处置均可见')
assert(ops.includes('郑师傅'), '演示数据中的跨馆调运展示搬运人员姓名')

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

// 轮椅协调进度（观众端）：跨馆调运中的钱奶奶
const qian = useStore.getState().visits.find((v) => v.party.contactName === '钱奶奶')
assert(!!qian, '演示数据含跨馆调运中的钱奶奶')
const qianPage = renderAt(`/visit/${qian.id}`)
assert(qianPage.includes('轮椅借用协调进度'), '观众端展示轮椅协调进度卡片')
assert(qianPage.includes('跨馆') && qianPage.includes('郑师傅'), '展示跨馆调运与搬运人员')
assert(qianPage.includes('等待位置'), '展示观众等待位置')
assert(qianPage.includes('临时讲解'), '等待期间临时讲解服务对观众可见')
assert(qianPage.includes('轮椅协调') || qianPage.includes('跨馆调运'), '服务记录含轮椅协调/跨馆调运标签')

// 排队待协调的赵大伯：显示排队位次与等待分钟
const zhao = useStore.getState().visits.find((v) => v.party.contactName === '赵大伯')
const zhaoPage = renderAt(`/visit/${zhao.id}`)
assert(zhaoPage.includes('排队第'), '排队观众页展示排队位次')
assert(zhaoPage.includes('归还'), '展示前方设备归还预计')
console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) process.exit(1)
