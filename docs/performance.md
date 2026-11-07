# 性能与基准测试

[返回 README](../README.md)

日记、用量、快照的 IndexedDB 读写，以及日记压缩和摘要，都跑在 [日记工作线程](../src/client/worker/journal.worker.ts) 里。高度网格和岛的顶点跑在 [世界工作线程](../src/client/worker/world.worker.ts) 里。这些任务交给工作线程后，主线程继续处理模拟、场景更新和渲染。没有 module Worker 的环境在主线程做同样的事，行为不变。

运行全部基准测试。

```bash
pnpm bench
```

`pnpm bench` 会输出各条路径的耗时和每秒次数，覆盖岛屿创建，空转和驱动各 120 帧，绕开巢寻路，快照的捕获和恢复，世界线程烘焙以及网格和 `islandBuffers` 的拆分，主线程装扮拆成巢、苹果和草，还有 400 轮日记的估算、装入、丢弃和誊写。这些数字不会让构建失败。`pnpm test` 里的 `tests/perf/budget.test.ts` 给这些路径设了宽松的毫秒上限，这些预算仅在本地运行，GitHub CI 会排除这组依赖机器耗时的测试。测试范围包括空转和驱动各 120 帧、绕开巢寻路、世界线程烘焙岛屿、主线程装扮岛屿，以及已有的快照和日记。这些上限用于发现数量级的性能退化，例如算法复杂度意外变成平方级；百分之几的波动不属于预算测试的判断范围。浏览器绘制、网络和模型不在这些预算里。

场景性能可单独运行。

```bash
pnpm exec vitest bench benchmarks/scenery.bench.ts --run --reporter=verbose
```

这组基准覆盖整座岛上的树、石、沼石、巢和草的模型创建，草的贴地，以及每轮几何释放；地表拆成纯地面烘焙、带短草苔藓的完整烘焙和主线程组装。运行路径包括 120 次草丛遮挡查询、带真实场景障碍且已确认可达的绕行，以及当前存档、无景物旧存档、密集草版本的恢复。恢复基准复用已烘焙地形，原有 `apply a body` 基准则包含地形重建。初始化和路线选择在计时外完成。

耗时列中的 mean、p75、p99 等数值单位为毫秒，hz 表示每秒次数。模型创建是启动时的一次性开销，不能当成每帧耗时；Node 基准也不包含 GPU 上传、阴影、浏览器绘制和相机移动，需要浏览器性能录制补充判断。Vitest 如提示 module export getter 开销，跨版本比较时应使用相同运行方式。

持续运行的热点另有 `benchmarks/runtime.bench.ts`，拆分 120 帧天空动画、移动蜘蛛时的苹果物理和 120 次墙体探测。可与驱动帧一起运行。

```bash
pnpm exec vitest bench benchmarks/runtime.bench.ts benchmarks/frame.bench.ts --run --reporter=verbose
```

`reset whole world` 场景在每次采样前恢复完整快照，恢复本身不计时，避免苹果在重复采样中逐渐静止而让结果偏低。云采用每朵独立的实例批次，保留云间透明排序和剔除；批次数量测试不能替代浏览器 GPU 帧时间测量。
