// 栖砂·田园记 2.3 生产经营验收测试（牧场 / 加工 / 雇工 / 新地貌 / 旧存档迁移）
// 运行（仓库根目录）：
//   node --test --test-isolation=none tests/production.test.mjs
//   （DSH 沙箱禁止 test runner spawn 子进程，普通机器上 node --test tests/production.test.mjs 亦可）
//
// 直接加载真实核心 ../src/farm-core.js（UMD，createRequire），不写任何镜像实现。
// 如需先试跑候选核心：设置环境变量 FARM_CORE_FILE=<相对 tests/ 的路径或绝对路径>。
// 契约：.work/production-contract.md
//
// 覆盖：
//   1. 新导出与地图/河道/地貌/352 格农田/所有地点可达
//   2. buildFacility 成功闭环与钱料不足、重复、远距离的原子失败
//   3. buyAnimal / buyFeed 的上限、余额、设施前置与非法数量
//   4. feedAnimals 每天只结算一次、无饲料拒绝、漏喂不死
//   5. collectAnimalProducts 一次收完、零产出拒绝不改状态
//   6. craft / collectCrafted 的队列上限、材料不足、未到期拒绝、次日到期可收
//   7. hireHelper / fireHelper 的费用、重复、远距离
//   8. sleep 中帮手「先浇后生长」「后采收」的顺序与工资只在有工作且钱够时扣
//   9. 旧存档缺新字段自动迁移、新字段非法必须拒绝且状态不变
//  10. sellAll 按 ITEMS 结算产品
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
  test('src/farm-core.js 应存在且能通过 createRequire 加载（UMD + module.exports）', () => {
    throw loadError;
  });
} else {
  const { FarmGame, MAP, LOCATIONS, CROPS } = FarmCore;

  // ---------------------------------------------------------------- 通用工具

  const newGame = (seed = 20261029) => new FarmGame(seed);
  const stand = (g, x, y) => { g.state.player.x = x; g.state.player.y = y; };
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP.cols && y < MAP.rows;
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const loc = (id) => {
    const L = LOCATIONS;
    if (!L) return undefined;
    if (Array.isArray(L)) return L.find((v) => v.id === id) || L.find((v) => v.name === id);
    return L[id];
  };

  const NEIGHBOURS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // 站到某个地点旁边（只改 state.player 构造场景）
  const standNear = (g, id) => {
    const target = loc(id);
    assert.ok(target, 'LOCATIONS 里应有 ' + id);
    for (const pair of NEIGHBOURS) {
      const x = target.x + pair[0];
      const y = target.y + pair[1];
      if (!inBounds(x, y)) continue;
      if (g.isWalkable(x, y)) { stand(g, x, y); return { x, y }; }
    }
    throw new Error('找不到 ' + id + ' 旁可站立的位置');
  };

  // 站到某格的相邻可走格（工具目标只允许 Chebyshev<=1）
  const standAdjacentTo = (g, tx, ty) => {
    for (const pair of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = tx + pair[0];
      const y = ty + pair[1];
      if (!inBounds(x, y)) continue;
      if (g.isWalkable(x, y)) { stand(g, x, y); return { x, y }; }
    }
    throw new Error('找不到 (' + tx + ',' + ty + ') 旁边可站立的位置');
  };

  // 站到离所有新地点都很远的地方（用于远距离失败断言）
  const standAwayFromLocations = (g, ids = ['ranch', 'workshop', 'guild']) => {
    const targets = ids.map((id) => loc(id)).filter(Boolean);
    for (let y = 0; y < MAP.rows; y++) {
      for (let x = 0; x < MAP.cols; x++) {
        if (!g.isWalkable(x, y)) continue;
        if (targets.every((t) => cheb(x, y, t.x, t.y) > 2)) { stand(g, x, y); return { x, y }; }
      }
    }
    throw new Error('找不到远离新地点的落脚点');
  };

  const standNearAny = (g, ids) => {
    for (const id of ids) {
      const target = loc(id);
      if (!target) continue;
      for (const pair of NEIGHBOURS) {
        const x = target.x + pair[0];
        const y = target.y + pair[1];
        if (!inBounds(x, y)) continue;
        if (g.isWalkable(x, y) && g._near(id)) return { x, y, id };
      }
    }
    throw new Error('找不到靠近 ' + ids.join('/') + ' 的位置');
  };

  // 从当前玩家位置出发、只走 isWalkable 的四方向 BFS
  const reachableFrom = (g) => {
    const seen = new Set();
    const start = g.state.player;
    const queue = [[start.x, start.y]];
    seen.add(start.x + ',' + start.y);
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i][0], y = queue[i][1];
      for (const pair of ORTHO) {
        const nx = x + pair[0], ny = y + pair[1];
        const k = nx + ',' + ny;
        if (seen.has(k) || !inBounds(nx, ny) || !g.isWalkable(nx, ny)) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
    return seen;
  };

  // 在 isFarmTile 里挑一个可用格子（优先未被占用）
  const findFarmTiles = (g, count) => {
    const out = [];
    for (let y = 0; y < MAP.rows && out.length < count; y++) {
      for (let x = 0; x < MAP.cols && out.length < count; x++) {
        if (!g.isFarmTile(x, y)) continue;
        if (g.state.plots[x + ',' + y]) continue;
        out.push([x, y]);
      }
    }
    assert.equal(out.length, count, '农田数量不足，无法构造场景');
    return out;
  };

  // 造一块已开垦 + 已播种 + 已浇水的田（用真实 API，不改内部结构）
  const plant = (g, x, y, cropId = 'radish') => {
    standAdjacentTo(g, x, y);
    assert.equal(g.use('hoe', cropId, x, y).ok, true, '开垦 (' + x + ',' + y + ') 应成功');
    assert.equal(g.use('seed', cropId, x, y).ok, true, '播种 (' + x + ',' + y + ') 应成功');
    assert.equal(g.use('water', cropId, x, y).ok, true, '浇水 (' + x + ',' + y + ') 应成功');
  };

  // 让玩家精力/钱/材料充足（直接写 state，仅用于构造前置条件）
  const grant = (g, patch) => {
    Object.keys(patch).forEach((k) => {
      if (k === 'bag' || k === 'seeds' || k === 'stats') g.state[k] = Object.assign({}, g.state[k], patch[k]);
      else g.state[k] = patch[k];
    });
  };

  // 每一次失败都必须是「原子」的：state 一个字节都不许变
  const assertAtomic = (g, fn, label) => {
    const before = g.snapshot();
    const result = fn();
    assert.equal(result && result.ok, false, label + ' 应该失败，实际返回：' + JSON.stringify(result));
    assert.equal(typeof result.message, 'string', label + ' 失败时应带中文消息');
    assert.ok(result.message.length > 0, label + ' 失败消息不能为空');
    assert.deepEqual(g.snapshot(), before, label + ' 失败后状态必须完全不变（原子性）');
    return result;
  };

  // 把新地点都站一遍的通用前置：建好设施 + 备好钱料
  const RICH = { money: 5000, wood: 200, stone: 200 };

  // 便捷：直接建好合作设施（走真实 API）
  const buildAll = (g) => {
    grant(g, RICH);
    standNear(g, 'ranch');
    assert.equal(g.buildFacility('coop').ok, true, '建鸡舍应成功');
    assert.equal(g.buildFacility('barn').ok, true, '建牛棚应成功');
    standNear(g, 'workshop');
    assert.equal(g.buildFacility('workshop').ok, true, '建加工坊应成功');
  };

  // 便捷：买动物 + 买饲料
  const stockRanch = (g, chickens = 2, cows = 1, feed = 20) => {
    standNear(g, 'ranch');
    if (chickens) assert.equal(g.buyAnimal('chicken', chickens).ok, true, '买鸡应成功');
    if (cows) assert.equal(g.buyAnimal('cow', cows).ok, true, '买牛应成功');
    if (feed) assert.equal(g.buyFeed(feed).ok, true, '买饲料应成功');
  };

  const nightAndSleep = (g) => {
    standNear(g, 'home');
    const r = g.sleep();
    assert.equal(r.ok, true, '在小屋旁睡觉应成功：' + (r && r.message));
    return r;
  };

  // ---------------------------------------------------------------- 1. 导出与地图

  describe('新导出与地图', () => {
    test('PRODUCTS / ITEMS / RECIPES / BUILDINGS / HELPERS 结构与价格符合契约', () => {
      const { PRODUCTS, ITEMS, RECIPES, BUILDINGS, HELPERS } = FarmCore;
      assert.ok(PRODUCTS && typeof PRODUCTS === 'object', '应导出 PRODUCTS');
      assert.deepEqual(Object.keys(PRODUCTS).sort(), ['cheese', 'egg', 'jam', 'mayo', 'milk']);
      const prices = { egg: 25, milk: 60, mayo: 80, cheese: 180, jam: 180 };
      for (const id of Object.keys(prices)) {
        assert.equal(PRODUCTS[id].sellPrice, prices[id], PRODUCTS[id].name || id + ' 售价应为 ' + prices[id]);
        assert.equal(typeof PRODUCTS[id].name, 'string');
      }

      assert.ok(ITEMS && typeof ITEMS === 'object', '应导出 ITEMS');
      for (const id of Object.keys(CROPS)) assert.ok(ITEMS[id], 'ITEMS 应包含作物 ' + id);
      for (const id of Object.keys(PRODUCTS)) assert.ok(ITEMS[id], 'ITEMS 应包含产品 ' + id);
      assert.equal(Object.keys(ITEMS).length, 8, 'ITEMS 应为 8 种（3 作物 + 5 产品）');

      assert.ok(RECIPES, '应导出 RECIPES');
      assert.deepEqual(Object.keys(RECIPES).sort(), ['cheese', 'jam', 'mayo']);
      assert.deepEqual(RECIPES.mayo.ingredients, { egg: 2 });
      assert.deepEqual(RECIPES.cheese.ingredients, { milk: 2 });
      assert.deepEqual(RECIPES.jam.ingredients, { berry: 2 });
      for (const id of Object.keys(RECIPES)) assert.equal(RECIPES[id].days, 1, id + ' 加工周期应为 1 天');

      assert.ok(BUILDINGS, '应导出 BUILDINGS');
      assert.deepEqual(BUILDINGS.coop, Object.assign({ name: '鸡舍' }, { money: 120, wood: 6, stone: 0 }));
      assert.deepEqual(BUILDINGS.barn, Object.assign({ name: '牛棚' }, { money: 300, wood: 12, stone: 6 }));
      assert.deepEqual(BUILDINGS.workshop, Object.assign({ name: '加工坊' }, { money: 180, wood: 6, stone: 4 }));

      assert.ok(HELPERS, '应导出 HELPERS');
      assert.deepEqual(HELPERS.waterer, { name: '浇水帮手', hirePrice: 50, wage: 25, capacity: 12 });
      assert.deepEqual(HELPERS.harvester, { name: '采收帮手', hirePrice: 60, wage: 30, capacity: 8 });
    });

    test('新地点 ranch/workshop/guild 存在，旧地点不变', () => {
      const expected = {
        ranch: { x: 2, y: 8 },
        workshop: { x: 25, y: 10 },
        guild: { x: 28, y: 7 }
      };
      for (const id of Object.keys(expected)) {
        const l = loc(id);
        assert.ok(l, 'LOCATIONS 应包含 ' + id);
        assert.equal(l.x, expected[id].x, id + ' 的 x');
        assert.equal(l.y, expected[id].y, id + ' 的 y');
        assert.equal(typeof l.name, 'string');
      }
      assert.equal(loc('home').x, 6, '旧小屋位置不变');
      assert.equal(loc('home').y, 7);
      assert.equal(loc('shop').x, 23, '旧杂货铺位置不变');
      assert.equal(loc('bin').x, 10, '旧出货箱位置不变');
      assert.equal(loc('npc').x, 20, '阿禾位置不变');
      assert.equal(loc('well').x, 19, '石井位置不变');
    });

    test('河道 x40..41,y10..28 为水，y20 是桥（可走），且不覆盖任何田地', () => {
      const g = newGame();
      for (let y = 10; y <= 28; y++) {
        for (const x of [40, 41]) {
          const t = g.tileAt(x, y);
          if (y === 20) {
            assert.notEqual(t, 'water', '(' + x + ',' + y + ') 桥所在行不应该是水');
            assert.equal(g.isWalkable(x, y), true, '(' + x + ',' + y + ') 桥应可通行');
          } else {
            assert.equal(t, 'water', '(' + x + ',' + y + ') 应为河道水面，实际 ' + t);
            assert.equal(g.isFarmTile(x, y), false, '(' + x + ',' + y + ') 是水，不能是田地');
          }
        }
      }
    });

    test('biomeAt 覆盖新地貌：woodland / highland / riverbank / meadow / village / farmland', () => {
      const g = newGame();
      assert.equal(typeof g.biomeAt, 'function', '应有 biomeAt 方法');
      const expect = (x, y, names, label) => {
        const got = g.biomeAt(x, y);
        assert.ok(got !== undefined && got !== null, label + ' (' + x + ',' + y + ') 应有地貌值');
        assert.ok(names.indexOf(got) >= 0, label + ' (' + x + ',' + y + ') 地貌应为 ' + names.join('/') + '，实际 ' + got);
      };
      expect(0, 12, ['woodland'], '林地');
      expect(4, 26, ['woodland'], '林地');
      expect(28, 1, ['highland'], '高地');
      expect(40, 3, ['highland'], '高地');
      expect(41, 25, ['riverbank', 'water'], '河岸');
      expect(39, 22, ['riverbank'], '河岸');
      expect(20, 24, ['meadow'], '草甸');
      expect(27, 28, ['meadow'], '草甸');
      expect(3, 2, ['village'], 'village 区');
      expect(10, 15, ['farmland'], '农田区');
    });

    test('农田仍是 352 格，新河/牧场建筑不侵占农田', () => {
      const g = newGame();
      let n = 0;
      for (let y = 0; y < MAP.rows; y++) {
        for (let x = 0; x < MAP.cols; x++) if (g.isFarmTile(x, y)) n++;
      }
      assert.equal(n, 352, '农田总格数应保持 352');
    });

    test('所有地点（含新地点）都能从出生点走到；牧场建筑不可走但入口可到', () => {
      const g = newGame();
      const reachable = reachableFrom(g);
      for (const id of ['home', 'shop', 'bin', 'npc', 'well', 'miller', 'ranger', 'miner', 'florist', 'ranch', 'workshop', 'guild']) {
        const target = loc(id);
        assert.ok(target, 'LOCATIONS 应包含 ' + id);
        const ok = NEIGHBOURS.some((pair) => reachable.has((target.x + pair[0]) + ',' + (target.y + pair[1])));
        assert.ok(ok, '地点 ' + id + ' 应能从出生点走到（含其相邻格）');
      }
      // 牧场建筑本体 x0..2,y4..7 不可走
      for (let y = 4; y <= 7; y++) {
        for (let x = 0; x <= 2; x++) {
          assert.equal(g.isWalkable(x, y), false, '牧场建筑 (' + x + ',' + y + ') 应不可走');
        }
      }
      // 入口 (2,8) 可达
      assert.equal(reachable.has('2,8'), true, '牧场入口 (2,8) 应可达');
    });
  });

  // ---------------------------------------------------------------- 2. buildFacility

  describe('建造设施 buildFacility', () => {
    test('成功闭环：在牧场旁建鸡舍/牛棚，在加工坊旁建加工坊，扣钱扣料仅一次', () => {
      const g = newGame();
      grant(g, RICH);
      standNear(g, 'ranch');
      const before = g.snapshot();
      const r1 = g.buildFacility('coop');
      assert.equal(r1.ok, true, '建鸡舍应成功：' + (r1 && r1.message));
      assert.equal(g.state.money, before.money - 120);
      assert.equal(g.state.wood, before.wood - 6);
      assert.equal(g.state.stone, before.stone - 0);
      assert.equal(g.state.livestock.coop, true, 'coop 标记应为 true');

      const r2 = g.buildFacility('barn');
      assert.equal(r2.ok, true, '建牛棚应成功：' + (r2 && r2.message));
      assert.equal(g.state.money, before.money - 120 - 300);
      assert.equal(g.state.wood, before.wood - 6 - 12);
      assert.equal(g.state.stone, before.stone - 6);
      assert.equal(g.state.livestock.barn, true);

      standNear(g, 'workshop');
      const beforeW = g.snapshot();
      const r3 = g.buildFacility('workshop');
      assert.equal(r3.ok, true, '建加工坊应成功：' + (r3 && r3.message));
      assert.equal(g.state.money, beforeW.money - 180);
      assert.equal(g.state.wood, beforeW.wood - 6);
      assert.equal(g.state.stone, beforeW.stone - 4);
      assert.equal(g.state.industry.built, true, 'industry.built 应为 true');
    });

    test('钱不足 / 木头不足 / 石头不足 / 未知设施 全部原子失败', () => {
      const g = newGame();
      standNear(g, 'ranch');
      grant(g, { money: 119, wood: 100, stone: 100 });
      assertAtomic(g, () => g.buildFacility('coop'), '钱不够建鸡舍');

      grant(g, { money: 1000, wood: 5, stone: 100 });
      assertAtomic(g, () => g.buildFacility('coop'), '木头不够建鸡舍');

      grant(g, { money: 1000, wood: 100, stone: 5 });
      assertAtomic(g, () => g.buildFacility('barn'), '石头不够建牛棚');

      grant(g, RICH);
      assertAtomic(g, () => g.buildFacility('castle'), '未知设施 id');

      grant(g, { money: 1000, wood: 100, stone: 0 });
      assertAtomic(g, () => g.buildFacility('workshop'), '石头不够建加工坊');
    });

    test('重复建造被拒绝且不重复扣费', () => {
      const g = newGame();
      buildAll(g);
      standNear(g, 'ranch');
      assertAtomic(g, () => g.buildFacility('coop'), '重复建鸡舍');
      assertAtomic(g, () => g.buildFacility('barn'), '重复建牛棚');
      standNear(g, 'workshop');
      const before = g.snapshot();
      assertAtomic(g, () => g.buildFacility('workshop'), '重复建加工坊');
      assert.deepEqual(g.snapshot(), before, '重复建造后状态应不变');
    });

    test('远距离建造被拒绝，且不扣任何钱料', () => {
      const g = newGame();
      grant(g, RICH);
      standAwayFromLocations(g, ['ranch', 'workshop']);
      assertAtomic(g, () => g.buildFacility('coop'), '远离牧场建鸡舍');
      assertAtomic(g, () => g.buildFacility('workshop'), '远离加工坊建加工坊');
    });
  });

  // ---------------------------------------------------------------- 3. 动物与饲料

  describe('购买动物与饲料', () => {
    test('买鸡/买牛成功扣钱并计数，价格为 80 / 220', () => {
      const g = newGame();
      buildAll(g);
      standNear(g, 'ranch');
      const before = g.snapshot();
      assert.equal(g.buyAnimal('chicken', 2).ok, true);
      assert.equal(g.state.money, before.money - 160, '两只鸡应扣 160');
      assert.equal(g.state.livestock.chickens, 2);
      const mid = g.snapshot();
      assert.equal(g.buyAnimal('cow', 1).ok, true);
      assert.equal(g.state.money, mid.money - 220, '一头牛应扣 220');
      assert.equal(g.state.livestock.cows, 1);
    });

    test('没有对应设施 / 超出上限 / 非法数量 / 钱不足 / 远距离 全部原子失败', () => {
      const g = newGame();
      grant(g, RICH);
      standNear(g, 'ranch');
      assertAtomic(g, () => g.buyAnimal('chicken', 1), '未建鸡舍买鸡');

      buildAll(g);
      standNear(g, 'ranch');
      assertAtomic(g, () => g.buyAnimal('chicken', 0), '鸡数量 0');
      assertAtomic(g, () => g.buyAnimal('chicken', -1), '鸡数量 -1');
      assertAtomic(g, () => g.buyAnimal('chicken', 1.5), '鸡数量 1.5');
      assertAtomic(g, () => g.buyAnimal('sheep', 1), '未知动物类型');

      assert.equal(g.buyAnimal('chicken', 6).ok, true, '刚好买满 6 只鸡应成功');
      assertAtomic(g, () => g.buyAnimal('chicken', 1), '超过 6 只鸡上限');

      assert.equal(g.buyAnimal('cow', 3).ok, true, '刚好买满 3 头牛应成功');
      assertAtomic(g, () => g.buyAnimal('cow', 1), '超过 3 头牛上限');

      const poor = newGame();
      buildAll(poor);
      standNear(poor, 'ranch');
      grant(poor, { money: 79 });
      assertAtomic(poor, () => poor.buyAnimal('chicken', 1), '钱不够买鸡');

      const far = newGame();
      buildAll(far);
      standAwayFromLocations(far, ['ranch']);
      assertAtomic(far, () => far.buyAnimal('chicken', 1), '远离牧场买鸡');
    });

    test('买饲料：5G 一份，正整数 1..99，ranch 或 shop 旁可买', () => {
      const g = newGame();
      grant(g, RICH);
      standNear(g, 'ranch');
      const before = g.snapshot();
      assert.equal(g.buyFeed(3).ok, true, '牧场旁买 3 份饲料');
      assert.equal(g.state.money, before.money - 15);
      assert.equal(g.state.livestock.feed, 3);

      standNear(g, 'shop');
      const mid = g.snapshot();
      assert.equal(g.buyFeed(1).ok, true, '杂货铺旁也能买饲料');
      assert.equal(g.state.money, mid.money - 5);

      standNear(g, 'ranch');
      assertAtomic(g, () => g.buyFeed(0), '饲料数量 0');
      assertAtomic(g, () => g.buyFeed(100), '饲料数量 100 超上限');
      assertAtomic(g, () => g.buyFeed(2.5), '饲料数量 2.5');
      grant(g, { money: 4 });
      assertAtomic(g, () => g.buyFeed(1), '钱不够买一份饲料');

      const far = newGame();
      grant(far, RICH);
      standAwayFromLocations(far, ['ranch', 'shop']);
      assertAtomic(far, () => far.buyFeed(1), '远离牧场与杂货铺买饲料');
    });
  });

  // ---------------------------------------------------------------- 4. 喂养与收取

  describe('喂养与动物产出', () => {
    test('喂一次扣对应饲料并记 fedAtDay；当天再次喂养被拒绝', () => {
      const g = newGame();
      buildAll(g);
      stockRanch(g, 2, 1, 20);
      standNear(g, 'ranch');
      const before = g.snapshot();
      const r = g.feedAnimals();
      assert.equal(r.ok, true, '首次喂养应成功：' + (r && r.message));
      assert.equal(g.state.livestock.feed, before.livestock.feed - (2 + 2 * 1), '应消耗 chickens + 2*cows 份饲料');
      assert.equal(g.state.livestock.fedAtDay, g.state.day, 'fedAtDay 应记录当前 day');
      assertAtomic(g, () => g.feedAnimals(), '同一天重复喂养');
    });

    test('无动物 / 已喂 / 饲料不足 / 远距离 全部拒绝且不改状态', () => {
      const g = newGame();
      buildAll(g);
      standNear(g, 'ranch');
      assertAtomic(g, () => g.feedAnimals(), '没有动物时喂养');

      assert.equal(g.buyAnimal('chicken', 1).ok, true);
      assert.equal(g.buyFeed(1).ok, true);
      const mid = g.snapshot();
      assert.equal(g.feedAnimals().ok, true, '有饲料时应能喂');
      assertAtomic(g, () => g.feedAnimals(), '当天第二次喂养');

      const empty = newGame();
      buildAll(empty);
      standNear(empty, 'ranch');
      assert.equal(empty.buyAnimal('cow', 1).ok, true);
      assertAtomic(empty, () => empty.feedAnimals(), '牛需要 2 份饲料，库存为 0 时喂养');

      const far = newGame();
      buildAll(far);
      stockRanch(far, 1, 0, 10);
      standAwayFromLocations(far, ['ranch']);
      assertAtomic(far, () => far.feedAnimals(), '远离牧场喂养');
    });

    test('喂养只结算一次：睡两晚只产一次；漏喂则不产但动物不死', () => {
      const g = newGame();
      buildAll(g);
      stockRanch(g, 3, 2, 20);
      standNear(g, 'ranch');
      assert.equal(g.feedAnimals().ok, true, '喂 3 只鸡 2 头牛');

      nightAndSleep(g); // day -> 2，结算一次
      const eggs = g.state.livestock.eggsReady;
      const milk = g.state.livestock.milkReady;
      assert.equal(eggs, 3, '3 只鸡应产出 3 个蛋');
      assert.equal(milk, 2, '2 头牛应产出 2 份奶');

      // 第二天不喂：再睡一晚不应再加产
      nightAndSleep(g); // day -> 3
      assert.equal(g.state.livestock.eggsReady, eggs, '没喂就不应该继续产蛋');
      assert.equal(g.state.livestock.milkReady, milk, '没喂就不应该继续产奶');
      assert.equal(g.state.livestock.chickens, 3, '漏喂不会让鸡死亡');
      assert.equal(g.state.livestock.cows, 2, '漏喂不会让牛死亡');

      // 再喂一次，只结算这一次
      standNear(g, 'ranch');
      assert.equal(g.feedAnimals().ok, true, '第三天可以再喂');
      nightAndSleep(g); // day -> 4
      assert.equal(g.state.livestock.eggsReady, eggs + 3, '新一次喂养应再产 3 个蛋');
      assert.equal(g.state.livestock.milkReady, milk + 2, '新一次喂养应再产 2 份奶');
    });

    test('收取产物一次清空并进背包；零产出拒绝且不改状态', () => {
      const g = newGame();
      buildAll(g);
      stockRanch(g, 2, 1, 20);
      standNear(g, 'ranch');
      assertAtomic(g, () => g.collectAnimalProducts(), '还没有产出时收取');

      assert.equal(g.feedAnimals().ok, true);
      nightAndSleep(g);
      standNear(g, 'ranch');
      const before = g.snapshot();
      const r = g.collectAnimalProducts();
      assert.equal(r.ok, true, '有产出时收取应成功：' + (r && r.message));
      assert.equal(g.state.bag.egg, (before.bag.egg || 0) + 2, '应收到 2 个蛋');
      assert.equal(g.state.bag.milk, (before.bag.milk || 0) + 1, '应收到 1 份奶');
      assert.equal(g.state.livestock.eggsReady, 0, '收取后待收蛋应归零');
      assert.equal(g.state.livestock.milkReady, 0, '收取后待收奶应归零');
      assertAtomic(g, () => g.collectAnimalProducts(), '刚收完再收一次');

      const far = newGame();
      buildAll(far);
      stockRanch(far, 1, 0, 10);
      standNear(far, 'ranch');
      assert.equal(far.feedAnimals().ok, true);
      nightAndSleep(far);
      standAwayFromLocations(far, ['ranch']);
      assertAtomic(far, () => far.collectAnimalProducts(), '远离牧场收取产物');
    });
  });

  // ---------------------------------------------------------------- 5. 加工坊

  describe('加工 craft / collectCrafted', () => {
    test('成功排产：扣材料、写 readyDay=day+1，不立刻给成品', () => {
      const g = newGame();
      buildAll(g);
      standNear(g, 'workshop');
      grant(g, { bag: { egg: 10, milk: 10, berry: 10 } });
      const before = g.snapshot();
      const r = g.craft('mayo', 2);
      assert.equal(r.ok, true, '加工蛋黄酱应成功：' + (r && r.message));
      assert.equal(g.state.bag.egg, before.bag.egg - 4, '2 份蛋黄酱需 4 个蛋');
      assert.equal(g.state.bag.mayo || 0, 0, '加工的产物不能立刻进背包');
      assert.equal(g.state.industry.jobs.length, 1, '应产生 1 个加工任务');
      const job = g.state.industry.jobs[0];
      assert.equal(job.recipe, 'mayo');
      assert.equal(job.qty, 2);
      assert.equal(job.readyDay, before.day + 1, 'readyDay 应为当前 day + 1');
    });

    test('未建加工坊 / 材料不足 / 非法数量 / 未知配方 / 远距离 全部原子失败', () => {
      const g = newGame();
      grant(g, { bag: { egg: 10, milk: 10, berry: 10 } });
      standNear(g, 'workshop');
      assertAtomic(g, () => g.craft('mayo', 1), '未建加工坊就加工');

      buildAll(g);
      standNear(g, 'workshop');
      assertAtomic(g, () => g.craft('mayo', 0), '数量 0');
      assertAtomic(g, () => g.craft('mayo', 6), '数量 6 超上限');
      assertAtomic(g, () => g.craft('mayo', 1.5), '数量 1.5');
      assertAtomic(g, () => g.craft('bread', 1), '未知配方');

      grant(g, { bag: { egg: 1, milk: 10, berry: 10 } });
      assertAtomic(g, () => g.craft('mayo', 1), '蛋不够加工蛋黄酱');
      grant(g, { bag: { egg: 10, milk: 1, berry: 10 } });
      assertAtomic(g, () => g.craft('cheese', 1), '奶不够加工奶酪');
      grant(g, { bag: { egg: 10, milk: 10, berry: 1 } });
      assertAtomic(g, () => g.craft('jam', 1), '草莓不够加工果酱');

      const far = newGame();
      buildAll(far);
      grant(far, { bag: { egg: 10, milk: 10, berry: 10 } });
      standAwayFromLocations(far, ['workshop']);
      assertAtomic(far, () => far.craft('mayo', 1), '远离加工坊加工');
    });

    test('队列最多 3 个，排满后再排产被拒绝且不扣材料', () => {
      const g = newGame();
      buildAll(g);
      standNear(g, 'workshop');
      grant(g, { bag: { egg: 90, milk: 90, berry: 90 } });
      for (let i = 0; i < 3; i++) {
        assert.equal(g.craft('mayo', 1).ok, true, '第 ' + (i + 1) + ' 个加工任务应能排入');
      }
      assert.equal(g.state.industry.jobs.length, 3, '队列应有 3 个任务');
      assertAtomic(g, () => g.craft('mayo', 1), '队列已满时再排产');
      assert.equal(g.state.industry.jobs.length, 3, '队列满失败后不应少扣材料或多出任务');
    });

    test('未到期拒绝收取；次日到期后可一次收完，未完成批次保留', () => {
      const g = newGame();
      buildAll(g);
      standNear(g, 'workshop');
      grant(g, { bag: { egg: 20, milk: 20, berry: 20 } });
      assert.equal(g.craft('mayo', 2).ok, true, '排产 2 份蛋黄酱');
      assert.equal(g.craft('cheese', 1).ok, true, '排产 1 份奶酪');
      assertAtomic(g, () => g.collectCrafted(), '当天未到期就收取');

      nightAndSleep(g); // day -> 2：蛋黄酱与奶酪都已到期
      standNear(g, 'workshop');
      const before = g.snapshot();
      const r = g.collectCrafted();
      assert.equal(r.ok, true, '到期后收取应成功：' + (r && r.message));
      assert.equal(g.state.bag.mayo, (before.bag.mayo || 0) + 2, '应收到 2 份蛋黄酱');
      assert.equal(g.state.bag.cheese, (before.bag.cheese || 0) + 1, '应收到 1 份奶酪');
      assert.equal(g.state.industry.jobs.length, 0, '全部到期后队列应清空');
      assert.equal(r.summary === undefined || r.summary.craftReady === undefined || r.summary.craftReady === 2, true, '如返回 summary.craftReady 应为 2');
    });

    test('到期收取：成品进背包、队列清空、再收一次失败', () => {
      const g = newGame();
      buildAll(g);
      standNear(g, 'workshop');
      grant(g, { bag: { egg: 20, milk: 20, berry: 20 } });
      assert.equal(g.craft('mayo', 2).ok, true);
      nightAndSleep(g);
      standNear(g, 'workshop');
      const before = g.snapshot();
      const r = g.collectCrafted();
      assert.equal(r.ok, true, '到期后收取应成功：' + (r && r.message));
      assert.equal(g.state.bag.mayo, (before.bag.mayo || 0) + 2, '应收到 2 份蛋黄酱');
      assert.equal(g.state.industry.jobs.length, 0, '到期任务应移出队列');
      assertAtomic(g, () => g.collectCrafted(), '没有已完成批次时收取');
    });

    test('混合队列：只收已到期批次，未到期保留', () => {
      const g = newGame();
      buildAll(g);
      standNear(g, 'workshop');
      grant(g, { bag: { egg: 20, milk: 20, berry: 20 } });
      assert.equal(g.craft('mayo', 1).ok, true);
      nightAndSleep(g); // day 2：mayo 已到期
      standNear(g, 'workshop');
      assert.equal(g.craft('cheese', 1).ok, true, '第二天再排一个奶酪（readyDay=3）');
      const before = g.snapshot();
      const r = g.collectCrafted();
      assert.equal(r.ok, true, '只收已到期批次应成功');
      assert.equal(g.state.bag.mayo, (before.bag.mayo || 0) + 1, '蛋黄酱应已收到');
      assert.equal(g.state.bag.cheese || 0, before.bag.cheese || 0, '奶酪未到期，不应进背包');
      assert.equal(g.state.industry.jobs.length, 1, '未到期任务应保留在队列');
      assert.equal(g.state.industry.jobs[0].recipe, 'cheese');
    });
  });

  // ---------------------------------------------------------------- 6. 帮手

  describe('雇工 hireHelper / fireHelper', () => {
    test('雇佣扣一次 hirePrice，重复雇佣被拒绝；解雇不退款不扣费', () => {
      const g = newGame();
      grant(g, RICH);
      standNear(g, 'guild');
      const before = g.snapshot();
      assert.equal(g.hireHelper('waterer').ok, true, '雇佣浇水帮手应成功');
      assert.equal(g.state.money, before.money - 50, '应扣 50G 雇佣费');
      assert.equal(g.state.helpers.waterer, true);
      assertAtomic(g, () => g.hireHelper('waterer'), '重复雇佣浇水帮手');

      const mid = g.snapshot();
      assert.equal(g.hireHelper('harvester').ok, true, '雇佣采收帮手应成功');
      assert.equal(g.state.money, mid.money - 60, '应扣 60G 雇佣费');

      const beforeFire = g.snapshot();
      const fire = g.fireHelper('waterer');
      assert.equal(fire.ok, true, '解雇应成功：' + (fire && fire.message));
      assert.equal(g.state.helpers.waterer, false, '解雇后标记应为 false');
      assert.equal(g.state.money, beforeFire.money, '解雇不退款也不扣费');
    });

    test('钱不足 / 未知帮手 / 未雇就解雇 / 远距离 全部原子失败', () => {
      const g = newGame();
      grant(g, { money: 49 });
      standNear(g, 'guild');
      assertAtomic(g, () => g.hireHelper('waterer'), '钱不够雇佣浇水帮手');
      grant(g, RICH);
      assertAtomic(g, () => g.hireHelper('chef'), '未知帮手 id');
      assertAtomic(g, () => g.fireHelper('harvester'), '没雇过就解雇');

      const far = newGame();
      grant(far, RICH);
      standAwayFromLocations(far, ['guild']);
      assertAtomic(far, () => far.hireHelper('waterer'), '远离帮手驿站雇佣');
    });
  });

  // ---------------------------------------------------------------- 7. sleep 中的帮手

  describe('睡觉结算中的帮手顺序与工资', () => {
    test('浇水帮手在生长前浇水：只浇未湿且未成熟的至多 12 块，扣 25G', () => {
      const g = newGame();
      grant(g, RICH);
      standNear(g, 'guild');
      assert.equal(g.hireHelper('waterer').ok, true, '雇浇水帮手');

      // 造 3 块萝卜，全部不浇水
      const tiles = findFarmTiles(g, 3);
      for (const t of tiles) {
        standAdjacentTo(g, t[0], t[1]);
        assert.equal(g.use('hoe', 'radish', t[0], t[1]).ok, true);
        assert.equal(g.use('seed', 'radish', t[0], t[1]).ok, true);
      }
      for (const t of tiles) assert.equal(g.state.plots[t[0] + ',' + t[1]].watered, false, '初始应为未浇水');

      // 保证第二天晴天，避免雨水替玩家浇水
      let guard = 0;
      while (nativeWeather(g, g.state.day + 1) === 'rainy' && guard++ < 20) g.state.seed = (g.state.seed + 1) >>> 0 || 1;
      const moneyBefore = g.state.money;
      const r = nightAndSleep(g);
      assert.equal(r.summary.helpers.wages >= 0, true, 'summary.helpers.wages 应存在');
      // 若第二天是雨天，帮手没活干就不该扣工资；这里已保证晴天
      assert.equal(g.state.money, moneyBefore - 25, '晴天有活干时应扣 25G 工资');
      assert.equal(r.summary.helpers.watered, 3, '应为 3 块地浇水');
      // 先浇后生长：3 块萝卜都长了 1 天
      for (const t of tiles) {
        assert.equal(g.state.plots[t[0] + ',' + t[1]].crop.age, 1, '(' + t[0] + ',' + t[1] + ') 应先浇后生长到 age=1');
      }
    });

    test('雨天田地已全湿：帮手没活干，不扣工资', () => {
      const g = newGame();
      grant(g, RICH);
      standNear(g, 'guild');
      assert.equal(g.hireHelper('waterer').ok, true);

      const tiles = findFarmTiles(g, 2);
      for (const t of tiles) {
        standAdjacentTo(g, t[0], t[1]);
        assert.equal(g.use('hoe', 'radish', t[0], t[1]).ok, true);
        assert.equal(g.use('seed', 'radish', t[0], t[1]).ok, true);
      }
      // 直接改日期到雨天
      let day = g.state.day;
      let guard = 0;
      while (nativeWeather(g, day + 1) !== 'rainy' && guard++ < 200) day++;
      assert.ok(guard < 200, '应在合理范围内找到雨天');
      // 用 restore 造出「今天是 day，明天要下雨」的合法存档
      const save = g.snapshot();
      save.day = day;
      save.weather = nativeWeather(g, day);
      const rebuilt = new FarmGame(save.seed);
      rebuilt.restore(save);
      // 场景：明天会下雨，田地由雨水接管；玩家回到小屋旁睡觉，帮手没有活可干
      standNear(rebuilt, 'home');
      const moneyBefore = rebuilt.state.money;
      const result = rebuilt.sleep();
      assert.equal(result.ok, true, '睡觉应成功：' + (result && result.message));
      assert.equal(rebuilt.state.weather, 'rainy', '第二天应是雨天');
      assert.equal(rebuilt.state.money, moneyBefore, '没有浇水工作时不应扣工资');
      assert.equal(result.summary.helpers.watered, 0, '没有工作就不该浇水：' + JSON.stringify(result.summary.helpers));
      assert.ok(rebuilt.summary.helpers.skipped.some((m) => m.indexOf('浇水帮手') >= 0), '应在总结里说明帮手没上工：' + JSON.stringify(rebuilt.summary.helpers));
      const rainHandled = tiles.every((t) => {
        const p = rebuilt.state.plots[t[0] + ',' + t[1]];
        return !!p && (t[0] + ',' + t[1]) && p.watered !== undefined;
      });
      assert.equal(rainHandled, true, '雨天新一天的地块应存在且带浇水标记');
    });

    test('采收帮手在生长后收成熟作物到背包，扣 30G', () => {
      const g = newGame();
      grant(g, RICH);
      standNear(g, 'guild');
      assert.equal(g.hireHelper('harvester').ok, true, '雇采收帮手');

      const tiles = findFarmTiles(g, 2);
      for (const t of tiles) plant(g, t[0], t[1], 'radish');

      // 萝卜 2 天成熟：先浇再睡，第二天补浇再睡
      for (let i = 0; i < 2; i++) {
        for (const t of tiles) {
          if (!g.state.plots[t[0] + ',' + t[1]].watered) {
            standAdjacentTo(g, t[0], t[1]);
            assert.equal(g.use('water', 'radish', t[0], t[1]).ok, true, '浇水应成功');
          }
        }
        stand(g, 6, 7);
        assert.equal(g.sleep().ok, true, '第 ' + (i + 1) + ' 晚睡觉应成功');
      }
      // 此时两块萝卜应已成熟
      for (const t of tiles) {
        assert.equal(g.state.plots[t[0] + ',' + t[1]].crop.age, CROPS.radish.days, '萝卜应已成熟');
      }
      standNear(g, 'home');
      const moneyBefore = g.state.money;
      const r = g.sleep();
      assert.equal(r.ok, true, '睡觉应成功');
      assert.equal(r.summary.helpers.harvested, 2, '采收帮手应收 2 块成熟作物（实际 ' + r.summary.helpers.harvested + '）');
      assert.equal(g.state.money, moneyBefore - 30, '有采收工作时应扣 30G');
      assert.equal((g.state.bag.radish || 0) >= 2, true, '采收的萝卜应进背包');
      for (const t of tiles) {
        const plot = g.state.plots[t[0] + ',' + t[1]];
        assert.ok(plot, '采收后应保留耕地');
        assert.equal(plot.crop, null, '采收后作物应清空');
      }
    });

    test('没雇帮手 / 没工作 / 钱不够 时不扣工资，summary 说明原因', () => {
      // 没雇：什么都不扣
      const plain = newGame();
      const r0 = nightAndSleep(plain);
      assert.ok(r0.summary.helpers, 'summary 应包含 helpers');
      assert.equal(plain.state.money, 100, '没有帮手时不应有工资支出');
      assert.equal(r0.summary.helpers.watered, 0);
      assert.equal(r0.summary.helpers.harvested, 0);

      // 雇了但没工作：不扣
      const idle = newGame();
      grant(idle, { money: 1000 });
      standNear(idle, 'guild');
      assert.equal(idle.hireHelper('waterer').ok, true);
      const moneyBefore = idle.state.money;
      nightAndSleep(idle);
      assert.equal(idle.state.money, moneyBefore, '没有可浇的作物时不应扣工资');

      // 有工作但钱不够：跳过且不扣
      const poor = newGame();
      grant(poor, { money: 50 });
      standNear(poor, 'guild');
      assert.equal(poor.hireHelper('waterer').ok, true); // 50 -> 0
      const tilesPoor = findFarmTiles(poor, 1);
      standAdjacentTo(poor, tilesPoor[0][0], tilesPoor[0][1]);
      assert.equal(poor.use('hoe', 'radish', tilesPoor[0][0], tilesPoor[0][1]).ok, true);
      assert.equal(poor.use('seed', 'radish', tilesPoor[0][0], tilesPoor[0][1]).ok, true);
      let guard = 0;
      while (nativeWeather(poor, poor.state.day + 1) === 'rainy' && guard++ < 20) poor.state.seed = (poor.state.seed + 1) >>> 0 || 1;
      const moneyLeft = poor.state.money;
      const rp = nightAndSleep(poor);
      assert.equal(poor.state.money, moneyLeft, '钱不够时不应扣工资（也不能透支成负数）');
      assert.ok(poor.state.money >= 0, '余额不得为负');
      const skipped = rp.summary.helpers.skipped;
      assert.ok(Array.isArray(skipped) && skipped.length > 0, '跳过工作时应给出中文说明');
      assert.ok(skipped.every((s) => typeof s === 'string' && s.length > 0), 'skipped 应为非空字符串数组');
    });

    test('睡觉 summary 结构完整：grown/day/weather/animals/helpers/craftReady', () => {
      const g = newGame();
      const r = nightAndSleep(g);
      const s = r.summary;
      assert.equal(typeof s.grown, 'number');
      assert.equal(s.day, 2, 'day 应前进到 2');
      assert.ok(s.weather === 'sunny' || s.weather === 'rainy', 'weather 应是 sunny/rainy');
      assert.ok(s.animals && typeof s.animals === 'object', 'summary 应含 animals');
      assert.equal(typeof s.animals.eggs, 'number');
      assert.equal(typeof s.animals.milk, 'number');
      assert.equal(typeof s.animals.unfed, 'boolean');
      assert.ok(s.helpers && typeof s.helpers === 'object', 'summary 应含 helpers');
      assert.equal(typeof s.helpers.watered, 'number');
      assert.equal(typeof s.helpers.harvested, 'number');
      assert.equal(typeof s.helpers.wages, 'number');
      assert.ok(Array.isArray(s.helpers.skipped), 'helpers.skipped 应为数组');
      assert.equal(typeof s.craftReady, 'number', 'summary 应含 craftReady 批次数');
      assert.equal(g.state.energy, g.state.maxEnergy, '睡觉恢复体力不变');
    });
  });

  // ---------------------------------------------------------------- 8. 存档迁移与校验

  describe('存档迁移与新字段校验', () => {
    test('初始状态带齐新字段：无动物/建筑/帮手/队列，bag 含 5 种产品', () => {
      const g = newGame();
      const st = g.state;
      assert.equal(st.version, 2, 'version 仍为 2');
      for (const id of ['egg', 'milk', 'mayo', 'cheese', 'jam']) {
        assert.equal(st.bag[id], 0, 'bag.' + id + ' 初始应为 0');
      }
      assert.equal(st.livestock.coop, false);
      assert.equal(st.livestock.barn, false);
      assert.equal(st.livestock.chickens, 0);
      assert.equal(st.livestock.cows, 0);
      assert.equal(st.livestock.eggsReady, 0);
      assert.equal(st.livestock.milkReady, 0);
      assert.equal(st.industry.built, false);
      assert.deepEqual(st.industry.jobs, []);
      assert.equal(st.helpers.waterer, false);
      assert.equal(st.helpers.harvester, false);
      assert.deepEqual(Object.keys(st.stats).sort(), ['earned', 'harvested', 'sold', 'watered'], 'stats 仍为 4 键');
    });

    test('旧存档（缺 livestock/industry/helpers、bag 无产品键）可迁移，新字段自动填默认', () => {
      const g = newGame(777);
      const legacy = g.snapshot();
      delete legacy.livestock;
      delete legacy.industry;
      delete legacy.helpers;
      for (const id of ['egg', 'milk', 'mayo', 'cheese', 'jam']) delete legacy.bag[id];
      legacy.money = 4321;

      g.restore(legacy);
      assert.equal(g.state.money, 4321, '旧存档的普通字段应原样恢复');
      assert.equal(g.state.livestock.coop, false, 'livestock 应自动补默认');
      assert.equal(g.state.livestock.feed, 0);
      assert.equal(g.state.industry.built, false, 'industry 应自动补默认');
      assert.deepEqual(g.state.industry.jobs, []);
      assert.equal(g.state.helpers.waterer, false, 'helpers 应自动补默认');
      for (const id of ['egg', 'milk', 'mayo', 'cheese', 'jam']) {
        assert.equal(g.state.bag[id], 0, '旧存档缺少 bag.' + id + ' 时应补 0');
      }

      // 迁移后老功能仍然可用
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true, '迁移后仍能正常睡觉');
    });

    test('新字段非法必须拒绝，且当前状态完全不变', () => {
      const g = newGame(20261029);
      const base = g.snapshot();
      const variants = [
        ['livestock 不是对象', (s) => { s.livestock = 'yes'; }],
        ['chickens 非整数', (s) => { s.livestock.chickens = 1.5; }],
        ['chickens 为负', (s) => { s.livestock.chickens = -1; }],
        ['chickens 超 6', (s) => { s.livestock.chickens = 7; }],
        ['cows 超 3', (s) => { s.livestock.cows = 4; }],
        ['有鸡但没鸡舍', (s) => { s.livestock.chickens = 2; }],
        ['有牛但没牛棚', (s) => { s.livestock.cows = 1; s.livestock.barn = false; }],
        ['fedAtDay 大于 day', (s) => { s.livestock.fedAtDay = s.day + 1; }],
        ['feed 为负', (s) => { s.livestock.feed = -5; }],
        ['eggsReady 非整数', (s) => { s.livestock.eggsReady = 0.5; }],
        ['coop 非布尔', (s) => { s.livestock.coop = 'true'; }],
        ['industry 不是对象', (s) => { s.industry = []; }],
        ['jobs 不是数组', (s) => { s.industry.jobs = {}; }],
        ['队列超过 3', (s) => { s.industry.built = true; s.industry.jobs = [1, 2, 3, 4].map((i) => ({ recipe: 'mayo', qty: 1, readyDay: s.day + i })); }],
        ['任务配方非法', (s) => { s.industry.built = true; s.industry.jobs = [{ recipe: 'bread', qty: 1, readyDay: s.day + 1 }]; }],
        ['任务数量超 5', (s) => { s.industry.built = true; s.industry.jobs = [{ recipe: 'mayo', qty: 6, readyDay: s.day + 1 }]; }],
        ['readyDay 非正整数', (s) => { s.industry.built = true; s.industry.jobs = [{ recipe: 'mayo', qty: 1, readyDay: 0 }]; }],
        ['helpers 非布尔', (s) => { s.helpers.waterer = 1; }],
        ['bag 产品为负', (s) => { s.bag.egg = -1; }],
        ['bag 产品非整数', (s) => { s.bag.milk = 2.5; }]
      ];
      for (const entry of variants) {
        const bad = clone(base);
        entry[1](bad);
        assert.throws(() => g.restore(bad), Error, entry[0] + ' 应抛出异常');
        assert.deepEqual(g.snapshot(), base, entry[0] + ' 被拒绝后状态必须不变');
      }
    });

    test('合法的新存档 round-trip：快照 → 读入 → 再快照完全一致', () => {
      const g = newGame(20261029);
      buildAll(g);
      stockRanch(g, 2, 1, 10);
      standNear(g, 'ranch');
      assert.equal(g.feedAnimals().ok, true);
      standNear(g, 'workshop');
      grant(g, { bag: { egg: 10, milk: 10, berry: 10 } });
      assert.equal(g.craft('cheese', 1).ok, true);
      standNear(g, 'guild');
      assert.equal(g.helpers && g.hireHelper('harvester').ok, true);

      const snap = g.snapshot();
      const other = new FarmGame(1);
      other.restore(snap);
      assert.deepEqual(other.snapshot(), snap, '合法存档 round-trip 应完全一致');

      // 深拷贝：改快照不影响游戏
      snap.livestock.chickens = 99;
      assert.notEqual(g.state.livestock.chickens, 99, 'snapshot 必须是深拷贝');
    });
  });

  // ---------------------------------------------------------------- 9. 出售与交互

  describe('出售产品与交互', () => {
    test('sellAll 按 ITEMS 结算产品，产品算入 sold/earned', () => {
      const g = newGame();
      standNear(g, 'bin');
      grant(g, { bag: { egg: 2, milk: 1, mayo: 1, cheese: 0, jam: 0, radish: 1 } });
      const before = g.snapshot();
      const r = g.sellAll();
      assert.equal(r.ok, true, '有货时出售应成功：' + (r && r.message));
      const expectEarned = 2 * 25 + 1 * 60 + 1 * 80 + 1 * 25;
      assert.equal(g.state.money, before.money + expectEarned, '应按 ITEMS 售价结算');
      assert.equal(g.state.stats.sold, before.stats.sold + 5, '产品也应计入售出件数');
      assert.equal(g.state.stats.earned, before.stats.earned + expectEarned);
      for (const id of ['egg', 'milk', 'mayo', 'cheese', 'jam', 'radish']) {
        assert.equal(g.state.bag[id], 0, 'bag.' + id + ' 应清空');
      }
    });

    test('interact 在新地点返回 ranch / workshop / guild', () => {
      const g = newGame();
      for (const id of ['ranch', 'workshop', 'guild']) {
        standNear(g, id);
        const r = g.interact();
        assert.equal(r.ok, true, id + ' 应可交互');
        assert.equal(r.kind, id, 'interact 在新地点 ' + id + ' 应返回 kind=' + id + '，实际 ' + r.kind);
      }
    });
  });

  // ---------------------------------------------------------------- 辅助

  // 用核心自带的天气规则推算某一天的天气：验证方式是新开一局并 sleep 到那天，
  // 但这太慢，所以这里只通过天气预报的事实来源（seed + day）间接判断：
  // 先快照，然后用 restore 造出 day 存档并 sleep，观察 weather。
  function nativeWeather(g, day) {
    const save = g.snapshot();
    save.day = day - 1;
    save.day = Math.max(1, save.day);
    const probe = new FarmGame(save.seed);
    probe.restore(save);
    standNear(probe, 'home');
    const r = probe.sleep();
    assert.equal(r.ok, true, '天气探测：sleep 应成功');
    return r.summary.weather;
  }
}