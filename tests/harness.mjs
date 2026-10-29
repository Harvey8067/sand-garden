// 从旧版沙盒 HTML 的内联脚本中提取 Garden 引擎，并在 node:vm 中运行。
// 只读取源码，不修改它；引擎段落起点/终点是旧版游戏源码中的锚点。
//
// 引擎来源：legacy/sandbox.html —— v2 农场版整合后，仓库根的 index.html 已经是农场游戏，
// 不再包含沙盒引擎，因此这里固定读 legacy/sandbox.html（构建脚本会保持该文件存在）。
// 若设置环境变量 SAND_GARDEN_ENGINE_FILE=<相对仓库根的路径>，则改读该文件作为引擎源码，
// 用于在把 .work/garden-engine.js 整合进产物之前先跑一遍测试。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

export const ENGINE_START = 'const W=300';
export const ENGINE_END = '/* UI_AND_RENDERER */';
export const ENGINE_OVERRIDE_ENV = 'SAND_GARDEN_ENGINE_FILE';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
// v2 农场版整合后，沙盒引擎只存在于 legacy/sandbox.html。
export const INDEX_HTML = resolve(REPO_ROOT, 'legacy', 'sandbox.html');

export function readIndexHtml() {
  return readFileSync(INDEX_HTML, 'utf8');
}

export function extractEngine(html) {
  const start = html.indexOf(ENGINE_START);
  if (start < 0) throw new Error('index.html 中找不到引擎起点 ' + ENGINE_START);
  const end = html.indexOf(ENGINE_END, start);
  if (end < 0) throw new Error('index.html 中找不到引擎终点 ' + ENGINE_END);
  if (end <= start) throw new Error('引擎起点位于终点之后，提取失败');
  return html.slice(start, end);
}

// 返回 { label, code }：label 用于报错定位。
export function engineSource(html) {
  if (html !== undefined) {
    return { label: 'index.html#inline-engine', code: extractEngine(html) };
  }
  const override = process.env[ENGINE_OVERRIDE_ENV];
  if (override && override.trim() !== '') {
    const file = resolve(REPO_ROOT, override.trim());
    return { label: file, code: readFileSync(file, 'utf8') };
  }
  return { label: 'index.html#inline-engine', code: extractEngine(readIndexHtml()) };
}

// 在 vm 沙箱里执行引擎段落，再把 Garden/W/H/N/MAT 暴露出来。
export function loadEngine(html) {
  const { label, code } = engineSource(html);
  const script =
    code + '\n;globalThis.__SAND_GARDEN_ENGINE__ = { Garden, W, H, N, MAT };\n';
  const context = vm.createContext({});
  new vm.Script(script, { filename: label }).runInContext(context);
  const engine = context.__SAND_GARDEN_ENGINE__;
  if (!engine || typeof engine.Garden !== 'function') {
    throw new Error('引擎源码 ' + label + ' 中没有导出 Garden 类');
  }
  return engine;
}

// 把 vm 领域里的对象转成本领域的普通 JSON 值，便于 deepStrictEqual 比较，
// 同时等价于真实存档经过 JSON.stringify/parse 的往返。
export function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

export function cellsOf(garden) {
  return Array.from(garden.cells);
}
