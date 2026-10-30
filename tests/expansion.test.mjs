// 栖砂·田园记 2.2 扩建验收测试
// 运行（仓库根目录）：node --test --test-isolation=none tests/expansion.test.mjs
// 覆盖：42×30 地图 / 352 格农田 / 全地点与每块田地 BFS 可达 / 5 NPC 与 15 任务 /
//       交付任务扣物原子性与前置与远距与重复领奖 / 旧 2.1 存档兼容 / 扩区可种可睡
// 依据：.work/expansion-contract.md
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_PATH = process.env.FARM_CORE_FILE
  ? path.resolve(HERE, process.env.FARM_CORE_FILE)
  : path.resolve(HERE, '..', 'src', 'farm-core.js');

let FarmCore = null;
let loadError = null;
try {
  FarmCore = require(CORE_PATH);
} catch (err) {
  loadError = err;
}

if (loadError) {
  test('src/farm-core.js 应存在且能通过 createRequire 加载', () => {
    throw loadError;
  });
} else {
  const { FarmGame, CROPS, MAP, LOCATIONS, QUESTS, TOOLS, NPCS } = FarmCore;

  const newGame = (seed = 20261029) => new FarmGame(seed);
  const plotAt = (g, x, y) => g.state.plots[x + ',' + y];
  const stand = (g, x, y) => { g.state.player.x = x; g.state.player.y = y; };
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP.cols && y < MAP.rows;
  const loc = (id) => {
    const L = LOCATIONS;
    if (Array.isArray(L)) return L.find((v) => v.id === id) || L.find((v) => v.name === id);
    return L && L[id];
  };
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

  // 西田/东田按契约固定矩形
  const WEST = { x0: 5, x1: 16, y0: 10, y1: 25 };
  const EAST = { x0: 30, x1: 39, y0: 10, y1: 25 };
  const inRect = (x, y, r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

  // 从玩家出生点做 BFS，只走 isWalkable 为真的格子（四方向）
  const reachableFrom = (g) => {
    const seen = new Set();
    const start = g.state.player;
    const key = (x, y) => x + ',' + y;
    const queue = [[start.x, start.y]];
    seen.add(key(start.x, start.y));
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const k = key(nx, ny);
        if (seen.has(k) || !inBounds(nx, ny) || !g.isWalkable(nx, ny)) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
    return seen;
  };

  // 站到某个地点旁边（只改 state.player，构造场景用）
  const standNear = (g, id) => {
    const target = loc(id);
    assert.ok(target, 'LOCATIONS 里应有 ' + id);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]]) {
      const x = target.x + dx;
      const y = target.y + dy;
      if (!inBounds(x, y)) continue;
      if (g.isWalkable(x, y)) { stand(g, x, y); return { x, y }; }
    }
    throw new Error('找不到 ' + id + ' 旁可站立的位置');
  };
  const standAdjacentTo = (g, tx, ty) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = tx + dx;
      const y = ty + dy;
      if (!inBounds(x, y)) continue;
      if (g.isWalkable(x, y)) { stand(g, x, y); return { x, y }; }
    }
    throw new Error('找不到 (' + tx + ',' + ty + ') 旁边可站立的位置');
  };

  const ensureWatered = (g, x, y, cropId = 'radish') => {
    standAdjacentTo(g, x, y);
    if (plotAt(g, x, y).watered) return;
    assert.equal(g.use('water', cropId, x, y).ok, true, '浇水 (' + x + ',' + y + ') 应成功');
    assert.equal(plotAt(g, x, y).watered, true);
  };

  const questById = (id) => QUESTS.find((q) => q.id === id);
  const NPC_KEYS = ['npc', 'miller', 'ranger', 'miner', 'florist'];

  describe('地图与农田规模', () => {
    test('地图为 42×30，旧世界 30×22 位于左上角且旧坐标不变', () => {
      assert.equal(MAP.cols, 42);
      assert.equal(MAP.rows, 30);
      assert.equal(MAP.tile, 32);
      const g = newGame();
      // 旧固定点仍保持原语义
      assert.equal(g.tileAt(5, 4), 'building', '小屋位置不变');
      assert.equal(g.tileAt(23, 4), 'building', '杂货铺位置不变');
      assert.equal(g.tileAt(25, 16), 'water', '池塘位置不变');
      assert.equal(g.tileAt(10, 8), 'path');
      // 旧地图新增的右侧/下侧区域必须存在
      assert.notEqual(g.tileAt(MAP.cols - 1, MAP.rows - 1), 'outside');
      assert.equal(g.tileAt(-1, 0), 'outside');
      assert.equal(g.tileAt(MAP.cols, 0), 'outside');
    });

    test('农田共 352 格：西田 192 + 东田 160，且都不被建筑/水/路占用', () => {
      const g = newGame();
      let west = 0;
      let east = 0;
      for (let y = 0; y < MAP.rows; y++) {
        for (let x = 0; x < MAP.cols; x++) {
          if (!g.isFarmTile(x, y)) continue;
          if (inRect(x, y, WEST)) west++;
          else if (inRect(x, y, EAST)) east++;
        }
      }
      assert.equal(west, 192, '西田 x5..16,y10..25 应有 192 格农田');
      assert.equal(east, 160, '东田 x30..39,y10..25 应有 160 格农田');
      assert.equal(west + east, 352, '农田总数应为 352');

      // 指定矩形内不允许出现建筑/水/路
      for (const rect of [WEST, EAST]) {
        for (let y = rect.y0; y <= rect.y1; y++) {
          for (let x = rect.x0; x <= rect.x1; x++) {
            const t = g.tileAt(x, y);
            assert.equal(t, 'grass', '(' + x + ',' + y + ') 农田矩形内应为草地，实际 ' + t);
            assert.equal(g.isFarmTile(x, y), true, '(' + x + ',' + y + ') 应属于农田');
            assert.equal(g.obstacleAt(x, y), null, '(' + x + ',' + y + ') 农田上不应生成障碍');
          }
        }
      }
    });
  });

  describe('连通性', () => {
    test('所有地点都能从出生点走到', () => {
      const g = newGame();
      const reachable = reachableFrom(g);
      for (const id of Object.keys(LOCATIONS)) {
        const target = loc(id);
        const ok = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
          .some(([dx, dy]) => reachable.has((target.x + dx) + ',' + (target.y + dy)));
        assert.ok(ok, '地点 ' + id + ' 应能从出生点走到（含其相邻格）');
      }
    });

    test('多名 NPC 都能从出生点走到', () => {
      assert.ok(NPCS && typeof NPCS === 'object', '应导出 NPCS');
      const g = newGame();
      const reachable = reachableFrom(g);
      for (const key of NPC_KEYS) {
        const npc = NPCS[key];
        assert.ok(npc, 'NPCS 应包含 ' + key);
        const at = npc.location ? loc(npc.location) : loc(key);
        assert.ok(at, key + ' 应有可定位的地点');
        const ok = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
          .some(([dx, dy]) => reachable.has((at.x + dx) + ',' + (at.y + dy)));
        assert.ok(ok, key + ' 应能从出生点走到');
      }
    });

    test('每一块农田都能被玩家走到并开垦', () => {
      const g = newGame();
      const reachable = reachableFrom(g);
      const tiles = [];
      for (let y = 0; y < MAP.rows; y++) {
        for (let x = 0; x < MAP.cols; x++) if (g.isFarmTile(x, y)) tiles.push([x, y]);
      }
      assert.equal(tiles.length, 352);

      const unreachable = [];
      for (const [x, y] of tiles) {
        if (reachable.has(x + ',' + y)) continue;
        // 允许经由相邻格操作（玩家站在旁边也能耕种）
        const neighbourOk = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reachable.has((x + dx) + ',' + (y + dy)));
        if (!neighbourOk) unreachable.push(x + ',' + y);
      }
      assert.deepEqual(unreachable, [], '这些农田既不可站也不能从相邻格操作：' + unreachable.slice(0, 12).join(' '));

      // 抽两块代表性地块真的开垦一次（西田、东田各一）
      for (const [x, y] of [[10, 20], [35, 20]]) {
        standAdjacentTo(g, x, y);
        assert.equal(g.use('hoe', 'radish', x, y).ok, true, '应能开垦 (' + x + ',' + y + ')');
        assert.ok(plotAt(g, x, y), '开垦后应有地块记录 (' + x + ',' + y + ')');
      }
    });
  });

  describe('NPC 与任务表', () => {
    test('5 名 NPC 结构完整，interact 返回对应 npcId', () => {
      assert.equal(Object.keys(NPCS).length, 5, '应有 5 名 NPC');
      for (const key of NPC_KEYS) {
        const npc = NPCS[key];
        assert.equal(typeof npc.name, 'string');
        assert.ok(npc.name.length > 0, key + ' 应有名字');
        assert.equal(typeof npc.role, 'string');
        assert.equal(typeof npc.greeting, 'string');
        assert.ok(npc.color != null, key + ' 应有 color');
        assert.ok(npc.location, key + ' 应有 location');
        assert.ok(loc(npc.location), key + '.location 应指向存在的 LOCATIONS 键');
      }
      // 原杂货铺仍是 shop，不是 miller
      assert.notEqual(NPCS.miller.location, 'shop', '杂货铺不应被麦叔顶替');

      const g = newGame();
      for (const key of NPC_KEYS) {
        const at = NPCS[key].location;
        standNear(g, at);
        const r = g.interact();
        assert.equal(r.ok, true, key + ' 应可交互');
        assert.equal(r.kind, 'npc', key + ' 的交互类型应为 npc');
        assert.equal(r.npcId, key, key + ' 的 npcId 应对应');
      }
    });

    test('任务表 15 条，旧 3 条数值不变，新任务结构符合约定', () => {
      assert.equal(QUESTS.length, 15);
      const ids = QUESTS.map((q) => q.id);
      assert.equal(new Set(ids).size, 15, '任务 id 不应重复');

      const oldSpec = {
        'first-harvest': { stat: 'harvested', target: 4, reward: 60 },
        'market-day': { stat: 'sold', target: 8, reward: 100 },
        'green-fingers': { stat: 'watered', target: 20, reward: 80 },
      };
      for (const [id, spec] of Object.entries(oldSpec)) {
        const q = questById(id);
        assert.ok(q, '旧任务应保留：' + id);
        for (const k of Object.keys(spec)) assert.equal(q[k], spec[k], id + '.' + k);
        assert.equal(q.npc, 'npc', id + ' 应属于 npc');
      }

      const deliverySpec = {
        'radish-delivery': { npc: 'miller', reward: 90, delivery: { radish: 3 } },
        'forest-timber': { npc: 'ranger', reward: 90, delivery: { wood: 9 } },
        'forest-supplies': { npc: 'ranger', reward: 240, delivery: { carrot: 4, berry: 2 }, requiresQuest: 'forest-gardener' },
        'stone-sample': { npc: 'miner', reward: 100, delivery: { stone: 6 } },
        'workshop-order': { npc: 'miner', reward: 220, delivery: { stone: 12, wood: 6 }, requiresQuest: 'stone-sample' },
        'berry-basket': { npc: 'florist', reward: 160, delivery: { berry: 3 } },
        'colorful-harvest': { npc: 'florist', reward: 240, delivery: { radish: 2, carrot: 2, berry: 2 }, requiresQuest: 'berry-basket' },
      };
      for (const [id, spec] of Object.entries(deliverySpec)) {
        const q = questById(id);
        assert.ok(q, '应有任务 ' + id);
        assert.equal(q.npc, spec.npc, id + '.npc');
        assert.equal(q.reward, spec.reward, id + '.reward');
        assert.deepEqual({ ...q.delivery }, spec.delivery, id + '.delivery');
        assert.equal(typeof q.name, 'string');
        assert.equal(typeof q.description, 'string');
        if (spec.requiresQuest) assert.equal(q.requiresQuest, spec.requiresQuest, id + '.requiresQuest');
        else assert.ok(!q.requiresQuest, id + ' 不应有前置');
      }

      const statSpec = {
        'market-supply': { npc: 'miller', stat: 'sold', target: 20, reward: 150, requiresQuest: 'radish-delivery' },
        'village-trade': { npc: 'miller', stat: 'earned', target: 600, reward: 200, requiresQuest: 'market-supply' },
        'forest-gardener': { npc: 'ranger', stat: 'watered', target: 80, reward: 160, requiresQuest: 'forest-timber' },
        'settled-in': { npc: 'miner', stat: 'day', target: 10, reward: 200, requiresQuest: 'workshop-order' },
        'flower-festival': { npc: 'florist', stat: 'harvested', target: 40, reward: 250, requiresQuest: 'colorful-harvest' },
      };
      for (const [id, spec] of Object.entries(statSpec)) {
        const q = questById(id);
        assert.ok(q, '应有任务 ' + id);
        assert.equal(q.npc, spec.npc, id + '.npc');
        assert.equal(q.stat, spec.stat, id + '.stat');
        assert.equal(q.target, spec.target, id + '.target');
        assert.equal(q.reward, spec.reward, id + '.reward');
        assert.equal(q.requiresQuest, spec.requiresQuest, id + '.requiresQuest');
      }
    });
  });

  describe('questStatus 与领取', () => {
    test('questStatus 报告 progress/target/ready/claimed/locked/npc/delivery', () => {
      const g = newGame();
      assert.equal(g.questStatus('no-such-quest'), null, '未知任务应返回 null');

      const q = g.questStatus('radish-delivery');
      assert.ok(q, 'radish-delivery 应有状态');
      assert.equal(q.target, 3);
      assert.equal(q.progress, 0);
      assert.equal(q.ready, false);
      assert.equal(q.claimed, false);
      assert.equal(q.npc, 'miller');
      assert.ok(q.delivery, '交付任务应带 delivery 描述');

      const locked = g.questStatus('market-supply');
      assert.equal(locked.locked, true, 'market-supply 前置未完成应 locked');
    });

    test('交付任务：材料不足时不扣物、不发奖、状态不变', () => {
      const g = newGame();
      standNear(g, 'miller');
      g.state.bag.radish = 2; // 需要 3
      const before = JSON.stringify(g.state);
      const r = g.claimQuest('radish-delivery');
      assert.equal(r.ok, false, '材料不足应拒绝');
      assert.equal(JSON.stringify(g.state), before, '失败路径不能有任何扣物或加钱');
      assert.equal(g.state.bag.radish, 2);
    });

    test('交付任务：材料足够时一次扣清并只发一次奖', () => {
      const g = newGame();
      standNear(g, 'miller');
      g.state.bag.radish = 5;
      const money = g.state.money;
      const r = g.claimQuest('radish-delivery');
      assert.equal(r.ok, true);
      assert.equal(g.state.bag.radish, 2, '应正好扣掉 3 个萝卜，剩余 2');
      assert.equal(g.state.money, money + 90);
      assert.ok(g.state.claimed.includes('radish-delivery'));

      const again = g.claimQuest('radish-delivery');
      assert.equal(again.ok, false, '不能重复领取');
      assert.equal(g.state.money, money + 90, '重复领取不得加钱');
      assert.equal(g.state.bag.radish, 2, '重复领取不得再扣物');
      assert.equal(g.state.claimed.filter((id) => id === 'radish-delivery').length, 1);
    });

    test('多材料交付任务按每种材料校验，缺少任意一种就整体拒绝', () => {
      const g = newGame();
      standNear(g, 'ranger');
      // forest-supplies 前置是 forest-gardener，先标记已领以解锁
      g.state.claimed.push('forest-gardener');
      g.state.bag.carrot = 4;
      g.state.bag.berry = 1; // 需要 2
      const before = JSON.stringify(g.state);
      assert.equal(g.claimQuest('forest-supplies').ok, false, '草莓不足应整体拒绝');
      assert.equal(JSON.stringify(g.state), before, '部分材料也不得被扣掉');

      g.state.bag.berry = 2;
      const money = g.state.money;
      assert.equal(g.claimQuest('forest-supplies').ok, true);
      assert.equal(g.state.bag.carrot, 0);
      assert.equal(g.state.bag.berry, 0);
      assert.equal(g.state.money, money + 240);
    });

    test('砍伐/采集类交付会扣 wood / stone', () => {
      const g = newGame();
      standNear(g, 'miner');
      g.state.wood = 10;
      g.state.stone = 5; // 需要 6
      const before = JSON.stringify(g.state);
      assert.equal(g.claimQuest('stone-sample').ok, false, '石头不足应拒绝');
      assert.equal(JSON.stringify(g.state), before);

      g.state.stone = 6;
      const wood = g.state.wood;
      const money = g.state.money;
      assert.equal(g.claimQuest('stone-sample').ok, true);
      assert.equal(g.state.stone, 0);
      assert.equal(g.state.wood, wood, '石头任务不应扣木头');
      assert.equal(g.state.money, money + 100);
    });

    test('前置未完成时锁定，完成后才可领取', () => {
      const g = newGame();
      standNear(g, 'miller');
      g.state.stats.sold = 20; // 达成 market-supply 的计数
      const before = JSON.stringify(g.state);
      assert.equal(g.claimQuest('market-supply').ok, false, '前置 radish-delivery 未领，应锁定');
      assert.equal(JSON.stringify(g.state), before, '锁定失败不应改变状态');

      // 完成前置
      standNear(g, 'miller');
      g.state.bag.radish = 3;
      assert.equal(g.claimQuest('radish-delivery').ok, true);

      const money = g.state.money;
      assert.equal(g.claimQuest('market-supply').ok, true, '前置完成后应可领取');
      assert.equal(g.state.money, money + 150, '统计任务不应扣物');
      assert.equal(g.state.stats.sold, 20, '统计任务不改统计数');
    });

    test('远离发起 NPC 时拒绝交付，且不扣任何材料', () => {
      const g = newGame();
      g.state.bag.radish = 3;
      // 站在远离 miller 的位置（出生点）
      stand(g, 12, 8);
      const before = JSON.stringify(g.state);
      const r = g.claimQuest('radish-delivery');
      assert.equal(r.ok, false, '距离太远应拒绝');
      assert.equal(JSON.stringify(g.state), before, '远距拒绝不得扣物');
      assert.equal(g.state.bag.radish, 3);
    });

    test('day 型统计任务读取 state.day', () => {
      const g = newGame();
      standNear(g, 'miner');
      g.state.claimed.push('workshop-order'); // 解锁 settled-in
      g.state.day = 9;
      assert.equal(g.questStatus('settled-in').progress, 9);
      assert.equal(g.questStatus('settled-in').ready, false);
      const before = JSON.stringify(g.state);
      assert.equal(g.claimQuest('settled-in').ok, false, '第 9 天不该完成 day10 任务');
      assert.equal(JSON.stringify(g.state), before);

      g.state.day = 10;
      const money = g.state.money;
      assert.equal(g.claimQuest('settled-in').ok, true);
      assert.equal(g.state.money, money + 200);
    });
  });

  describe('旧 2.1 存档兼容', () => {
    test('旧的 version 2 存档读入后保留钱/背包/地块/清理记录，且不因重布景被拒', () => {
      // 构造一份“2.1 时代”的存档：30×22 世界里的坐标、旧 plots、旧 cleared
      const g = newGame();
      const save = g.snapshot();
      save.version = 2;
      save.money = 1234;
      save.bag.radish = 7;
      save.plots = {
        '10,12': { watered: false, crop: { id: 'radish', age: 1 } },
        '5,10': { watered: true, crop: null },
      };
      // 旧 cleared：既包含仍在家田外的坐标，也包含如今落进新农田的坐标
      save.cleared = ['10,19', '40,20'];

      const fresh = newGame(777);
      assert.doesNotThrow(() => fresh.restore(save), '旧 2.1 存档不应因重布景被拒绝');
      assert.equal(fresh.state.money, 1234, '钱必须保留');
      assert.equal(fresh.state.bag.radish, 7, '背包必须保留');
      assert.equal(Object.keys(fresh.state.plots).length, 2, '原地块必须保留');
      assert.equal(plotAt(fresh, 10, 12).crop.id, 'radish');
      assert.equal(plotAt(fresh, 5, 10).watered, true);
      assert.deepEqual([...fresh.state.cleared].sort(), ['10,19', '40,20'].sort(), '清理记录必须保留');
      // 兼容存档后仍可继续正常操作
      standNear(fresh, 'shop');
      assert.equal(fresh.buy('radish', 1).ok, true);
    });

    test('旧 2.1 存档读入后仍能在原地块上收获与睡觉生长', () => {
      const g = newGame();
      const save = g.snapshot();
      save.plots = { '10,12': { watered: true, crop: { id: 'radish', age: 0 } } };
      const fresh = newGame(5);
      fresh.restore(save);

      standNear(fresh, 'home');
      const r = fresh.sleep();
      assert.equal(r.ok, true);
      assert.equal(plotAt(fresh, 10, 12).crop.age, 1, '旧地块读入后应能正常生长');
    });
  });

  describe('扩建区域可正常游玩', () => {
    test('东田与西田南段都能开垦、播种、浇水、隔夜生长、收获', () => {
      const g = newGame();
      // 东田 (35,20) 与西田南段 (10,22)，都远离旧 30×22 地图中心
      const targets = [[35, 20], [10, 22]];
      for (const [x, y] of targets) {
        standAdjacentTo(g, x, y);
        assert.equal(g.use('hoe', 'radish', x, y).ok, true, '开垦 (' + x + ',' + y + ')');
        assert.equal(g.use('seed', 'radish', x, y).ok, true, '播种 (' + x + ',' + y + ')');
        ensureWatered(g, x, y);
      }
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true, '扩区地块应能参与睡觉生长');
      for (const [x, y] of targets) {
        assert.equal(plotAt(g, x, y).crop.age, 1, '(' + x + ',' + y + ') 应长了一天');
      }
      standNear(g, 'home');
      for (const [x, y] of targets) ensureWatered(g, x, y);
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      for (const [x, y] of targets) {
        standAdjacentTo(g, x, y);
        assert.equal(g.use('harvest', 'radish', x, y).ok, true, '收获 (' + x + ',' + y + ')');
      }
      assert.equal(g.state.bag.radish, 2, '两块扩区地块都应产出');
    });

    test('新地图上的可清理资源数量多于旧版 24 个，且不与农田/路/建筑/水重叠', () => {
      const g = newGame();
      const obstacles = [];
      for (let y = 0; y < MAP.rows; y++) {
        for (let x = 0; x < MAP.cols; x++) {
          const ob = g.obstacleAt(x, y);
          if (ob) obstacles.push(ob);
        }
      }
      assert.ok(obstacles.length > 24, '新地图资源数量应多于旧版 24，实际 ' + obstacles.length);
      for (const ob of obstacles) {
        assert.equal(g.isFarmTile(ob.x, ob.y), false, '障碍不应生成在农田上：' + JSON.stringify(ob));
        const t = g.tileAt(ob.x, ob.y);
        assert.equal(t, 'grass', '障碍应只在草地上：' + JSON.stringify(ob) + ' 实际 ' + t);
        for (const id of Object.keys(LOCATIONS)) {
          const l = loc(id);
          assert.ok(cheb(ob.x, ob.y, l.x, l.y) > 0, '障碍不应压在地点上：' + JSON.stringify(ob));
        }
      }
    });
  });
}
