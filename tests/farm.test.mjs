// 栖砂·田园记 / 农场规则验收测试
// 运行（仓库根目录）：
//   node --test --test-isolation=none tests/farm.test.mjs
//   （普通机器上 node --test tests/farm.test.mjs 亦可；DSH 沙箱禁止 test runner spawn 子进程，
//     会报 Error: spawn EPERM，需加 --test-isolation=none 或直接 node tests/farm.test.mjs）
//
// 默认加载 ../src/farm-core.js（UMD，通过 createRequire 加载 module.exports）。
// 如需先试跑候选核心：设置环境变量 FARM_CORE_FILE=<相对 tests/ 的路径或绝对路径>。
//
// 约定来源：sand-garden-repo/.work/farm-contract.md
// 注意：随机地图的细节（障碍具体位置、天气序列）不在用例里固定；需要站位时通过
//       state.player 移动到目标格附近的可走格，或从 obstacleAt/isWalkable 中动态查找。
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
  const { FarmGame, CROPS, MAP, LOCATIONS, QUESTS, TOOLS } = FarmCore;

  // ---------- 工具函数 ----------
  const newGame = (seed = 20261029) => new FarmGame(seed);
  const plotAt = (g, x, y) => g.state.plots[x + ',' + y];
  const stand = (g, x, y) => { g.state.player.x = x; g.state.player.y = y; };
  const pick = (bucket, ids) => Object.fromEntries(ids.map((id) => [id, bucket[id]]));
  const CROP_IDS = ['radish', 'carrot', 'berry'];
  const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  // weather 的取值形式契约未固定，只判断「是不是雨天」
  const isRain = (state) => {
    const w = state && state.weather;
    if (typeof w !== 'string') return false;
    return w.toLowerCase().includes('rain') || w.includes('雨');
  };

  // LOCATIONS 可能是 {id:{x,y,name}} 或 [{id,...}]，两种都支持
  const loc = (id) => {
    const L = LOCATIONS;
    if (Array.isArray(L)) {
      const hit = L.find((v) => v.id === id) || L.find((v) => v.name === id);
      assert.ok(hit, 'LOCATIONS 里应有 ' + id);
      return hit;
    }
    assert.ok(L && L[id], 'LOCATIONS 里应有 ' + id);
    return L[id];
  };

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP.cols && y < MAP.rows;

  // 移动到交互格旁边（优先走到可走格）
  const standNear = (g, id) => {
    const target = loc(id);
    const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]];
    for (const [dx, dy] of offsets) {
      const x = target.x + dx;
      const y = target.y + dy;
      if (!inBounds(x, y)) continue;
      if (g.isWalkable(x, y)) {
        stand(g, x, y);
        return { x, y };
      }
    }
    throw new Error('找不到 ' + id + ' 附近可站立的位置');
  };

  // 移动到 (tx,ty) 相邻格（Chebyshev=1），用于显式指定目标格的农事操作
  const standAdjacentTo = (g, tx, ty) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = tx + dx;
      const y = ty + dy;
      if (!inBounds(x, y)) continue;
      if (g.isWalkable(x, y)) {
        stand(g, x, y);
        return { x, y };
      }
    }
    throw new Error('找不到 (' + tx + ',' + ty + ') 旁边可站立的位置');
  };

  // 固定的农田测试格（2.2：西田 x5..16,y10..25，东田 x30..39,y10..25；障碍不生成在农田上）
  const TILE_A = { x: 10, y: 12 };
  const DAY1_TILES = [[9, 12], [10, 12], [11, 12], [10, 11], [10, 13], [9, 11]];
  const CROSS_CENTER = { x: 13, y: 14 };
  const CROSS_TILES = [[13, 13], [12, 14], [13, 14], [14, 14], [13, 15]];

  // 把一块地浇到「湿」为止：本来湿的地块重复浇水会零消耗地返回失败，这是正确行为
  const ensureWatered = (g, x, y, cropId = 'radish') => {
    standAdjacentTo(g, x, y);
    const energy = g.state.energy;
    const wateredStat = g.state.stats.watered;
    const already = plotAt(g, x, y).watered;
    const r = g.use('water', cropId, x, y);
    if (already) {
      assert.equal(r.ok, false, '(' + x + ',' + y + ') 已湿，重复浇水应被拒绝');
      assert.equal(g.state.energy, energy, '重复浇水不应消耗体力');
      assert.equal(g.state.stats.watered, wateredStat, '重复浇水不应重复统计 watered');
    } else {
      assert.equal(r.ok, true, '浇水 (' + x + ',' + y + ') 应成功');
    }
    assert.equal(plotAt(g, x, y).watered, true, '(' + x + ',' + y + ') 最终应是湿的');
  };
  const plantAll = (g, tiles, cropId = 'radish') => {
    for (const [x, y] of tiles) {
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', cropId, x, y).ok, true, '开垦 (' + x + ',' + y + ') 应成功');
      assert.equal(g.use('seed', cropId, x, y).ok, true, '播种 (' + x + ',' + y + ') 应成功');
      ensureWatered(g, x, y, cropId);
    }
  };
  const waterAll = (g, tiles, cropId = 'radish') => {
    for (const [x, y] of tiles) ensureWatered(g, x, y, cropId);
  };
  const harvestAll = (g, tiles, cropId = 'radish') => {
    for (const [x, y] of tiles) {
      standAdjacentTo(g, x, y);
      assert.equal(g.use('harvest', cropId, x, y).ok, true, '收获 (' + x + ',' + y + ') 应成功');
    }
  };

  const allObstacles = (g) => {
    const out = [];
    for (let y = 0; y < MAP.rows; y++) {
      for (let x = 0; x < MAP.cols; x++) {
        const ob = g.obstacleAt(x, y);
        if (ob) out.push(ob);
      }
    }
    return out;
  };

  // 找到一处「可走格 + 相邻不可走格」，用于验证朝向更新
  const findWall = (g) => {
    for (let y = 0; y < MAP.rows; y++) {
      for (let x = 0; x < MAP.cols; x++) {
        if (!g.isWalkable(x, y)) continue;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          if (!g.isWalkable(nx, ny)) return { x, y, dx, dy };
        }
      }
    }
    throw new Error('地图上找不到墙');
  };

  // 契约规定 interact() 只报告交互类型，井的回体力由 UI 再调用的具体方法完成，但方法名未约定。
  // 这里按常见命名探测；探测不到就退回 interact()（两种设计都能验证「每天一次」这条规则）。
  const wellRestAction = (g) => {
    const candidates = ['drinkWell', 'restAtWell', 'restWell', 'wellRest', 'useWell', 'drink', 'rest'];
    for (const name of candidates) {
      if (typeof g[name] === 'function') return { name, call: () => g[name]() };
    }
    return { name: 'interact', call: () => g.interact() };
  };

  // ---------- 用例 ----------
  describe('模块与静态约定', () => {
    test('UMD 导出 FarmCore 且常量符合约定', () => {
      // 只断言「至少有这些」，2.3 允许继续扩展导出（PRODUCTS/ITEMS/RECIPES/BUILDINGS/HELPERS 等）
      for (const key of ['FarmGame', 'CROPS', 'MAP', 'LOCATIONS', 'QUESTS', 'TOOLS', 'NPCS']) {
        assert.ok(FarmCore[key] != null, '缺少导出 ' + key);
      }
      assert.equal(typeof FarmGame, 'function');
      // 2.2 扩建：42×30，每格 32px；旧世界 30×22 是新世界左上角
      assert.equal(MAP.cols, 42);
      assert.equal(MAP.rows, 30);
      assert.equal(MAP.tile, 32);

      const cropSpec = {
        radish: { name: '萝卜', days: 2, seedPrice: 12, sellPrice: 25 },
        carrot: { name: '胡萝卜', days: 3, seedPrice: 18, sellPrice: 42 },
        berry: { name: '草莓', days: 4, seedPrice: 30, sellPrice: 75 },
      };
      for (const [id, spec] of Object.entries(cropSpec)) {
        assert.ok(CROPS[id], '应有作物 ' + id);
        for (const field of Object.keys(spec)) assert.equal(CROPS[id][field], spec[field], id + '.' + field);
      }

      assert.deepEqual([...TOOLS].sort(), ['axe', 'harvest', 'hoe', 'pickaxe', 'seed', 'water']);

      const locSpec = { home: { x: 6, y: 7, name: '小屋' }, shop: { x: 23, y: 7, name: '杂货铺' }, bin: { x: 10, y: 7, name: '出货箱' }, npc: { x: 20, y: 9, name: '阿禾' }, well: { x: 19, y: 12, name: '石井' } };
      for (const [id, spec] of Object.entries(locSpec)) {
        const got = loc(id);
        assert.equal(got.x, spec.x, id + '.x');
        assert.equal(got.y, spec.y, id + '.y');
        assert.equal(got.name, spec.name, id + '.name');
      }

      assert.equal(QUESTS.length, 15, '2.2 应有 15 条委托（旧 3 + 四名新 NPC 各 3）');
      const questSpec = {
        'first-harvest': { stat: 'harvested', target: 4, reward: 60 },
        'market-day': { stat: 'sold', target: 8, reward: 100 },
        'green-fingers': { stat: 'watered', target: 20, reward: 80 },
      };
      for (const [id, spec] of Object.entries(questSpec)) {
        const quest = QUESTS.find((q) => q.id === id);
        assert.ok(quest, '应有委托 ' + id);
        for (const field of Object.keys(spec)) assert.equal(quest[field], spec[field], id + '.' + field);
      }

      // 2.3：旧地点不变，新增三个经营地点
      const newLocs = { ranch: { x: 2, y: 8, name: '牧场' }, workshop: { x: 25, y: 10, name: '加工坊' }, guild: { x: 28, y: 7, name: '帮手驿站' } };
      for (const [id, spec] of Object.entries(newLocs)) {
        const got = loc(id);
        assert.ok(got, 'LOCATIONS 应包含 ' + id);
        assert.equal(got.x, spec.x, id + '.x');
        assert.equal(got.y, spec.y, id + '.y');
        assert.equal(got.name, spec.name, id + '.name');
      }
    });

    test('2.3 新增经营导出结构符合约定', () => {
      const { PRODUCTS, ITEMS, RECIPES, BUILDINGS, HELPERS } = FarmCore;
      for (const [key, value] of Object.entries({ PRODUCTS, ITEMS, RECIPES, BUILDINGS, HELPERS })) {
        assert.ok(value && typeof value === 'object', '应导出 ' + key);
      }
      const productSpec = {
        egg: { name: '鸡蛋', sellPrice: 25 },
        milk: { name: '牛奶', sellPrice: 60 },
        mayo: { name: '蛋黄酱', sellPrice: 80 },
        cheese: { name: '奶酪', sellPrice: 180 },
        jam: { name: '果酱', sellPrice: 180 },
      };
      for (const [id, spec] of Object.entries(productSpec)) {
        assert.ok(PRODUCTS[id], 'PRODUCTS 应有 ' + id);
        assert.equal(PRODUCTS[id].name, spec.name, id + '.name');
        assert.equal(PRODUCTS[id].sellPrice, spec.sellPrice, id + '.sellPrice');
      }
      // ITEMS 是作物与产品的合集
      for (const id of ['radish', 'carrot', 'berry', 'egg', 'milk', 'mayo', 'cheese', 'jam']) {
        assert.ok(ITEMS[id], 'ITEMS 应包含 ' + id);
      }
      const recipeSpec = {
        mayo: { ingredients: { egg: 2 }, days: 1 },
        cheese: { ingredients: { milk: 2 }, days: 1 },
        jam: { ingredients: { berry: 2 }, days: 1 },
      };
      for (const [id, spec] of Object.entries(recipeSpec)) {
        assert.ok(RECIPES[id], 'RECIPES 应有 ' + id);
        assert.deepEqual({ ...RECIPES[id].ingredients }, spec.ingredients, id + '.ingredients');
        assert.equal(RECIPES[id].days, spec.days, id + '.days');
        assert.equal(typeof RECIPES[id].name, 'string');
      }
      const buildingSpec = { coop: { money: 120, wood: 6, stone: 0 }, barn: { money: 300, wood: 12, stone: 6 }, workshop: { money: 180, wood: 6, stone: 4 } };
      for (const [id, spec] of Object.entries(buildingSpec)) {
        assert.ok(BUILDINGS[id], 'BUILDINGS 应有 ' + id);
        for (const k of Object.keys(spec)) assert.equal(BUILDINGS[id][k], spec[k], id + '.' + k);
      }
      const helperSpec = { waterer: { hirePrice: 50, wage: 25, capacity: 12 }, harvester: { hirePrice: 60, wage: 30, capacity: 8 } };
      for (const [id, spec] of Object.entries(helperSpec)) {
        assert.ok(HELPERS[id], 'HELPERS 应有 ' + id);
        for (const k of Object.keys(spec)) assert.equal(HELPERS[id][k], spec[k], id + '.' + k);
      }
    });

    test('2.3 地形：河道/桥与地貌查询', () => {
      const g = newGame();
      // x40..41,y10..28 为水，但 y20 是桥（可走）
      for (let y = 10; y <= 28; y++) {
        for (const x of [40, 41]) {
          if (y === 20) {
            assert.equal(g.isWalkable(x, y), true, '(' + x + ',' + y + ') 桥应可走');
            const t = g.tileAt(x, y);
            assert.ok(t === 'bridge' || t === 'path', '(' + x + ',' + y + ') 桥的地形应为 bridge/path，实际 ' + t);
          } else {
            assert.equal(g.tileAt(x, y), 'water', '(' + x + ',' + y + ') 应为水');
            assert.equal(g.isWalkable(x, y), false, '(' + x + ',' + y + ') 水面不可走');
          }
        }
      }
      // 2.3 不新增农田，仍为 352
      let farm = 0;
      for (let y = 0; y < MAP.rows; y++) for (let x = 0; x < MAP.cols; x++) if (g.isFarmTile(x, y)) farm++;
      assert.equal(farm, 352, '2.3 农田仍应恰好 352 格');

      if (typeof g.biomeAt === 'function') {
        assert.equal(g.biomeAt(40, 15), 'riverbank', '河道属 riverbank');
        assert.equal(g.biomeAt(1, 15), 'woodland', '西侧森林');
        assert.equal(g.biomeAt(30, 2), 'highland', '右上高地');
        assert.equal(g.biomeAt(22, 24), 'meadow', '南部草甸');
        assert.equal(g.biomeAt(10, 12), 'farmland', '农田地貌');
        assert.equal(g.biomeAt(12, 8), 'village', '村庄');
      }
    });
  });

  describe('初始状态', () => {
    test('新游戏初始状态符合约定', () => {
      const g = newGame();
      const s = g.state;
      assert.equal(s.version, 2);
      assert.equal(s.player.x, 12);
      assert.equal(s.player.y, 8);
      assert.equal(s.player.facing, 'down');
      assert.equal(s.day, 1);
      assert.equal(s.minutes, 360);
      assert.equal(s.money, 100);
      assert.equal(s.energy, 100);
      assert.equal(s.maxEnergy, 100);
      assert.ok(Number.isInteger(s.seed) && s.seed > 0 && s.seed <= 4294967295, 'seed 应为非零 uint32');
      assert.equal(isRain(s), false, '开局天气应是晴天');
      assert.deepEqual(pick(s.seeds, CROP_IDS), { radish: 6, carrot: 2, berry: 0 });
      assert.deepEqual(pick(s.bag, CROP_IDS), { radish: 0, carrot: 0, berry: 0 });
      // 2.3：bag 允许新增产品键（默认 0），这里只校验已有的作物键，不排斥扩展键
      for (const key of Object.keys(s.bag)) {
        assert.equal(typeof s.bag[key], 'number', 'bag.' + key + ' 应为数字');
      }
      if (FarmCore.PRODUCTS) {
        for (const id of Object.keys(FarmCore.PRODUCTS)) {
          assert.equal(s.bag[id], 0, '初始 bag.' + id + ' 应为 0');
        }
      }
      assert.equal(s.wood, 0);
      assert.equal(s.stone, 0);
      assert.deepEqual(s.plots, {});
      assert.deepEqual(s.cleared, []);
      assert.equal(s.wateringLevel, 0);
      assert.deepEqual(s.claimed, []);
      assert.deepEqual({ ...s.stats }, { harvested: 0, sold: 0, earned: 0, watered: 0 });
    });

    test('地形查询：地块类型、农田范围与可走性', () => {
      const g = newGame();
      assert.equal(g.tileAt(-1, 0), 'outside');
      assert.equal(g.tileAt(MAP.cols, 0), 'outside');
      assert.equal(g.tileAt(0, MAP.rows), 'outside');
      assert.equal(g.tileAt(5, 4), 'building', '小屋占位');
      assert.equal(g.tileAt(23, 4), 'building', '杂货铺占位');
      assert.equal(g.tileAt(25, 16), 'water', '池塘中心');
      assert.equal(g.tileAt(10, 8), 'path', '道路');
      assert.equal(g.tileAt(TILE_A.x, TILE_A.y), 'grass');

      assert.equal(g.isFarmTile(10, 12), true);
      assert.equal(g.isFarmTile(4, 12), false);
      assert.equal(g.isFarmTile(10, 9), false);
      // 2.2：西田扩到 y10..25，因此 (10,19) 现在属于农田；东田在 x30..39
      assert.equal(g.isFarmTile(10, 19), true, '(10,19) 应属于扩建后的西田');
      assert.equal(g.isFarmTile(10, 26), false, 'y26 已超出西田');
      assert.equal(g.isFarmTile(35, 12), true, '(35,12) 应属于东田');

      assert.equal(g.isWalkable(5, 4), false, '建筑不可走');
      assert.equal(g.isWalkable(25, 16), false, '水面不可走');
      assert.equal(g.isWalkable(10, 8), true, '道路可走');
      assert.equal(g.isFarmTile(4, 8), false);
      assert.equal(g.isWalkable(4, 8), true, '农田外也可走');

      // 农田外应存在可行走的草地（同时不受随机障碍影响）
      let found = null;
      for (let y = 0; y < MAP.rows && !found; y++) {
        for (let x = 0; x < MAP.cols; x++) {
          if (g.tileAt(x, y) === 'grass' && !g.isFarmTile(x, y) && g.isWalkable(x, y)) { found = { x, y }; break; }
        }
      }
      assert.ok(found, '农田外应有可行走的草地');
    });
  });

  describe('移动', () => {
    test('只能四方向移动，正常行走不耗体力', () => {
      const g = newGame();
      stand(g, 12, 8); // 道路上
      const energy = g.state.energy;
      const r = g.move(1, 0);
      assert.equal(r.ok, true);
      assert.deepEqual([g.state.player.x, g.state.player.y], [13, 8]);
      assert.equal(g.state.energy, energy, '走路不该消耗体力');

      const diag = g.move(1, 1);
      assert.equal(diag.ok, false, '不允许斜走');
      assert.equal(typeof diag.message, 'string');
      assert.deepEqual([g.state.player.x, g.state.player.y], [13, 8], '非法移动不应改变位置');
    });

    test('朝向即使受阻也会更新', () => {
      const facingOf = (dx, dy) => (dy === -1 ? 'up' : dy === 1 ? 'down' : dx === -1 ? 'left' : 'right');
      const g = newGame();
      const wall = findWall(g);
      stand(g, wall.x, wall.y);
      const r = g.move(wall.dx, wall.dy);
      assert.equal(r.ok, false, '撞墙应失败');
      assert.equal(typeof r.message, 'string');
      assert.deepEqual([g.state.player.x, g.state.player.y], [wall.x, wall.y], '撞墙不应改变位置');
      assert.equal(g.state.player.facing, facingOf(wall.dx, wall.dy), '受阻也应更新朝向');

      // 成功走动同样更新朝向：初始朝下，向下走一格应仍是 down
      const g2 = newGame();
      const ny = g2.state.player.y + 1;
      assert.equal(g2.isWalkable(g2.state.player.x, ny), true, '初始位置下方应是可走的道路');
      assert.equal(g2.move(0, 1).ok, true);
      assert.equal(g2.state.player.facing, 'down');
      assert.equal(g2.move(-1, 0).ok, true);
      assert.equal(g2.state.player.facing, 'left');
    });
  });

  describe('商店与库存', () => {
    test('在杂货铺旁边买种会扣款并加种子', () => {
      const g = newGame();
      standNear(g, 'shop');
      const money = g.state.money;
      const seeds = g.state.seeds.radish;
      const r = g.buy('radish', 3);
      assert.equal(r.ok, true);
      assert.equal(g.state.money, money - CROPS.radish.seedPrice * 3);
      assert.equal(g.state.seeds.radish, seeds + 3);
    });

    test('买种数量非法、余额不足、离开商店时都不改变状态', () => {
      const g = newGame();
      standNear(g, 'shop');
      const before = JSON.stringify(g.state);
      for (const qty of [0, -1, 100, 1.5, NaN]) {
        const r = g.buy('radish', qty);
        assert.equal(r.ok, false, '数量 ' + qty + ' 应被拒绝');
        assert.equal(typeof r.message, 'string');
      }
      const tooMany = g.buy('carrot', 99); // 18*99=1782 > 100
      assert.equal(tooMany.ok, false, '余额不足应被拒绝');
      const unknownCrop = g.buy('melon', 1);
      assert.equal(unknownCrop.ok, false, '未知作物应被拒绝');
      assert.equal(JSON.stringify(g.state), before, '被拒绝的购买不能改变任何状态');
      assert.ok(g.state.money >= 0);

      // 离店
      stand(g, 12, 8);
      const far = g.buy('radish', 1);
      assert.equal(far.ok, false, '离杂货铺太远不能买');
      assert.equal(g.state.money, 100);
      assert.equal(g.state.seeds.radish, 6);
    });

    test('空背包或在远离出货箱时出售都不会凭空改钱', () => {
      const g = newGame();
      standNear(g, 'bin');
      g.sellAll(); // 背包全空：零收获不扣物，也不该凭空加钱
      assert.equal(g.state.money, 100, '空背包不应加钱');
      assert.deepEqual(pick(g.state.bag, CROP_IDS), { radish: 0, carrot: 0, berry: 0 });
      assert.deepEqual({ ...g.state.stats }, { harvested: 0, sold: 0, earned: 0, watered: 0 }, '空背包不应改统计');

      stand(g, 12, 8); // 远离出货箱
      const farMoney = g.state.money;
      const far = g.sellAll();
      assert.equal(far.ok, false, '离出货箱太远不能卖');
      assert.equal(g.state.money, farMoney);
    });
  });

  describe('农事流程', () => {
    test('完整流程：买种→开垦→播种→浇水→睡觉→生长→收获→出售', () => {
      const g = newGame();
      standNear(g, 'shop');
      assert.equal(g.buy('radish', 3).ok, true);

      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.ok(plotAt(g, x, y), '开垦后应生成 plots[x,y] 记录');
      assert.equal(plotAt(g, x, y).watered, false);
      assert.equal(plotAt(g, x, y).crop, null);

      const seedsBeforeSowing = g.state.seeds.radish;
      assert.equal(g.use('seed', 'radish', x, y).ok, true);
      assert.deepEqual({ id: plotAt(g, x, y).crop.id, age: plotAt(g, x, y).crop.age }, { id: 'radish', age: 0 });
      assert.equal(g.state.seeds.radish, seedsBeforeSowing - 1, '播种应扣 1 个种子');

      ensureWatered(g, x, y);

      standNear(g, 'home');
      const day0 = g.state.day;
      const r1 = g.sleep();
      assert.equal(r1.ok, true);
      assert.equal(g.state.day, day0 + 1);
      assert.ok(r1.summary && r1.summary.grown >= 1, '浇水后睡觉应至少让一株作物长大一天');
      assert.equal(g.state.energy, g.state.maxEnergy, '睡醒体力应恢复');
      assert.equal(plotAt(g, x, y).crop.age, 1);

      // 第二天再浇水再睡：萝卜 2 天成熟
      ensureWatered(g, x, y);
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      assert.ok(plotAt(g, x, y).crop.age >= CROPS.radish.days, '两天后应成熟');

      standAdjacentTo(g, x, y);
      const bagBefore = g.state.bag.radish;
      assert.equal(g.use('harvest', 'radish', x, y).ok, true);
      assert.equal(g.state.bag.radish, bagBefore + 1, '收获应得 1 个作物');
      assert.equal(plotAt(g, x, y).crop, null, '收获后作物清空');
      assert.ok(plotAt(g, x, y), '收获后应保留耕地');

      standNear(g, 'bin');
      const moneyBefore = g.state.money;
      const sell = g.sellAll();
      assert.equal(sell.ok, true);
      assert.equal(g.state.money, moneyBefore + CROPS.radish.sellPrice);
      assert.equal(g.state.bag.radish, 0, '出售后背包应清空');
      assert.equal(g.state.stats.harvested, 1);
      assert.ok(g.state.stats.sold >= 1);
      assert.equal(g.state.stats.earned, CROPS.radish.sellPrice);
      assert.ok(g.state.money >= 0);
    });

    test('不浇水时作物不生长也不死亡', () => {
      const g = newGame();
      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.equal(g.use('seed', 'radish', x, y).ok, true);
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      const plot = plotAt(g, x, y);
      assert.ok(plot && plot.crop, '没浇水的作物不该消失');
      assert.equal(plot.crop.age, 0, '没浇水不该生长');
      assert.equal(plot.crop.id, 'radish');
    });

    test('种子不足与未开垦时失败且不改变状态', () => {
      const g = newGame();
      const { x, y } = TILE_A;

      // 未开垦就播种
      standAdjacentTo(g, x, y);
      const before1 = JSON.stringify(g.state);
      assert.equal(g.use('seed', 'radish', x, y).ok, false);
      assert.equal(JSON.stringify(g.state), before1, '未开垦播种不应改变状态');
      assert.equal(plotAt(g, x, y), undefined);

      // 开垦后种 berry（初始 0 个种子）
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      standAdjacentTo(g, x, y);
      const before2 = JSON.stringify(g.state);
      assert.equal(g.state.seeds.berry, 0);
      assert.equal(g.use('seed', 'berry', x, y).ok, false, '没有种子应失败');
      assert.equal(JSON.stringify(g.state), before2, '种子不足不应改变状态');
      assert.equal(plotAt(g, x, y).crop, null);
    });

    test('目标格太远时拒绝操作且不消耗体力与时间', () => {
      const g = newGame();
      stand(g, 12, 8);
      const energy = g.state.energy;
      const minutes = g.state.minutes;
      const r = g.use('hoe', 'radish', 10, 15); // Chebyshev 7
      assert.equal(r.ok, false);
      assert.equal(typeof r.message, 'string');
      assert.equal(g.state.energy, energy);
      assert.equal(g.state.minutes, minutes);
      assert.equal(plotAt(g, 10, 15), undefined);
    });

    test('体力不足时原子失败，体力刚好时成功', () => {
      const g = newGame();
      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      g.state.energy = 1; // 开垦需要 2
      const before = JSON.stringify(g.state);
      assert.equal(g.use('hoe', 'radish', x, y).ok, false);
      assert.equal(JSON.stringify(g.state), before, '体力不足不应有任何副作用');
      assert.equal(plotAt(g, x, y), undefined);

      g.state.energy = 2;
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.equal(g.state.energy, 0, '开垦应扣 2 点体力');
    });
  });

  describe('睡觉与时间', () => {
    test('只有家门附近可以睡觉', () => {
      const g = newGame();
      stand(g, 12, 8); // 离家很远
      const day = g.state.day;
      const minutes = g.state.minutes;
      const r = g.sleep();
      assert.equal(r.ok, false);
      assert.equal(typeof r.message, 'string');
      assert.equal(g.state.day, day, '睡觉失败不应推进天数');
      assert.equal(g.state.minutes, minutes);

      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      assert.equal(g.state.day, day + 1);
    });

    test('睡觉恢复体力、清空浇水标记、日期加一', () => {
      const g = newGame();
      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.equal(g.use('seed', 'radish', x, y).ok, true);
      ensureWatered(g, x, y);

      g.state.energy = 20;
      standNear(g, 'home');
      const r = g.sleep();
      assert.equal(r.ok, true);
      assert.equal(g.state.day, 2);
      assert.equal(g.state.energy, g.state.maxEnergy);
      assert.equal(plotAt(g, x, y).watered, isRain(g.state), '浇水标记应清空，除非新的一天是雨天');
    });

    test('雨天：新的一天浇水状态与天气一致，且雨天会替代手动浇水', () => {
      const g = newGame();
      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.equal(g.use('seed', 'radish', x, y).ok, true);
      standNear(g, 'home');

      let sawRain = false;
      let sawSun = false;
      for (let i = 0; i < 60; i++) {
        const r = g.sleep();
        assert.equal(r.ok, true);
        const rainy = isRain(g.state);
        if (rainy) sawRain = true; else sawSun = true;
        const plot = plotAt(g, x, y);
        assert.ok(plot, '地块记录不应丢失');
        assert.equal(plot.watered, rainy, '第 ' + g.state.day + ' 天（weather=' + g.state.weather + '）地块浇水状态应与天气一致');
        if (r.summary && r.summary.weather !== undefined) {
          assert.equal(String(r.summary.weather), String(g.state.weather), 'summary.weather 应与 state.weather 一致');
        }
        assert.equal(g.state.energy, g.state.maxEnergy);
      }
      assert.ok(sawSun, '60 天里应至少有一天晴天');
      assert.ok(sawRain, '60 天里应至少下过一次雨（否则雨天规则无法被验证）');
    });

    test('雨天开垦的地块立即可湿，播种后不用浇水也能隔夜生长', () => {
      const g = newGame();
      standNear(g, 'home');

      // 开局是晴天，先睡到下雨的那一天
      let rainyDay = -1;
      for (let i = 0; i < 120; i++) {
        if (isRain(g.state)) { rainyDay = g.state.day; break; }
        assert.equal(g.sleep().ok, true);
      }
      assert.ok(rainyDay > 0, '120 天内应出现雨天（否则这条规则无法被验证）');

      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.equal(plotAt(g, x, y).watered, true, '雨天开垦的地块应当立即湿润，不需要手动浇水');

      assert.equal(g.use('seed', 'radish', x, y).ok, true);
      assert.equal(plotAt(g, x, y).watered, true, '播种不应清掉雨天带来的湿润');

      // 关键：全程不手动浇水
      standNear(g, 'home');
      const r = g.sleep();
      assert.equal(r.ok, true);
      assert.equal(plotAt(g, x, y).crop.age, 1, '雨天开垦的地块不手动浇水也应隔夜长一天');
      assert.ok(r.summary.grown >= 1, 'summary.grown 应统计到这株作物');
    });

    test('晴天开垦的地块不会自动湿润，不浇水当天就不生长', () => {
      const g = newGame();
      assert.equal(isRain(g.state), false, '前置条件：开局是晴天');
      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.equal(plotAt(g, x, y).watered, false, '晴天开垦的地块应当是干的');

      assert.equal(g.use('seed', 'radish', x, y).ok, true);
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      assert.equal(plotAt(g, x, y).crop.age, 0, '没浇水的作物当天不应生长');
    });

    test('advanceTime 累计时间但不超过 22:00', () => {
      const g = newGame();
      assert.equal(g.state.minutes, 360);
      g.advanceTime(60);
      assert.equal(g.state.minutes, 420);

      const before = g.state.minutes;
      g.advanceTime(-5);
      assert.ok(g.state.minutes >= before, '时间不能倒退');

      const huge = g.advanceTime(100000);
      if (!(huge && huge.ok === false)) {
        assert.equal(g.state.minutes, 22 * 60, '时间应封顶在 22:00');
      }
      assert.ok(g.state.minutes <= 22 * 60);
    });
  });

  describe('交互与委托', () => {
    test('nearby/interact 报告正确的交互类型，远离时为 null', () => {
      const g = newGame();
      assert.equal(g.nearby(), null, '初始位置附近没有交互格');
      const far = g.interact();
      assert.equal(far.ok, false);
      assert.equal(far.kind, null);

      standNear(g, 'shop');
      const near = g.nearby();
      assert.ok(near, '站到杂货铺旁边应能识别交互格');
      assert.equal(near.id, 'shop');
      assert.equal(near.name, '杂货铺');
      assert.equal(near.x, loc('shop').x);
      assert.equal(near.y, loc('shop').y);

      for (const id of ['home', 'bin', 'npc', 'well']) {
        standNear(g, id);
        const r = g.interact();
        assert.equal(r.ok, true, id + ' 应可交互');
        assert.equal(r.kind, id, id + ' 的交互类型');
        assert.equal(typeof r.message, 'string');
      }
    });

    test('委托只在满足条件后、在阿禾身边才能领取，且只能领一次', () => {
      const g = newGame();
      standNear(g, 'npc');
      const money0 = g.state.money;
      assert.equal(g.claimQuest('first-harvest').ok, false, '未满足条件不能领');
      assert.equal(g.claimQuest('market-day').ok, false, '未满足条件不能领');
      assert.equal(g.claimQuest('no-such-quest').ok, false, '不存在的委托不能领');
      assert.equal(g.state.money, money0);

      // 真收 4 个萝卜（初始 6 个萝卜种子，不需购买）
      const questTiles = DAY1_TILES.slice(0, 4);
      plantAll(g, questTiles);
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      waterAll(g, questTiles);
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      harvestAll(g, questTiles);
      assert.equal(g.state.stats.harvested, 4, '应有 4 次收获统计');

      standNear(g, 'npc');
      const before = g.state.money;
      const r = g.claimQuest('first-harvest');
      assert.equal(r.ok, true);
      assert.equal(g.state.money, before + 60);
      assert.ok(g.state.claimed.includes('first-harvest'));

      const again = g.claimQuest('first-harvest');
      assert.equal(again.ok, false, '同一委托不能重复领取');
      assert.equal(g.state.money, before + 60, '重复领取不应加钱');
      assert.equal(g.state.claimed.filter((id) => id === 'first-harvest').length, 1);
    });
  });

  describe('经济与委托补充覆盖', () => {
    test('批量买 5 份种子按单价乘数量扣款', () => {
      const g = newGame();
      standNear(g, 'shop');
      const money = g.state.money;
      const seedsRadish = g.state.seeds.radish;
      const seedsCarrot = g.state.seeds.carrot;

      const radish = g.buy('radish', 5);
      assert.equal(radish.ok, true);
      assert.equal(g.state.money, money - CROPS.radish.seedPrice * 5);
      assert.equal(g.state.seeds.radish, seedsRadish + 5);

      const moneyAfterRadish = g.state.money;
      const carrot = g.buy('carrot', 2);
      assert.equal(carrot.ok, true);
      assert.equal(g.state.money, moneyAfterRadish - CROPS.carrot.seedPrice * 2);
      assert.equal(g.state.seeds.carrot, seedsCarrot + 2);
      assert.ok(g.state.money >= 0);
    });

    test('余额不够买 5 份时整笔拒绝，钱和种子都不变', () => {
      const g = newGame();
      standNear(g, 'shop');
      // 100 G 只够 4 份草莓（30×4=120 已超出），买 5 份必然失败
      const before = JSON.stringify(g.state);
      const r = g.buy('berry', 5);
      assert.equal(r.ok, false, '余额不足应整笔拒绝');
      assert.equal(typeof r.message, 'string');
      assert.equal(JSON.stringify(g.state), before, '失败的批量购买不应留下任何部分扣款或部分加种');
      assert.equal(g.state.money, 100);
      assert.equal(g.state.seeds.berry, 0);
    });

    test('三条委托满足后各领一次，重复领取全部被拒', () => {
      const g = newGame();
      standNear(g, 'npc');

      const quests = [
        ['first-harvest', 'harvested', 4, 60],
        ['market-day', 'sold', 8, 100],
        ['green-fingers', 'watered', 20, 80],
      ];

      // 先确认未达成时一律拒绝
      for (const [id] of quests) {
        const r = g.claimQuest(id);
        assert.equal(r.ok, false, id + ' 未达成时不应发奖');
      }
      assert.deepEqual([...g.state.claimed], []);

      // 构造统计（测试允许直接构造，避免为了凑数字写镜像实现）
      for (const [, stat, target] of quests) g.state.stats[stat] = target;

      for (const [id, , , reward] of quests) {
        const money = g.state.money;
        const r = g.claimQuest(id);
        assert.equal(r.ok, true, id + ' 达成后应可领取');
        assert.equal(g.state.money, money + reward, id + ' 奖励金额');
        assert.equal(g.state.claimed.filter((q) => q === id).length, 1);
      }

      // 再来一遍：全部应被拒绝，且总额不变
      const moneyAfterAll = g.state.money;
      for (const [id] of quests) {
        const again = g.claimQuest(id);
        assert.equal(again.ok, false, id + ' 不能重复领取');
      }
      assert.equal(g.state.money, moneyAfterAll, '重复领取不应再加钱');
      assert.equal(new Set(g.state.claimed).size, 3);
    });
  });

  describe('存档兼容与睡眠总结', () => {
    test('2.0 存档快照可以被新游戏 restore 完整读回', () => {
      const source = newGame();
      // 造一点真实进度：买种、开垦、播种、浇水
      standNear(source, 'shop');
      assert.equal(source.buy('radish', 1).ok, true);
      standAdjacentTo(source, TILE_A.x, TILE_A.y);
      assert.equal(source.use('hoe', 'radish', TILE_A.x, TILE_A.y).ok, true);
      assert.equal(source.use('seed', 'radish', TILE_A.x, TILE_A.y).ok, true);
      ensureWatered(source, TILE_A.x, TILE_A.y);

      const save = source.snapshot();
      assert.equal(save.version, 2, '当前存档格式就是 2.0');

      const restored = newGame(1); // 换一个种子构造新游戏
      assert.doesNotThrow(() => restored.restore(save), '2.0 存档应能被 restore 接受');
      assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(save), '读回后的状态应与存档完全一致');
      assert.equal(restored.state.money, save.money);
      assert.equal(restored.state.day, save.day);
      assert.equal(Object.keys(restored.state.plots).length, Object.keys(save.plots).length);

      // 读回后还能继续正常玩：睡一觉
      standNear(restored, 'home');
      assert.equal(restored.sleep().ok, true);
      assert.equal(restored.state.day, save.day + 1);
    });

    test('2.2 旧存档（无 2.3 新字段）可读入并自动补默认值', () => {
      const g = newGame();
      const old = g.snapshot();
      // 模拟 2.2 时代存档：去掉所有 2.3 才有的可选字段与产品背包键
      delete old.livestock;
      delete old.industry;
      delete old.helpers;
      if (FarmCore.PRODUCTS) for (const id of Object.keys(FarmCore.PRODUCTS)) delete old.bag[id];
      old.money = 777;
      old.plots = { '10,12': { watered: false, crop: { id: 'radish', age: 1 } } };

      const fresh = newGame(31);
      assert.doesNotThrow(() => fresh.restore(old), '2.2 旧存档应仍可读入');
      assert.equal(fresh.state.money, 777, '金额保留');
      assert.equal(plotAt(fresh, 10, 12).crop.id, 'radish', '原地块保留');
      if (FarmCore.PRODUCTS) {
        for (const id of Object.keys(FarmCore.PRODUCTS)) {
          assert.equal(fresh.state.bag[id], 0, '缺失的产品背包键应补 0');
        }
        assert.deepEqual(pick(fresh.state.bag, CROP_IDS), pick(old.bag, CROP_IDS));
      }
    });

    test('sleep 的 summary.grown/day/weather 与实际状态一致', () => {
      const g = newGame();
      // 两块地：一块浇水会生长，一块不浇水不生长
      standAdjacentTo(g, TILE_A.x, TILE_A.y);
      assert.equal(g.use('hoe', 'radish', TILE_A.x, TILE_A.y).ok, true);
      assert.equal(g.use('seed', 'radish', TILE_A.x, TILE_A.y).ok, true);
      ensureWatered(g, TILE_A.x, TILE_A.y);

      const dry = { x: 11, y: 12 };
      standAdjacentTo(g, dry.x, dry.y);
      assert.equal(g.use('hoe', 'radish', dry.x, dry.y).ok, true);
      assert.equal(g.use('seed', 'radish', dry.x, dry.y).ok, true);
      if (plotAt(g, dry.x, dry.y).watered) plotAt(g, dry.x, dry.y).watered = false; // 雨天造出干旱对照

      const wetAgeBefore = plotAt(g, TILE_A.x, TILE_A.y).crop.age;
      const dryAgeBefore = plotAt(g, dry.x, dry.y).crop.age;
      const dayBefore = g.state.day;

      standNear(g, 'home');
      const r = g.sleep();
      assert.equal(r.ok, true);
      assert.ok(r.summary && typeof r.summary === 'object', 'sleep 应返回 summary');

      assert.equal(r.summary.day, g.state.day, 'summary.day 应等于新的一天');
      assert.equal(r.summary.day, dayBefore + 1);
      assert.equal(r.summary.weather, g.state.weather, 'summary.weather 应等于新一天的实际天气');
      assert.ok(['sunny', 'rainy'].includes(r.summary.weather));

      assert.equal(plotAt(g, TILE_A.x, TILE_A.y).crop.age, wetAgeBefore + 1, '浇过水的那块应长一天');
      assert.equal(plotAt(g, dry.x, dry.y).crop.age, dryAgeBefore, '没浇水的对照块不应生长');
      assert.equal(r.summary.grown, 1, 'summary.grown 应等于实际生长的株数');
      assert.equal(g.state.day, dayBefore + 1);
    });

    test('已湿土地重复浇水被拒绝，且不消耗体力、不重复统计 watered', () => {
      const g = newGame();
      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.equal(g.use('seed', 'radish', x, y).ok, true);

      ensureWatered(g, x, y);
      assert.equal(plotAt(g, x, y).watered, true);
      const energy = g.state.energy;
      const watered = g.state.stats.watered;
      const minutes = g.state.minutes;

      const repeat = g.use('water', 'radish', x, y);
      assert.equal(repeat.ok, false, '已湿土地重复浇水应被拒绝');
      assert.equal(typeof repeat.message, 'string');
      assert.equal(g.state.energy, energy, '重复浇水不应扣体力');
      assert.equal(g.state.stats.watered, watered, '重复浇水不应重复累加 watered 统计');
      assert.equal(g.state.minutes, minutes, '重复浇水不应推进时间');
      assert.equal(plotAt(g, x, y).watered, true, '地块应保持湿润');

      // 隔天变干后应能重新浇水并记账
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      if (!plotAt(g, x, y).watered) {
        standAdjacentTo(g, x, y);
        const before = g.state.stats.watered;
        assert.equal(g.use('water', 'radish', x, y).ok, true, '干掉的地块应可再次浇水');
        assert.ok(g.state.stats.watered > before, '重新浇水应计入 watered');
      }
    });
  });

  describe('体力与井', () => {
    test('井每天只回复一次体力', () => {
      const g = newGame();
      standNear(g, 'well');
      const action = wellRestAction(g);

      // 契约里 interact() 只报告交互类型；回体力是另一个方法，先确认类型识别
      if (action.name !== 'interact') {
        const probe = g.interact();
        assert.equal(probe.ok, true);
        assert.equal(probe.kind, 'well');
      }

      g.state.energy = 40;
      const r1 = action.call();
      assert.equal(r1.ok, true, '第一次歇脚应成功（方法：' + action.name + '）');
      if (action.name === 'interact') assert.equal(r1.kind, 'well');
      assert.ok(g.state.energy > 40, '第一次在井边歇脚应回复体力（方法：' + action.name + '）');
      const afterFirst = g.state.energy;

      action.call();
      assert.equal(g.state.energy, afterFirst, '同一天不能靠井无限回体力');

      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      standNear(g, 'well');
      g.state.energy = 30;
      const r3 = action.call();
      assert.equal(r3.ok, true, '新的一天应该可以再歇脚');
      assert.ok(g.state.energy > 30);
    });
  });

  describe('障碍与工具升级', () => {
    test('斧头与镐能清除障碍并产出资源，障碍只在农田外', () => {
      const g = newGame();
      const obstacles = allObstacles(g);
      assert.ok(obstacles.length > 0, '地图上应生成树和石头');
      for (const ob of obstacles) {
        assert.ok(ob.type === 'tree' || ob.type === 'rock', '障碍类型应为 tree/rock');
        assert.equal(g.isFarmTile(ob.x, ob.y), false, '障碍不应出现在农田格上');
      }
      assert.ok(obstacles.some((o) => o.type === 'tree'), '应至少有一棵树');
      assert.ok(obstacles.some((o) => o.type === 'rock'), '应至少有一块石头');

      const tree = obstacles.find((o) => o.type === 'tree');
      standAdjacentTo(g, tree.x, tree.y);
      const wood0 = g.state.wood;
      const energy0 = g.state.energy;
      assert.equal(g.use('axe', 'radish', tree.x, tree.y).ok, true);
      assert.equal(g.state.wood, wood0 + 3, '砍树得 3 木材');
      assert.equal(g.state.energy, energy0 - 6, '砍树耗 6 体力');
      assert.equal(g.obstacleAt(tree.x, tree.y), null, '树应被清除');
      assert.equal(g.isWalkable(tree.x, tree.y), true, '清掉障碍后该格应可走');

      const rock = obstacles.find((o) => o.type === 'rock');
      standAdjacentTo(g, rock.x, rock.y);
      const stone0 = g.state.stone;
      const energy1 = g.state.energy;
      assert.equal(g.use('pickaxe', 'radish', rock.x, rock.y).ok, true);
      assert.equal(g.state.stone, stone0 + 2, '碎石得 2 石材');
      assert.equal(g.state.energy, energy1 - 6, '碎石耗 6 体力');
      assert.equal(g.obstacleAt(rock.x, rock.y), null);

      // 同一个位置再砍应失败
      assert.equal(g.use('axe', 'radish', tree.x, tree.y).ok, false);
    });

    test('体力不足时无法清除障碍，障碍与资源都不变', () => {
      const g = newGame();
      const tree = allObstacles(g).find((o) => o.type === 'tree');
      standAdjacentTo(g, tree.x, tree.y);
      g.state.energy = 5; // 砍树需要 6
      const before = JSON.stringify(g.state);
      assert.equal(g.use('axe', 'radish', tree.x, tree.y).ok, false);
      assert.equal(JSON.stringify(g.state), before);
      assert.ok(g.obstacleAt(tree.x, tree.y), '障碍应仍在');
    });

    test('浇水壶升级：条件不足失败；满足后扣费一次并十字浇水', () => {
      const g = newGame();
      standNear(g, 'shop');
      const money0 = g.state.money;
      assert.equal(g.upgradeWatering().ok, false, '初始金币与木材不足，应失败');
      assert.equal(g.state.wateringLevel, 0);
      assert.equal(g.state.money, money0);

      // 用初始 6 个萝卜种子收成 6 个萝卜卖掉，凑够 160 金币
      plantAll(g, DAY1_TILES);
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      waterAll(g, DAY1_TILES);
      standNear(g, 'home');
      assert.equal(g.sleep().ok, true);
      harvestAll(g, DAY1_TILES);
      assert.equal(g.state.bag.radish, 6);
      standNear(g, 'bin');
      assert.equal(g.sellAll().ok, true);
      assert.equal(g.state.money, 100 + 6 * CROPS.radish.sellPrice);

      // 砍两棵树凑木材 6
      let choppedTrees = 0;
      for (const ob of allObstacles(g)) {
        if (ob.type !== 'tree' || choppedTrees >= 2) continue;
        standAdjacentTo(g, ob.x, ob.y);
        if (g.use('axe', 'radish', ob.x, ob.y).ok) choppedTrees += 1;
      }
      assert.equal(choppedTrees, 2);
      assert.equal(g.state.wood, 6);

      standNear(g, 'shop');
      const moneyBefore = g.state.money;
      const woodBefore = g.state.wood;
      const r = g.upgradeWatering();
      assert.equal(r.ok, true);
      assert.equal(g.state.wateringLevel, 1);
      assert.equal(g.state.money, moneyBefore - 160, '升级扣 160 金币');
      assert.equal(g.state.wood, woodBefore - 6, '升级扣 6 木材');
      assert.equal(g.upgradeWatering().ok, false, '不能重复升级');

      // 6 个初始萝卜种子已在上面用完，为十字地块补买种子
      standNear(g, 'shop');
      assert.equal(g.buy('radish', CROSS_TILES.length).ok, true);

      // 升级后一次浇水覆盖目标格及其上下左右十字。
      // 雨天开垦的地块本来就地湿，先把"湿"重置成干再验十字范围，否则重复浇水会被正确拒绝。
      for (const [x, y] of CROSS_TILES) {
        standAdjacentTo(g, x, y);
        assert.equal(g.use('hoe', 'radish', x, y).ok, true);
        assert.equal(g.use('seed', 'radish', x, y).ok, true);
        plotAt(g, x, y).watered = false;
      }
      standAdjacentTo(g, CROSS_CENTER.x, CROSS_CENTER.y);
      const energyBefore = g.state.energy;
      assert.equal(g.use('water', 'radish', CROSS_CENTER.x, CROSS_CENTER.y).ok, true);
      assert.equal(g.state.energy, energyBefore - 2, '浇水耗 2 体力');
      for (const [x, y] of CROSS_TILES) {
        assert.equal(plotAt(g, x, y).watered, true, '(' + x + ',' + y + ') 应在十字浇水范围内');
      }
    });
  });

  describe('存档', () => {
    test('snapshot 返回深拷贝，改动快照不影响游戏状态', () => {
      const g = newGame();
      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.equal(g.use('seed', 'radish', x, y).ok, true);

      const snap = g.snapshot();
      const again = g.snapshot();
      assert.notStrictEqual(snap, again, '每次快照应是新对象');
      assert.notStrictEqual(snap.plots, again.plots, '嵌套对象也应是新对象');

      snap.money = 999999;
      snap.seeds.radish = 0;
      snap.stats.harvested = 42;
      snap.plots[x + ',' + y].crop.age = 99;
      assert.equal(g.state.money, 100);
      assert.equal(g.state.seeds.radish, 5);
      assert.equal(g.state.stats.harvested, 0);
      assert.equal(plotAt(g, x, y).crop.age, 0);
    });

    test('restore 深拷贝存档并完整恢复状态', () => {
      const g = newGame();
      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.equal(g.use('seed', 'radish', x, y).ok, true);
      const saved = g.snapshot();

      const other = newGame(7);
      other.restore(saved);
      assert.equal(JSON.stringify(other.state), JSON.stringify(saved), '恢复后状态应与存档一致');

      saved.money = 12345;
      saved.plots[x + ',' + y].crop.age = 77;
      assert.notEqual(other.state.money, 12345, 'restore 应做深拷贝');
      assert.equal(plotAt(other, x, y).crop.age, 0);
    });

    test('非法存档被原子拒绝，原状态不变（含 v1 沙盒存档）', () => {
      const g = newGame();
      const { x, y } = TILE_A;
      standAdjacentTo(g, x, y);
      assert.equal(g.use('hoe', 'radish', x, y).ok, true);
      assert.equal(g.use('seed', 'radish', x, y).ok, true);

      const before = JSON.stringify(g.state);
      const good = g.snapshot();
      const noStats = { ...good };
      delete noStats.stats;

      const badSaves = [
        ['null', null],
        ['空对象', {}],
        ['v1 沙盒存档', { ...good, version: 1 }],
        ['未知版本号', { ...good, version: 99 }],
        ['日期非法', { ...good, day: 0 }],
        ['金币为负', { ...good, money: -5 }],
        ['玩家越界', { ...good, player: { x: -1, y: 3, facing: 'down' } }],
        ['农田键名非法', { ...good, plots: { bad: { watered: false, crop: null } } }],
        ['种子数为负', { ...good, seeds: { ...good.seeds, radish: -1 } }],
        ['缺少统计字段', noStats],
      ];
      for (const [label, data] of badSaves) {
        assert.throws(
          () => g.restore(data),
          (err) => err instanceof Error && /[\u4e00-\u9fa5]/.test(err.message),
          label + ' 应抛中文 Error',
        );
        assert.equal(JSON.stringify(g.state), before, label + ' 被拒绝后原状态必须原样保留');
      }

      // v1 存档要给出有意义的提示，不能只是「失败」
      let message = '';
      try { g.restore({ ...good, version: 1 }); } catch (err) { message = String(err.message); }
      assert.ok(message.length >= 4, 'v1 存档的报错应是有意义的说明，实际：' + message);
    });
  });
}
