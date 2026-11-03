# Token 蛛

<p align="center">
  <img src="./public/logo.svg" width="120" height="120" alt="Token 蛛 logo" />
</p>

[![codecov](https://codecov.io/gh/minorcell/spider/branch/main/graph/badge.svg)](https://codecov.io/gh/minorcell/spider)

一只蜘蛛宠物。填上模型地址、名字和 Key，它就是你的了。

它是一个 Agent。我们做的是它的 harness：让它明白自己就在这片地方里，再给它一套已经抽象好的工具，和算好的说法。

## 跑起来

需要 Node 24 以上。

```bash
pnpm install
pnpm dev
```

浏览器打开终端里那个地址。画面铺满一屏。

## 让它走

点右上角的「设置」，填三项：

- Base URL，填到 `/v1` 为止
- Model ID
- API Key

兼容 OpenAI 的接口就行。这三项只留在这台浏览器里。没填的时候，它就站在巢门口。

填好之后，底下输入一句话，回车。它正在做的事会出现在身边。再发一句，会打断上一句。

## 它会记得

世界和模型设置共用持久化缓存层：内存保存当前状态，IndexedDB 保存检查点，localStorage 保存同步恢复记录。新世界启动后就保存；模拟有变化时最多每十秒做一次检查点，工具调用和结果合并写入，提交句子、切到后台或关闭页面立即补存。刷新、重开，蜘蛛会回到上次的位置，背上的东西和没做完的那句话也在。当前世界长期保留，兼容恢复旧版本存档。

缓存层在 `src/client/store/cache.ts`，负责内存快照、同步暂存和串行持久化；世界层负责存档校验、迁移和多标签页租约，设置层负责字段校验与旧 key 迁移。关闭页面不能保证异步 IndexedDB 写入完成，因此持续保存检查点，并在离开时同步暂存完整状态；未完成的写入不会把较新的恢复记录覆盖回旧状态。

多标签页用 owner 和租约区分：后开的页面不会覆盖正在跑的那一个，等租约过期才接手。安静的时候只续一个独立的小租约 key，不重写整份快照。

## 后台线程与性能

日记、用量、快照的 IndexedDB 读写，以及日记压缩和摘要，都跑在 `src/client/worker/journal.worker.ts` 里。高度网格和岛的顶点跑在 `src/client/worker/world.worker.ts` 里。主线程只负责收发消息、模拟和上传几何。没有 module Worker 的环境在主线程做同样的事，行为不变。

关键路径有基准和预算测试：

```bash
pnpm bench
```

`pnpm bench` 跑建岛、120 帧、快照的捕获/恢复/序列化，以及 400 轮日记的估算、压缩和转写。`pnpm test` 里还有 `tests/perf/budget.test.ts`，给同样的路径设了宽松的时间预算，用来发现突然变成平方复杂度的改动。
