# 栖砂回归测试 · 基线记录

记录时间：2026-10-29
被测源码：`index.html` 内联脚本（引擎段 `const W=300` … `/* UI_AND_RENDERER */` 之前）
Node：`v24.21.0`（`C:\Users\why\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`）
测试依赖：只用 `node:test` + `node:assert` + `node:vm`，无第三方包。

## 文件

| 文件 | 作用 |
| --- | --- |
| `tests/harness.mjs` | 读取 `index.html`、按锚点切出引擎段、在 `node:vm` 中执行并导出 `Garden/W/H/N/MAT` |
| `tests/garden.test.mjs` | 17 个行为测试（5 个 suite） |
| `tests/BASELINE.md` | 本文件，基线记录 |

## 运行方式

在本仓库根目录：

```
node --test tests/garden.test.mjs
```

本机（DSH 沙箱）注意：`node --test` 默认会为每个测试文件 spawn 子进程并捕获其 stdio，
沙箱不允许打开命名管道，会直接报 `Error: spawn EPERM`（这是环境限制，不是测试失败）。
用「不做进程隔离」的等价写法即可在沙箱内正常跑：

```
node --test --test-isolation=none tests/garden.test.mjs
```

或直接执行测试文件（同样在进程内跑，TAP 输出到 stdout）：

```
node tests/garden.test.mjs
```

把候选修复先放到别的文件里试跑（不改 `index.html`）：

```
# Windows PowerShell
$env:SAND_GARDEN_ENGINE_FILE='sand-garden-repo/.work/garden-engine.js'  # 相对仓库根
node --test --test-isolation=none tests/garden.test.mjs
Remove-Item Env:SAND_GARDEN_ENGINE_FILE
```

环境变量未设置时，测试始终读 `index.html` 的内联引擎段。

## 基线结果

命令（仓库根目录）：

```
node --test --test-isolation=none tests/garden.test.mjs
```

输出摘要：

```
ℹ tests 17
ℹ suites 5
ℹ pass 13
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 405.8
```

结论：13 通过 / 4 失败。4 个失败全部来自已知缺陷，均已在用例名中标注 `[基线失败]`。

## 4 个基线失败及根因

### 1. `旧版 island 存档（无 islandSeed 字段）仍可恢复 [基线失败]`
### 2. `island 快照经过 JSON roundtrip 后状态一致 [基线失败]`
### 3. `island 快照恢复后继续演化与原世界一致（RNG 状态被保存） [基线失败]`

三者同一个根因：`Garden.restore()` 的场景白名单不含 `island`。

```
!['valley','desert','volcano','empty'].includes(s.scene)  // index.html 引擎段 restore()
```

而 `Garden.island()` 会把 `this.scene` 设为 `'island'`，快照同样写 `scene:'island'`，
于是任何 island 存档（含读档后撤销、读文件、读本地存档）都会抛 `Error('存档格式不正确')`。
修复方向：白名单加入 `'island'`（旧存档无 `islandSeed` 也要能读）。

### 4. `多个种子下泉眼坐标合法、生成在空位并实际出水 [基线失败]`

`Garden.island()` 把泉眼源点放在山顶往下 3 格：

```
this.sources=[{x:cx,y:Math.max(4,sea-peak+3),material:2,rate:3}];
```

该位置的 `d=y-top=3`，`island()` 填的是 `d<2?SOIL:(d<4?SAND:ROCK)` → 其实是 **沙**。
而 `Garden.step()` 的水源只在目标格为空时才注入：

```
for(let dx=-1;dx<=1;dx++){const i=this.index(s.x+dx,s.y);if(i>=0&&c[i]===0)this.put(s.x+dx,s.y,s.material);}
```

所以泉眼永远吐不出水（实测 10 个种子中的 8 个带泉眼、40 步内新增水量均为 0）。
失败断言原文示例：

```
AssertionError: seed 1：泉眼 (97,130) 应生成在空位，实际是 SAND
```

## 用例清单（17 个）

| Suite | 用例 | 基线 |
| --- | --- | --- |
| 引擎装载 | 可从 index.html 内联脚本提取 Garden 引擎并在 node:vm 中运行 | 通过 |
| 材料基本规则 | 沙会下落并堆在岩石上 | 通过 |
| 材料基本规则 | 岩石不受重力影响 | 通过 |
| 材料基本规则 | 沙会沉入水中并把水顶上来 | 通过 |
| 材料基本规则 | 火遇水立刻变成蒸汽 | 通过 |
| 材料基本规则 | 熔岩遇水凝固成岩石并产生蒸汽 | 通过 |
| 材料基本规则 | 种子在泥土上、附近有水时会发芽长成植物 | 通过 |
| 绘画边界 | 越界坐标被裁剪，不抛错也不缠绕到另一侧 | 通过 |
| 存档校验 | 非法存档被拒绝，且不会破坏当前世界 | 通过 |
| 存档校验 | 旧版 valley 存档（无 islandSeed 字段）仍可恢复 | 通过 |
| 存档校验 | 旧版 island 存档（无 islandSeed 字段）仍可恢复 | **失败（基线）** |
| 随机小岛 | 同一种子生成完全相同的小岛 | 通过 |
| 随机小岛 | 不同种子生成不同的小岛 | 通过 |
| 随机小岛 | island 快照经过 JSON roundtrip 后状态一致 | **失败（基线）** |
| 随机小岛 | island 快照恢复后继续演化与原世界一致（RNG 状态被保存） | **失败（基线）** |
| 随机小岛 | valley 快照恢复后继续演化与原世界一致（RNG 状态被保存） | 通过 |
| 随机小岛 | 多个种子下泉眼坐标合法、生成在空位并实际出水 | **失败（基线）** |

## 测试可满足性核验（不修改游戏）

为了确认这些用例不是「写过严」，在 `tests/` 下用一次性文件做了一次 dry run：
把引擎段抽出后只做两处最小替换（① restore 白名单加 `'island'`；② 泉眼源点改到山顶上方的空格），
用 `SAND_GARDEN_ENGINE_FILE=tests/_dryrun-engine.js` 跑同一套测试：

```
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

该 dry run 文件已删除，**没有修改 `index.html`/`sand-garden.html`**，也不代表最终实现，
只用于证明「17 个用例在修复后可以全部转绿」。

## 交付后需要知道的两点

1. `index.html` 与 `sand-garden.html` 目前字节完全相同
   （SHA256 `787F21DB2C204B63EF06BBC7568164D6AFBB445B19F0F85DADDA2FB2D010587B`）。
   测试只读 `index.html`。整合修复时若只改其中一个，两份会分叉；建议两个都改，或在完成后核对哈希。
2. 修复后重跑上面命令，预期 17/17 通过、退出码 0。若有偶发失败，先确认是哪个种子/哪一步，
   再判断是物理规则变更还是回归。
