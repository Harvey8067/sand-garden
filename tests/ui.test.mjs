// 栖砂·田园记 / UI 行为测试（修饰键、路线、点击映射、暂停）
// 运行（仓库根目录）：node --test --test-isolation=none tests/ui.test.mjs
//
// 做法：不重写任何 UI 逻辑，而是用 node:vm 直接加载真实的 src/ui.js，
//       只提供最小的 DOM / canvas / rAF 桩，然后派发真实的键盘与指针事件、
//       手动驱动 requestAnimationFrame 帧，观察真实代码产生的状态。
//
// 默认加载 ../src/ui.js 与 ../src/farm-core.js；可用环境变量 FARM_UI_FILE / FARM_CORE_FILE 覆盖。
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const CORE_PATH = process.env.FARM_CORE_FILE
  ? path.resolve(HERE, process.env.FARM_CORE_FILE)
  : path.join(REPO, 'src', 'farm-core.js');
const UI_PATH = process.env.FARM_UI_FILE
  ? path.resolve(HERE, process.env.FARM_UI_FILE)
  : path.join(REPO, 'src', 'ui.js');

const TILE = 32; // MAP.tile

let FarmCore = null;
let loadError = null;
try {
  FarmCore = require(CORE_PATH);
  readFileSync(UI_PATH, 'utf8'); // 仅确认可读，真正执行在 loadUI 里
} catch (err) {
  loadError = err;
}

if (loadError) {
  test('src/ui.js 与 src/farm-core.js 应存在且可加载', () => {
    throw loadError;
  });
} else {
  const { MAP, LOCATIONS } = FarmCore;

  // ---------- 最小 DOM 桩 + 真实 ui.js 装载 ----------
  const makeCtxStub = () =>
    new Proxy({}, {
      get: (target, prop) => (prop in target ? target[prop] : () => {}),
      set: (target, prop, value) => { target[prop] = value; return true; },
    });

  function loadUI() {
    const elements = new Map();
    const listeners = { window: {}, canvas: {}, document: {} };
    const rafQueue = [];
    const clock = { t: 0 };
    let seq = 0;

    const makeElement = (id) => {
      const el = {
        id: id || 'el' + (++seq),
        dataset: {},
        style: {},
        children: [],
        textContent: '',
        innerHTML: '',
        hidden: false,
        disabled: false,
        open: false,
        value: '',
        max: 100,
        className: '',
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        setAttribute() {},
        getAttribute() { return null; },
        removeAttribute() {},
        append(...kids) { el.children.push(...kids); },
        appendChild(kid) { el.children.push(kid); return kid; },
        replaceChildren() { el.children = []; },
        querySelector() { return makeElement('sub'); },
        querySelectorAll() { return []; },
        addEventListener(type, fn) { (el._listeners ||= {}); (el._listeners[type] ||= []).push(fn); },
        removeEventListener() {},
        focus() {},
        blur() {},
        click() {},
        setPointerCapture() {},
        releasePointerCapture() {},
        getBoundingClientRect() { return { left: 0, top: 0, right: MAP.cols * TILE, bottom: MAP.rows * TILE, width: MAP.cols * TILE, height: MAP.rows * TILE }; },
        getContext() { return makeCtxStub(); },
        showModal() { el.open = true; },
        close() { el.open = false; },
      };
      return el;
    };

    const element = (id) => {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    };

    const toolButtons = ['hoe', 'seed', 'water', 'harvest', 'axe', 'pickaxe'].map((tool) => {
      const b = makeElement('tool-' + tool);
      b.dataset.tool = tool;
      return b;
    });
    const guideButtons = ['home', 'shop', 'bin', 'npc', 'well'].map((id) => {
      const b = makeElement('guide-' + id);
      b.dataset.go = id;
      return b;
    });
    const moveButtons = [['0,-1', 'up'], ['0,1', 'down'], ['-1,0', 'left'], ['1,0', 'right']].map(([move, name]) => {
      const b = makeElement('move-' + name);
      b.dataset.move = move;
      return b;
    });

    const document = {
      hidden: false,
      body: makeElement('body'),
      getElementById: (id) => element(id),
      querySelector: () => makeElement('query'),
      querySelectorAll: (sel) => {
        if (sel === '[data-tool]') return toolButtons;
        if (sel === '[data-go]') return guideButtons;
        if (sel === '[data-move]') return moveButtons;
        return [];
      },
      createElement: (tag) => makeElement(tag),
      addEventListener: (type, fn) => { ((listeners.document[type] ||= []).push(fn)); },
      removeEventListener() {},
    };

    const canvas = element('farm');

    const sandbox = {
      console,
      document,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      performance: { now: () => clock.t },
      setTimeout: (fn) => 0,
      clearTimeout() {},
      requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
      cancelAnimationFrame() {},
      addEventListener: (type, fn) => { ((listeners.window[type] ||= []).push(fn)); },
      removeEventListener() {},
      Date,
      Math,
      JSON,
      URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
      Blob: function Blob() {},
      alert() {},
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.window.FarmCore = FarmCore;
    sandbox.window.FarmRenderer = { draw() {} };

    const context = vm.createContext(sandbox);
    new vm.Script(readFileSync(UI_PATH, 'utf8'), { filename: UI_PATH }).runInContext(context);

    const api = sandbox.window.SAND_FARM;
    assert.ok(api, 'ui.js 应在 window.SAND_FARM 暴露调试接口');

    const ui = {
      api,
      game: api.game,
      element,
      guide: (id) => guideButtons.find((b) => b.dataset.go === id),
      dialogOpen: () => element('dialog').open,
      dialogTitle: () => element('dialogTitle').textContent,
      toast: () => element('toast').textContent,
      player: () => ({ x: api.game.state.player.x, y: api.game.state.player.y }),
      keydown(init) {
        const prevented = { called: false };
        const event = {
          key: init.key,
          code: init.code || '',
          repeat: !!init.repeat,
          ctrlKey: !!init.ctrlKey,
          metaKey: !!init.metaKey,
          altKey: !!init.altKey,
          shiftKey: !!init.shiftKey,
          target: { matches: () => !!init.targetMatches },
          preventDefault() { prevented.called = true; },
        };
        const handlers = listeners.window.keydown || [];
        assert.ok(handlers.length > 0, 'ui.js 应注册 keydown 监听');
        for (const fn of handlers) fn(event);
        return prevented;
      },
      pointerDown(tileX, tileY) {
        const handlers = (canvas._listeners && canvas._listeners.pointerdown) || [];
        assert.ok(handlers.length > 0, 'ui.js 应在画布上注册 pointerdown 监听');
        const prevented = { called: false };
        const event = {
          button: 0,
          clientX: (tileX + 0.5) * TILE,
          clientY: (tileY + 0.5) * TILE,
          preventDefault() { prevented.called = true; },
        };
        for (const fn of handlers) fn(event);
        return prevented;
      },
      frame(times = 1, stepMs = 150) {
        for (let i = 0; i < times; i++) {
          clock.t += stepMs;
          const queue = rafQueue.splice(0, rafQueue.length);
          for (const cb of queue) cb(clock.t);
        }
      },
      // 驱动帧直到满足条件或到达上限，返回是否满足
      runUntil(predicate, maxFrames = 400, stepMs = 150) {
        for (let i = 0; i < maxFrames; i++) {
          if (predicate()) return true;
          ui.frame(1, stepMs);
        }
        return predicate();
      },
      isWalkable: (x, y) => api.game.isWalkable(x, y),
      tileAt: (x, y) => api.game.tileAt(x, y),
    };
    return ui;
  }

  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

  describe('UI 装载', () => {
    test('在 DOM 桩里能加载真实 ui.js 并暴露 SAND_FARM', () => {
      const ui = loadUI();
      const health = ui.api.health();
      assert.equal(health.canvas, true);
      assert.equal(health.paused, false);
      assert.equal(ui.game.state.day, 1);
      assert.deepEqual(ui.player(), { x: 12, y: 8 });
    });
  });

  describe('修饰键', () => {
    test('按住 Ctrl / Meta / Alt 时方向键不会移动玩家，也不吞掉浏览器快捷键', () => {
      const ui = loadUI();
      const start = ui.player();
      for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
        for (const key of ['ArrowRight', 'd', 'ArrowUp', 'w']) {
          const prevented = ui.keydown({ key, [mod]: true });
          assert.deepEqual(ui.player(), start, mod + ' + ' + key + ' 不应移动玩家');
          assert.equal(prevented.called, false, mod + ' + ' + key + ' 不应被 preventDefault 吞掉');
        }
        // 修饰键下也不应触发暂停等快捷键
        ui.keydown({ key: 'p', [mod]: true });
        assert.equal(ui.api.health().paused, false, mod + ' + p 不应切换暂停');
      }
      assert.deepEqual(ui.player(), start);
    });

    test('没有修饰键时方向键正常移动一格', () => {
      const ui = loadUI();
      const start = ui.player();
      const prevented = ui.keydown({ key: 'ArrowRight' });
      assert.equal(prevented.called, true, '普通方向键应 preventDefault 阻止页面滚动');
      assert.deepEqual(ui.player(), { x: start.x + 1, y: start.y });
      assert.equal(ui.game.state.player.facing, 'right');
    });
  });

  describe('暂停与村庄向导', () => {
    test('暂停时点击村庄向导不会解除暂停，也不会开始走路', () => {
      const ui = loadUI();
      ui.api.pause(true);
      assert.equal(ui.api.health().paused, true);

      ui.guide('shop').onclick();
      assert.equal(ui.api.health().paused, true, '暂停时点向导不应解除暂停');
      const afterClick = ui.player();
      ui.frame(30);
      assert.deepEqual(ui.player(), afterClick, '暂停时点向导不应开始移动');

      // 取消暂停后同一按钮应能正常开始导航
      ui.api.pause(false);
      ui.guide('shop').onclick();
      ui.frame(30);
      assert.notDeepEqual(ui.player(), afterClick, '取消暂停后点向导应开始走向目的地');
    });
  });

  describe('点击映射与路径', () => {
    test('点击建筑内部会走到门口并触发该建筑交互', () => {
      const ui = loadUI();
      const home = LOCATIONS.home;
      // (5,4) 在小屋建筑内部，本身不可走
      assert.equal(ui.isWalkable(5, 4), false, '前置条件：建筑格不可走');
      ui.pointerDown(5, 4);

      const reached = ui.runUntil(() => ui.dialogOpen(), 400);
      assert.ok(reached, '点击建筑内部后应走到门口并打开交互面板');
      assert.equal(ui.dialogTitle(), '今天就到这里吧', '应触发小屋（睡觉）交互');
      assert.ok(!String(ui.toast()).includes('走不到'), '不应提示走不到：' + ui.toast());

      const p = ui.player();
      assert.ok(cheb(p.x, p.y, home.x, home.y) <= 1, '最终应停在门口（与 ' + JSON.stringify(home) + ' 相邻），实际 ' + JSON.stringify(p));
    });

    test('点击大片不可行走区域会走到最近的可行走边缘，而不是放弃', () => {
      const ui = loadUI();
      // 池塘中心：一大片不可走的区域
      const center = { x: 25, y: 16 };
      assert.equal(ui.isWalkable(center.x, center.y), false, '前置条件：池塘中心不可走');
      const start = ui.player();

      // 最近的可走环：从被点击格向外一圈一圈找，第一个存在可走格的 Chebyshev 距离
      const nearestWalkableRing = (cx, cy) => {
        const maxRing = Math.max(MAP.cols, MAP.rows);
        for (let r = 1; r <= maxRing; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const x = cx + dx;
              const y = cy + dy;
              if (x < 0 || y < 0 || x >= MAP.cols || y >= MAP.rows) continue;
              if (ui.isWalkable(x, y)) return r;
            }
          }
        }
        return Infinity;
      };
      const ring = nearestWalkableRing(center.x, center.y);
      assert.ok(Number.isFinite(ring), '前置条件：池塘外面应有可走的地方');

      ui.pointerDown(center.x, center.y);
      ui.frame(400);

      const p = ui.player();
      assert.notDeepEqual(p, start, '应真的走过去，而不是原地不动');
      assert.ok(!String(ui.toast()).includes('走不到'), '不应提示走不到：' + ui.toast());
      assert.equal(ui.isWalkable(p.x, p.y), true, '终点必须可走：' + JSON.stringify(p));
      assert.equal(
        cheb(p.x, p.y, center.x, center.y), ring,
        '终点应落在最近的可走环（ring=' + ring + '）上，而不是随便一个可走远处，实际 ' + JSON.stringify(p),
      );
    });
  });
}
