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
