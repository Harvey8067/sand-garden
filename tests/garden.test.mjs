// 栖砂 / Sand Garden 回归测试
// 运行：node --test tests/garden.test.mjs
// 测试从 index.html 的内联脚本中提取 Garden 引擎，在 node:vm 里执行，不依赖浏览器与第三方库。
//
// 标注「基线失败」的用例在本次修复前预期失败（已知缺陷），修复后应转为通过：
//   - island 快照 restore：旧白名单为 ['valley','desert','volcano','empty']，不含 island
//   - island 快照续跑：同上，restore 直接抛错
//   - 泉眼：旧实现把源点放在 (cx, sea-peak+3)，该格是沙/泥土，出水判定 c[i]===0 永不成立
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, plain, cellsOf } from './harness.mjs';

const { Garden, W, H, N, MAT } = loadEngine();
const MATERIAL_NAME = Object.fromEntries(Object.entries(MAT).map(([name, id]) => [id, name]));

const cellAt = (garden, x, y) => garden.cells[garden.index(x, y)];
const nameAt = (garden, x, y) => MATERIAL_NAME[cellAt(garden, x, y)];
const emptyGarden = () => { const g = new Garden(); g.reset('empty'); return g; };
const countGrid = (garden) => {
  const out = {};
  for (let i = 0; i < N; i++) {
    const name = MATERIAL_NAME[garden.cells[i]];
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
};
// 画布内、以 (cx,cy) 为圆心半径 r 的圆盘点数（用于精确校验 stamp 的裁剪行为）
const inBoundsDisc = (cx, cy, r) => {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && x < W && y >= 0 && y < H) n++;
    }
  }
  return n;
};

describe('引擎装载', () => {
  test('可从 index.html 内联脚本提取 Garden 引擎并在 node:vm 中运行', () => {
    assert.equal(W, 300);
    assert.equal(H, 188);
    assert.equal(N, 300 * 188);
    assert.equal(MAT.SAND, 1);
    assert.equal(MAT.WATER, 2);
    assert.equal(MAT.ROCK, 3);
    assert.equal(MAT.BUD, 12);
    const g = new Garden();
    assert.equal(g.tick, 0);
    assert.equal(g.scene, 'valley');
    assert.deepEqual(cellsOf(g), new Array(N).fill(0), '新花园应为全空网格');
  });
});

describe('材料基本规则', () => {
  test('沙会下落并堆在岩石上', () => {
    const g = emptyGarden();
    for (let x = 0; x <= 20; x++) g.put(x, 101, MAT.ROCK);
    g.put(10, 10, MAT.SAND);
    g.step();
    assert.equal(cellAt(g, 10, 11), MAT.SAND, '一步应下落一格');
    assert.equal(cellAt(g, 10, 10), MAT.EMPTY, '原位置应腾空');
    for (let i = 0; i < 100; i++) g.step();
    assert.equal(cellAt(g, 10, 100), MAT.SAND, '沙应停在岩石上方');
    assert.equal(cellAt(g, 10, 101), MAT.ROCK, '岩石不应被沙挤开');
  });

  test('岩石不受重力影响', () => {
    const g = emptyGarden();
    g.put(20, 20, MAT.ROCK);
    for (let i = 0; i < 5; i++) g.step();
    assert.equal(cellAt(g, 20, 20), MAT.ROCK);
    assert.equal(cellAt(g, 20, 21), MAT.EMPTY);
    assert.equal(cellAt(g, 19, 20), MAT.EMPTY);
    assert.equal(cellAt(g, 20, 19), MAT.EMPTY);
  });

  test('沙会沉入水中并把水顶上来', () => {
    // 一格的窄井：底部与两侧是岩石，水无法横向流走，只能被沙置换
    const g = emptyGarden();
    for (const [x, y] of [[29, 21], [29, 22], [31, 21], [31, 22], [30, 22]]) g.put(x, y, MAT.ROCK);
    g.put(30, 21, MAT.WATER);
    g.put(30, 20, MAT.SAND);
    g.step();
    assert.equal(cellAt(g, 30, 21), MAT.SAND, '沙应下沉穿过水');
    assert.equal(cellAt(g, 30, 20), MAT.WATER, '水应被置换到上方');
  });

  test('火遇水立刻变成蒸汽', () => {
    const g = emptyGarden();
    g.put(40, 21, MAT.ROCK);
    g.put(41, 21, MAT.ROCK);
    g.put(40, 20, MAT.FIRE);
    g.put(41, 20, MAT.WATER);
    g.step();
    const counts = countGrid(g);
    assert.equal(counts.FIRE ?? 0, 0, '火应熄灭');
    assert.equal(counts.WATER ?? 0, 0, '水应被汽化');
    assert.equal(counts.STEAM ?? 0, 2, '火与水都应变成蒸汽');
    assert.equal(counts.ROCK ?? 0, 2, '作为地基的岩石不受影响');
  });

  test('熔岩遇水凝固成岩石并产生蒸汽', () => {
    const g = emptyGarden();
    g.put(50, 21, MAT.ROCK);
    g.put(51, 21, MAT.ROCK);
    g.put(50, 20, MAT.LAVA);
    g.put(51, 20, MAT.WATER);
    for (let i = 0; i < 4; i++) g.step();
    const counts = countGrid(g);
    assert.equal(counts.LAVA ?? 0, 0, '熔岩应全部凝固');
    assert.equal(counts.WATER ?? 0, 0, '水应全部耗尽');
    assert.equal(counts.ROCK ?? 0, 3, '熔岩应变成一块岩石（另有 2 块地基）');
    assert.equal(counts.STEAM ?? 0, 1, '反应应产生 1 份蒸汽');
  });

  test('种子在泥土上、附近有水时会发芽长成植物', () => {
    const g = emptyGarden();
    for (let x = 13; x <= 19; x++) g.put(x, 101, MAT.SOIL);
    g.put(16, 100, MAT.ROCK); // 两侧挡住水，避免水横向流走
    g.put(18, 100, MAT.ROCK);
    g.put(15, 100, MAT.SEED);
    g.put(17, 100, MAT.WATER);
    let sawBud = false;
    for (let i = 0; i < 16; i++) {
      g.step();
      if (cellAt(g, 15, 100) === MAT.BUD) sawBud = true;
    }
    assert.ok(sawBud, '种子应先长成花苞');
    assert.equal(cellAt(g, 15, 100), MAT.WOOD, '花苞随后长成植物（木质）');
  });
});

describe('绘画边界', () => {
  test('越界坐标被裁剪，不抛错也不缠绕到另一侧', () => {
    const g = emptyGarden();
    g.stamp(0, 0, 6, MAT.ROCK, true);
    const rocks = cellsOf(g).filter((v) => v === MAT.ROCK).length;
    assert.equal(rocks, inBoundsDisc(0, 0, 6), '只应写入画布内的圆盘点，越界部分被裁掉');
    assert.equal(cellAt(g, 0, 0), MAT.ROCK, '圆心应被写入');
    assert.equal(cellAt(g, W - 1, 0), MAT.EMPTY, '不应缠绕到右边缘');
    assert.equal(cellAt(g, 0, H - 1), MAT.EMPTY, '不应缠绕到底边');

    assert.doesNotThrow(() => {
      g.stamp(-5, -5, 3, MAT.ROCK, true);
      g.stamp(W + 5, H + 5, 3, MAT.ROCK, true);
      g.stamp(W - 1, H - 1, 6, MAT.ROCK, true);
      g.stamp(W / 2, H / 2, 0, MAT.SAND);
    }, '画布外与半径 0 的落笔不应抛错');

    assert.equal(g.index(-1, 0), -1);
    assert.equal(g.index(W, 0), -1);
    assert.equal(g.index(0, H), -1);
    const before = cellsOf(g);
    g.put(-1, 0, MAT.ROCK);
    g.put(W, H, MAT.ROCK);
    assert.deepEqual(cellsOf(g), before, '画出画布的 put 应是空操作');
  });
});

describe('存档校验', () => {
  test('非法存档被拒绝，且不会破坏当前世界', () => {
    const g = new Garden();
    g.reset('valley');
    const reference = plain(g.snapshot());
    assert.ok(reference.cells.some((v) => v !== 0), '前置条件：当前世界不是空的');

    const withCell = (index, value) => {
      const cells = reference.cells.slice();
      cells[index] = value;
      return { ...reference, cells };
    };
    const badSaves = [
      ['不是对象', null],
      ['版本号不符', { ...reference, version: 2 }],
      ['宽度不符', { ...reference, width: W - 1 }],
      ['cells 长度不足', { ...reference, cells: reference.cells.slice(0, -1) }],
      ['cells 含未知材料 13', withCell(5, 13)],
      ['life 为负数', (() => { const life = reference.life.slice(); life[7] = -1; return { ...reference, life }; })()],
      ['tick 为负数', { ...reference, tick: -1 }],
      ['泉眼坐标越界', { ...reference, sources: [{ x: W, y: 10, material: 2, rate: 2 }] }],
      ['未知场景', { ...reference, scene: 'moon' }],
    ];

    for (const [label, bad] of badSaves) {
      assert.throws(() => g.restore(bad), /存档格式不正确/, label + ' 应被拒绝');
      assert.deepEqual(plain(g.snapshot()), reference, label + ' 被拒绝后当前世界必须原样保留');
    }
  });

  test('旧版 valley 存档（无 islandSeed 字段）仍可恢复', () => {
    const source = new Garden();
    source.reset('valley');
    for (let i = 0; i < 5; i++) source.step();
    const saved = plain(source.snapshot());
    delete saved.islandSeed; // 旧版本没有该字段
    const target = new Garden();
    assert.doesNotThrow(() => target.restore(saved), '缺少 islandSeed 的旧存档应被兼容');
    assert.equal(target.scene, 'valley');
    assert.equal(target.tick, saved.tick);
  });

  test('旧版 island 存档（无 islandSeed 字段）仍可恢复 [基线失败]', () => {
    const source = new Garden();
    source.island(1234);
    const saved = plain(source.snapshot());
    delete saved.islandSeed; // 修复前生成的 island 存档没有种子字段
    const target = new Garden();
    assert.doesNotThrow(() => target.restore(saved), '缺少 islandSeed 的旧 island 存档应被兼容');
    assert.equal(target.scene, 'island');
  });
});

describe('随机小岛', () => {
  test('同一种子生成完全相同的小岛', () => {
    const a = new Garden();
    a.island(4242);
    const b = new Garden();
    b.island(4242);
    assert.deepEqual(plain(a.snapshot()), plain(b.snapshot()));
    assert.equal(a.scene, 'island');
    assert.ok(cellsOf(a).some((v) => v === MAT.WATER), '小岛应当有海水');
  });

  test('不同种子生成不同的小岛', () => {
    const a = new Garden();
    a.island(11);
    const b = new Garden();
    b.island(12);
    assert.notDeepEqual(cellsOf(a), cellsOf(b));
  });

  test('island 快照经过 JSON roundtrip 后状态一致 [基线失败]', () => {
    const g = new Garden();
    g.island(1234);
    const saved = plain(g.snapshot());
    const restored = new Garden();
    assert.doesNotThrow(() => restored.restore(saved), 'island 存档应被 restore 接受');
    assert.equal(restored.scene, 'island');
    assert.deepEqual(plain(restored.snapshot()), saved, '恢复后的快照应与存档完全一致');
  });

  test('island 快照恢复后继续演化与原世界一致（RNG 状态被保存） [基线失败]', () => {
    const g = new Garden();
    g.island(2024);
    for (let i = 0; i < 5; i++) g.step();
    const saved = plain(g.snapshot());
    for (let i = 0; i < 12; i++) g.step();
    const expected = plain(g.snapshot());

    const restored = new Garden();
    restored.restore(saved);
    for (let i = 0; i < 12; i++) restored.step();
    assert.deepEqual(plain(restored.snapshot()), expected, '读档后的随机序列应接续原世界');
  });

  test('valley 快照恢复后继续演化与原世界一致（RNG 状态被保存）', () => {
    const g = new Garden();
    g.reset('valley');
    for (let i = 0; i < 10; i++) g.step();
    const saved = plain(g.snapshot());
    for (let i = 0; i < 15; i++) g.step();
    const expected = plain(g.snapshot());

    const restored = new Garden();
    restored.restore(saved);
    for (let i = 0; i < 15; i++) restored.step();
    assert.deepEqual(plain(restored.snapshot()), expected);
  });

  test('多个种子下泉眼坐标合法、生成在空位并实际出水 [基线失败]', () => {
    const seeds = [1, 3, 5, 8, 13, 34, 977, 1234];
    let springCount = 0;

    for (const seed of seeds) {
      const g = new Garden();
      g.island(seed);
      if (g.sources.length === 0) continue;
      springCount++;

      for (const s of g.sources) {
        assert.ok(Number.isInteger(s.x) && s.x >= 0 && s.x < W, 'seed ' + seed + '：泉眼 x 越界 ' + s.x);
        assert.ok(Number.isInteger(s.y) && s.y >= 0 && s.y < H, 'seed ' + seed + '：泉眼 y 越界 ' + s.y);
        assert.ok(s.material === MAT.WATER || s.material === MAT.LAVA, 'seed ' + seed + '：泉眼材料非法');
        assert.ok(Number.isInteger(s.rate) && s.rate > 0, 'seed ' + seed + '：泉眼 rate 非法');
        assert.equal(
          cellAt(g, s.x, s.y), MAT.EMPTY,
          'seed ' + seed + '：泉眼 (' + s.x + ',' + s.y + ') 应生成在空位，实际是 ' + nameAt(g, s.x, s.y),
        );
      }

      const before = cellsOf(g);
      const springs = g.sources.map((s) => ({ x: s.x, y: s.y }));
      for (let i = 0; i < 40; i++) g.step();
      const after = cellsOf(g);

      for (const s of springs) {
        let produced = 0;
        for (let y = Math.max(0, s.y - 2); y <= Math.min(H - 1, s.y + 15); y++) {
          for (let x = Math.max(0, s.x - 10); x <= Math.min(W - 1, s.x + 10); x++) {
            const i = y * W + x;
            if (before[i] !== MAT.WATER && after[i] === MAT.WATER) produced++;
          }
        }
        assert.ok(produced > 0, 'seed ' + seed + '：泉眼 (' + s.x + ',' + s.y + ') 在 40 步内没有出水');
      }
    }

    assert.ok(springCount >= 3, '样本中只有 ' + springCount + ' 个带泉眼的小岛，测试价值不足');
  });
});
