/* 栖砂·田园记 v2.2 — 农场核心规则（纯逻辑，无 DOM、零依赖）
 *
 * UMD 导出：浏览器下 window/globalThis.FarmCore，Node 下 module.exports。
 * FarmCore = { FarmGame, CROPS, MAP, LOCATIONS, NPCS, QUESTS, TOOLS }
 *
 * 2.2 扩建：地图 42×30（旧世界 30×22 为新世界左上角），西田 + 东田共 352 格，
 * 五名村民（阿禾 + 麦叔 / 林岚 / 石川 / 小葵）、15 条委托（3 统计 + 12 含交付/前置）。
 *
 * 设计要点：
 * - 所有会改变世界的操作都先完成校验、再一次性落盘；失败时库存、体力、时间、地块、材料全都不动。
 * - 天气完全由 (seed, day) 决定，不额外保存 RNG 状态，所以快照/读档后未来的天气依旧一致。
 * - 障碍物（树/石）由确定式算法在外圈草地生成，避开农田/道路/建筑/水面/交互格/出生点，
 *   并保证所有交互点在布景后仍可从出生点 BFS 到达；清除记录存于 state.cleared。
 * - 旧版 v2 存档（30×22 世界、旧地块、旧 cleared）可直接读入：地块坐标仍落在西田内，
 *   cleared 只做地图内坐标校验，历史障碍吞进新田地时放行该条目。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.FarmCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 常量

  var MAP = { cols: 42, rows: 30, tile: 32 };

  var CROPS = {
    radish: { name: '萝卜', days: 2, seedPrice: 12, sellPrice: 25 },
    carrot: { name: '胡萝卜', days: 3, seedPrice: 18, sellPrice: 42 },
    berry: { name: '草莓', days: 4, seedPrice: 30, sellPrice: 75 }
  };

  var TOOLS = ['hoe', 'seed', 'water', 'harvest', 'axe', 'pickaxe'];

  var LOCATIONS = {
    home: { x: 6, y: 7, name: '小屋' },
    shop: { x: 23, y: 7, name: '杂货铺' },
    bin: { x: 10, y: 7, name: '出货箱' },
    npc: { x: 20, y: 9, name: '阿禾' },
    well: { x: 19, y: 12, name: '石井' },
    miller: { x: 31, y: 8, name: '麦叔' },
    ranger: { x: 36, y: 6, name: '林岚' },
    miner: { x: 27, y: 26, name: '石川' },
    florist: { x: 20, y: 26, name: '小葵' },
    ranch: { x: 2, y: 8, name: '牧场' },
    workshop: { x: 25, y: 10, name: '加工坊' },
    guild: { x: 28, y: 7, name: '帮手驿站' }
  };

  var NPCS = {
    npc: {
      name: '阿禾', role: '村里的老邻居', color: '#e0a25c', location: 'npc',
      greeting: '阿禾：「慢慢来，让这片土地和生活一起热闹起来。」'
    },
    miller: {
      name: '麦叔', role: '磨坊主', color: '#c98a3f', location: 'miller',
      greeting: '麦叔：「磨盘转起来就要粮食。你地里的东西，我都愿意收。」'
    },
    ranger: {
      name: '林岚', role: '护林员', color: '#5f9e6a', location: 'ranger',
      greeting: '林岚：「林子里的木头和石头，用得上就拿去，别砍光了就行。」'
    },
    miner: {
      name: '石川', role: '矿工', color: '#8b8fa6', location: 'miner',
      greeting: '石川：「石头是好东西。给我几块像样的，我替你打点家伙。」'
    },
    florist: {
      name: '小葵', role: '花匠', color: '#d9779a', location: 'florist',
      greeting: '小葵：「花开的时候，整个村子都会亮一点。你愿意帮我装点它吗？」'
    }
  };

  var QUESTS = [
    { id: 'first-harvest', name: '第一篮收成', npc: 'npc', description: '阿禾想看看你第一次的收成。', stat: 'harvested', target: 4, reward: 60 },
    { id: 'market-day', name: '田园小生意', npc: 'npc', description: '把收成卖到集市，让村子尝到你的手艺。', stat: 'sold', target: 8, reward: 100 },
    { id: 'green-fingers', name: '勤劳园丁', npc: 'npc', description: '勤浇水，土地才肯长东西。', stat: 'watered', target: 20, reward: 80 },

    { id: 'radish-delivery', name: '新鲜的萝卜', npc: 'miller', description: '麦叔想磨一锅萝卜面，需要 3 个新鲜萝卜。', delivery: { radish: 3 }, target: 3, reward: 90 },
    { id: 'market-supply', name: '集市供货', npc: 'miller', description: '麦叔托你把 20 份收成卖到集市去。', stat: 'sold', target: 20, reward: 150, requiresQuest: 'radish-delivery' },
    { id: 'village-trade', name: '村庄生意', npc: 'miller', description: '让村子全年进账 600 金币，账本交给麦叔过目。', stat: 'earned', target: 600, reward: 200, requiresQuest: 'market-supply' },

    { id: 'forest-timber', name: '林间木料', npc: 'ranger', description: '林岚在补一间护林小屋，需要 9 份木头。', delivery: { wood: 9 }, target: 9, reward: 90 },
    { id: 'forest-gardener', name: '护林园丁', npc: 'ranger', description: '帮林岚把苗圃浇满 80 次水。', stat: 'watered', target: 80, reward: 160, requiresQuest: 'forest-timber' },
    { id: 'forest-supplies', name: '林间补给', npc: 'ranger', description: '巡山前要带够口粮：4 个胡萝卜、2 个草莓。', delivery: { carrot: 4, berry: 2 }, target: 6, reward: 240, requiresQuest: 'forest-gardener' },

    { id: 'stone-sample', name: '矿石样本', npc: 'miner', description: '石川想看看你的镐子能敲出什么样的石头，交 6 份石料。', delivery: { stone: 6 }, target: 6, reward: 100 },
    { id: 'workshop-order', name: '工坊订单', npc: 'miner', description: '一笔大订单：12 份石料与 6 份木头。', delivery: { stone: 12, wood: 6 }, target: 18, reward: 220, requiresQuest: 'stone-sample' },
    { id: 'settled-in', name: '安顿下来', npc: 'miner', description: '住满第 10 天，石川就承认你是村里人了。', stat: 'day', target: 10, reward: 200, requiresQuest: 'workshop-order' },

    { id: 'berry-basket', name: '莓果小篮', npc: 'florist', description: '小葵想用 3 个草莓做一篮甜点。', delivery: { berry: 3 }, target: 3, reward: 160 },
    { id: 'colorful-harvest', name: '五彩收成', npc: 'florist', description: '凑齐萝卜、胡萝卜和草莓各 2 个，做一束彩色花篮。', delivery: { radish: 2, carrot: 2, berry: 2 }, target: 6, reward: 240, requiresQuest: 'berry-basket' },
    { id: 'flower-festival', name: '花开时节', npc: 'florist', description: '为花节采收 40 次收成，让村里开满花。', stat: 'harvested', target: 40, reward: 250, requiresQuest: 'colorful-harvest' }
  ];

  // ---- 2.3 生产经营：产品 / 物品 / 配方 / 建筑 / 帮手 ----

  var PRODUCTS = {
    egg: { name: '鸡蛋', sellPrice: 25 },
    milk: { name: '牛奶', sellPrice: 60 },
    mayo: { name: '蛋黄酱', sellPrice: 80 },
    cheese: { name: '奶酪', sellPrice: 180 },
    jam: { name: '果酱', sellPrice: 180 }
  };

  var ITEMS = {};
  Object.keys(CROPS).forEach(function (id) { ITEMS[id] = CROPS[id]; });
  Object.keys(PRODUCTS).forEach(function (id) { ITEMS[id] = PRODUCTS[id]; });

  var RECIPES = {
    mayo: { name: '蛋黄酱', ingredients: { egg: 2 }, days: 1 },
    cheese: { name: '奶酪', ingredients: { milk: 2 }, days: 1 },
    jam: { name: '果酱', ingredients: { berry: 2 }, days: 1 }
  };

  var BUILDINGS = {
    coop: { name: '鸡舍', money: 120, wood: 6, stone: 0 },
    barn: { name: '牛棚', money: 300, wood: 12, stone: 6 },
    workshop: { name: '加工坊', money: 180, wood: 6, stone: 4 }
  };

  var HELPERS = {
    waterer: { name: '浇水帮手', hirePrice: 50, wage: 25, capacity: 12 },
    harvester: { name: '采收帮手', hirePrice: 60, wage: 30, capacity: 8 }
  };

  var ANIMALS = {
    chicken: { name: '鸡', price: 80, facility: 'coop', cap: 6, product: 'egg' },
    cow: { name: '牛', price: 220, facility: 'barn', cap: 3, product: 'milk' }
  };

  var MAX_JOBS = 3;
  var JOB_QTY_MAX = 5;
  var FEED_PRICE = 5;

  // ---------------------------------------------------------------- 地图规则（2.2）

  var HOUSE = { x0: 3, x1: 8, y0: 3, y1: 6 };   // 不可走
  var SHOP = { x0: 20, x1: 26, y0: 3, y1: 6 };  // 不可走
  var POND = { cx: 25, cy: 16, rx: 3, ry: 3 };  // 椭圆池塘，不可走
  var FARM_WEST = { x0: 5, x1: 16, y0: 10, y1: 25 };  // 192 格
  var FARM_EAST = { x0: 30, x1: 39, y0: 10, y1: 25 }; // 160 格
  var ROAD_H = { y: 8, x0: 2, x1: 40 };
  var ROAD_V1 = { x: 18, y0: 8, y1: 28 };
  var ROAD_V2 = { x: 28, y0: 8, y1: 28 };
  var RANCH_BUILDING = { x0: 0, x1: 2, y0: 4, y1: 7 }; // 牧场建筑，不可走
  var RIVER = { x0: 40, x1: 41, y0: 10, y1: 28 };      // 河道，只有 y20 是桥
  var BRIDGE_Y = 20;

  var START = { x: 12, y: 8, facing: 'down' };
  var START_DAY_MINUTES = 6 * 60;   // 06:00
  var LAST_MINUTES = 22 * 60;       // 22:00
  var ACTION_MINUTES = 5;           // 成功动作消耗的游戏分钟
  var WELL_ENERGY = 12;             // 井边休息一次恢复的体力

  var FACING_DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  var FACINGS = ['up', 'down', 'left', 'right'];

  var USE_COST = { hoe: 2, seed: 1, water: 2, harvest: 1, axe: 6, pickaxe: 6 };
  var AXE_WOOD = 3;
  var PICKAXE_STONE = 2;
  var UPGRADE_MONEY = 160;
  var UPGRADE_WOOD = 6;

  var TREE_GOAL = 26;
  var ROCK_GOAL = 20;

  // ---------------------------------------------------------------- 小工具

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function inBounds(x, y) {
    return isInt(x) && isInt(y) && x >= 0 && y >= 0 && x < MAP.cols && y < MAP.rows;
  }

  function isHouse(x, y) { return x >= HOUSE.x0 && x <= HOUSE.x1 && y >= HOUSE.y0 && y <= HOUSE.y1; }
  function isShop(x, y) { return x >= SHOP.x0 && x <= SHOP.x1 && y >= SHOP.y0 && y <= SHOP.y1; }
  function isRanchBuilding(x, y) { return inRect(RANCH_BUILDING, x, y); }
  function isRiver(x, y) { return inRect(RIVER, x, y) && y !== BRIDGE_Y; }
  function isPond(x, y) {
    var dx = (x - POND.cx) / POND.rx;
    var dy = (y - POND.cy) / POND.ry;
    return dx * dx + dy * dy <= 1;
  }
  function inRect(r, x, y) { return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }
  function isFarm(x, y) { return inRect(FARM_WEST, x, y) || inRect(FARM_EAST, x, y); }
  function isRoad(x, y) {
    if (y === ROAD_H.y && x >= ROAD_H.x0 && x <= ROAD_H.x1) return true;
    if (x === ROAD_V1.x && y >= ROAD_V1.y0 && y <= ROAD_V1.y1) return true;
    if (x === ROAD_V2.x && y >= ROAD_V2.y0 && y <= ROAD_V2.y1) return true;
    return false;
  }

  // 纯地形判定：建筑 > 水面 > 道路 > 草地（池塘压在 x=28 道路上时以水面为准）
  function terrainAt(x, y) {
    if (!inBounds(x, y)) return 'outside';
    if (isHouse(x, y) || isShop(x, y) || isRanchBuilding(x, y)) return 'building';
    if (isPond(x, y)) return 'water';
    if (inRect(RIVER, x, y)) return y === BRIDGE_Y ? 'path' : 'water'; // 河道，y20 为桥
    if (isRoad(x, y)) return 'path';
    return 'grass';
  }

  // 2.3 地貌（只读，不影响通行）：林地 / 高地 / 河岸 / 草甸 / 村庄 / 农田
  function biomeOf(x, y) {
    if (!inBounds(x, y)) return 'outside';
    if (x >= 0 && x <= 4 && y >= 10 && y <= 27) return 'woodland';
    if (x >= 28 && x <= 41 && y >= 0 && y <= 5) return 'highland';
    if (x >= 39 && y >= 10 && y <= 28) return 'riverbank';
    if (x >= 19 && x <= 28 && y >= 20 && y <= 29) return 'meadow';
    if (y <= 9) return 'village';
    return 'farmland';
  }

  function cheb(ax, ay, bx, by) {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }

  function plotKey(x, y) { return x + ',' + y; }

  function parsePlotKey(key) {
    var m = /^(\d{1,2}),(\d{1,2})$/.exec(String(key));
    if (!m) return null;
    var x = parseInt(m[1], 10), y = parseInt(m[2], 10);
    if (!inBounds(x, y) || !isFarm(x, y)) return null;
    return { x: x, y: y };
  }

  // 天气：由 (seed, day) 唯一决定的确定性序列，无需保存 RNG。
  function hash32(a) {
    var h = a >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }
  function weatherForDay(seed, day) {
    var mixed = hash32((seed ^ Math.imul(day >>> 0, 0x9e3779b1)) >>> 0);
    var roll = mixed / 4294967296;
    return roll < 0.32 ? 'rainy' : 'sunny';
  }

  function ok(message, extra) {
    var r = { ok: true, message: message || '' };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }
  function fail(message) { return { ok: false, message: message }; }

  var CROP_IDS = Object.keys(CROPS);
  var ITEM_IDS = Object.keys(ITEMS);
  var PRODUCT_IDS = Object.keys(PRODUCTS);

  function findQuest(id) {
    for (var i = 0; i < QUESTS.length; i++) if (QUESTS[i].id === id) return QUESTS[i];
    return null;
  }

  function materialName(key) {
    if (CROPS[key]) return CROPS[key].name;
    if (key === 'wood') return '木材';
    if (key === 'stone') return '石料';
    return key;
  }

  // 交付材料当前持有量：作物看 bag，木头/石料看对应字段
  function ownOf(state, key) {
    if (CROPS[key]) return state.bag[key] || 0;
    if (key === 'wood') return state.wood || 0;
    if (key === 'stone') return state.stone || 0;
    return 0;
  }

  // ---------------------------------------------------------------- 障碍布景（2.2）

  function isOuterBand(x, y) {
    if (x <= 2 || x >= MAP.cols - 3) return true;            // 左右外沿
    if (y <= 2 || y >= MAP.rows - 3) return true;            // 上下外沿
    if (x >= 17 && x <= 29 && (y <= 12 || y >= 20)) return true; // 两片田之间的中部草地
    return false;
  }

  function buildObstacleTable() {
    var locTiles = Object.create(null);
    Object.keys(LOCATIONS).forEach(function (id) {
      var l = LOCATIONS[id];
      locTiles[l.x + ',' + l.y] = id;
    });

    var candidates = [];
    for (var y = 0; y < MAP.rows; y++) {
      for (var x = 0; x < MAP.cols; x++) {
        if (!isOuterBand(x, y)) continue;
        if (terrainAt(x, y) !== 'grass') continue;
        if (isFarm(x, y)) continue;
        if (locTiles[x + ',' + y]) continue;
        if (x === START.x && y === START.y) continue;
        candidates.push({
          x: x, y: y,
          h: hash32((Math.imul(x + 7, 73856093) ^ Math.imul(y + 13, 19349663)) >>> 0)
        });
      }
    }
    candidates.sort(function (a, b) { return a.h - b.h || a.x - b.x || a.y - b.y; });

    var table = Object.create(null);
    var occupied = function (x, y) { return table[x + ',' + y]; };
    var freeNeighbours = function (x, y) {
      var n = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = x + d[0], ny = y + d[1];
        if (terrainAt(nx, ny) !== 'grass') return;
        if (occupied(nx, ny)) return;
        n++;
      });
      return n;
    };
    // 从出生点 BFS：所有交互点可达，且每个交互点至少有一个可达的可走邻格
    var reachesAll = function () {
      var seen = Object.create(null);
      var queue = [[START.x, START.y]];
      seen[START.x + ',' + START.y] = true;
      for (var head = 0; head < queue.length; head++) {
        var cur = queue[head];
        for (var k = 0; k < 4; k++) {
          var d = [[1, 0], [-1, 0], [0, 1], [0, -1]][k];
          var nx = cur[0] + d[0], ny = cur[1] + d[1], key = nx + ',' + ny;
          if (!inBounds(nx, ny)) continue;
          if (seen[key]) continue;
          var t = terrainAt(nx, ny);
          if (t === 'building' || t === 'water') continue;
          if (occupied(nx, ny)) continue;
          seen[key] = true;
          queue.push([nx, ny]);
        }
      }
      var ids = Object.keys(LOCATIONS);
      for (var i = 0; i < ids.length; i++) {
        var l = LOCATIONS[ids[i]];
        var adj = false;
        for (var k2 = 0; k2 < 4; k2++) {
          var d2 = [[1, 0], [-1, 0], [0, 1], [0, -1]][k2];
          if (seen[(l.x + d2[0]) + ',' + (l.y + d2[1])]) { adj = true; break; }
        }
        if (!adj) return false;
      }
      return true;
    };

    var trees = 0, rocks = 0;
    for (var i = 0; i < candidates.length; i++) {
      if (trees >= TREE_GOAL && rocks >= ROCK_GOAL) break;
      var c = candidates[i];
      var type;
      if (trees < TREE_GOAL && (rocks >= ROCK_GOAL || trees <= rocks)) type = 'tree';
      else if (rocks < ROCK_GOAL) type = 'rock';
      else continue;
      if (freeNeighbours(c.x, c.y) < 2) continue;
      var key = c.x + ',' + c.y;
      table[key] = type;
      if (!reachesAll()) { delete table[key]; continue; }
      if (type === 'tree') trees++; else rocks++;
    }

    // 收尾：任何障碍都至少保留两个可站立的相邻格
    var changed = true;
    while (changed) {
      changed = false;
      Object.keys(table).forEach(function (key) {
        var parts = key.split(',');
        var x = parseInt(parts[0], 10), y = parseInt(parts[1], 10);
        if (freeNeighbours(x, y) < 2) { delete table[key]; changed = true; }
      });
    }
    return table;
  }

  var OBSTACLE_TABLE = buildObstacleTable();

  // ---------------------------------------------------------------- 存档校验

  function saveError(detail) { return new Error('存档格式不正确：' + detail); }

  function validateSave(data) {
    if (!isPlainObject(data)) throw new Error('存档必须是一个对象。');
    // 旧沙盒存档：给出明确提示，而不是泛泛的格式错误。
    if (data.version === 1 || Array.isArray(data.cells) || Array.isArray(data.life) ||
        typeof data.scene === 'string') {
      throw new Error('这是旧版沙盒存档（v1），农场版本无法读取；请重新开始一座农场。');
    }
    if (data.version !== 2) throw new Error('存档版本不正确：需要 version 为 2。');

    if (!isInt(data.seed) || data.seed <= 0 || data.seed > 4294967295) throw saveError('seed 必须是 1 到 4294967295 的整数。');
    if (!isInt(data.day) || data.day < 1 || data.day > 1000000000) throw saveError('day 必须是正整数。');
    if (!isInt(data.minutes) || data.minutes < 0 || data.minutes > LAST_MINUTES) throw saveError('minutes 必须在 0 到 1320（22:00）之间。');
    if (data.weather !== 'sunny' && data.weather !== 'rainy') throw saveError('weather 必须是 sunny 或 rainy。');

    if (!isInt(data.maxEnergy) || data.maxEnergy < 1 || data.maxEnergy > 1000) throw saveError('maxEnergy 必须是 1 到 1000 的整数。');
    if (!isInt(data.energy) || data.energy < 0 || data.energy > data.maxEnergy) throw saveError('energy 必须在 0 到 maxEnergy 之间。');
    if (!isInt(data.money) || data.money < 0 || data.money > 1000000000) throw saveError('money 必须是非负整数。');
    if (!isInt(data.wood) || data.wood < 0 || data.wood > 1000000000) throw saveError('wood 必须是非负整数。');
    if (!isInt(data.stone) || data.stone < 0 || data.stone > 1000000000) throw saveError('stone 必须是非负整数。');

    if (!isPlainObject(data.seeds)) throw saveError('seeds 必须是对象。');
    if (!isPlainObject(data.bag)) throw saveError('bag 必须是对象。');
    CROP_IDS.forEach(function (id) {
      if (data.seeds[id] !== undefined && (!isInt(data.seeds[id]) || data.seeds[id] < 0 || data.seeds[id] > 999999)) throw saveError('seeds.' + id + ' 必须是非负整数。');
    });
    ITEM_IDS.forEach(function (id) {
      if (data.bag[id] !== undefined && (!isInt(data.bag[id]) || data.bag[id] < 0 || data.bag[id] > 999999)) throw saveError('bag.' + id + ' 必须是非负整数。');
    });
    if (!isPlainObject(data.plots)) throw saveError('plots 必须是对象。');
    Object.keys(data.plots).forEach(function (key) {
      if (!parsePlotKey(key)) throw saveError('plots 的键 "' + key + '" 不是农田坐标。');
      var plot = data.plots[key];
      if (!isPlainObject(plot)) throw saveError('地块 ' + key + ' 的数据必须是对象。');
      if (typeof plot.watered !== 'boolean') throw saveError('地块 ' + key + ' 的 watered 必须是布尔值。');
      if (plot.crop === null) return;
      if (!isPlainObject(plot.crop)) throw saveError('地块 ' + key + ' 的 crop 必须是 null 或作物对象。');
      if (!CROPS[plot.crop.id]) throw saveError('地块 ' + key + ' 的作物 id 未知。');
      if (!isInt(plot.crop.age) || plot.crop.age < 0 || plot.crop.age > CROPS[plot.crop.id].days) throw saveError('地块 ' + key + ' 的作物 age 超出范围。');
    });

    if (!Array.isArray(data.cleared)) throw saveError('cleared 必须是数组。');
    data.cleared.forEach(function (key) {
      if (typeof key !== 'string' || !parsePlotKeyLike(key)) throw saveError('cleared 里含无效坐标：' + key);
    });

    if (!isInt(data.wateringLevel) || data.wateringLevel < 0 || data.wateringLevel > 1) throw saveError('wateringLevel 必须是 0 或 1。');

    if (!Array.isArray(data.claimed)) throw saveError('claimed 必须是数组。');
    data.claimed.forEach(function (id) {
      if (!findQuest(id)) throw saveError('claimed 里含未知委托：' + id);
    });

    if (!isInt(data.restedAtDay) || data.restedAtDay < 0 || data.restedAtDay > 1000000000) throw saveError('restedAtDay 必须是非负整数。');

    if (!isPlainObject(data.stats)) throw saveError('stats 必须是对象。');
    ['harvested', 'sold', 'earned', 'watered'].forEach(function (k) {
      if (!isInt(data.stats[k]) || data.stats[k] < 0) throw saveError('stats.' + k + ' 必须是非负整数。');
    });

    if (!isPlainObject(data.player)) throw saveError('player 必须是对象。');
    if (!inBounds(data.player.x, data.player.y)) throw saveError('player 坐标超出地图。');
    if (FACINGS.indexOf(data.player.facing) < 0) throw saveError('player.facing 必须是 up/down/left/right。');

    // ---- 2.3 新字段：旧存档可以完全没有；一旦存在就必须合法 ----
    if (data.livestock !== undefined) {
      var lv = data.livestock;
      if (!isPlainObject(lv)) throw saveError('livestock 必须是对象。');
      ['coop', 'barn'].forEach(function (k) {
        if (typeof lv[k] !== 'boolean') throw saveError('livestock.' + k + ' 必须是布尔值。');
      });
      if (!isInt(lv.chickens) || lv.chickens < 0 || lv.chickens > 6) throw saveError('livestock.chickens 必须是 0 到 6 的整数。');
      if (!isInt(lv.cows) || lv.cows < 0 || lv.cows > 3) throw saveError('livestock.cows 必须是 0 到 3 的整数。');
      if (lv.chickens > 0 && !lv.coop) throw saveError('livestock.chickens 需要先建好鸡舍。');
      if (lv.cows > 0 && !lv.barn) throw saveError('livestock.cows 需要先建好牛棚。');
      ['feed', 'eggsReady', 'milkReady'].forEach(function (k) {
        if (!isInt(lv[k]) || lv[k] < 0 || lv[k] > 999999) throw saveError('livestock.' + k + ' 必须是非负整数。');
      });
      if (!isInt(lv.fedAtDay) || lv.fedAtDay < 0 || lv.fedAtDay > data.day) throw saveError('livestock.fedAtDay 必须在 0 到 day 之间。');
    }
    if (data.industry !== undefined) {
      var ind = data.industry;
      if (!isPlainObject(ind)) throw saveError('industry 必须是对象。');
      if (typeof ind.built !== 'boolean') throw saveError('industry.built 必须是布尔值。');
      if (!Array.isArray(ind.jobs)) throw saveError('industry.jobs 必须是数组。');
      if (ind.jobs.length > MAX_JOBS) throw saveError('industry.jobs 最多 ' + MAX_JOBS + ' 条。');
      if (ind.jobs.length > 0 && !ind.built) throw saveError('industry.jobs 需要先建好加工坊。');
      ind.jobs.forEach(function (job) {
        if (!isPlainObject(job)) throw saveError('industry.jobs 里必须是对象。');
        if (!RECIPES[job.recipe]) throw saveError('industry.jobs 里的配方未知：' + job.recipe);
        if (!isInt(job.qty) || job.qty < 1 || job.qty > JOB_QTY_MAX) throw saveError('industry.jobs 的 qty 必须是 1 到 ' + JOB_QTY_MAX + ' 的整数。');
        if (!isInt(job.readyDay) || job.readyDay < 1) throw saveError('industry.jobs 的 readyDay 必须是正整数。');
      });
    }
    if (data.helpers !== undefined) {
      var hp = data.helpers;
      if (!isPlainObject(hp)) throw saveError('helpers 必须是对象。');
      ['waterer', 'harvester'].forEach(function (k) {
        if (typeof hp[k] !== 'boolean') throw saveError('helpers.' + k + ' 必须是布尔值。');
      });
    }
  }

  // cleared 只存地图内的 "x,y"，不强制是固定布景（版本演进时更宽容）：
  // 旧 30×22 存档里的历史障碍坐标即使现在落在新田地上，也照常放行。
  function parsePlotKeyLike(key) {
    var m = /^(\d{1,2}),(\d{1,2})$/.exec(String(key));
    if (!m) return false;
    return inBounds(parseInt(m[1], 10), parseInt(m[2], 10));
  }

  function buildState(data) {
    var seeds = {}, bag = {};
    CROP_IDS.forEach(function (id) {
      seeds[id] = data.seeds[id] || 0;
    });
    ITEM_IDS.forEach(function (id) {
      bag[id] = data.bag[id] || 0;
    });
    var plots = {};
    Object.keys(data.plots).forEach(function (key) {
      var p = data.plots[key];
      plots[key] = {
        watered: p.watered,
        crop: p.crop ? { id: p.crop.id, age: p.crop.age } : null
      };
    });
    var cleared = [];
    data.cleared.forEach(function (key) { if (cleared.indexOf(key) < 0) cleared.push(String(key)); });
    var claimed = [];
    data.claimed.forEach(function (id) { if (claimed.indexOf(id) < 0) claimed.push(id); });
    return {
      version: 2,
      seed: data.seed,
      day: data.day,
      minutes: data.minutes,
      weather: data.weather,
      money: data.money,
      energy: data.energy,
      maxEnergy: data.maxEnergy,
      seeds: seeds,
      bag: bag,
      wood: data.wood,
      stone: data.stone,
      plots: plots,
      cleared: cleared,
      wateringLevel: data.wateringLevel,
      claimed: claimed,
      restedAtDay: data.restedAtDay,
      stats: {
        harvested: data.stats.harvested,
        sold: data.stats.sold,
        earned: data.stats.earned,
        watered: data.stats.watered
      },
      player: { x: data.player.x, y: data.player.y, facing: data.player.facing },
      livestock: buildLivestock(data.livestock),
      industry: buildIndustry(data.industry),
      helpers: buildHelpers(data.helpers)
    };
  }

  // 2.3 新字段归一化：旧存档缺字段时给默认值，存在时按已校验的数据拷贝
  function buildLivestock(src) {
    var d = { coop: false, barn: false, chickens: 0, cows: 0, feed: 0, fedAtDay: 0, eggsReady: 0, milkReady: 0 };
    if (!src) return d;
    d.coop = !!src.coop;
    d.barn = !!src.barn;
    d.chickens = src.chickens;
    d.cows = src.cows;
    d.feed = src.feed;
    d.fedAtDay = src.fedAtDay;
    d.eggsReady = src.eggsReady;
    d.milkReady = src.milkReady;
    return d;
  }

  function buildIndustry(src) {
    var d = { built: false, jobs: [] };
    if (!src) return d;
    d.built = !!src.built;
    d.jobs = src.jobs.map(function (job) {
      return { recipe: job.recipe, qty: job.qty, readyDay: job.readyDay };
    });
    return d;
  }

  function buildHelpers(src) {
    var d = { waterer: false, harvester: false };
    if (!src) return d;
    d.waterer = !!src.waterer;
    d.harvester = !!src.harvester;
    return d;
  }

  // ---------------------------------------------------------------- FarmGame

  function FarmGame(seed) {
    if (!(this instanceof FarmGame)) return new FarmGame(seed);
    var normalized = 0;
    if (typeof seed === 'number' && isFinite(seed)) normalized = (seed >>> 0);
    else if (typeof seed === 'string' && /^\d+$/.test(seed.trim())) normalized = (parseInt(seed, 10) >>> 0);
    if (!normalized) normalized = 20261029;

    this.state = {
      version: 2,
      seed: normalized,
      day: 1,
      minutes: START_DAY_MINUTES,
      weather: 'sunny',
      money: 100,
      energy: 100,
      maxEnergy: 100,
      seeds: { radish: 6, carrot: 2, berry: 0 },
      bag: { radish: 0, carrot: 0, berry: 0, egg: 0, milk: 0, mayo: 0, cheese: 0, jam: 0 },
      wood: 0,
      stone: 0,
      plots: {},
      cleared: [],
      wateringLevel: 0,
      claimed: [],
      restedAtDay: 0,
      stats: { harvested: 0, sold: 0, earned: 0, watered: 0 },
      player: { x: START.x, y: START.y, facing: START.facing },
      livestock: { coop: false, barn: false, chickens: 0, cows: 0, feed: 0, fedAtDay: 0, eggsReady: 0, milkReady: 0 },
      industry: { built: false, jobs: [] },
      helpers: { waterer: false, harvester: false }
    };
  }

  // ---- 只读查询

  FarmGame.prototype.tileAt = function (x, y) {
    return terrainAt(x, y);
  };

  FarmGame.prototype.biomeAt = function (x, y) {
    return biomeOf(x, y);
  };

  FarmGame.prototype.isFarmTile = function (x, y) {
    return inBounds(x, y) && isFarm(x, y);
  };

  FarmGame.prototype.obstacleAt = function (x, y) {
    if (!inBounds(x, y)) return null;
    var key = plotKey(x, y);
    var cleared = this.state.cleared;
    for (var i = 0; i < cleared.length; i++) if (cleared[i] === key) return null;
    var type = OBSTACLE_TABLE[key];
    return type ? { type: type, x: x, y: y } : null;
  };

  FarmGame.prototype.isWalkable = function (x, y) {
    if (!inBounds(x, y)) return false;
    var tile = this.tileAt(x, y);
    if (tile === 'building' || tile === 'water' || tile === 'outside') return false;
    return !this.obstacleAt(x, y);
  };

  FarmGame.prototype.timeLabel = function () {
    var m = this.state.minutes;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  };

  FarmGame.prototype.nearby = function () {
    var p = this.state.player;
    var best = null, bestDist = 99;
    Object.keys(LOCATIONS).forEach(function (id) {
      var loc = LOCATIONS[id];
      var dist = cheb(p.x, p.y, loc.x, loc.y);
      if (dist <= 1 && dist < bestDist) {
        best = { id: id, name: loc.name, x: loc.x, y: loc.y };
        bestDist = dist;
      }
    });
    return best;
  };

  FarmGame.prototype._near = function (id) {
    var loc = LOCATIONS[id];
    if (!loc) return false;
    var p = this.state.player;
    return cheb(p.x, p.y, loc.x, loc.y) <= 1;
  };

  // ---- 移动

  FarmGame.prototype.move = function (dx, dy) {
    if (!isInt(dx) || !isInt(dy) || Math.abs(dx) + Math.abs(dy) !== 1) {
      return fail('只能向上下左右走一格。');
    }
    var facing = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up';
    this.state.player.facing = facing; // 朝向即使受阻也会更新
    var p = this.state.player;
    var nx = p.x + dx, ny = p.y + dy;
    if (!inBounds(nx, ny)) return fail('前面是世界的边缘。');
    if (!this.isWalkable(nx, ny)) {
      var obstacle = this.obstacleAt(nx, ny);
      if (obstacle) {
        return fail(obstacle.type === 'tree' ? '一棵树挡在前面，也许可以用斧头砍开。' : '一块石头挡在前面，也许可以用镐敲开。');
      }
      var tile = this.tileAt(nx, ny);
      if (tile === 'water') return fail('水太深了，游不过去。');
      if (tile === 'building') return fail('那边是建筑，进不去。');
      return fail('前面过不去。');
    }
    p.x = nx;
    p.y = ny;
    return ok('你向前走了一步。');
  };

  // ---- 目标格解析

  FarmGame.prototype._resolveTarget = function (x, y) {
    var p = this.state.player;
    var tx = x, ty = y;
    if (tx !== undefined || ty !== undefined) {
      if (!isInt(tx) || !isInt(ty)) return fail('目标坐标必须是整数。');
      if (!inBounds(tx, ty)) return fail('目标不在世界里。');
      if (cheb(p.x, p.y, tx, ty) > 1) return fail('太远了，只能操作身边一格。');
    } else {
      var delta = FACING_DELTA[p.facing] || FACING_DELTA.down;
      tx = p.x + delta[0];
      ty = p.y + delta[1];
      if (!inBounds(tx, ty)) return fail('面前是世界的边缘。');
    }
    return { ok: true, message: '', x: tx, y: ty };
  };

  FarmGame.prototype._spendAndWait = function (energyCost) {
    this.state.energy -= energyCost;
    if (this.state.energy < 0) this.state.energy = 0;
    this.state.minutes = Math.min(LAST_MINUTES, this.state.minutes + ACTION_MINUTES);
  };

  // ---- 使用工具

  FarmGame.prototype.use = function (tool, cropId, x, y) {
    var self = this;
    if (TOOLS.indexOf(tool) < 0) return fail('没有这种工具：' + tool + '。');
    if (tool === 'seed') {
      cropId = cropId === undefined ? 'radish' : cropId;
      if (!CROPS[cropId]) return fail('没有这种作物：' + cropId + '。');
    }
    var target = this._resolveTarget(x, y);
    if (!target.ok) return target;

    var cost = USE_COST[tool];
    if (this.state.energy < cost) return fail('体力不够（需要 ' + cost + ' 点，当前 ' + this.state.energy + ' 点）。');

    var key = plotKey(target.x, target.y);

    if (tool === 'hoe') {
      if (!this.isFarmTile(target.x, target.y)) return fail('农田外不能开垦。');
      if (this.state.plots[key]) return fail('这块地已经开垦过了。');
      this.state.plots[key] = { watered: this.state.weather === 'rainy', crop: null };
      this._spendAndWait(cost);
      return ok('开垦了一块农田，消耗 ' + cost + ' 点体力。');
    }

    if (tool === 'seed') {
      var plot = this.state.plots[key];
      if (!plot) return fail('要先用锄头开垦这块地。');
      if (plot.crop) return fail('这块地已经种着作物了。');
      if ((this.state.seeds[cropId] || 0) <= 0) return fail(CROPS[cropId].name + '种子不够了。');
      this.state.seeds[cropId] -= 1;
      plot.crop = { id: cropId, age: 0 };
      this._spendAndWait(cost);
      return ok('播下了' + CROPS[cropId].name + '种子，消耗 ' + cost + ' 点体力。');
    }

    if (tool === 'water') {
      if (!this.state.plots[key]) return fail('这里还不是农田，浇不了水。');
      var targets = [key];
      if (this.state.wateringLevel >= 1) {
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nk = plotKey(target.x + d[0], target.y + d[1]);
          if (self.state.plots[nk]) targets.push(nk);
        });
      }
      targets = targets.filter(function (k) { return !self.state.plots[k].watered; });
      if (!targets.length) return fail('这些土地已经湿润，不需要重复浇水。');
      targets.forEach(function (k) { self.state.plots[k].watered = true; });
      this.state.stats.watered += targets.length; // 每次浇水按实际覆盖的地块数计数
      this._spendAndWait(cost);
      return ok('浇了 ' + targets.length + ' 块地，消耗 ' + cost + ' 点体力。');
    }

    if (tool === 'harvest') {
      var hp = this.state.plots[key];
      if (!hp || !hp.crop) return fail('这里没有可以收获的作物。');
      var cropId = hp.crop.id;
      var def = CROPS[cropId];
      if (hp.crop.age < def.days) {
        return fail(def.name + '还没成熟（' + hp.crop.age + '/' + def.days + ' 天）。');
      }
      hp.crop = null; // 收获后保留耕地
      this.state.bag[cropId] = (this.state.bag[cropId] || 0) + 1;
      this.state.stats.harvested += 1;
      this._spendAndWait(cost);
      return ok('收获了 1 个' + def.name + '，消耗 ' + cost + ' 点体力。');
    }

    var obstacle = this.obstacleAt(target.x, target.y);
    if (tool === 'axe') {
      if (!obstacle || obstacle.type !== 'tree') return fail(obstacle ? '挡路的是石头，得用镐。' : '这里没有可以砍的树。');
      this.state.cleared.push(key);
      this.state.wood += AXE_WOOD;
      this._spendAndWait(cost);
      return ok('砍倒一棵树，得到 ' + AXE_WOOD + ' 份木头，消耗 ' + cost + ' 点体力。');
    }
    if (tool === 'pickaxe') {
      if (!obstacle || obstacle.type !== 'rock') return fail(obstacle ? '挡路的是树，得用斧头。' : '这里没有可以敲的石头。');
      this.state.cleared.push(key);
      this.state.stone += PICKAXE_STONE;
      this._spendAndWait(cost);
      return ok('敲碎一块石头，得到 ' + PICKAXE_STONE + ' 份石料，消耗 ' + cost + ' 点体力。');
    }
    return fail('这个工具暂时用不了。');
  };

  // ---- 交互

  FarmGame.prototype.interact = function () {
    var loc = this.nearby();
    if (!loc) return { ok: false, message: '附近没有可以互动的东西。', kind: null };
    if (NPCS[loc.id]) {
      return { ok: true, message: NPCS[loc.id].greeting, kind: 'npc', npcId: loc.id };
    }
    var text = {
      home: '小屋的门虚掩着，在这里可以睡觉结束这一天。',
      shop: '杂货铺里飘着种子和木料的香气，可以买种子、升级洒水壶。',
      bin: '出货箱张着盖子，把背包里的作物放进去就能换成金币。',
      well: '石井的水很凉，累了可以在这里歇一会儿（每天一次）。'
    };
    return { ok: true, message: text[loc.id] || ('这里是' + loc.name + '。'), kind: loc.id };
  };

  // ---- 2.3 生产经营：设施 / 养殖 / 加工 / 帮手

  function sortedPlotKeys(st) {
    return Object.keys(st.plots).sort(function (a, b) {
      var A = a.split(','), B = b.split(',');
      var ay = parseInt(A[1], 10), by = parseInt(B[1], 10);
      return ay - by || parseInt(A[0], 10) - parseInt(B[0], 10);
    });
  }

  function facilityBuilt(st, id) {
    if (id === 'coop') return !!st.livestock.coop;
    if (id === 'barn') return !!st.livestock.barn;
    if (id === 'workshop') return !!st.industry.built;
    return false;
  }

  FarmGame.prototype.buildFacility = function (id) {
    var def = BUILDINGS[id];
    if (!def) return fail('不认识这种设施：' + id + '。');
    if (!this._near(id === 'workshop' ? 'workshop' : 'ranch')) {
      return fail('要到' + (id === 'workshop' ? '加工坊' : '牧场') + '旁边才能建造。');
    }
    if (facilityBuilt(this.state, id)) return fail(def.name + '已经建好了。');
    if (this.state.money < def.money) return fail('金币不够：建造' + def.name + '需要 ' + def.money + ' G。');
    if (this.state.wood < def.wood) return fail('木材不够：建造' + def.name + '需要 ' + def.wood + ' 份。');
    if (this.state.stone < def.stone) return fail('石料不够：建造' + def.name + '需要 ' + def.stone + ' 份。');
    this.state.money -= def.money;
    this.state.wood -= def.wood;
    this.state.stone -= def.stone;
    if (id === 'coop') this.state.livestock.coop = true;
    else if (id === 'barn') this.state.livestock.barn = true;
    else this.state.industry.built = true;
    return ok('建好了' + def.name + '。');
  };

  FarmGame.prototype.buyAnimal = function (type, qty) {
    var def = ANIMALS[type];
    if (!def) return fail('没有这种动物：' + type + '。');
    if (!this._near('ranch')) return fail('要到牧场旁边才能买动物。');
    qty = qty === undefined ? 1 : qty;
    if (!isInt(qty) || qty < 1 || qty > def.cap) return fail('一次购买数量要在 1 到 ' + def.cap + ' 之间。');
    if (!facilityBuilt(this.state, def.facility)) return fail('要先建好' + BUILDINGS[def.facility].name + '。');
    var field = type === 'chicken' ? 'chickens' : 'cows';
    if (this.state.livestock[field] + qty > def.cap) return fail(def.name + '最多养 ' + def.cap + ' 只。');
    var cost = def.price * qty;
    if (this.state.money < cost) return fail('金币不够：需要 ' + cost + ' G。');
    this.state.money -= cost;
    this.state.livestock[field] += qty;
    return ok('买了 ' + qty + ' 只' + def.name + '，花了 ' + cost + ' G。');
  };

  FarmGame.prototype.buyFeed = function (qty) {
    if (!this._near('ranch') && !this._near('shop')) return fail('要到牧场或杂货铺旁边才能买饲料。');
    qty = qty === undefined ? 1 : qty;
    if (!isInt(qty) || qty < 1 || qty > 99) return fail('一次购买饲料数量要在 1 到 99 之间。');
    var cost = FEED_PRICE * qty;
    if (this.state.money < cost) return fail('金币不够：需要 ' + cost + ' G。');
    this.state.money -= cost;
    this.state.livestock.feed += qty;
    return ok('买了 ' + qty + ' 份饲料，花了 ' + cost + ' G。');
  };

  FarmGame.prototype.feedAnimals = function () {
    if (!this._near('ranch')) return fail('要到牧场旁边才能喂动物。');
    var lv = this.state.livestock;
    var total = lv.chickens + lv.cows;
    if (total <= 0) return fail('还没有养动物。');
    if (lv.fedAtDay === this.state.day) return fail('今天已经喂过了。');
    var need = lv.chickens + lv.cows * 2;
    if (lv.feed < need) return fail('饲料不够：需要 ' + need + ' 份。');
    lv.feed -= need;
    lv.fedAtDay = this.state.day;
    return ok('喂了 ' + lv.chickens + ' 只鸡、' + lv.cows + ' 头牛，消耗 ' + need + ' 份饲料。');
  };

  FarmGame.prototype.collectAnimalProducts = function () {
    if (!this._near('ranch')) return fail('要到牧场旁边才能收蛋奶。');
    var lv = this.state.livestock;
    var eggs = lv.eggsReady, milk = lv.milkReady;
    if (eggs <= 0 && milk <= 0) return fail('现在没有可以收的蛋或奶。');
    this.state.bag.egg += eggs;
    this.state.bag.milk += milk;
    lv.eggsReady = 0;
    lv.milkReady = 0;
    return ok('收下 ' + eggs + ' 个鸡蛋、' + milk + ' 瓶牛奶。');
  };

  FarmGame.prototype.craft = function (recipeId, qty) {
    var def = RECIPES[recipeId];
    if (!def) return fail('没有这种配方：' + recipeId + '。');
    if (!this._near('workshop')) return fail('要到加工坊旁边才能加工。');
    if (!this.state.industry.built) return fail('要先建好加工坊。');
    qty = qty === undefined ? 1 : qty;
    if (!isInt(qty) || qty < 1 || qty > JOB_QTY_MAX) return fail('每批数量要在 1 到 ' + JOB_QTY_MAX + ' 之间。');
    if (this.state.industry.jobs.length >= MAX_JOBS) return fail('加工队列已经满了。');
    var ids = Object.keys(def.ingredients);
    for (var i = 0; i < ids.length; i++) {
      var need = def.ingredients[ids[i]] * qty;
      if ((this.state.bag[ids[i]] || 0) < need) return fail(materialName(ids[i]) + '不够：需要 ' + need + ' 个。');
    }
    ids.forEach(function (k) { this.state.bag[k] -= def.ingredients[k] * qty; }, this);
    this.state.industry.jobs.push({ recipe: recipeId, qty: qty, readyDay: this.state.day + def.days });
    return ok('开始加工 ' + qty + ' 份' + def.name + '，明天就好。');
  };

  FarmGame.prototype.collectCrafted = function () {
    if (!this._near('workshop')) return fail('要到加工坊旁边才能取成品。');
    var jobs = this.state.industry.jobs;
    var ready = jobs.filter(function (j) { return j.readyDay <= this.state.day; }, this);
    if (!ready.length) return fail('还没有加工好的成品。');
    var got = 0;
    ready.forEach(function (j) { this.state.bag[j.recipe] += j.qty; got += j.qty; }, this);
    var today = this.state.day;
    this.state.industry.jobs = jobs.filter(function (j) { return j.readyDay > today; });
    return ok('取回 ' + got + ' 份加工品。');
  };

  FarmGame.prototype.hireHelper = function (id) {
    var def = HELPERS[id];
    if (!def) return fail('没有这种帮手：' + id + '。');
    if (!this._near('guild')) return fail('要到帮手驿站才能雇佣。');
    if (this.state.helpers[id]) return fail(def.name + '已经雇好了。');
    if (this.state.money < def.hirePrice) return fail('金币不够：雇佣需要 ' + def.hirePrice + ' G。');
    this.state.money -= def.hirePrice;
    this.state.helpers[id] = true;
    return ok('雇好了' + def.name + '。');
  };

  FarmGame.prototype.fireHelper = function (id) {
    var def = HELPERS[id];
    if (!def) return fail('没有这种帮手：' + id + '。');
    if (!this._near('guild')) return fail('要到帮手驿站才能解雇。');
    if (!this.state.helpers[id]) return fail('还没有雇佣' + def.name + '。');
    this.state.helpers[id] = false;
    return ok('和' + def.name + '结束了合作，没有退还雇佣费。');
  };

  // ---- 睡觉 / 时间

  FarmGame.prototype.sleep = function () {
    var p = this.state.player;
    var home = LOCATIONS.home;
    if (cheb(p.x, p.y, home.x, home.y) > 1) return fail('要回到小屋旁边才能睡觉。');

    var st = this.state;
    var plots = st.plots;
    var nextWeather = weatherForDay(st.seed, st.day + 1);
    var skipped = [];
    var helpers = { watered: 0, harvested: 0, wages: 0, skipped: skipped };
    var keys = Object.keys(plots).sort(function (a, b) {
      var A = a.split(','), B = b.split(',');
      return parseInt(A[1], 10) - parseInt(B[1], 10) || parseInt(A[0], 10) - parseInt(B[0], 10);
    });

    // 雨天（今天或明天）田地由雨水打理：浇水帮手没有活干，也不收工资
    var rainCovers = nextWeather === 'rainy' || st.weather === 'rainy';
    if (st.helpers.waterer) {
      var thirsty = keys.filter(function (k) {
        var pl = plots[k];
        return pl.crop && pl.crop.age < CROPS[pl.crop.id].days && !pl.watered;
      }).slice(0, HELPERS.waterer.capacity);
      if (rainCovers) skipped.push('浇水帮手：今天或明天有雨，田地由雨水打理，今晚不用上工。');
      else if (!thirsty.length) skipped.push('浇水帮手：今天没有需要浇水的作物。');
      else if (st.money < HELPERS.waterer.wage) skipped.push('浇水帮手：金币不足 ' + HELPERS.waterer.wage + '，今晚没有上工。');
      else {
        thirsty.forEach(function (k) { plots[k].watered = true; });
        st.money -= HELPERS.waterer.wage;
        st.stats.watered += thirsty.length;
        helpers.watered = thirsty.length;
        helpers.wages += HELPERS.waterer.wage;
      }
    }

    // 记录「今晚之前就已经成熟」的地块：帮手只收这些，今晚刚成熟的留给玩家自己收
    var ripeBefore = keys.filter(function (k) {
      var pl = plots[k];
      return pl.crop && pl.crop.age >= CROPS[pl.crop.id].days;
    });

    var grown = 0;
    keys.forEach(function (key) {
      var plot = plots[key];
      if (plot.crop) {
        var def = CROPS[plot.crop.id];
        if (plot.crop.age < def.days && plot.watered) { plot.crop.age += 1; grown += 1; }
      }
      plot.watered = false;
    });

    if (st.helpers.harvester) {
      var ripe = ripeBefore.filter(function (k) { return plots[k].crop; }).slice(0, HELPERS.harvester.capacity);
      if (!ripe.length) skipped.push('采收帮手：没有成熟的作物需要采收。');
      else if (st.money < HELPERS.harvester.wage) skipped.push('采收帮手：金币不足 ' + HELPERS.harvester.wage + '，今晚没有上工。');
      else {
        ripe.forEach(function (k) {
          var id = plots[k].crop.id;
          plots[k].crop = null;
          st.bag[id] = (st.bag[id] || 0) + 1;
        });
        st.money -= HELPERS.harvester.wage;
        st.stats.harvested += ripe.length;
        helpers.harvested = ripe.length;
        helpers.wages += HELPERS.harvester.wage;
      }
    }

    var lv = st.livestock;
    var animals = { eggs: 0, milk: 0, unfed: false };
    var hasAnimals = lv.chickens + lv.cows > 0;
    if (hasAnimals && lv.fedAtDay === st.day) {
      animals.eggs = lv.chickens;
      animals.milk = lv.cows;
      lv.eggsReady += lv.chickens;
      lv.milkReady += lv.cows;
    } else if (hasAnimals) animals.unfed = true;

    st.day += 1;
    st.minutes = START_DAY_MINUTES;
    st.energy = st.maxEnergy;
    var weather = weatherForDay(st.seed, st.day);
    st.weather = weather;
    if (weather === 'rainy') keys.forEach(function (key) { plots[key].watered = true; });
    var craftReady = st.industry.jobs.filter(function (job) { return job.readyDay <= st.day; }).length;

    var summary = { grown: grown, day: st.day, weather: weather, animals: animals, helpers: helpers, craftReady: craftReady };
    this.summary = summary; // 最近一次睡觉的总结（UI 展示用）
    var text = '第 ' + st.day + ' 天开始了，' + (weather === 'rainy' ? '外面下着雨' : '天气晴朗') +
      (grown > 0 ? '，有 ' + grown + ' 株作物长高了。' : '。');
    return { ok: true, message: text, summary: summary };
  };

  FarmGame.prototype.advanceTime = function (minutes) {
    if (!isInt(minutes) || minutes <= 0) return fail('时间增量必须是正整数。');
    var current = this.state.minutes;
    if (current >= LAST_MINUTES) return ok('已经 22:00 了，该回家了。');
    this.state.minutes = Math.min(LAST_MINUTES, current + minutes);
    if (this.state.minutes >= LAST_MINUTES) return ok('时间到了 22:00，该回家睡觉了。');
    return ok('时间到了 ' + this.timeLabel() + '。');
  };

  // ---- 商店 / 出货 / 委托 / 升级

  FarmGame.prototype.buy = function (cropId, qty) {
    if (!this._near('shop')) return fail('要到杂货铺旁边才能买种子。');
    if (!CROPS[cropId]) return fail('没有这种作物：' + cropId + '。');
    qty = qty === undefined ? 1 : qty;
    if (!isInt(qty) || qty < 1 || qty > 99) return fail('一次购买的种子数量要在 1 到 99 之间。');
    var cost = CROPS[cropId].seedPrice * qty;
    if (this.state.money < cost) return fail('钱不够：需要 ' + cost + ' 金币，你只有 ' + this.state.money + '。');
    this.state.money -= cost;
    this.state.seeds[cropId] = (this.state.seeds[cropId] || 0) + qty;
    return ok('买了 ' + qty + ' 颗' + CROPS[cropId].name + '种子，花了 ' + cost + ' 金币。');
  };

  FarmGame.prototype.sellAll = function () {
    if (!this._near('bin')) return fail('要到出货箱旁边才能出售作物。');
    var bag = this.state.bag;
    var sold = 0, earned = 0;
    Object.keys(ITEMS).forEach(function (id) {
      var qty = bag[id] || 0;
      if (!qty) return;
      sold += qty;
      earned += qty * ITEMS[id].sellPrice;
      bag[id] = 0;
    });
    if (sold === 0) return fail('背包里还没有可以出售的作物。');
    this.state.money += earned;
    this.state.stats.sold += sold;
    this.state.stats.earned += earned;
    return ok('卖出 ' + sold + ' 个作物，赚到 ' + earned + ' 金币。');
  };

  // ---- 委托进度与交付

  FarmGame.prototype.questStatus = function (id) {
    var quest = findQuest(id);
    if (!quest) return null;
    var st = this.state;
    var claimed = st.claimed.indexOf(id) >= 0;
    var locked = !!quest.requiresQuest && st.claimed.indexOf(quest.requiresQuest) < 0;

    var progress = 0;
    if (quest.delivery) {
      Object.keys(quest.delivery).forEach(function (k) {
        progress += Math.min(ownOf(st, k), quest.delivery[k]);
      });
    } else if (quest.stat === 'day') {
      progress = st.day;
    } else {
      progress = st.stats[quest.stat] || 0;
    }

    var target = quest.target;
    var ready = !claimed && !locked && progress >= target;
    var delivery = null;
    if (quest.delivery) {
      delivery = {};
      Object.keys(quest.delivery).forEach(function (k) { delivery[k] = quest.delivery[k]; });
    }
    return {
      progress: progress,
      target: target,
      ready: ready,
      claimed: claimed,
      locked: locked,
      npc: quest.npc,
      delivery: delivery
    };
  };

  FarmGame.prototype.claimQuest = function (id) {
    var quest = findQuest(id);
    if (!quest) return fail('没有这个委托：' + id + '。');
    var npcLoc = LOCATIONS[quest.npc];
    if (!npcLoc) return fail('这个委托暂时没人能接。');
    if (!this._near(quest.npc)) return fail('要走到' + npcLoc.name + '身边才能交委托。');
    if (this.state.claimed.indexOf(id) >= 0) return fail('这个委托的奖励已经领过了。');
    if (quest.requiresQuest) {
      var pre = findQuest(quest.requiresQuest);
      if (this.state.claimed.indexOf(quest.requiresQuest) < 0) {
        return fail('要先完成「' + (pre ? pre.name : quest.requiresQuest) + '」才能接这件委托。');
      }
    }

    // 逐项复核交付材料（校验阶段只读，不做任何扣减）
    if (quest.delivery) {
      var missing = [];
      var ids = Object.keys(quest.delivery);
      for (var i = 0; i < ids.length; i++) {
        var k = ids[i];
        var need = quest.delivery[k];
        var own = ownOf(this.state, k);
        if (own < need) missing.push(materialName(k) + ' ' + own + '/' + need);
      }
      if (missing.length) return fail('材料还不够：' + missing.join('、') + '。');
    } else {
      var status = this.questStatus(id);
      if (!status.ready) {
        return fail('「' + quest.name + '」还差一点：' + status.progress + '/' + status.target + '。');
      }
    }

    // 校验全部通过后一次性扣资源、发钱、记领取（任何失败都已提前返回）
    if (quest.delivery) {
      var keys = Object.keys(quest.delivery);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var amount = quest.delivery[key];
        if (CROPS[key]) this.state.bag[key] -= amount;
        else if (key === 'wood') this.state.wood -= amount;
        else if (key === 'stone') this.state.stone -= amount;
      }
    }
    this.state.claimed.push(id);
    this.state.money += quest.reward;
    return ok('完成委托「' + quest.name + '」，领到 ' + quest.reward + ' 金币。');
  };

  FarmGame.prototype.upgradeWatering = function () {
    if (!this._near('shop')) return fail('要到杂货铺旁边才能升级洒水壶。');
    if (this.state.wateringLevel >= 1) return fail('洒水壶已经升级过了。');
    if (this.state.money < UPGRADE_MONEY) return fail('钱不够：升级需要 ' + UPGRADE_MONEY + ' 金币。');
    if (this.state.wood < UPGRADE_WOOD) return fail('木头不够：升级需要 ' + UPGRADE_WOOD + ' 份木头。');
    this.state.money -= UPGRADE_MONEY;
    this.state.wood -= UPGRADE_WOOD;
    this.state.wateringLevel = 1;
    return ok('洒水壶升级了，一次可以浇目标格和它上下左右的农田。');
  };

  FarmGame.prototype.drinkWell = function () {
    if (!this._near('well')) return fail('要到石井旁边才能休息。');
    if (this.state.restedAtDay === this.state.day) return fail('今天已经在井边歇过了，明天再来吧。');
    if (this.state.energy >= this.state.maxEnergy) return fail('现在精神很好，不需要休息。');
    this.state.energy = Math.min(this.state.maxEnergy, this.state.energy + WELL_ENERGY);
    this.state.restedAtDay = this.state.day;
    return ok('在井边歇了一会儿，恢复了 ' + WELL_ENERGY + ' 点体力。');
  };

  // 兼容别名：井边休息（与 drinkWell 相同）
  FarmGame.prototype.restAtWell = FarmGame.prototype.drinkWell;

  // ---- 存档

  FarmGame.prototype.snapshot = function () {
    return JSON.parse(JSON.stringify(this.state));
  };

  FarmGame.prototype.restore = function (data) {
    // 全部校验通过后才替换 state：非法输入抛错，原状态保持不变。
    validateSave(data);
    var copy = JSON.parse(JSON.stringify(data));
    this.state = buildState(copy);
  };

  // 便捷只读访问器：state.helpers 的别名（UI/测试读取帮手状态用）
  Object.defineProperty(FarmGame.prototype, 'helpers', {
    get: function () { return this.state.helpers; },
    enumerable: false,
    configurable: true
  });

  // 便捷只读访问器：state.livestock 的别名
  Object.defineProperty(FarmGame.prototype, 'livestock', {
    get: function () { return this.state.livestock; },
    enumerable: false,
    configurable: true
  });

  // 便捷只读访问器：state.industry 的别名
  Object.defineProperty(FarmGame.prototype, 'industry', {
    get: function () { return this.state.industry; },
    enumerable: false,
    configurable: true
  });

  return {
    FarmGame: FarmGame,
    CROPS: CROPS,
    MAP: MAP,
    LOCATIONS: LOCATIONS,
    NPCS: NPCS,
    QUESTS: QUESTS,
    TOOLS: TOOLS,
    PRODUCTS: PRODUCTS,
    ITEMS: ITEMS,
    RECIPES: RECIPES,
    BUILDINGS: BUILDINGS,
    HELPERS: HELPERS,
    ANIMALS: ANIMALS
  };
});
