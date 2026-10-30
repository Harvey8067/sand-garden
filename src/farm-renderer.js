/*!
 * 栖砂·田园记 v2 — 原创像素农场渲染器 FarmRenderer
 * ------------------------------------------------------------------
 * 入口：window.FarmRenderer.draw(ctx, game, view)
 *   game : FarmGame 实例（只读 game.state、game.tileAt/isFarmTile/obstacleAt）
 *   view : { time:number(ms), tool:string, cropId:string, target:null|{x,y} }
 * 约定：每次绘制完整 960x704 地图；全部图形为运行时几何/像素笔绘，零外部素材；
 *       不修改游戏状态（只读取，不调用任何会改 state 的方法）。
 */
(function (root) {
  'use strict';
  if (!root) { return; }

  /* ==================== 基础常量 ==================== */
  /* 2.2 扩建：世界 42x30（1344x960）。旧 30x22 是新世界的左上角。 */
  var TILE = 32, COLS = 42, ROWS = 30;
  var MAP_W = COLS * TILE, MAP_H = ROWS * TILE;
  var LEGACY_COLS = 30, LEGACY_ROWS = 22;   /* 旧区尺寸，仅供兼容判断 */
  var PI2 = Math.PI * 2;

  /* 两块田（契约）：西田 x5..16 y10..25，东田 x30..39 y10..25 */
  var FARMS = [
    { x0: 5, y0: 10, x1: 16, y1: 25, name: '西田' },
    { x0: 30, y0: 10, x1: 39, y1: 25, name: '东田' }
  ];
  var FARM = FARMS[0];  /* 兼容旧引用（边界提示取整体范围时另算） */

  /* 2.3 生产：新增地点（旧地点不动） */
  var LOC_FALLBACK_EXTRA = {
    ranch: { x: 2, y: 8, name: '牧场' },
    workshop: { x: 25, y: 10, name: '加工坊' },
    guild: { x: 28, y: 7, name: '帮手驿站' }
  };
  var RANCH_BOX = { x0: 0, y0: 4, x1: 2, y1: 7 };    /* 牧场建筑，不可走，入口(2,8) */
  var RIVER = { x0: 40, x1: 41, y0: 10, y1: 28, bridgeY: 20 };  /* 河道，y20 为桥 */
  var BIOMES = {
    woodland: { x0: 0, x1: 4, y0: 10, y1: 27 },
    highland: { x0: 28, x1: 41, y0: 0, y1: 5 },
    riverbank: { x0: 39, x1: 41, y0: 10, y1: 28 },
    meadow: { x0: 19, x1: 28, y0: 20, y1: 29 }
  };

  var HOUSE_BOX = { x0: 3, y0: 3, x1: 8, y1: 6 };    /* 保留原位 */
  var SHOP_BOX = { x0: 20, y0: 3, x1: 26, y1: 6 };   /* 保留原位 */
  var POND = { cx: 25, cy: 16, rx: 3, ry: 3 };       /* 保留原位 */

  var LOC_FALLBACK = {
    home: { x: 6, y: 7, name: '小屋' },
    shop: { x: 23, y: 7, name: '杂货铺' },
    bin: { x: 10, y: 7, name: '出货箱' },
    npc: { x: 20, y: 9, name: '阿禾' },
    well: { x: 19, y: 12, name: '石井' },
    miller: { x: 31, y: 8, name: '麦叔' },
    ranger: { x: 36, y: 6, name: '林岚' },
    miner: { x: 27, y: 26, name: '石川' },
    florist: { x: 20, y: 26, name: '小葵' }
  };

  /* 四位新村民的外观/身份（core 的 NPCS 到位后以 core 为准） */
  var NPC_STYLE_FALLBACK = {
    npc: { role: '邻居', skin: '#f2cba2', hair: '#6e4a2f', shirt: '#7fae9c', apron: '#e9dcc0', hat: 'straw' },
    miller: { role: '磨坊主', skin: '#eec39a', hair: '#8a5a34', shirt: '#c8a878', apron: '#efe3cb', hat: 'cap', prop: 'sack' },
    ranger: { role: '护林人', skin: '#f0c6a0', hair: '#4a5f3c', shirt: '#6d9463', apron: '#5c7a52', hat: 'hood', prop: 'bow' },
    miner: { role: '矿工', skin: '#dbb287', hair: '#3f3a36', shirt: '#8a7f74', apron: '#6b6158', hat: 'helmet', prop: 'pick' },
    florist: { role: '花匠', skin: '#f6d3b0', hair: '#a4633f', shirt: '#d98fa8', apron: '#f3e2ea', hat: 'ribbon', prop: 'basket' }
  };

  var CROP_FALLBACK = {
    radish: { name: '萝卜', days: 2 },
    carrot: { name: '胡萝卜', days: 3 },
    berry: { name: '草莓', days: 4 }
  };

  /* ==================== 调色板（柔和 + 明暗层次） ==================== */
  var C = {
    grass: ['#8bbd70', '#84b569', '#92c277', '#7daf63'],
    grassPatch: '#78aa5e', grassLight: '#a6d187', grassTuft: '#a9d288', grassShade: '#699a53',
    flower: ['#f7efd0', '#f2d992', '#f0c6cc'],
    path: ['#dcc9a0', '#d6c397', '#e0cfaa'],
    pathJoint: '#c9b98e', pathStone: '#e6d7b0', pathTop: '#f1e6c8', pathBottom: '#c2ad80',
    waterDeep: '#4689ab', waterMid: '#5ca5c3', waterLight: '#8fcfe0', waterFoam: '#ddf3f7',
    soil: '#8d6b4a', soilDark: '#6f5237', soilLight: '#a07d58', furrow: '#78573c',
    soilWet: '#5f4630', soilWetDark: '#4b3625', soilWetLight: '#7a5b40',
    wood: '#b08050', woodDark: '#83593a', woodLight: '#caa06d',
    stone: '#9ea8a6', stoneDark: '#7d8787', stoneLight: '#bcc5c1',
    roof: '#c96c50', roofLight: '#dc8563', roofDark: '#a5533c', roofRidge: '#e6a884',
    wall: '#f2e2bd', wallShade: '#dfca9e', wallDark: '#c8af83',
    glass: '#aad9dc', glassLight: '#daf3f4', frame: '#a97e52',
    shopWall: '#f0ddcb', shopRoof: '#7fa2a0', shopRoofLight: '#96b7b4', shopRoofDark: '#688783',
    awningA: '#d3705f', awningB: '#f7ecd9',
    skin: '#f2cba2', skinShade: '#dfb188',
    hair: '#7b5334',
    hat: '#efd98f', hatDark: '#cfae63', hatBand: '#b9834e',
    shirt: '#7fa8d4', shirtLight: '#9cc0e0', shirtDark: '#6789b2',
    pack: '#b07a4c', packDark: '#8b5c36',
    pants: '#5b6d92', pantsDark: '#4a5a7b', shoe: '#43434c',
    npcShirt: '#7fae9c', npcShirtDark: '#669485', npcApron: '#e9dcc0',
    radish: '#f3f1e4', radishTip: '#e08a9b', carrot: '#e98f3e', carrotDark: '#c9752c',
    berry: '#d95a55', berryLight: '#f08b7f',
    leaf: '#6fa85c', leafLight: '#8cc474', leafDark: '#5b8f4c'
  };

  /* ==================== 通用小工具 ==================== */
  var hasOwn = Object.prototype.hasOwnProperty;
  function has(o, k) { return !!o && hasOwn.call(o, k); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function h2(x, y) {
    var n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function px(g, x, y, w, h, color) {
    if (!(w > 0) || !(h > 0)) { return; }
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }

  /* 椭圆填充：内部带 save/restore，兼容无 ctx.ellipse 的环境 */
  function blob(g, cx, cy, rx, ry, color) {
    if (!(rx > 0) || !(ry > 0)) { return; }
    g.save();
    g.beginPath();
    if (g.ellipse) {
      g.ellipse(cx, cy, rx, ry, 0, 0, PI2);
    } else {
      g.translate(cx, cy);
      g.scale(rx, ry);
      if (typeof g.arc === 'function') { g.arc(0, 0, 1, 0, PI2); }
    }
    g.fillStyle = color;
    g.fill();
    g.restore();
  }

  function ellipsePath(g, cx, cy, rx, ry) {
    g.beginPath();
    if (g.ellipse) { g.ellipse(cx, cy, rx, ry, 0, 0, PI2); return; }
    var steps = 28;
    for (var i = 0; i <= steps; i++) {
      var a = (i / steps) * PI2;
      var x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      if (i === 0) { g.moveTo(x, y); } else { g.lineTo(x, y); }
    }
    g.closePath();
  }

  function roundRectPath(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  function setDash(g, arr) { if (typeof g.setLineDash === 'function') { try { g.setLineDash(arr || []); } catch (e) {} } }

  function textWidth(g, text, size) {
    var w = 0;
    if (g && typeof g.measureText === 'function') {
      try {
        var m = g.measureText(text);
        if (m && typeof m.width === 'number' && isFinite(m.width)) { w = m.width; }
      } catch (e) { w = 0; }
    }
    if (!w) { w = String(text).length * (size || 11); }
    return w;
  }

  var FONT_LABEL = '600 12px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  var FONT_PILL = '600 11px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  var FONT_TINY = '600 10px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

  /* ==================== 画布/精灵缓存 ==================== */
  function makeCanvas(w, h) {
    if (root.document && typeof root.document.createElement === 'function') {
      var c = root.document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    return null;
  }
  function ctx2d(cv) {
    if (!cv || typeof cv.getContext !== 'function') { return null; }
    var g = null;
    try { g = cv.getContext('2d'); } catch (e) { g = null; }
    if (g) { try { g.imageSmoothingEnabled = false; } catch (e) {} }
    return g;
  }

  var baseCache = { game: null, key: '', canvas: null };

  /* ==================== 地形读取（只读核心 API，带契约默认布局） ==================== */
  function tileIndexOf(x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) { return -1; }
    return y * COLS + x;
  }

  /* 契约布局（core 未提供 tileAt 时使用；与 expansion/production 契约一致） */
  function layoutTile(x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) { return 'outside'; }
    if (x >= HOUSE_BOX.x0 && x <= HOUSE_BOX.x1 && y >= HOUSE_BOX.y0 && y <= HOUSE_BOX.y1) { return 'building'; }
    if (x >= SHOP_BOX.x0 && x <= SHOP_BOX.x1 && y >= SHOP_BOX.y0 && y <= SHOP_BOX.y1) { return 'building'; }
    /* 牧场建筑 x0..2 y4..7 不可走；入口 (2,8) 由下方道路连通 */
    if (x >= RANCH_BOX.x0 && x <= RANCH_BOX.x1 && y >= RANCH_BOX.y0 && y <= RANCH_BOX.y1) { return 'building'; }
    /* 河道 x40..41 y10..28，y20 为桥 */
    if (x >= RIVER.x0 && x <= RIVER.x1 && y >= RIVER.y0 && y <= RIVER.y1) {
      return y === RIVER.bridgeY ? 'path' : 'water';
    }
    var dx = (x + 0.5 - POND.cx) / POND.rx, dy = (y + 0.5 - POND.cy) / POND.ry;
    if (dx * dx + dy * dy <= 1) { return 'water'; }
    /* 道路：y8 x2..40，x18 y8..28，x28 y8..28 */
    if (y === 8 && x >= 2 && x <= 40) { return 'path'; }
    if ((x === 18 || x === 28) && y >= 8 && y <= 28) { return 'path'; }
    return 'grass';
  }

  /* 地貌：优先 core.biomeAt，其次契约矩形，最后按 tile 兜底 */
  function biomeOf(game, grid, x, y) {
    if (game && typeof game.biomeAt === 'function') {
      try {
        var b = game.biomeAt(x, y);
        if (typeof b === 'string' && b) { return b; }
      } catch (e) {}
    }
    var t = tileOf(grid, x, y);
    if (t === 'water' && x >= RIVER.x0) { return 'river'; }
    if (x >= BIOMES.riverbank.x0 && x <= BIOMES.riverbank.x1 && y >= BIOMES.riverbank.y0 && y <= BIOMES.riverbank.y1) { return 'riverbank'; }
    if (x >= BIOMES.woodland.x0 && x <= BIOMES.woodland.x1 && y >= BIOMES.woodland.y0 && y <= BIOMES.woodland.y1) { return 'woodland'; }
    if (x >= BIOMES.highland.x0 && x <= BIOMES.highland.x1 && y >= BIOMES.highland.y0 && y <= BIOMES.highland.y1) { return 'highland'; }
    if (x >= BIOMES.meadow.x0 && x <= BIOMES.meadow.x1 && y >= BIOMES.meadow.y0 && y <= BIOMES.meadow.y1) { return 'meadow'; }
    if (y <= 9) { return 'village'; }
    return 'farmland';
  }

  var terrainMemo = typeof WeakMap === 'function' ? new WeakMap() : null;

  function terrainGrid(game) {
    if (terrainMemo && game && typeof game === 'object') {
      var memo = terrainMemo.get(game);
      if (memo) { return memo; }
    }
    var grid = new Array(COLS * ROWS);
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var t = null;
        if (game && typeof game.tileAt === 'function') {
          try { t = game.tileAt(x, y); } catch (e) { t = null; }
        }
        if (typeof t !== 'string' || !t) { t = layoutTile(x, y); }
        grid[y * COLS + x] = t;
      }
    }
    if (terrainMemo && game && typeof game === 'object') { terrainMemo.set(game, grid); }
    return grid;
  }

  function tileOf(grid, x, y) {
    var i = tileIndexOf(x, y);
    return i < 0 ? 'outside' : grid[i];
  }

  function isFarmTile(game, x, y) {
    if (game && typeof game.isFarmTile === 'function') {
      try {
        var r = game.isFarmTile(x, y);
        if (typeof r === 'boolean') { return r; }
      } catch (e) {}
    }
    for (var i = 0; i < FARMS.length; i++) {
      var f = FARMS[i];
      if (x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1) { return true; }
    }
    return false;
  }

  /* 离目标格最近的田（用于边界提示） */
  function nearestFarm(x, y) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < FARMS.length; i++) {
      var f = FARMS[i];
      var dx = x < f.x0 ? f.x0 - x : (x > f.x1 ? x - f.x1 : 0);
      var dy = y < f.y0 ? f.y0 - y : (y > f.y1 ? y - f.y1 : 0);
      var d = dx + dy;
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  /* 目标格属于哪块田（用于边界提示），不在田地返回 null */
  function farmOf(x, y) {
    for (var i = 0; i < FARMS.length; i++) {
      var f = FARMS[i];
      if (x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1) { return f; }
    }
    return null;
  }

  function plotAt(st, x, y) {
    var plots = st && st.plots;
    if (!plots) { return null; }
    return has(plots, x + ',' + y) ? plots[x + ',' + y] : null;
  }

  function parsePlotKey(k) {
    var parts = String(k).split(',');
    var x = parseInt(parts[0], 10), y = parseInt(parts[1], 10);
    if (!isFinite(x) || !isFinite(y)) { return null; }
    return { x: x, y: y };
  }

  /* ==================== 场景/作物/任务常量（优先读 FarmCore） ==================== */
  function locations() {
    var core = root.FarmCore;
    var src = (core && core.LOCATIONS) || {};
    var out = {};
    /* 旧 9 个地点 + 2.3 新增 牧场/加工坊/帮手驿站 */
    var tables = [LOC_FALLBACK, LOC_FALLBACK_EXTRA];
    for (var ti = 0; ti < tables.length; ti++) {
      var tbl = tables[ti];
      for (var k in tbl) {
        if (!has(tbl, k)) { continue; }
        var f = tbl[k], s = src[k] || {};
        out[k] = { x: num(s.x, f.x), y: num(s.y, f.y), name: String(s.name || f.name) };
      }
    }
    return out;
  }

  /* 可交互村民：npc/miller/ranger/miner/florist（只读 core，回退契约） */
  var NPC_KEYS = ['npc', 'miller', 'ranger', 'miner', 'florist'];
  function npcList() {
    var core = root.FarmCore;
    var src = (core && core.NPCS) || {};
    var locs = locations();
    var out = [];
    for (var i = 0; i < NPC_KEYS.length; i++) {
      var id = NPC_KEYS[i];
      var loc = locs[id];
      if (!loc) { continue; }
      var meta = src[id] || {};
      var style = has(NPC_STYLE_FALLBACK, id) ? NPC_STYLE_FALLBACK[id] : NPC_STYLE_FALLBACK.npc;
      out.push({
        id: id,
        name: String(meta.name || loc.name || ''),
        role: String(meta.role || style.role || '村民'),
        color: String(meta.color || ''),
        x: loc.x, y: loc.y,
        style: style
      });
    }
    return out;
  }

  /* 某位 NPC 是否有"可领取"的委托：优先 questStatus()，回退统计比对 */
  function npcHasReadyQuest(game, st, npcId) {
    var quests = (root.FarmCore && root.FarmCore.QUESTS) || [];
    var claimed = Array.isArray(st && st.claimed) ? st.claimed : [];
    var hasStatus = game && typeof game.questStatus === 'function';
    for (var i = 0; i < quests.length; i++) {
      var q = quests[i];
      if (!q) { continue; }
      var owner = String(q.npc || 'npc');
      if (owner !== npcId) { continue; }
      if (q.id && claimed.indexOf(q.id) !== -1) { continue; }
      if (hasStatus) {
        var s = null;
        try { s = game.questStatus(q.id); } catch (e) { s = null; }
        if (s && typeof s === 'object') {
          if (s.claimed) { continue; }
          if (s.locked) { continue; }
          if (s.ready) { return true; }
          continue;
        }
      }
      /* 回退：只看老式统计任务 */
      var stat = q.stat;
      if (!stat) { continue; }
      var stats = (st && st.stats) || {};
      var have = stat === 'day' ? num(st && st.day, 1) : num(stats[stat], 0);
      if (have >= num(q.target, 1)) { return true; }
    }
    return false;
  }

  function cropDef(id) {
    var core = root.FarmCore;
    var a = (core && core.CROPS && core.CROPS[id]) || null;
    var b = CROP_FALLBACK[id] || CROP_FALLBACK.radish;
    return { name: String((a && a.name) || b.name), days: Math.max(1, Math.round(num(a && a.days, b.days))) };
  }
  function cropName(id) { return cropDef(id).name; }
  function cropDays(id) { return cropDef(id).days; }

  function isMature(crop) {
    if (!crop) { return false; }
    if (typeof crop.ready === 'boolean') { return crop.ready; }
    if (typeof crop.mature === 'boolean') { return crop.mature; }
    var days = cropDays(crop.id);
    if (typeof crop.stage === 'number') { return crop.stage >= 3; }
    return num(crop.age, 0) >= days;
  }

  function isRain(st) {
    var w = st && st.weather;
    if (typeof w === 'string') { return /雨|rain|storm|thunder/i.test(w); }
    if (w && typeof w === 'object') { return !!w.rain; }
    return false;
  }

  function stateOf(game) {
    if (!game) { return {}; }
    if (game.state && typeof game.state === 'object') { return game.state; }
    return {};
  }

  /* ==================== 障碍物（树/石） ==================== */
  /* 旧区布景（保留核心 24 个的观感）+ 扩区/外缘可清理资源 */
  var FALLBACK_OBSTACLES = [
    ['tree', 2, 4], ['tree', 2, 6], ['tree', 9, 4], ['tree', 12, 4], ['tree', 16, 4],
    ['tree', 18, 5], ['tree', 28, 6], ['tree', 2, 13], ['tree', 3, 16], ['tree', 28, 11],
    ['tree', 9, 20], ['tree', 12, 20], ['tree', 22, 20], ['tree', 27, 2], ['tree', 1, 18],
    ['rock', 2, 16], ['rock', 26, 20], ['rock', 7, 21], ['rock', 15, 21], ['rock', 29, 14],
    ['rock', 13, 21], ['rock', 1, 9],
    /* 扩建区（x>=30 或 y>=22），避开道路/田地/地点/池塘 */
    ['tree', 31, 2], ['tree', 34, 3], ['tree', 38, 2], ['tree', 41, 4], ['tree', 40, 12],
    ['tree', 41, 16], ['tree', 32, 20], ['tree', 37, 22], ['tree', 41, 24], ['tree', 33, 27],
    ['tree', 39, 28], ['tree', 22, 28], ['tree', 25, 29], ['tree', 8, 28], ['tree', 13, 29],
    ['tree', 2, 24], ['tree', 4, 27], ['tree', 29, 29],
    ['rock', 30, 3], ['rock', 36, 2], ['rock', 40, 8],
    ['rock', 41, 20], ['rock', 35, 28], ['rock', 30, 26], ['rock', 24, 25], ['rock', 26, 24],
    ['rock', 11, 26], ['rock', 6, 26], ['rock', 1, 22], ['rock', 21, 29]
  ];
  var obsMemo = typeof WeakMap === 'function' ? new WeakMap() : null;

  function obstaclesOf(game) {
    var st = stateOf(game);
    var cleared = Array.isArray(st.cleared) ? st.cleared : [];
    var key = '';
    for (var ci = 0; ci < cleared.length; ci++) {
      var cc = cleared[ci];
      key += (typeof cc === 'string' ? cc : (cc && cc.x != null ? (cc.x + ',' + cc.y) : '')) + '|';
    }
    if (obsMemo && game && typeof game === 'object') {
      var memo = obsMemo.get(game);
      if (memo && memo.key === key) { return memo.items; }
    }

    var items = [];
    var seen = {};
    function push(type, x, y) {
      if (typeof type !== 'string') { return; }
      var tt = type.toLowerCase();
      if (tt !== 'tree' && tt !== 'rock') { return; }
      x = Math.round(num(x, NaN)); y = Math.round(num(y, NaN));
      if (!isFinite(x) || !isFinite(y)) { return; }
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) { return; }
      var kk = x + ',' + y;
      if (seen[kk]) { return; }
      seen[kk] = 1;
      items.push({ type: tt, x: x, y: y });
    }

    var fromCore = false;
    if (game && Array.isArray(game.obstacles)) {
      fromCore = true;
      for (var oi = 0; oi < game.obstacles.length; oi++) {
        var o = game.obstacles[oi];
        if (!o) { continue; }
        push(o.type, num(o.x, NaN), num(o.y, NaN));
      }
    }
    if (!fromCore && game && typeof game.obstacleAt === 'function') {
      fromCore = true;
      for (var yy = 0; yy < ROWS; yy++) {
        for (var xx = 0; xx < COLS; xx++) {
          var ob = null;
          try { ob = game.obstacleAt(xx, yy); } catch (e) { ob = null; }
          if (ob) { push(ob.type, num(ob.x, xx), num(ob.y, yy)); }
        }
      }
    }
    if (!fromCore) {
      for (var fi = 0; fi < FALLBACK_OBSTACLES.length; fi++) {
        push(FALLBACK_OBSTACLES[fi][0], FALLBACK_OBSTACLES[fi][1], FALLBACK_OBSTACLES[fi][2]);
      }
    }

    if (cleared.length) {
      var dead = {};
      for (var di = 0; di < cleared.length; di++) {
        var dc = cleared[di];
        dead[typeof dc === 'string' ? dc : (dc && dc.x != null ? (dc.x + ',' + dc.y) : '')] = 1;
      }
      var kept = [];
      for (var ki = 0; ki < items.length; ki++) {
        if (!dead[items[ki].x + ',' + items[ki].y]) { kept.push(items[ki]); }
      }
      items = kept;
    }

    if (obsMemo && game && typeof game === 'object') { obsMemo.set(game, { key: key, items: items }); }
    return items;
  }

  /* ==================== 地面绘制 ==================== */
  function paintGrass(g, tx, ty, x, y) {
    var v = Math.floor(h2(tx, ty) * C.grass.length);
    if (v >= C.grass.length) { v = C.grass.length - 1; }
    px(g, x, y, TILE, TILE, C.grass[v]);
    /* 柔和色斑（小面积、低对比，避免像污渍） */
    var p = h2(tx + 31, ty + 17);
    if (p > 0.55) {
      blob(g, x + 13 + p * 6, y + 16 + p * 4, 5, 3, C.grassPatch);
      if (p > 0.82) { blob(g, x + 7, y + 8, 3, 2, C.grassLight); }
    }
    /* 草叶 */
    for (var i = 0; i < 3; i++) {
      var ax = x + 3 + Math.floor(h2(tx * 3 + i, ty * 5 + i) * 26);
      var ay = y + 4 + Math.floor(h2(tx * 7 + i, ty * 11 + i) * 24);
      px(g, ax, ay, 2, 3, C.grassTuft);
      px(g, ax + 2, ay + 2, 2, 2, C.grassLight);
      px(g, ax + 1, ay + 3, 2, 2, C.grassShade);
    }
    /* 小花 */
    var f = h2(tx * 13 + 5, ty * 7 + 9);
    if (f > 0.9) {
      var fx = x + 9 + Math.floor(h2(tx + 2, ty + 3) * 14);
      var fy = y + 9 + Math.floor(h2(tx + 5, ty + 1) * 14);
      px(g, fx, fy + 2, 1, 3, C.grassShade);
      var col = f > 0.965 ? C.flower[2] : (f > 0.93 ? C.flower[1] : C.flower[0]);
      px(g, fx - 1, fy, 3, 2, col);
      px(g, fx, fy + 1, 2, 2, col);
      px(g, fx, fy, 1, 1, '#fffdf2');
    }
  }

  function paintPath(g, tx, ty, x, y, grid) {
    var v = Math.floor(h2(tx + 3, ty + 9) * C.path.length);
    px(g, x, y, TILE, TILE, C.path[v >= C.path.length ? 0 : v]);
    /* 2x2 石板 */
    for (var sy = 0; sy < 2; sy++) {
      for (var sx = 0; sx < 2; sx++) {
        var ox = x + sx * 16 + 1 + (h2(tx + sx, ty + sy) > 0.5 ? 1 : 0);
        var oy = y + sy * 16 + 1;
        px(g, ox - 1, oy + 1, 15, 12, C.pathJoint);
        px(g, ox, oy, 13, 11, C.pathStone);
        px(g, ox, oy, 13, 2, C.pathTop);
        px(g, ox, oy + 10, 13, 1, C.pathBottom);
        if (h2(tx * 2 + sx, ty * 3 + sy) > 0.45) { px(g, ox + 2, oy + 4, 2, 2, C.pathBottom); }
        if (h2(tx * 5 + sx, ty + sy) > 0.7) { px(g, ox + 8, oy + 7, 2, 1, C.pathTop); }
      }
    }
    /* 与草地交界处的压边，制造轻微高度差 */
    if (tileOf(grid, tx, ty - 1) !== 'path') { px(g, x, y, TILE, 2, C.pathTop); }
    if (tileOf(grid, tx, ty + 1) !== 'path') { px(g, x, y + TILE - 2, TILE, 2, C.pathJoint); }
    if (tileOf(grid, tx - 1, ty) !== 'path') { px(g, x, y, 2, TILE, 'rgba(178,160,120,0.55)'); }
    if (tileOf(grid, tx + 1, ty) !== 'path') { px(g, x + TILE - 2, y, 2, TILE, 'rgba(178,160,120,0.45)'); }
  }

  /* 池塘：把水格并集作为路径，整块上色，避免逐格色块与方角 */
  function pondPath(g, grid) {
    g.beginPath();
    for (var ty = 0; ty < ROWS; ty++) {
      for (var tx = 0; tx < COLS; tx++) {
        if (tileOf(grid, tx, ty) === 'water') { g.rect(tx * TILE, ty * TILE, TILE, TILE); }
      }
    }
  }

  function paintPond(g, grid) {
    var minX = COLS, minY = ROWS, maxX = -1, maxY = -1;
    for (var ty = 0; ty < ROWS; ty++) {
      for (var tx = 0; tx < COLS; tx++) {
        if (tileOf(grid, tx, ty) !== 'water') { continue; }
        if (tx < minX) { minX = tx; }
        if (tx > maxX) { maxX = tx; }
        if (ty < minY) { minY = ty; }
        if (ty > maxY) { maxY = ty; }
      }
    }
    if (maxX < 0) { return; }
    var bx = minX * TILE, by = minY * TILE;
    var bw = (maxX - minX + 1) * TILE, bh = (maxY - minY + 1) * TILE;
    var cx = 25 * TILE + 16, cy = 16 * TILE + 16;

    g.save();
    pondPath(g, grid);
    g.clip();
    /* 浅滩 -> 中层 -> 深水 */
    px(g, bx, by, bw, bh, C.waterLight);
    blob(g, cx, cy, 3.05 * TILE, 3.0 * TILE, C.waterMid);
    blob(g, cx, cy, 2.05 * TILE, 1.95 * TILE, C.waterDeep);
    blob(g, cx - 0.4 * TILE, cy - 0.45 * TILE, 1.25 * TILE, 1.05 * TILE, 'rgba(62,128,163,0.55)');
    blob(g, cx + 0.9 * TILE, cy + 0.5 * TILE, 0.9 * TILE, 0.7 * TILE, 'rgba(90,168,196,0.35)');
    /* 静态波光 */
    for (var i = 0; i < 26; i++) {
      var sx = bx + h2(i * 7 + 1, i * 3 + 5) * bw;
      var sy = by + h2(i * 11 + 3, i * 5 + 9) * bh;
      px(g, sx, sy, 4 + Math.floor(h2(i, i + 2) * 5), 1, 'rgba(226,247,252,0.22)');
    }
    /* 岸线内侧浅水高光 */
    for (var wy = 0; wy < ROWS; wy++) {
      for (var wx = 0; wx < COLS; wx++) {
        if (tileOf(grid, wx, wy) !== 'water') { continue; }
        var x = wx * TILE, y = wy * TILE;
        if (tileOf(grid, wx, wy - 1) !== 'water') { px(g, x, y, TILE, 3, 'rgba(214,240,246,0.35)'); }
        if (tileOf(grid, wx - 1, wy) !== 'water') { px(g, x, y, 3, TILE, 'rgba(214,240,246,0.26)'); }
        if (tileOf(grid, wx + 1, wy) !== 'water') { px(g, x + TILE - 2, y, 2, TILE, 'rgba(58,120,150,0.22)'); }
        if (tileOf(grid, wx, wy + 1) !== 'water') { px(g, x, y + TILE - 2, TILE, 2, 'rgba(58,120,150,0.26)'); }
      }
    }
    g.restore();
  }

  function paintOutside(g, tx, ty, x, y) {
    px(g, x, y, TILE, TILE, '#5d7b51');
    px(g, x, y, TILE, 2, '#6d8c5e');
    for (var i = 0; i < 4; i++) {
      var ax = x + 3 + Math.floor(h2(tx * 7 + i, ty * 3 + i) * 26);
      var ay = y + 5 + Math.floor(h2(tx * 11 + i, ty * 5 + i) * 22);
      px(g, ax, ay, 2, 2, h2(tx + i, ty + i) > 0.5 ? '#6f8f5f' : '#527049');
    }
  }

  function paintSoil(g, st, tx, ty, x, y, plot) {
    var wet = !!(plot && plot.watered);
    px(g, x, y, TILE, TILE, wet ? C.soilWet : C.soil);
    var v = h2(tx + 7, ty + 3);
    if (v > 0.5) { blob(g, x + 10 + v * 10, y + 13 + v * 7, 6, 4, wet ? C.soilWetDark : C.soilDark); }
    /* 垄沟 */
    for (var i = 0; i < 4; i++) {
      var fy = y + 5 + i * 8;
      px(g, x + 2, fy, TILE - 4, 2, wet ? C.soilWetDark : C.furrow);
      px(g, x + 2, fy + 2, TILE - 4, 1, wet ? C.soilWetLight : C.soilLight);
    }
    /* 湿土反光 */
    if (wet) {
      px(g, x + 5, y + 8, 7, 1, 'rgba(150,200,220,0.35)');
      px(g, x + 19, y + 21, 6, 1, 'rgba(150,200,220,0.28)');
      px(g, x + 12, y + 16, 2, 1, 'rgba(190,225,240,0.30)');
    }
    /* 与外沿交界的暗边 */
    if (!plotAt(st, tx, ty - 1)) { px(g, x, y, TILE, 3, C.soilDark); }
    if (!plotAt(st, tx, ty + 1)) { px(g, x, y + TILE - 3, TILE, 3, 'rgba(58,42,27,0.30)'); }
    if (!plotAt(st, tx - 1, ty)) { px(g, x, y, 3, TILE, C.soilDark); }
    if (!plotAt(st, tx + 1, ty)) { px(g, x + TILE - 3, y, 3, TILE, 'rgba(58,42,27,0.24)'); }
  }

  /* 池塘岸线：草与水的过渡、石头、芦苇 */
  /* biome 色层：林地更深、高地偏冷带岩纹、草甸偏黄、河岸带湿沙 */
  function paintBiomeTint(g, game, grid, tx, ty, x, y) {
    var b = biomeOf(game, grid, tx, ty);
    if (b === 'woodland') {
      px(g, x, y, TILE, TILE, 'rgba(58,92,50,0.16)');
      for (var i = 0; i < 3; i++) {
        var lx = x + 3 + Math.floor(h2(tx * 3 + i, ty * 7 + i) * 24);
        var ly = y + 4 + Math.floor(h2(tx * 5 + i, ty * 3 + i) * 22);
        px(g, lx, ly, 2, 4, 'rgba(64,96,54,0.30)');
      }
    } else if (b === 'highland') {
      px(g, x, y, TILE, TILE, 'rgba(120,128,116,0.14)');
      if (h2(tx + 3, ty + 9) > 0.45) {
        px(g, x + 6 + Math.floor(h2(tx, ty + 2) * 14), y + 8 + Math.floor(h2(tx + 7, ty) * 14), 7, 3, 'rgba(150,158,150,0.30)');
        px(g, x + 6 + Math.floor(h2(tx, ty + 2) * 14), y + 8 + Math.floor(h2(tx + 7, ty) * 14), 7, 1, 'rgba(176,184,174,0.30)');
      }
    } else if (b === 'meadow') {
      px(g, x, y, TILE, TILE, 'rgba(214,204,120,0.10)');
      if (h2(tx * 11 + 2, ty * 5 + 6) > 0.72) {
        var fx = x + 8 + Math.floor(h2(tx + 1, ty + 4) * 16);
        var fy = y + 8 + Math.floor(h2(tx + 6, ty + 3) * 16);
        px(g, fx, fy + 1, 1, 3, 'rgba(120,150,90,0.55)');
        px(g, fx - 1, fy, 3, 2, h2(tx, ty) > 0.5 ? '#f4e6a8' : '#f2cfd4');
      }
    } else if (b === 'riverbank') {
      px(g, x, y, TILE, TILE, 'rgba(200,186,140,0.16)');
    }
  }

  /* 河道：整块水体 + 桥面（y20 为 path） */
  function paintRiver(g, grid) {
    var minX = COLS, minY = ROWS, maxX = -1, maxY = -1, any = false;
    for (var ty = 0; ty < ROWS; ty++) {
      for (var tx = 0; tx < COLS; tx++) {
        if (tileOf(grid, tx, ty) !== 'water') { continue; }
        /* 只处理东侧河道（池塘走 paintPond） */
        var pondDx = (tx + 0.5 - POND.cx) / POND.rx, pondDy = (ty + 0.5 - POND.cy) / POND.ry;
        if (pondDx * pondDx + pondDy * pondDy <= 1) { continue; }
        any = true;
        if (tx < minX) { minX = tx; }
        if (tx > maxX) { maxX = tx; }
        if (ty < minY) { minY = ty; }
        if (ty > maxY) { maxY = ty; }
      }
    }
    if (!any) { return; }
    var bx = minX * TILE, by = minY * TILE;
    var bw = (maxX - minX + 1) * TILE, bh = (maxY - minY + 1) * TILE;

    g.save();
    g.beginPath();
    for (var wy = minY; wy <= maxY; wy++) {
      for (var wx = minX; wx <= maxX; wx++) {
        if (tileOf(grid, wx, wy) !== 'water') { continue; }
        var pdx = (wx + 0.5 - POND.cx) / POND.rx, pdy = (wy + 0.5 - POND.cy) / POND.ry;
        if (pdx * pdx + pdy * pdy <= 1) { continue; }
        g.rect(wx * TILE, wy * TILE, TILE, TILE);
      }
    }
    g.clip();
    px(g, bx, by, bw, bh, C.waterMid);
    /* 顺流的浅色带与深色带 */
    for (var i = 0; i < 40; i++) {
      var lx = bx + h2(i * 5 + 1, i * 3 + 7) * bw;
      var ly = by + h2(i * 9 + 2, i * 7 + 5) * bh;
      px(g, lx, ly, 6 + Math.floor(h2(i, i + 3) * 8), 1, 'rgba(214,240,246,0.22)');
    }
    px(g, bx, by, bw, bh * 0.18, 'rgba(70,140,178,0.20)');
    px(g, bx + bw * 0.62, by, bw * 0.38, bh, 'rgba(58,128,166,0.18)');
    g.restore();

    /* 两岸：石与芦苇已被 paintPondRim 处理同款，这里补浅滩线 */
    for (var ry = minY; ry <= maxY; ry++) {
      for (var rx = minX; rx <= maxX; rx++) {
        if (tileOf(grid, rx, ry) !== 'water') { continue; }
        var pdx2 = (rx + 0.5 - POND.cx) / POND.rx, pdy2 = (ry + 0.5 - POND.cy) / POND.ry;
        if (pdx2 * pdx2 + pdy2 * pdy2 <= 1) { continue; }
        var px0 = rx * TILE, py0 = ry * TILE;
        if (tileOf(grid, rx - 1, ry) !== 'water') { px(g, px0, py0, 2, TILE, 'rgba(226,244,248,0.40)'); }
        if (tileOf(grid, rx + 1, ry) !== 'water') { px(g, px0 + TILE - 2, py0, 2, TILE, 'rgba(210,236,244,0.34)'); }
        if (tileOf(grid, rx, ry - 1) !== 'water') { px(g, px0, py0, TILE, 2, 'rgba(226,244,248,0.34)'); }
        if (tileOf(grid, rx, ry + 1) !== 'water') { px(g, px0, py0 + TILE - 2, TILE, 2, 'rgba(210,236,244,0.30)'); }
      }
    }

    /* 桥面（y20 的 path 格）：木板 + 栏杆 */
    var bridgeY = (RIVER.bridgeY) * TILE;
    var bridgeW = (RIVER.x1 - RIVER.x0 + 1) * TILE;
    px(g, RIVER.x0 * TILE - 4, bridgeY + 2, bridgeW + 8, TILE - 4, C.woodDark);
    px(g, RIVER.x0 * TILE - 2, bridgeY + 4, bridgeW + 4, TILE - 8, C.wood);
    for (var bd = 0; bd < 6; bd++) {
      px(g, RIVER.x0 * TILE - 2 + bd * 12, bridgeY + 4, 1, TILE - 8, C.woodLight);
    }
    px(g, RIVER.x0 * TILE - 4, bridgeY, bridgeW + 8, 3, C.woodLight);
    px(g, RIVER.x0 * TILE - 4, bridgeY + TILE - 3, bridgeW + 8, 3, C.woodDark);
  }

  function paintPondRim(g, grid) {
    for (var ty = 0; ty < ROWS; ty++) {
      for (var tx = 0; tx < COLS; tx++) {
        var t = tileOf(grid, tx, ty);
        var x = tx * TILE, y = ty * TILE;
        if (t === 'water') {
          /* 水面内侧浅滩 */
          if (tileOf(grid, tx, ty - 1) !== 'water') { px(g, x + 2, y + 1, TILE - 4, 2, 'rgba(233,249,250,0.45)'); }
          if (tileOf(grid, tx - 1, ty) !== 'water') { px(g, x + 1, y + 2, 2, TILE - 4, 'rgba(233,249,250,0.35)'); }
        } else if (t === 'grass') {
          var nearWater = (tileOf(grid, tx, ty - 1) === 'water') || (tileOf(grid, tx, ty + 1) === 'water') ||
                          (tileOf(grid, tx - 1, ty) === 'water') || (tileOf(grid, tx + 1, ty) === 'water');
          if (nearWater) {
            /* 湿沙岸 */
            if (tileOf(grid, tx, ty - 1) === 'water') { px(g, x, y, TILE, 3, 'rgba(216,199,150,0.55)'); }
            if (tileOf(grid, tx, ty + 1) === 'water') { px(g, x, y + TILE - 3, TILE, 3, 'rgba(216,199,150,0.45)'); }
            if (tileOf(grid, tx - 1, ty) === 'water') { px(g, x, y, 3, TILE, 'rgba(216,199,150,0.45)'); }
            if (tileOf(grid, tx + 1, ty) === 'water') { px(g, x + TILE - 3, y, 3, TILE, 'rgba(216,199,150,0.45)'); }
            /* 岸边石头 */
            if (h2(tx * 9 + 2, ty * 5 + 7) > 0.5) {
              var sx = x + 4 + Math.floor(h2(tx + 1, ty + 4) * 18);
              var sy = y + 4 + Math.floor(h2(tx + 6, ty + 2) * 18);
              px(g, sx, sy, 5, 4, C.stone);
              px(g, sx, sy, 5, 1, C.stoneLight);
              px(g, sx, sy + 3, 5, 1, C.stoneDark);
            }
            /* 芦苇 */
            if (h2(tx * 3 + 5, ty * 7 + 1) > 0.62) {
              var rx = x + 3 + Math.floor(h2(tx + 8, ty + 3) * 20);
              var ry = y + 3 + Math.floor(h2(tx + 4, ty + 9) * 18);
              px(g, rx, ry, 1, 9, '#5f8f4b');
              px(g, rx + 2, ry + 2, 1, 7, '#6d9d56');
              px(g, rx + 4, ry + 1, 1, 8, '#5f8f4b');
              px(g, rx, ry - 1, 2, 2, '#8a6a3c');
            }
          }
        }
      }
    }
  }

  /* 田地装饰：虚线边界、木桩、木牌 */
  function paintFarmDecor(g) {
    for (var fi2 = 0; fi2 < FARMS.length; fi2++) {
      var farm = FARMS[fi2];
      var x0 = farm.x0 * TILE, y0 = farm.y0 * TILE;
      var x1 = (farm.x1 + 1) * TILE, y1 = (farm.y1 + 1) * TILE;
      g.save();
      setDash(g, [7, 6]);
      g.strokeStyle = 'rgba(92,70,44,0.20)';
      g.lineWidth = 1;
      g.strokeRect(x0 + 1.5, y0 + 1.5, (x1 - x0) - 3, (y1 - y0) - 3);
      setDash(g, []);
      g.restore();
      /* 四角木桩 */
      var corners = [[x0 - 3, y0 - 10], [x1 - 3, y0 - 10], [x0 - 3, y1 - 10], [x1 - 3, y1 - 10]];
      for (var i = 0; i < corners.length; i++) {
        var cxp = corners[i][0], cyp = corners[i][1];
        px(g, cxp, cyp, 5, 12, C.woodDark);
        px(g, cxp, cyp, 5, 2, C.woodLight);
        px(g, cxp + 1, cyp + 3, 1, 6, 'rgba(60,40,24,0.35)');
      }
      /* 田地木牌 */
      var sx = x0 + 6, sy = y0 - 20;
      px(g, sx, sy + 12, 3, 10, C.woodDark);
      roundRectPath(g, sx - 4, sy, 42, 16, 3);
      g.fillStyle = 'rgba(250,244,226,0.95)';
      g.fill();
      g.strokeStyle = 'rgba(110,84,52,0.55)';
      g.lineWidth = 1;
      g.stroke();
      g.font = FONT_TINY;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#5c4427';
      g.fillText(farm.name, sx + 17, sy + 9);
    }
  }

  function paintDoormat(g, locs) {
    /* 小屋门口 */
    var hx = locs.home.x * TILE, hy = locs.home.y * TILE;
    roundRectPath(g, hx + 5, hy + 18, 22, 9, 3);
    g.fillStyle = '#d8c39a';
    g.fill();
    g.strokeStyle = 'rgba(120,94,60,0.35)';
    g.lineWidth = 1;
    g.stroke();
    px(g, hx + 8, hy + 20, 16, 1, '#b89a6c');
    px(g, hx + 8, hy + 23, 16, 1, '#b89a6c');
    /* 商店门口（棚布同色条纹地垫） */
    var sx = locs.shop.x * TILE, sy = locs.shop.y * TILE;
    roundRectPath(g, sx + 3, sy + 17, 26, 11, 3);
    g.fillStyle = C.awningB;
    g.fill();
    g.strokeStyle = 'rgba(150,80,66,0.45)';
    g.lineWidth = 1;
    g.stroke();
    px(g, sx + 7, sy + 19, 4, 7, C.awningA);
    px(g, sx + 15, sy + 19, 4, 7, C.awningA);
    px(g, sx + 23, sy + 19, 4, 7, C.awningA);
    /* 出货箱脚下 */
    var bx = locs.bin.x * TILE, by = locs.bin.y * TILE;
    blob(g, bx + 16, by + 25, 12, 4, 'rgba(120,94,62,0.20)');
  }

  /* 地面层缓存键：轻量指纹（耕地数量 + 浇水数 + 作物数 + 首个/末个 key），
     避免每帧字符串化数百个地块造成抖动；变化时会重建。 */
  function plotsKey(st) {
    var plots = (st && st.plots) || {};
    var count = 0, watered = 0, crops = 0, first = '', last = '';
    for (var k in plots) {
      if (!has(plots, k)) { continue; }
      var p = plots[k];
      count++;
      if (p && p.watered) { watered++; }
      if (p && p.crop) { crops++; }
      if (!first) { first = k; }
      last = k;
    }
    return count + ':' + watered + ':' + crops + ':' + first + ':' + last;
  }

  function paintBase(g, game, st) {
    var grid = terrainGrid(game);
    for (var ty = 0; ty < ROWS; ty++) {
      for (var tx = 0; tx < COLS; tx++) {
        var t = grid[ty * COLS + tx];
        var x = tx * TILE, y = ty * TILE;
        if (t === 'water') {
          /* 水体在 paintPond / paintRiver 里整块绘制 */
        } else if (t === 'path') {
          paintPath(g, tx, ty, x, y, grid);
        } else if (t === 'outside') {
          paintOutside(g, tx, ty, x, y);
        } else {
          paintGrass(g, tx, ty, x, y);
          paintBiomeTint(g, game, grid, tx, ty, x, y);
        }
      }
    }
    /* 农田底色：两块田各铺一层极淡暖色，帮助辨认可耕种范围 */
    for (var ft = 0; ft < FARMS.length; ft++) {
      var farmT = FARMS[ft];
      px(g, farmT.x0 * TILE, farmT.y0 * TILE,
         (farmT.x1 - farmT.x0 + 1) * TILE, (farmT.y1 - farmT.y0 + 1) * TILE,
         'rgba(226,214,166,0.10)');
    }
    /* 池塘水体 + 河道 */
    paintPond(g, grid);
    paintRiver(g, grid);
    /* 耕地（覆盖在草地之上） */
    var plots = (st && st.plots) || {};
    for (var key in plots) {
      if (!has(plots, key)) { continue; }
      var pos = parsePlotKey(key);
      if (!pos) { continue; }
      paintSoil(g, st, pos.x, pos.y, pos.x * TILE, pos.y * TILE, plots[key]);
    }
    paintPondRim(g, grid);
    paintFarmDecor(g);
    paintDoormat(g, locations());
  }

  function ensureBase(game, st) {
    var key = plotsKey(st);
    if (baseCache.canvas && baseCache.game === game && baseCache.key === key) { return baseCache.canvas; }
    var cv = makeCanvas(MAP_W, MAP_H);
    if (!cv) { return null; }
    var g2 = ctx2d(cv);
    if (!g2) { return null; }
    try {
      paintBase(g2, game, st);
    } catch (e) {
      return null;
    }
    baseCache = { game: game, key: key, canvas: cv };
    return cv;
  }

  /* ==================== 池塘动态水面 ==================== */
  function drawWaterFX(g, t, rain, grid) {
    var cx = 25 * TILE + 16, cy = 16 * TILE + 16;
    g.save();
    pondPath(g, grid);
    if (typeof g.clip === 'function') { g.clip(); }
    var glow = 0.10 + (rain ? 0.08 : 0) + Math.sin(t * 0.0011) * 0.03;
    blob(g, cx - 16, cy - 18, 62, 46, 'rgba(190,235,245,' + clamp(glow, 0.04, 0.24).toFixed(3) + ')');
    for (var i = 0; i < 3; i++) {
      var ph = ((t * 0.00016) + i / 3) % 1;
      var r = 14 + ph * 88;
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(226,248,252,' + ((1 - ph) * 0.34).toFixed(3) + ')';
      ellipsePath(g, cx + (i - 1) * 16, cy + (i - 1) * 9, r, r * 0.62);
      g.stroke();
    }
    for (var k = 0; k < 7; k++) {
      var a = t * 0.0004 + k * 0.37;
      var hx = cx + Math.cos(a * 1.7 + k) * (26 + k * 7);
      var hy = cy + Math.sin(a * 1.3 + k * 2) * (18 + k * 4);
      px(g, hx, hy, 3, 1, 'rgba(235,252,255,0.35)');
    }
    if (rain) {
      for (var s = 0; s < 8; s++) {
        var sx = cx + (h2(s * 3 + 1, s * 7 + 2) - 0.5) * 160;
        var sy = cy + (h2(s * 5 + 3, s * 11 + 4) - 0.5) * 150;
        var ph2 = (t * 0.0018 + h2(s * 13 + 5, s * 17 + 7)) % 1;
        var rr = 2 + ph2 * 6;
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(224,246,252,' + ((1 - ph2) * 0.45).toFixed(3) + ')';
        ellipsePath(g, sx, sy, rr, rr * 0.5);
        g.stroke();
      }
    }
    g.restore();
  }

  /* ==================== 建筑 ==================== */
  function drawHouse(g, t) {
    var x = 96, y = 96, w = 192, h = 128;
    var cx = x + w / 2;
    var bottom = y + h;
    /* 贴地小投影（不铺满，不遮挡其他内容） */
    blob(g, cx, bottom - 1, w * 0.44, 5, 'rgba(52,46,34,0.13)');
    /* 石基 */
    px(g, x + 2, bottom - 12, w - 4, 12, C.stone);
    px(g, x + 2, bottom - 12, w - 4, 2, C.stoneLight);
    px(g, x + 2, bottom - 3, w - 4, 3, C.stoneDark);
    for (var si = 0; si < 8; si++) { px(g, x + 8 + si * 22, bottom - 10, 2, 7, C.stoneDark); }
    /* 墙体 */
    px(g, x + 4, y + 50, w - 8, h - 58, C.wall);
    px(g, x + 4, y + 50, w - 8, 3, C.wallShade);
    px(g, x + 4, bottom - 16, w - 8, 3, C.wallDark);
    px(g, x + 4, y + 50, 4, h - 58, C.frame);
    px(g, x + w - 8, y + 50, 4, h - 58, C.frame);
    px(g, x + 4, y + 50, w - 8, 4, C.frame);
    /* 门 */
    var dw = 30, dh = 36, dx = cx - dw / 2, dy = bottom - dh - 6;
    px(g, dx - 3, dy - 3, dw + 6, dh + 6, C.frame);
    px(g, dx, dy, dw, dh, '#8b5f3c');
    px(g, dx + 2, dy + 2, dw - 4, dh - 4, '#9c6d47');
    for (var d = 0; d < 3; d++) { px(g, dx + 6 + d * 8, dy + 3, 2, dh - 6, '#845838'); }
    px(g, dx + dw - 8, dy + Math.round(dh * 0.55), 3, 3, '#e3c06a');
    /* 台阶 */
    px(g, dx - 8, bottom - 8, dw + 16, 6, C.stoneLight);
    px(g, dx - 8, bottom - 2, dw + 16, 2, C.stoneDark);
    /* 窗户 + 花箱 */
    var wins = [x + 22, x + w - 62];
    for (var wi = 0; wi < wins.length; wi++) {
      var wx = wins[wi], wy = y + 86;
      px(g, wx - 3, wy - 3, 40, 30, C.frame);
      px(g, wx, wy, 34, 24, C.glass);
      px(g, wx, wy, 34, 2, C.glassLight);
      px(g, wx + 16, wy, 2, 24, C.frame);
      px(g, wx, wy + 11, 34, 2, C.frame);
      px(g, wx + 3, wy + 3, 8, 6, 'rgba(255,255,255,0.5)');
      px(g, wx - 3, wy + 27, 40, 6, C.wood);
      px(g, wx - 3, wy + 27, 40, 2, C.woodLight);
      for (var fi = 0; fi < 5; fi++) { px(g, wx + 1 + fi * 7, wy + 24, 3, 3, fi % 2 ? '#e58f8a' : '#f2d98c'); }
    }
    /* 屋顶（先裁剪再铺瓦片） */
    g.save();
    g.beginPath();
    g.moveTo(x - 8, y + 78);
    g.lineTo(x + 24, y + 6);
    g.lineTo(x + w - 24, y + 6);
    g.lineTo(x + w + 8, y + 78);
    g.closePath();
    g.fillStyle = C.roof;
    g.fill();
    g.clip();
    for (var r = 0; r < 8; r++) {
      var ry = y + 10 + r * 9;
      var tt = (ry - (y + 6)) / 72;
      var lx = x + 24 - 34 * tt;
      var rxp = x + w - 24 + 34 * tt;
      for (var sxp = lx; sxp < rxp; sxp += 9) {
        px(g, sxp, ry, 7, 6, ((r + Math.round(sxp / 9)) % 2) ? C.roof : C.roofDark);
        px(g, sxp, ry, 7, 2, C.roofLight);
      }
    }
    g.restore();
    /* 屋脊与屋檐 */
    px(g, x + 22, y + 4, w - 44, 5, C.roofRidge);
    px(g, x + 22, y + 4, w - 44, 2, '#f0be9c');
    px(g, x - 8, y + 76, w + 16, 4, 'rgba(80,52,36,0.22)');
    /* 烟囱 */
    px(g, x + 142, y + 2, 18, 26, '#b06a52');
    px(g, x + 142, y + 2, 18, 4, '#c78670');
    px(g, x + 146, y - 2, 10, 5, '#8f5340');
    /* 门灯（夜里常亮一点） */
    px(g, cx - 3, dy - 11, 6, 5, '#5f4a33');
    px(g, cx - 2, dy - 10, 4, 3, '#ffe6a6');
    blob(g, cx, dy - 9, 7, 6, 'rgba(255,228,150,0.16)');
  }

  function drawShop(g, t) {
    var x = 640, y = 96, w = 224, h = 128;
    var cx = x + w / 2;
    var bottom = y + h;
    var ay = y + 62;
    blob(g, cx, bottom - 1, w * 0.42, 5, 'rgba(52,46,34,0.12)');
    /* 墙体 */
    px(g, x + 3, ay, w - 6, h - 62, C.shopWall);
    px(g, x + 3, ay, w - 6, 3, '#fbf0e2');
    px(g, x + 3, bottom - 8, w - 6, 8, '#d8c3ab');
    px(g, x + 3, ay, 4, h - 62, C.frame);
    px(g, x + w - 7, ay, 4, h - 62, C.frame);
    /* 屋顶 */
    px(g, x - 6, y + 4, w + 12, 58, C.shopRoof);
    for (var r = 0; r < 6; r++) {
      px(g, x - 6, y + 8 + r * 9, w + 12, 6, r % 2 ? C.shopRoof : C.shopRoofLight);
      for (var sxp = x; sxp < x + w; sxp += 14) { px(g, sxp, y + 8 + r * 9, 2, 6, C.shopRoofDark); }
    }
    px(g, x - 6, y + 4, w + 12, 4, C.shopRoofLight);
    px(g, x - 6, y + 60, w + 12, 4, C.shopRoofDark);
    /* 遮阳棚 */
    for (var s = 0; s < 16; s++) {
      px(g, x - 8 + s * 15, ay, 15, 20, s % 2 ? C.awningB : C.awningA);
    }
    for (var s2 = 0; s2 < 16; s2++) {
      var ax = x - 8 + s2 * 15;
      g.fillStyle = s2 % 2 ? C.awningB : C.awningA;
      g.beginPath();
      g.moveTo(ax, ay + 20);
      g.lineTo(ax + 15, ay + 20);
      g.lineTo(ax + 15, ay + 25);
      g.quadraticCurveTo(ax + 7.5, ay + 31, ax, ay + 25);
      g.closePath();
      g.fill();
    }
    px(g, x - 8, ay + 20, w + 16, 2, 'rgba(90,60,40,0.18)');
    /* 大橱窗 */
    px(g, x + 18, 186, 108, 34, C.frame);
    px(g, x + 22, 189, 100, 28, C.glass);
    px(g, x + 22, 189, 100, 3, C.glassLight);
    /* 窗里货品 */
    px(g, x + 30, 203, 14, 12, '#d9b77e');
    px(g, x + 47, 199, 10, 16, '#b8cfd4');
    px(g, x + 60, 205, 16, 10, '#e0c48c');
    px(g, x + 79, 198, 12, 17, '#c9d9c2');
    px(g, x + 94, 205, 14, 10, '#e8c9a2');
    px(g, x + 22, 189, 100, 3, C.glassLight);
    px(g, x + 26, 193, 10, 7, 'rgba(255,255,255,0.45)');
    /* 门 */
    var dw = 44, dx = x + w - dw - 16, dy = 186;
    px(g, dx - 3, dy - 3, dw + 6, bottom - dy + 1, C.frame);
    px(g, dx, dy, dw, bottom - dy - 2, '#8b5f3c');
    px(g, dx + 2, dy + 2, dw - 4, bottom - dy - 6, '#9c6d47');
    for (var dd = 0; dd < 4; dd++) { px(g, dx + 7 + dd * 9, dy + 4, 2, bottom - dy - 8, '#845838'); }
    px(g, dx + 5, dy + 12, 16, 10, C.glass);
    px(g, dx + 5, dy + 12, 16, 2, C.glassLight);
    /* 门前货箱（贴着建筑下沿，不占道路） */
    px(g, x + 8, 204, 20, 18, C.wood);
    px(g, x + 8, 204, 20, 3, C.woodLight);
    px(g, x + 8, 204, 20, 1, C.woodLight);
    px(g, x + 8, 216, 20, 3, C.woodDark);
    px(g, x + 12, 208, 12, 6, '#d9b77e');
    px(g, x + w - 30, 206, 22, 16, C.woodDark);
    px(g, x + w - 30, 206, 22, 2, C.woodLight);
    px(g, x + w - 26, 210, 14, 3, '#9c7346');
    px(g, x + w - 26, 214, 14, 2, '#9c7346');
  }

  function drawWell(g, t) {
    var cx = 19 * TILE + 16, by = 12 * TILE + 30;
    blob(g, cx, by - 2, 15, 5, 'rgba(52,44,34,0.16)');
    /* 石圈 */
    blob(g, cx, by - 8, 15, 10, C.stone);
    blob(g, cx, by - 10, 12, 8, C.stoneLight);
    blob(g, cx, by - 8, 8, 5.5, C.waterDeep);
    blob(g, cx - 2, by - 9, 4, 2.5, 'rgba(220,245,250,0.55)');
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * PI2;
      px(g, cx + Math.cos(a) * 11 - 2, by - 8 + Math.sin(a) * 7 - 1, 4, 3, C.stoneDark);
    }
    /* 立柱 */
    px(g, cx - 16, by - 32, 4, 24, C.wood);
    px(g, cx + 12, by - 32, 4, 24, C.wood);
    px(g, cx - 16, by - 32, 2, 24, C.woodLight);
    px(g, cx + 12, by - 32, 2, 24, C.woodLight);
    /* 小屋顶 */
    g.beginPath();
    g.moveTo(cx - 21, by - 30);
    g.lineTo(cx, by - 42);
    g.lineTo(cx + 21, by - 30);
    g.closePath();
    g.fillStyle = C.roof;
    g.fill();
    px(g, cx - 21, by - 30, 42, 3, C.roofRidge);
    px(g, cx - 12, by - 36, 24, 2, C.roofLight);
    /* 绳与木桶 */
    px(g, cx, by - 28, 1, 13, '#8b6a44');
    px(g, cx - 5, by - 16, 10, 8, C.wood);
    px(g, cx - 5, by - 16, 10, 2, C.woodLight);
    px(g, cx - 5, by - 10, 10, 2, C.woodDark);
    px(g, cx - 1, by - 19, 2, 3, C.woodDark);
    /* 水面微光 */
    px(g, cx - 5, by - 9, 3, 1, 'rgba(226,248,252,0.5)');
  }

  function drawBin(g, t) {
    var cx = 10 * TILE + 16, by = 7 * TILE + 30;
    blob(g, cx, by - 1, 13, 4, 'rgba(52,44,34,0.15)');
    px(g, cx - 12, by - 18, 24, 18, C.wood);
    px(g, cx - 12, by - 18, 24, 3, C.woodLight);
    px(g, cx - 12, by - 3, 24, 3, C.woodDark);
    for (var i = 0; i < 3; i++) { px(g, cx - 12, by - 14 + i * 5, 24, 1, C.woodDark); }
    px(g, cx - 12, by - 14, 24, 2, '#b9c2c4');
    px(g, cx - 12, by - 6, 24, 2, '#b9c2c4');
    /* 打开的盖子 */
    px(g, cx - 13, by - 23, 26, 5, C.woodLight);
    px(g, cx - 13, by - 23, 26, 2, '#dcb98a');
    px(g, cx - 13, by - 18, 26, 1, C.woodDark);
    /* 箱内与硬币反光 */
    px(g, cx - 9, by - 18, 18, 4, '#6b4f33');
    var glint = 0.5 + 0.5 * Math.sin(t * 0.004);
    px(g, cx - 4, by - 18, 2, 2, 'rgba(255,224,138,' + (0.55 + glint * 0.4).toFixed(2) + ')');
    px(g, cx + 3, by - 17, 2, 2, 'rgba(255,224,138,' + (0.45 + (1 - glint) * 0.4).toFixed(2) + ')');
    px(g, cx - 1, by - 22, 2, 2, C.woodDark);
  }

  /* ==================== 生产设施 / 动物 / 雇工 ==================== */
  function prodState(st) {
    var live = (st && st.livestock) || {};
    var ind = (st && st.industry) || {};
    var help = (st && st.helpers) || {};
    return {
      coop: !!live.coop, barn: !!live.barn,
      chickens: clamp(Math.round(num(live.chickens, 0)), 0, 6),
      cows: clamp(Math.round(num(live.cows, 0)), 0, 3),
      feed: Math.max(0, Math.round(num(live.feed, 0))),
      eggs: Math.max(0, Math.round(num(live.eggsReady, 0))),
      milk: Math.max(0, Math.round(num(live.milkReady, 0))),
      workshop: !!ind.built,
      waterer: !!help.waterer, harvester: !!help.harvester
    };
  }

  /* 牧场：围栏 + 小屋（已建鸡舍/牛棚时显示实体，否则显示地基与标牌） */
  function drawRanch(g, st, t) {
    var x0 = RANCH_BOX.x0 * TILE, y0 = RANCH_BOX.y0 * TILE;
    var x1 = (RANCH_BOX.x1 + 1) * TILE, y1 = (RANCH_BOX.y1 + 1) * TILE;
    var ps = prodState(st);
    /* 草地围场（在牧场建筑下方的空地：x0..2 之外铺一圈栏杆） */
    var fx0 = x0 - 20, fy0 = y0 + 8, fx1 = x1 + 150, fy1 = y1 + 78;
    px(g, fx0, fy0, fx1 - fx0, fy1 - fy0, 'rgba(150,178,110,0.16)');
    g.save();
    g.strokeStyle = 'rgba(140,104,66,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(fx0, fy1); g.lineTo(fx0, fy0); g.lineTo(fx1, fy0);
    g.stroke();
    setDash(g, [5, 5]);
    g.strokeStyle = 'rgba(140,104,66,0.25)';
    g.beginPath();
    g.moveTo(fx0, fy1); g.lineTo(fx1, fy1);
    g.stroke();
    setDash(g, []);
    g.restore();
    /* 栏柱 */
    for (var pxi = fx0; pxi <= fx1; pxi += 22) {
      px(g, pxi, fy0 - 2, 3, 8, C.woodDark);
      px(g, pxi, fy0 - 2, 3, 2, C.woodLight);
    }

    /* 牧场小屋（x0..2,y4..7） */
    var bx = x0 + 4, by = y0 + 4, bw = x1 - x0 - 8, bh = y1 - y0 - 8;
    px(g, bx, by + bh * 0.42, bw, bh * 0.58, ps.coop || ps.barn ? '#e8d3ae' : 'rgba(214,198,166,0.55)');
    px(g, bx, by + bh * 0.42, bw, 3, '#d3b98f');
    /* 屋顶 */
    if (ps.coop || ps.barn) {
      g.beginPath();
      g.moveTo(bx - 5, by + bh * 0.46);
      g.lineTo(bx + bw * 0.18, by);
      g.lineTo(bx + bw * 0.82, by);
      g.lineTo(bx + bw + 5, by + bh * 0.46);
      g.closePath();
      g.fillStyle = '#b98a5c';
      g.fill();
      px(g, bx - 5, by + bh * 0.44, bw + 10, 4, '#9c6f45');
      for (var rr = 0; rr < 3; rr++) {
        px(g, bx + 3, by + 8 + rr * 8, bw - 6, 2, 'rgba(140,100,62,0.35)');
      }
    } else {
      /* 未建：地基 + 木料堆 */
      g.save();
      setDash(g, [6, 4]);
      g.strokeStyle = 'rgba(120,96,64,0.55)';
      g.lineWidth = 2;
      g.strokeRect(bx + 6, by + bh * 0.5, bw - 12, bh * 0.44);
      setDash(g, []);
      g.restore();
      for (var li = 0; li < 4; li++) { px(g, bx + 12 + li * 5, by + bh * 0.62 + li * 2, 22, 3, C.wood); }
    }
    /* 门 */
    px(g, bx + bw * 0.42, by + bh * 0.68, 20, bh * 0.32, ps.coop || ps.barn ? '#7c5233' : 'rgba(124,82,51,0.45)');
    px(g, bx + bw * 0.42, by + bh * 0.68, 20, 2, '#9a6b45');
    /* 屋内灯（已建且已喂） */
    var fed = num(st && st.livestock && st.livestock.fedAtDay, -1) === num(st && st.day, 1);
    if ((ps.coop || ps.barn) && fed) {
      px(g, bx + 10, by + bh * 0.5, 7, 5, '#ffe6a6');
      blob(g, bx + 13, by + bh * 0.52, 9, 7, 'rgba(255,228,150,0.16)');
    }

    /* 圈里的动物：随数量绘制（同一像素尺度） */
    drawAnimals(g, ps, fx0 + 26, fy0 + 30, t);
    /* 待收产物提示 */
    if (ps.eggs > 0) { bucket(g, fx0 + 12, fy1 - 20, '蛋', ps.eggs, '#f2e4bf'); }
    if (ps.milk > 0) { bucket(g, fx0 + 52, fy1 - 20, '奶', ps.milk, '#e8f1f4'); }
  }

  function drawAnimals(g, ps, ox, oy, t) {
    /* 鸡：最多 6，两列小个头 */
    for (var ci = 0; ci < ps.chickens; ci++) {
      var cx = ox + (ci % 3) * 20 + (ci >= 3 ? 6 : 0);
      var cy = oy + Math.floor(ci / 3) * 20;
      var bob = Math.round(Math.sin(t * 0.004 + ci) * 1);
      px(g, cx, cy + bob, 8, 6, '#f4f0e2');
      px(g, cx + 1, cy + 1 + bob, 5, 2, '#fbf8ee');
      px(g, cx + 6, cy - 2 + bob, 4, 4, '#f4f0e2');
      px(g, cx + 8, cy - 1 + bob, 2, 1, '#e0a24a');
      px(g, cx + 9, cy + 1 + bob, 1, 2, '#c9402f');
      px(g, cx + 6, cy - 2 + bob, 1, 1, '#4a3a2c');
      px(g, cx + 1, cy + 5 + bob, 1, 2, '#d8a34e');
      px(g, cx + 5, cy + 5 + bob, 1, 2, '#d8a34e');
    }
    /* 牛：最多 3，个头更大 */
    for (var bi = 0; bi < ps.cows; bi++) {
      var bx = ox + bi * 34 + 8;
      var byy = oy + 40 + Math.round(Math.sin(t * 0.0028 + bi * 1.7) * 1);
      px(g, bx, byy, 18, 10, '#f2ece0');
      px(g, bx, byy, 18, 3, '#fbf7ee');
      px(g, bx - 6, byy + 1, 7, 6, '#f2ece0');
      px(g, bx - 8, byy + 2, 3, 2, '#e0d3c2');
      px(g, bx + 2, byy + 3, 5, 4, '#5b4636');
      px(g, bx + 11, byy + 4, 4, 3, '#5b4636');
      px(g, bx + 3, byy + 9, 2, 4, '#8a7358');
      px(g, bx + 13, byy + 9, 2, 4, '#8a7358');
      px(g, bx + 16, byy + 2, 2, 2, '#4a3a2c');
    }
  }

  /* 小木桶标记待收数量 */
  function bucket(g, x, y, label, count, tone) {
    px(g, x, y, 12, 10, C.wood);
    px(g, x, y, 12, 2, C.woodLight);
    px(g, x, y + 8, 12, 2, C.woodDark);
    px(g, x + 4, y - 4, 3, 5, tone);
    g.font = FONT_TINY;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#3f3222';
    g.fillText(String(count), x + 6, y + 5);
  }

  /* 加工坊：已建为石木工坊，未建为标牌与材料堆 */
  function drawWorkshop(g, st, t) {
    var loc = locations().workshop;
    var cx = loc.x * TILE + 16, by = loc.y * TILE + 30;
    var built = prodState(st).workshop;
    blob(g, cx, by - 2, 26, 5, 'rgba(52,46,34,0.16)');
    if (built) {
      px(g, cx - 24, by - 30, 48, 30, '#d9cbb2');
      px(g, cx - 24, by - 30, 48, 3, '#eadfc8');
      px(g, cx - 24, by - 6, 48, 6, '#b8a688');
      g.beginPath();
      g.moveTo(cx - 28, by - 26);
      g.lineTo(cx - 12, by - 42);
      g.lineTo(cx + 12, by - 42);
      g.lineTo(cx + 28, by - 26);
      g.closePath();
      g.fillStyle = '#8a6a52';
      g.fill();
      px(g, cx - 28, by - 27, 56, 3, '#a07c5e');
      /* 烟囱与蒸汽 */
      px(g, cx + 10, by - 50, 8, 12, '#9a8570');
      px(g, cx + 10, by - 50, 8, 3, '#b09a84');
      for (var s = 0; s < 3; s++) {
        var ph = ((t * 0.00035) + s / 3) % 1;
        blob(g, cx + 14 + Math.sin(ph * 6 + s) * 4, by - 52 - ph * 20, 3 + ph * 3, 2 + ph * 2,
          'rgba(236,240,238,' + (0.35 * (1 - ph)).toFixed(3) + ')');
      }
      /* 门与窗 */
      px(g, cx - 8, by - 22, 16, 22, '#7c5233');
      px(g, cx - 8, by - 22, 16, 2, '#9a6b45');
      px(g, cx - 20, by - 22, 9, 8, C.glass);
      px(g, cx - 20, by - 22, 9, 2, C.glassLight);
      px(g, cx + 12, by - 22, 9, 8, C.glass);
      px(g, cx + 12, by - 22, 9, 2, C.glassLight);
      /* 门口木桶（蛋黄酱/奶酪意象） */
      px(g, cx - 26, by - 12, 8, 12, C.wood);
      px(g, cx - 26, by - 12, 8, 2, C.woodLight);
      px(g, cx + 18, by - 10, 9, 10, '#c9b48c');
      px(g, cx + 18, by - 10, 9, 2, '#ddcaa4');
    } else {
      /* 未建：木牌 + 材料 */
      px(g, cx - 16, by - 16, 3, 16, C.woodDark);
      roundRectPath(g, cx - 22, by - 32, 44, 16, 3);
      g.fillStyle = 'rgba(250,244,226,0.95)';
      g.fill();
      g.strokeStyle = 'rgba(110,84,52,0.55)';
      g.lineWidth = 1;
      g.stroke();
      g.font = FONT_TINY;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#5c4427';
      g.fillText('待建', cx, by - 24);
      for (var m = 0; m < 3; m++) { px(g, cx + 2 + m * 5, by - 8, 18, 3, m % 2 ? C.wood : C.stone); }
    }
  }

  /* 帮手驿站：旗幡 + 帐篷；雇工后门口站一个小人影 */
  function drawGuild(g, st, t) {
    var loc = locations().guild;
    var cx = loc.x * TILE + 16, by = loc.y * TILE + 30;
    var ps = prodState(st);
    blob(g, cx, by - 2, 20, 4, 'rgba(52,46,34,0.14)');
    /* 帐篷屋 */
    g.beginPath();
    g.moveTo(cx - 20, by - 4);
    g.lineTo(cx, by - 34);
    g.lineTo(cx + 20, by - 4);
    g.closePath();
    g.fillStyle = '#c98f66';
    g.fill();
    px(g, cx - 20, by - 6, 40, 4, '#a9744f');
    px(g, cx - 2, by - 34, 4, 30, '#e0b48c');
    px(g, cx - 7, by - 16, 14, 12, 'rgba(90,62,40,0.55)');
    /* 旗幡 */
    px(g, cx + 18, by - 40, 2, 36, C.woodDark);
    var wav = Math.round(Math.sin(t * 0.003) * 2);
    px(g, cx + 20, by - 38, 12 + wav, 7, '#d3705f');
    px(g, cx + 20, by - 38, 12 + wav, 2, '#e58c7b');
    /* 雇工人影（仅装饰，不表示位置） */
    if (ps.waterer) { helperFigure(g, cx - 26, by - 6, '#7fa8d4'); }
    if (ps.harvester) { helperFigure(g, cx + 26, by - 4, '#c9a06a'); }
  }

  function helperFigure(g, x, y, tone) {
    px(g, x - 3, y - 14, 6, 8, tone);
    px(g, x - 3, y - 14, 6, 2, '#ffffff55');
    px(g, x - 2, y - 20, 4, 6, C.skin);
    px(g, x - 2, y - 21, 4, 2, '#6b4a34');
    px(g, x - 3, y - 6, 2, 6, '#5b6d92');
    px(g, x + 1, y - 6, 2, 6, '#4a5a7b');
  }

  /* ==================== 树 / 石头 ==================== */
  function drawTree(g, cx, baseY, variant, t) {
    var sway = Math.round(Math.sin(t * 0.0013 + cx * 0.05) * 1);
    blob(g, cx, baseY - 1, 12, 4, 'rgba(45,38,28,0.16)');
    px(g, cx - 3, baseY - 17, 6, 17, '#8a5f3c');
    px(g, cx - 3, baseY - 17, 2, 17, '#9d7049');
    px(g, cx + 1, baseY - 17, 2, 17, '#754c2f');
    px(g, cx - 5, baseY - 3, 3, 3, '#6b4529');
    px(g, cx + 2, baseY - 3, 3, 3, '#6b4529');
    var cy = baseY - 30;
    blob(g, cx + sway, cy + 9, 17, 12, '#4f8a4a');
    blob(g, cx + sway - 2, cy + 1, 14, 11, '#5c9a52');
    blob(g, cx + sway - 4, cy - 4, 10, 8, '#6ba85c');
    blob(g, cx + sway - 6, cy - 7, 5, 4, '#8cc374');
    px(g, cx + sway - 9, cy - 2, 3, 3, 'rgba(140,195,116,0.7)');
    if (variant === 1) {
      px(g, cx + sway + 4, cy + 4, 3, 3, '#d9695a');
      px(g, cx + sway - 6, cy + 8, 3, 3, '#e07a63');
    } else if (variant === 2) {
      px(g, cx + sway - 2, cy + 10, 2, 2, '#f2e7c2');
      px(g, cx + sway + 6, cy - 2, 2, 2, '#f2e7c2');
    }
  }

  function drawRock(g, cx, baseY, variant) {
    blob(g, cx, baseY - 1, 12, 4, 'rgba(45,38,28,0.14)');
    blob(g, cx, baseY - 9, 12, 8, '#8f989a');
    blob(g, cx - 2, baseY - 13, 8, 6, '#a3acae');
    px(g, cx - 7, baseY - 6, 7, 2, '#b6bec0');
    px(g, cx + 2, baseY - 4, 6, 2, '#788284');
    px(g, cx - 3, baseY - 3, 3, 2, variant === 1 ? '#6f9a5b' : '#7d8484');
    if (variant === 2) { px(g, cx + 4, baseY - 12, 3, 2, '#c2cacb'); }
  }

  /* ==================== 人物 ==================== */
  function drawTool(g, x, y, tool) {
    var k = String(tool || '');
    if (k === 'hoe') {
      px(g, x, y - 2, 2, 13, C.woodDark);
      px(g, x - 4, y - 3, 8, 3, C.stoneLight);
      px(g, x - 4, y - 1, 8, 1, C.stoneDark);
    } else if (k === 'seed') {
      px(g, x - 3, y + 1, 7, 8, '#caa06a');
      px(g, x - 3, y + 1, 7, 2, '#e0bd8a');
      px(g, x - 2, y + 4, 2, 2, '#7d5a34');
      px(g, x + 1, y + 6, 2, 2, '#7d5a34');
    } else if (k === 'water') {
      px(g, x - 3, y + 2, 8, 7, '#7fa8b8');
      px(g, x - 3, y + 2, 8, 2, '#a3c8d4');
      px(g, x + 5, y + 1, 4, 2, '#7fa8b8');
      px(g, x + 8, y, 2, 2, '#a3c8d4');
      px(g, x - 5, y + 4, 2, 3, '#7fa8b8');
    } else if (k === 'harvest') {
      px(g, x - 4, y + 3, 9, 6, '#caa06a');
      px(g, x - 4, y + 3, 9, 2, '#e0bd8a');
      px(g, x - 4, y + 8, 9, 2, '#a07c48');
      px(g, x - 2, y + 1, 3, 3, C.leaf);
      px(g, x + 2, y, 3, 4, C.leafLight);
    } else if (k === 'axe') {
      px(g, x, y - 2, 2, 13, C.woodDark);
      px(g, x - 4, y - 4, 7, 5, C.stoneLight);
      px(g, x - 4, y - 1, 7, 2, C.stoneDark);
    } else if (k === 'pickaxe') {
      px(g, x, y - 2, 2, 13, C.woodDark);
      px(g, x - 5, y - 4, 11, 2, C.stoneLight);
      px(g, x - 5, y - 4, 3, 4, C.stoneDark);
      px(g, x + 3, y - 4, 3, 4, C.stoneDark);
    }
  }

  function drawPlayer(g, st, view, t) {
    /* 位置来源优先级：view.player（UI 做时间插值，可为小数）→ 逻辑状态。
       只做"世界像素取整"，不写回 state，也不做子像素平移。 */
    var vp = view && view.player;
    var p = (st && st.player) || {};
    var pxX, pxY, facing;
    if (vp && (typeof vp.x === 'number' || typeof vp.y === 'number')) {
      pxX = num(vp.x, num(p.x, 12));
      pxY = num(vp.y, num(p.y, 8));
      facing = String(vp.facing || p.facing || 'down');
    } else {
      pxX = num(p.x, 12);
      pxY = num(p.y, 8);
      facing = String(p.facing || 'down');
    }
    /* 格坐标(小数) → 世界像素 → 取整，保证像素边缘稳定 */
    var wpx = Math.round(pxX * TILE + 16);
    var wpy = Math.round(pxY * TILE + 30);
    var cx = wpx;
    var yb = wpy + Math.round(Math.sin(t * 0.0042) * 1);
    var skin = C.skin, skinShade = C.skinShade;

    blob(g, cx, yb - 2, 9, 3, 'rgba(52,44,34,0.18)');

    /* 背包：背面朝向时最明显 */
    if (facing === 'up') {
      px(g, cx - 5, yb - 18, 10, 10, C.pack);
      px(g, cx - 5, yb - 18, 10, 2, '#c08d5c');
      px(g, cx - 5, yb - 9, 10, 1, C.packDark);
      px(g, cx - 2, yb - 16, 4, 4, C.packDark);
    } else if (facing === 'left') {
      px(g, cx + 2, yb - 17, 6, 9, C.pack);
      px(g, cx + 2, yb - 17, 6, 2, '#c08d5c');
    } else if (facing === 'right') {
      px(g, cx - 8, yb - 17, 6, 9, C.pack);
      px(g, cx - 8, yb - 17, 6, 2, '#c08d5c');
    } else {
      px(g, cx - 6, yb - 16, 3, 2, C.packDark);
      px(g, cx + 3, yb - 16, 3, 2, C.packDark);
    }

    /* 腿与鞋 */
    px(g, cx - 6, yb - 9, 4, 6, C.pants);
    px(g, cx + 2, yb - 9, 4, 6, C.pantsDark);
    px(g, cx - 6, yb - 3, 5, 3, C.shoe);
    px(g, cx + 1, yb - 3, 5, 3, C.shoe);

    /* 身体 */
    px(g, cx - 7, yb - 18, 14, 10, C.shirt);
    px(g, cx - 7, yb - 18, 14, 2, C.shirtLight);
    px(g, cx - 7, yb - 10, 14, 2, C.shirtDark);
    /* 手臂 */
    px(g, cx - 10, yb - 17, 3, 7, skin);
    px(g, cx + 7, yb - 17, 3, 7, skin);
    px(g, cx - 10, yb - 11, 3, 1, skinShade);
    px(g, cx + 7, yb - 11, 3, 1, skinShade);

    /* 头与头发 */
    px(g, cx - 5, yb - 26, 10, 9, skin);
    if (facing === 'up') {
      px(g, cx - 5, yb - 26, 10, 8, C.hair);
      px(g, cx - 5, yb - 19, 10, 1, '#6b462c');
    } else if (facing === 'left') {
      px(g, cx - 5, yb - 26, 8, 4, C.hair);
      px(g, cx - 5, yb - 26, 2, 7, C.hair);
    } else if (facing === 'right') {
      px(g, cx - 3, yb - 26, 8, 4, C.hair);
      px(g, cx + 3, yb - 26, 2, 7, C.hair);
    } else {
      px(g, cx - 5, yb - 26, 10, 3, C.hair);
      px(g, cx - 5, yb - 24, 1, 4, C.hair);
      px(g, cx + 4, yb - 24, 1, 4, C.hair);
    }

    /* 草帽 */
    blob(g, cx, yb - 27, 11, 3.5, C.hat);
    px(g, cx - 5, yb - 33, 10, 7, C.hat);
    px(g, cx - 5, yb - 33, 10, 2, '#f8e7b4');
    px(g, cx - 5, yb - 28, 10, 2, C.hatBand);
    px(g, cx - 9, yb - 28, 3, 1, C.hatDark);
    px(g, cx + 6, yb - 28, 3, 1, C.hatDark);

    /* 五官 */
    if (facing === 'down') {
      px(g, cx - 3, yb - 22, 2, 2, '#4a3a2c');
      px(g, cx + 1, yb - 22, 2, 2, '#4a3a2c');
      px(g, cx - 1, yb - 19, 2, 1, 'rgba(190,120,100,0.55)');
    } else if (facing === 'left') {
      px(g, cx - 4, yb - 22, 2, 2, '#4a3a2c');
      px(g, cx - 6, yb - 21, 1, 1, '#e0b28c');
    } else if (facing === 'right') {
      px(g, cx + 2, yb - 22, 2, 2, '#4a3a2c');
      px(g, cx + 5, yb - 21, 1, 1, '#e0b28c');
    }

    /* 手上的工具 */
    var tool = view && view.tool;
    if (tool) {
      var hx = facing === 'left' ? cx - 15 : (facing === 'right' ? cx + 11 : cx + 10);
      drawTool(g, hx, yb - 14, tool);
    }
  }

  /* 五名村民共用同一套 32px 像素骨架，仅换配色与随身物件 */
  function drawNPC(g, unit, t) {
    var s = unit.style || NPC_STYLE_FALLBACK.npc;
    var id = unit.id;
    var cx = unit.x * TILE + 16;
    var yb = unit.y * TILE + 30 + Math.round(Math.sin(t * 0.0031 + unit.x * 0.7) * 1);
    var skin = s.skin || C.skin;
    var shirt = s.shirt || C.npcShirt;
    var apron = s.apron || C.npcApron;
    var hair = s.hair || '#6e4a2f';

    blob(g, cx, yb - 2, 9, 3, 'rgba(52,44,34,0.16)');
    /* 腿与鞋（配色跟衣服呼应） */
    px(g, cx - 6, yb - 9, 4, 6, id === 'florist' ? '#8a6f7f' : '#6b6f8a');
    px(g, cx + 2, yb - 9, 4, 6, id === 'florist' ? '#79606f' : '#5a5e78');
    px(g, cx - 6, yb - 3, 5, 3, '#4a4038');
    px(g, cx + 1, yb - 3, 5, 3, '#4a4038');
    /* 身体 + 围裙 */
    px(g, cx - 7, yb - 18, 14, 10, shirt);
    px(g, cx - 7, yb - 18, 14, 2, shade(shirt, 1.14));
    px(g, cx - 7, yb - 10, 14, 2, shade(shirt, 0.86));
    if (id !== 'ranger') {
      px(g, cx - 5, yb - 15, 10, 7, apron);
      px(g, cx - 5, yb - 15, 10, 1, shade(apron, 1.1));
    } else {
      /* 护林人：斜挎带 */
      for (var bs = 0; bs < 8; bs++) { px(g, cx - 5 + bs, yb - 16 + bs, 2, 2, '#4f6b45'); }
    }
    px(g, cx - 10, yb - 17, 3, 7, skin);
    px(g, cx + 7, yb - 17, 3, 7, skin);
    /* 头与头发 */
    px(g, cx - 5, yb - 26, 10, 9, skin);
    px(g, cx - 5, yb - 26, 10, 3, hair);
    px(g, cx - 5, yb - 24, 2, 5, hair);
    px(g, cx + 3, yb - 24, 2, 5, hair);
    /* 帽子 / 头饰 */
    if (s.hat === 'straw') {
      blob(g, cx, yb - 27, 11, 3.5, C.hat);
      px(g, cx - 5, yb - 33, 10, 7, C.hat);
      px(g, cx - 5, yb - 33, 10, 2, '#f8e7b4');
      px(g, cx - 5, yb - 28, 10, 2, '#c98f5c');
    } else if (s.hat === 'cap') {
      /* 麦叔：磨坊工布帽 + 麦穗 */
      px(g, cx - 6, yb - 32, 12, 5, '#d9c08a');
      px(g, cx - 6, yb - 32, 12, 2, '#ead7a8');
      px(g, cx - 3, yb - 27, 8, 2, '#b79a63');
      px(g, cx + 5, yb - 30, 3, 4, '#c9a34f');
    } else if (s.hat === 'hood') {
      /* 林岚：兜帽 */
      px(g, cx - 7, yb - 34, 14, 8, '#4f6b45');
      px(g, cx - 7, yb - 34, 14, 2, '#5f7d53');
      px(g, cx - 7, yb - 28, 2, 6, '#4f6b45');
      px(g, cx + 5, yb - 28, 2, 6, '#4f6b45');
      px(g, cx - 3, yb - 26, 7, 2, '#3f5838');
    } else if (s.hat === 'helmet') {
      /* 石川：矿灯头盔 */
      px(g, cx - 6, yb - 33, 12, 5, '#b9b0a2');
      px(g, cx - 6, yb - 33, 12, 2, '#cec5b6');
      px(g, cx - 2, yb - 36, 4, 3, '#8b8378');
      px(g, cx - 1, yb - 36, 2, 2, '#ffe6a0');
    } else if (s.hat === 'ribbon') {
      /* 小葵：发带 + 小花 */
      px(g, cx - 5, yb - 28, 10, 2, '#e0798f');
      px(g, cx + 4, yb - 30, 4, 3, '#e88fa3');
      px(g, cx + 5, yb - 31, 2, 2, '#f6d06a');
      px(g, cx - 6, yb - 26, 2, 3, hair);
    }
    /* 表情（眨眼相位各不相同，避免整齐划一） */
    var blink = ((t * 0.0012 + unit.x * 0.37) % 4) < 0.12;
    if (blink) {
      px(g, cx - 3, yb - 21, 2, 1, '#4a3a2c');
      px(g, cx + 1, yb - 21, 2, 1, '#4a3a2c');
    } else {
      px(g, cx - 3, yb - 22, 2, 2, '#4a3a2c');
      px(g, cx + 1, yb - 22, 2, 2, '#4a3a2c');
    }
    px(g, cx - 1, yb - 19, 2, 1, 'rgba(190,120,100,0.5)');

    /* 随身物件：同尺度小道具，区分职业但不写实 */
    if (id === 'npc') {
      px(g, cx + 7, yb - 11, 8, 6, '#caa06a');
      px(g, cx + 7, yb - 11, 8, 2, '#e0bd8a');
      px(g, cx + 9, yb - 14, 2, 3, '#8fa05a');
      px(g, cx + 12, yb - 15, 2, 4, '#7f9450');
    } else if (id === 'miller') {
      /* 麦袋 */
      px(g, cx + 8, yb - 12, 8, 8, '#d8c193');
      px(g, cx + 8, yb - 12, 8, 2, '#e8d6ae');
      px(g, cx + 9, yb - 13, 6, 2, '#b79a63');
      px(g, cx + 10, yb - 10, 2, 2, '#c9a34f');
    } else if (id === 'ranger') {
      /* 木弓 */
      px(g, cx + 9, yb - 20, 2, 12, '#8a5f3a');
      px(g, cx + 8, yb - 18, 1, 8, '#c9a06a');
      px(g, cx + 11, yb - 18, 1, 8, '#c9a06a');
      px(g, cx + 10, yb - 20, 2, 2, '#6f8f5c');
    } else if (id === 'miner') {
      /* 镐 */
      px(g, cx + 9, yb - 20, 2, 13, '#8a5f3a');
      px(g, cx + 6, yb - 21, 9, 2, '#b9c2c0');
      px(g, cx + 6, yb - 21, 2, 4, '#98a19f');
      px(g, cx + 13, yb - 21, 2, 4, '#98a19f');
    } else if (id === 'florist') {
      /* 花篮 */
      px(g, cx + 7, yb - 11, 9, 6, '#d3ab77');
      px(g, cx + 7, yb - 11, 9, 2, '#e6c793');
      px(g, cx + 8, yb - 15, 2, 4, '#e88fa3');
      px(g, cx + 11, yb - 16, 2, 5, '#8fbd72');
      px(g, cx + 14, yb - 15, 2, 4, '#f6d06a');
      px(g, cx + 9, yb - 16, 2, 2, '#e0798f');
    }
  }

  /* 十六进制颜色微调明暗（保持同一色系） */
  function shade(hex, k) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    if (h.length !== 6) { return hex; }
    var r = parseInt(h.slice(0, 2), 16), gg = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    r = clamp(Math.round(r * k), 0, 255); gg = clamp(Math.round(gg * k), 0, 255); b = clamp(Math.round(b * k), 0, 255);
    return 'rgb(' + r + ',' + gg + ',' + b + ')';
  }

  /* ==================== 作物 ==================== */
  function drawCrop(g, st, tx, ty, plot, t) {
    var crop = plot && plot.crop;
    if (!crop) { return; }
    var id = String(crop.id || 'radish');
    var days = cropDays(id);
    var mature = isMature(crop);
    var age = num(crop.age, 0);
    var ratio = mature ? 1 : clamp(age / days, 0, 0.999);
    var stage = mature ? 3 : (ratio >= 0.62 ? 2 : (ratio >= 0.28 ? 1 : 0));
    var x = tx * TILE, y = ty * TILE;
    var cx = x + 16, by = y + 27;
    var wet = !!(plot && plot.watered);
    var sway = stage >= 2 ? Math.round(Math.sin(t * 0.0018 + tx * 0.6 + ty * 0.3)) : 0;
    var leaf = C.leaf, leafL = C.leafLight, leafD = C.leafDark;

    /* 根部土丘 */
    blob(g, cx, by - 2, 7, 2.5, wet ? C.soilWetDark : C.soilDark);
    if (wet) { px(g, cx - 4, by - 3, 3, 1, 'rgba(160,205,225,0.4)'); }

    if (stage === 0) {
      px(g, cx - 1, by - 6, 2, 4, leafD);
      px(g, cx - 4, by - 7, 3, 2, leaf);
      px(g, cx + 2, by - 7, 3, 2, leafL);
    } else if (stage === 1) {
      px(g, cx - 1, by - 10, 2, 7, leafD);
      px(g, cx - 6, by - 12, 5, 3, leaf);
      px(g, cx + 2, by - 13, 5, 3, leafL);
      px(g, cx - 4, by - 14, 3, 3, leafL);
      px(g, cx + 1, by - 10, 3, 2, leafD);
    } else {
      px(g, cx - 1, by - 15, 2, 11, leafD);
      for (var i = 0; i < 3; i++) {
        var lx = cx - 7 + i * 5 + sway;
        px(g, lx, by - 19 + i * 2, 5, 3, i === 1 ? leafL : leaf);
        px(g, lx + 1, by - 17 + i * 2, 2, 3, leafD);
      }
      px(g, cx + sway, by - 21, 3, 4, leafL);
      px(g, cx - 4 + sway, by - 21, 3, 3, leaf);
      if (mature) { drawProduce(g, id, cx + sway, by, t); }
    }
  }

  function drawProduce(g, id, cx, by, t) {
    if (id === 'carrot') {
      /* 露出土面的橙色肩部 + 茂盛缨叶 */
      px(g, cx - 5, by - 6, 10, 4, C.carrot);
      px(g, cx - 5, by - 6, 10, 1, '#f4a75c');
      px(g, cx - 3, by - 3, 2, 2, C.carrotDark);
      px(g, cx + 1, by - 3, 2, 2, C.carrotDark);
      px(g, cx - 1, by - 14, 2, 8, '#5b8f4c');
      for (var i = 0; i < 4; i++) { px(g, cx - 6 + i * 3, by - 18 + (i % 2), 2, 4, i % 2 ? C.leaf : C.leafLight); }
      px(g, cx, by - 20, 2, 4, C.leafLight);
      return;
    }
    if (id === 'berry') {
      /* 灌木 + 红果 */
      blob(g, cx, by - 11, 10, 8, '#4f8549');
      blob(g, cx - 3, by - 14, 7, 6, '#5f9455');
      blob(g, cx + 2, by - 9, 6, 4, '#6ba45c');
      px(g, cx - 8, by - 12, 3, 2, 'rgba(140,195,116,0.6)');
      var berries = [[-5, -13], [0, -9], [5, -13], [-2, -6], [4, -7]];
      for (var b = 0; b < berries.length; b++) {
        var bx = cx + berries[b][0], byy = by + berries[b][1];
        px(g, bx, byy, 3, 3, C.berry);
        px(g, bx, byy, 1, 1, C.berryLight);
      }
      px(g, cx - 1, by - 20, 2, 4, '#6ba45c');
      return;
    }
    /* 萝卜：白根 + 粉尖 + 叶 */
    px(g, cx - 5, by - 8, 10, 5, C.radish);
    px(g, cx - 5, by - 8, 10, 1, '#fffdf4');
    px(g, cx - 3, by - 4, 6, 2, C.radishTip);
    px(g, cx - 1, by - 3, 2, 1, '#b96b7d');
    px(g, cx - 3, by - 7, 2, 1, 'rgba(255,255,255,0.8)');
    for (var r = 0; r < 3; r++) {
      px(g, cx - 8 + r * 5, by - 14 + r, 4, 3, r === 1 ? C.leafLight : C.leaf);
      px(g, cx - 7 + r * 5, by - 16 + r, 2, 3, C.leafLight);
    }
  }

  /* ==================== 天气 / 光照 ==================== */
  function drawDaylight(g, st, rain) {
    var minutes = num(st && st.minutes, 360);
    if (minutes >= 1260) {
      px(g, 0, 0, MAP_W, MAP_H, 'rgba(46,60,104,0.12)');
    } else if (minutes >= 1080) {
      px(g, 0, 0, MAP_W, MAP_H, 'rgba(240,160,90,0.07)');
    }
    if (!rain) {
      /* 日间柔和光斑（不属于"阴影"，透明度很低，不遮挡任何 UI） */
      for (var i = 0; i < 6; i++) {
        var lx = h2(i * 17 + 3, i * 5 + 7) * MAP_W;
        var ly = h2(i * 11 + 9, i * 3 + 1) * MAP_H;
        blob(g, lx, ly, 60 + h2(i, 2) * 50, 24 + h2(i, 4) * 18, 'rgba(255,250,220,0.045)');
      }
    }
  }

  function drawRain(g, t) {
    px(g, 0, 0, MAP_W, MAP_H, 'rgba(64,86,112,0.10)');
    var n = 140;
    g.lineWidth = 1.2;
    for (var i = 0; i < n; i++) {
      var hs = h2(i * 13 + 7, i * 29 + 3);
      var hs2 = h2(i * 5 + 11, i * 17 + 13);
      var speed = 420 + hs * 520;
      var yy = ((t * speed * 0.001 + hs2 * (MAP_H + 120)) % (MAP_H + 120)) - 40;
      var xx = ((hs * (MAP_W + 160) + yy * 0.42) % (MAP_W + 160)) - 80;
      var len = 10 + hs * 14;
      g.strokeStyle = 'rgba(214,236,250,' + (0.22 + hs2 * 0.28).toFixed(3) + ')';
      g.beginPath();
      g.moveTo(xx, yy);
      g.lineTo(xx + 3, yy + len);
      g.stroke();
    }
    /* 更近的雨丝，增强雨天层次 */
    for (var k = 0; k < 14; k++) {
      var kx = h2(k * 23 + 5, k * 31 + 7) * MAP_W;
      var ky = ((t * 0.0011 * (900 + k * 40) + h2(k * 3, k + 9) * (MAP_H + 200)) % (MAP_H + 200)) - 80;
      g.lineWidth = 1.7;
      g.strokeStyle = 'rgba(230,246,253,0.40)';
      g.beginPath();
      g.moveTo(kx - 2, ky);
      g.lineTo(kx + 5, ky + 26);
      g.stroke();
    }
    for (var s = 0; s < 26; s++) {
      var sx = h2(s * 7 + 1, s * 3 + 9) * MAP_W;
      var sy = h2(s * 11 + 3, s * 19 + 5) * MAP_H;
      var ph = (t * 0.0016 + h2(s, s + 1)) % 1;
      var rr = 2 + ph * 7;
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(200,232,246,' + ((1 - ph) * 0.32).toFixed(3) + ')';
      ellipsePath(g, sx, sy, rr, rr * 0.5);
      g.stroke();
    }
  }

  /* ==================== 选中格 / 提示 / 标签 ==================== */
  function drawCorners(g, x, y, size, color) {
    var t = 3, l = 9;
    g.fillStyle = color;
    g.fillRect(x, y, l, t);
    g.fillRect(x, y, t, l);
    g.fillRect(x + size - l, y, l, t);
    g.fillRect(x + size - t, y, t, l);
    g.fillRect(x, y + size - t, l, t);
    g.fillRect(x, y + size - l, t, l);
    g.fillRect(x + size - l, y + size - t, l, t);
    g.fillRect(x + size - t, y + size - l, t, l);
  }

  function glowFarmBoundary(g, t, farm) {
    var box = farm || FARM;
    var x0 = box.x0 * TILE + 1, y0 = box.y0 * TILE + 1;
    var x1 = (box.x1 + 1) * TILE - 1, y1 = (box.y1 + 1) * TILE - 1;
    g.save();
    setDash(g, [7, 5]);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(228,178,86,' + (0.45 + 0.22 * Math.sin(t * 0.005)).toFixed(3) + ')';
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    setDash(g, []);
    g.restore();
  }

  function targetText(game, st, view, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) {
      return { text: '地图之外', tone: 'rgba(240,200,184,0.95)' };
    }
    var farm = isFarmTile(game, tx, ty);
    var plot = plotAt(st, tx, ty);
    var tool = String((view && view.tool) || '');
    var id = String((view && view.cropId) || 'radish');
    if (plot) {
      if (plot.crop) {
        var nm = cropName(plot.crop.id);
        var mature = isMature(plot.crop);
        var txt = nm + ' · ' + (mature ? '可收获' : '生长中') + (plot.watered ? ' · 已浇水' : ' · 缺水');
        return { text: txt, tone: mature ? 'rgba(246,227,164,0.97)' : 'rgba(233,239,224,0.95)' };
      }
      var seeds = num(st && st.seeds && st.seeds[id], 0);
      if (tool === 'seed') { return { text: '播种 ' + cropName(id) + '（剩 ' + seeds + '）', tone: 'rgba(233,239,224,0.95)' }; }
      return { text: '已开垦 · 可播种', tone: 'rgba(233,239,224,0.95)' };
    }
    if (!farm) {
      if (tool === 'hoe' || tool === 'seed') { return { text: '仅农田内可耕种', tone: 'rgba(243,206,190,0.96)' }; }
      return null;
    }
    if (tool === 'hoe') { return { text: '可开垦', tone: 'rgba(233,239,224,0.95)' }; }
    return null;
  }

  function drawTarget(g, game, st, view, t) {
    var tg = view && view.target;
    if (!tg) { return; }
    var tx = Math.round(num(tg.x, NaN)), ty = Math.round(num(tg.y, NaN));
    if (!isFinite(tx) || !isFinite(ty)) { return; }
    var inside = tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS;
    var farm = isFarmTile(game, tx, ty);
    var tool = String((view && view.tool) || '');
    var x = tx * TILE, y = ty * TILE;
    var ok = inside && farm;

    /* 升级后的十字浇水范围预览 */
    if (inside && tool === 'water' && num(st && st.wateringLevel, 0) >= 1) {
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < nb.length; i++) {
        var nx = tx + nb[i][0], ny = ty + nb[i][1];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) { continue; }
        g.fillStyle = 'rgba(130,196,224,0.13)';
        g.fillRect(nx * TILE, ny * TILE, TILE, TILE);
        px(g, nx * TILE + 14, ny * TILE + 14, 3, 3, 'rgba(150,214,238,0.55)');
      }
    }

    if (inside) {
      g.fillStyle = ok ? 'rgba(246,240,190,0.16)' : 'rgba(224,128,106,0.14)';
      g.fillRect(x, y, TILE, TILE);
      drawCorners(g, x, y, TILE, ok ? '#f4e7a8' : '#e59c88');
      var sy2 = y + ((t * 0.03) % TILE);
      g.fillStyle = ok ? 'rgba(255,250,215,0.22)' : 'rgba(240,170,150,0.16)';
      g.fillRect(x + 2, sy2, TILE - 4, 1);
    }

    if (tool === 'hoe' || tool === 'seed' || tool === 'water' || tool === 'harvest') {
      if (!ok) { glowFarmBoundary(g, t, nearestFarm(tx, ty)); }
    }

    var info = targetText(game, st, view, tx, ty);
    if (info) {
      var pcx = x + TILE / 2;
      var pcy = y - 6;
      /* 越界格也钉在目标附近，只做世界内夹取，避免相机平移后文字跑到屏幕边缘 */
      pill(g, info.text, clamp(pcx, 60, MAP_W - 60), clamp(pcy, 24, MAP_H - 12), info.tone);
    }
  }

  function pill(g, text, cx, cy, tone) {
    g.save();
    g.font = FONT_PILL;
    var tw = textWidth(g, text, 11);
    var w = Math.round(tw + 14), hh = 19;
    var x = Math.round(cx - w / 2), y = Math.round(cy - hh);
    if (x < 3) { x = 3; }
    if (x + w > MAP_W - 3) { x = MAP_W - 3 - w; }
    if (y < 3) { y = 3; }
    roundRectPath(g, x, y, w, hh, 5);
    g.fillStyle = tone || 'rgba(250,244,228,0.95)';
    g.fill();
    g.strokeStyle = 'rgba(96,76,50,0.38)';
    g.lineWidth = 1;
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 4, y + hh - 1);
    g.lineTo(cx, y + hh + 5);
    g.lineTo(cx + 4, y + hh - 1);
    g.closePath();
    g.fillStyle = tone || 'rgba(250,244,228,0.95)';
    g.fill();
    g.font = FONT_PILL;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#4b3a27';
    g.fillText(text, x + w / 2, y + hh / 2 + 0.5);
    g.restore();
  }

  function labelPlate(g, text, cx, cy, highlight) {
    g.save();
    g.font = FONT_LABEL;
    var tw = textWidth(g, text, 12);
    var w = Math.round(tw + 14), hh = 19;
    var x = Math.round(cx - w / 2), y = Math.round(cy - hh / 2);
    if (x < 3) { x = 3; }
    if (x + w > MAP_W - 3) { x = MAP_W - 3 - w; }
    var bg = highlight ? 'rgba(255,250,226,0.97)' : 'rgba(252,247,233,0.93)';
    var bd = highlight ? 'rgba(196,146,64,0.95)' : 'rgba(103,82,56,0.42)';
    roundRectPath(g, x, y, w, hh, 6);
    g.fillStyle = bg;
    g.fill();
    g.strokeStyle = bd;
    g.lineWidth = 1;
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 4, y + hh - 1);
    g.lineTo(cx, y + hh + 5);
    g.lineTo(cx + 4, y + hh - 1);
    g.closePath();
    g.fillStyle = bg;
    g.fill();
    g.strokeStyle = bd;
    g.stroke();
    g.font = FONT_LABEL;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = highlight ? '#6b4a22' : '#4b3a27';
    g.fillText(text, x + w / 2, y + hh / 2 + 0.5);
    g.restore();
  }

  function sparkle(g, x, y, alpha) {
    g.save();
    g.globalAlpha = clamp(alpha, 0.12, 0.95);
    px(g, x - 1, y - 4, 2, 9, '#ffe9a8');
    px(g, x - 4, y - 1, 9, 2, '#ffe9a8');
    px(g, x, y, 2, 2, '#fffbe8');
    g.restore();
  }

  function bubble(g, cx, cy, ch, t, soft) {
    var b = Math.round(Math.sin(t * 0.005) * 2);
    var y = cy + b;
    blob(g, cx, y + 12, 5, 2, 'rgba(60,50,36,0.14)');
    blob(g, cx, y + 5, 9, 9, soft ? '#f2e8c8' : '#f8eecb');
    g.strokeStyle = 'rgba(120,92,52,0.6)';
    g.lineWidth = 1;
    ellipsePath(g, cx, y + 5, 9, 9);
    g.stroke();
    g.font = '700 12px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = soft ? '#8a6a35' : '#a06f2a';
    g.fillText(ch, cx, y + 6);
  }

  function cheb(ax, ay, bx, by) {
    var dx = Math.abs(num(ax, 0) - num(bx, 0));
    var dy = Math.abs(num(ay, 0) - num(by, 0));
    return Math.max(dx, dy);
  }

  function drawSparkles(g, st, t) {
    var plots = (st && st.plots) || {};
    for (var k in plots) {
      if (!has(plots, k)) { continue; }
      var p = plots[k];
      if (!p || !p.crop) { continue; }
      if (!isMature(p.crop)) { continue; }
      var pos = parsePlotKey(k);
      if (!pos) { continue; }
      var a = 0.38 + 0.32 * Math.sin(t * 0.004 + (pos.x + pos.y) * 0.9);
      sparkle(g, pos.x * TILE + 16, pos.y * TILE + 4, a);
    }
  }

  function drawInteractRings(g, st, locs, t) {
    var p = (st && st.player) || {};
    for (var k in locs) {
      if (!has(locs, k)) { continue; }
      var L = locs[k];
      if (cheb(p.x, p.y, L.x, L.y) > 1) { continue; }
      g.save();
      g.globalAlpha = clamp(0.30 + 0.22 * Math.sin(t * 0.005 + L.x), 0.12, 0.75);
      g.strokeStyle = '#f2dc9a';
      g.lineWidth = 2;
      ellipsePath(g, L.x * TILE + 16, L.y * TILE + 24, 13, 5);
      g.stroke();
      g.restore();
    }
  }

  function drawLabels(g, game, st, locs, t) {
    var p = (st && st.player) || {};
    var near = null;
    for (var k in locs) {
      if (!has(locs, k)) { continue; }
      if (cheb(p.x, p.y, locs[k].x, locs[k].y) <= 1) { near = k; break; }
    }
    /* 固定建筑（世界坐标，保留旧位置） */
    labelPlate(g, locs.home.name, locs.home.x * TILE + 16, HOUSE_BOX.y0 * TILE - 10, near === 'home');
    labelPlate(g, locs.shop.name, locs.shop.x * TILE + 16, SHOP_BOX.y0 * TILE - 10, near === 'shop');
    labelPlate(g, locs.bin.name, locs.bin.x * TILE + 16, locs.bin.y * TILE - 10, near === 'bin');
    labelPlate(g, locs.well.name, locs.well.x * TILE + 16, locs.well.y * TILE - 54, near === 'well');
    /* 2.3 生产地点（入口名称可读） */
    if (locs.ranch) { labelPlate(g, locs.ranch.name, locs.ranch.x * TILE + 16, RANCH_BOX.y0 * TILE - 12, near === 'ranch'); }
    if (locs.workshop) { labelPlate(g, locs.workshop.name, locs.workshop.x * TILE + 16, locs.workshop.y * TILE - 52, near === 'workshop'); }
    if (locs.guild) { labelPlate(g, locs.guild.name, locs.guild.x * TILE + 16, locs.guild.y * TILE - 56, near === 'guild'); }

    /* 村民：名字 + 角色 + 仅当本人有可领委托时亮"!" */
    var npcs = npcList();
    for (var i = 0; i < npcs.length; i++) {
      var u = npcs[i];
      var cx = u.x * TILE + 16;
      labelPlate(g, u.name, cx, u.y * TILE - 22, near === u.id);
      if (npcHasReadyQuest(game, st, u.id)) {
        bubble(g, cx + 13, u.y * TILE - 48, '!', t);
      }
    }
    if (num(st && st.restedAtDay, -1) !== num(st && st.day, 1)) {
      bubble(g, locs.well.x * TILE + 16 + 14, locs.well.y * TILE - 30, '✦', t, true);
    }
  }

  /* ==================== 主绘制入口 ==================== */
  /* 相机：格坐标（可为小数），只做平移；视口小于世界时由 canvas 自然裁切。
     世界固定 42x30 像素尺度，绝不把整张地图缩小塞进画布。 */
  function cameraOf(view, st) {
    var cam = view && view.camera;
    if (cam && typeof cam === 'object') {
      var cx = num(cam.x, NaN), cy = num(cam.y, NaN);
      if (isFinite(cx) && isFinite(cy)) { return { x: cx, y: cy }; }
    }
    /* 没有 camera 时（旧调用/首次渲染）居中到玩家，不做缩放 */
    var p = (st && st.player) || {};
    return { x: num(p.x, 0) - 15, y: num(p.y, 0) - 11 };
  }

  /* 当前视口的格数（用于让 HUD 文字贴住可见区域边角） */
  function viewportTiles(g) {
    var cv = g && g.canvas;
    var cw = cv && cv.width > 0 ? cv.width : 960;
    var ch = cv && cv.height > 0 ? cv.height : 704;
    return { w: cw / TILE, h: ch / TILE, pw: cw, ph: ch };
  }

  function obstacleVariant(o) {
    return Math.floor(h2(o.x * 7 + 3, o.y * 11 + 5) * 3);
  }

  function draw(ctx, game, view) {
    if (!ctx) { return; }
    var g = ctx;
    var st = stateOf(game);
    var v = view || {};
    var t = num(v.time, 0);
    var rain = isRain(st);
    var locs = locations();
    var cam = cameraOf(v, st);

    g.save();
    try { g.imageSmoothingEnabled = false; } catch (e) {}

    /* 相机：只平移，且按整世界像素取整（避免 0.01px 子像素位移导致像素边缘闪烁）。
       视口 960x540/704 由 canvas 自然裁切，绝不缩放。 */
    g.translate(-Math.round(cam.x * TILE), -Math.round(cam.y * TILE));

    /* 1) 地面层（有 DOM 时整层缓存，只有耕地/浇水变化才重画） */
    var base = ensureBase(game, st);
    if (base) {
      g.drawImage(base, 0, 0);
    } else {
      paintBase(g, game, st);
    }

    /* 2) 动态水面 */
    drawWaterFX(g, t, rain, terrainGrid(game));

    /* 3) 实体按 y 排序绘制 */
    var items = [];
    var obs = obstaclesOf(game);
    for (var i = 0; i < obs.length; i++) {
      items.push({ y: obs[i].y * TILE + 30, k: obs[i].type === 'rock' ? 'rock' : 'tree', o: obs[i] });
    }
    var plots = (st && st.plots) || {};
    for (var pk in plots) {
      if (!has(plots, pk)) { continue; }
      var pp = plots[pk];
      if (!pp || !pp.crop) { continue; }
      var pos = parsePlotKey(pk);
      if (!pos) { continue; }
      items.push({ y: pos.y * TILE + 28, k: 'crop', tx: pos.x, ty: pos.y, p: pp });
    }
    items.push({ y: (HOUSE_BOX.y1 + 1) * TILE, k: 'house' });
    items.push({ y: (SHOP_BOX.y1 + 1) * TILE, k: 'shop' });
    items.push({ y: (RANCH_BOX.y1 + 1) * TILE, k: 'ranch' });
    items.push({ y: locs.workshop.y * TILE + 30, k: 'workshop' });
    items.push({ y: locs.guild.y * TILE + 30, k: 'guild' });
    items.push({ y: locs.well.y * TILE + 30, k: 'well' });
    items.push({ y: locs.bin.y * TILE + 30, k: 'bin' });
    var npcs = npcList();
    for (var ni = 0; ni < npcs.length; ni++) {
      items.push({ y: npcs[ni].y * TILE + 30, k: 'npc', u: npcs[ni] });
    }
    var vpSort = (v && v.player && typeof v.player.y === 'number') ? v.player.y : num(st.player && st.player.y, 8);
    items.push({ y: Math.round(num(vpSort, 8) * TILE) + 30, k: 'player' });
    items.sort(function (a, b) { return a.y - b.y; });

    for (var n = 0; n < items.length; n++) {
      var it = items[n];
      if (it.k === 'tree') {
        drawTree(g, it.o.x * TILE + 16, it.o.y * TILE + 30, obstacleVariant(it.o), t);
      } else if (it.k === 'rock') {
        drawRock(g, it.o.x * TILE + 16, it.o.y * TILE + 30, obstacleVariant(it.o));
      } else if (it.k === 'crop') {
        drawCrop(g, st, it.tx, it.ty, it.p, t);
      } else if (it.k === 'house') {
        drawHouse(g, t);
      } else if (it.k === 'shop') {
        drawShop(g, t);
      } else if (it.k === 'well') {
        drawWell(g, t);
      } else if (it.k === 'bin') {
        drawBin(g, t);
      } else if (it.k === 'ranch') {
        drawRanch(g, st, t);
      } else if (it.k === 'workshop') {
        drawWorkshop(g, st, t);
      } else if (it.k === 'guild') {
        drawGuild(g, st, t);
      } else if (it.k === 'npc') {
        drawNPC(g, it.u, t);
      } else if (it.k === 'player') {
        drawPlayer(g, st, v, t);
      }
    }

    /* 4) 成熟提示 */
    drawSparkles(g, st, t);

    /* 5) 光照与天气：只覆盖世界，不做全屏压暗（HUD 在 DOM 层，不受影响） */
    drawDaylight(g, st, rain);
    if (rain) { drawRain(g, t); }

    /* 6) 交互提示与文字（世界坐标，随相机一起平移） */
    drawInteractRings(g, st, locs, t);
    drawTarget(g, game, st, v, t);
    drawLabels(g, game, st, locs, t);

    g.restore();
  }

  var FarmRenderer = {
    draw: draw,
    version: '2.3.0',
    palette: C,
    map: { cols: COLS, rows: ROWS, tile: TILE, width: MAP_W, height: MAP_H },
    farms: FARMS,
    npcs: NPC_KEYS,
    /* 2.3 只读元信息：供 UI/测试核对，绘制本身不依赖调用方读取 */
    production: {
      locations: Object.keys(LOC_FALLBACK_EXTRA),
      river: RIVER,
      biomes: BIOMES,
      ranchBox: RANCH_BOX
    }
  };
  root.FarmRenderer = FarmRenderer;
  if (typeof module !== 'undefined' && module.exports) {
    try { module.exports = FarmRenderer; } catch (e) {}
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
