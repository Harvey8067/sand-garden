#!/usr/bin/env node
/**
 * 栖砂·田园记 v2 — 单文件构建脚本（零依赖）
 *
 * 作用：把 src/shell.html 里 4 个占位符替换成真实内容，产出一份可双击运行的单文件 HTML，
 * 并同时写出 index.html 与 sand-garden.html（两份必须字节相同）。
 *
 *   PLACEHOLDER_STYLE    <- src/style.css
 *   PLACEHOLDER_CORE     <- src/farm-core.js     (UMD, 挂 window.FarmCore)
 *   PLACEHOLDER_RENDERER <- src/farm-renderer.js (IIFE, 挂 window.FarmRenderer)
 *   PLACEHOLDER_UI       <- src/ui.js            (IIFE, 挂 window.SAND_FARM)
 *
 * 用法（仓库根目录）：node scripts/build.mjs [--check]
 *   --check  只校验现有产物是否与源码一致（不写文件），用于 CI/验收。
 *
 * 设计要点：
 * - 纯 Node 标准库，无第三方依赖；不联网。
 * - 幂等：同样的 src 输入永远产出同样的字节（不写入时间戳/随机数）。
 * - 构建后跑一整套自检，任何一项失败都以非零状态码退出并打印原因。
 * - 内联前硬校验源码里不能出现 </script 或 <!--，否则会把内联脚本提前截断。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SHELL = 'src/shell.html';
const OUTPUTS = ['index.html', 'sand-garden.html'];

// 占位符 -> 源文件，顺序即脚本顺序要求：style -> core -> renderer -> ui
const SLOTS = [
  { placeholder: '/*' + '__STYLE__' + '*/', source: 'src/style.css', kind: 'style', label: 'style' },
  { placeholder: '/*' + '__CORE__' + '*/', source: 'src/farm-core.js', kind: 'script', label: 'core' },
  { placeholder: '/*' + '__RENDERER__' + '*/', source: 'src/farm-renderer.js', kind: 'script', label: 'renderer' },
  { placeholder: '/*' + '__UI__' + '*/', source: 'src/ui.js', kind: 'script', label: 'ui' }
];

// 内联进 HTML 后仍然可辨识的标记，用来校验脚本顺序与内容存在性
const MARKERS = {
  style: ':root{color-scheme:light',
  core: '农场核心规则',
  renderer: '原创像素农场渲染器',
  ui: 'window.SAND_FARM'
};

const problems = [];
const notes = [];
function fail(msg) { problems.push(msg); }
function ok(msg) { notes.push('  OK  ' + msg); }

function readText(relPath) {
  const abs = resolve(ROOT, relPath);
  if (!existsSync(abs)) throw new Error('缺少源文件：' + relPath);
  return readFileSync(abs, 'utf8');
}

// ---------------------------------------------------------------- 构建

function build() {
  let html = readText(SHELL);
  const sources = new Map();

  for (const slot of SLOTS) {
    const occurrences = html.split(slot.placeholder).length - 1;
    if (occurrences !== 1) {
      throw new Error(SHELL + ' 中占位符 ' + slot.placeholder + ' 出现 ' + occurrences + ' 次，应恰好 1 次');
    }
    let code = readText(slot.source);
    if (slot.kind === 'style' && existsSync(resolve(ROOT, 'src/art-theme.css'))) {
      code += String.fromCharCode(10) + readText('src/art-theme.css');
    }
    if (slot.kind === 'script') {
      if (/<\/script/i.test(code)) throw new Error(slot.source + ' 含有 </script，无法安全内联');
      if (/<!--/.test(code)) throw new Error(slot.source + ' 含有 <!--，会破坏内联脚本');
      code = code.replace(/\s*$/, '\n');
    }
    if (slot.kind === 'style' && /<\/style/i.test(code)) {
      throw new Error(slot.source + ' 含有 </style，无法安全内联');
    }
    sources.set(slot.label, code);
    html = html.replace(slot.placeholder, function () { return code; });
  }
  const coverFile = resolve(ROOT, 'assets/farm-cover.webp');
  if (!existsSync(coverFile)) throw new Error('缺少农场封面');
  const cover = 'data:image/webp;base64,' + readFileSync(coverFile).toString('base64');
  const coverSlot = '/*' + '__COVER__' + '*/';
  if (html.split(coverSlot).length !== 2) throw new Error('农场封面占位符必须恰好出现一次');
  html = html.replace(coverSlot, () => cover);
  return { html, sources };
}

// ---------------------------------------------------------------- 自检

function selfCheck(html, sources) {
  problems.length = 0;
  notes.length = 0;

  // [1] 无占位符残留
  const leftover = html.match(/\/\*__[A-Z]+__\*\//g);
  if (leftover) fail('[1] 产物仍有占位符残留：' + [...new Set(leftover)].join(', '));
  else ok('[1] 无占位符残留（4 个槽位全部替换）');

  // [2] canvas 尺寸 960x704
  const canvasTags = html.match(/<canvas\b[^>]*>/gi) || [];
  const canvasOK = canvasTags.length === 1 &&
    /\bwidth="960"/.test(canvasTags[0]) && /\bheight="704"/.test(canvasTags[0]);
  if (!canvasOK) fail('[2] canvas 应恰好 1 个且为 960x704，实际：' + (canvasTags.join(' | ') || '(无)'));
  else ok('[2] canvas 为 width="960" height="704"');

  // [3] 脚本顺序 style -> core -> renderer -> ui
  const positions = {};
  for (const key of Object.keys(MARKERS)) {
    positions[key] = html.indexOf(MARKERS[key]);
    if (positions[key] < 0) fail('[3] 产物中找不到 ' + key + ' 段标记：' + MARKERS[key]);
  }
  if (Object.values(positions).every(p => p >= 0)) {
    const order = Object.entries(positions).sort((a, b) => a[1] - b[1]).map(e => e[0]).join(' -> ');
    const expected = 'style -> core -> renderer -> ui';
    if (order !== expected) fail('[3] 脚本顺序错误：实际 ' + order + '，期望 ' + expected);
    else ok('[3] 顺序正确：' + order);
  }

  // [4] 无外部脚本 / 外部样式 / 远程资源
  const externalScript = html.match(/<script\b[^>]*\bsrc\s*=/gi);
  const externalLink = html.match(/<link\b[^>]*\brel\s*=\s*["']?stylesheet/gi);
  const cssImport = html.match(/@import\s+url/gi);
  const cssUrl = html.match(/url\(\s*["']?(?:https?:|\/\/)/gi);
  if (externalScript) fail('[4] 产物存在外部 <script src>：' + externalScript.length + ' 处');
  if (externalLink) fail('[4] 产物存在外部样式表 <link rel=stylesheet>：' + externalLink.length + ' 处');
  if (cssImport) fail('[4] 产物存在 @import url()：' + cssImport.length + ' 处');
  if (cssUrl) fail('[4] 产物存在远程 url()：' + cssUrl.length + ' 处');
  if (!externalScript && !externalLink && !cssImport && !cssUrl) {
    ok('[4] 无外部 <script src> / 外部样式表 / @import / 远程 url()');
  }

  // [5] script / style 标签成对，数量与槽位一致
  const scriptCount = SLOTS.filter(s => s.kind === 'script').length;
  const openTags = (html.match(/<script\b/gi) || []).length;
  const closeTags = (html.match(/<\/script\s*>/gi) || []).length;
  if (openTags !== closeTags || openTags !== scriptCount) {
    fail('[5] script 标签不配对：<script> ' + openTags + ' 个，</script> ' + closeTags + ' 个，期望各 ' + scriptCount + ' 个');
  } else {
    ok('[5] script 标签配对正确（<script> ' + openTags + ' / </script> ' + closeTags + '）');
  }

  const styleOpen = (html.match(/<style\b/gi) || []).length;
  const styleClose = (html.match(/<\/style\s*>/gi) || []).length;
  if (styleOpen !== styleClose) fail('[5] style 标签不配对：' + styleOpen + ' / ' + styleClose);
  else ok('[5] style 标签配对正确（' + styleOpen + ' / ' + styleClose + '）');

  // [6] 三个全局符号的挂载代码都在产物中
  const globals = [
    ['FarmCore', /root\.FarmCore|window\.FarmCore/],
    ['FarmRenderer', /root\.FarmRenderer|window\.FarmRenderer/],
    ['SAND_FARM', /window\.SAND_FARM/]
  ];
  let allGlobals = true;
  for (const pair of globals) {
    if (!pair[1].test(html)) { allGlobals = false; fail('[6] 产物中没有 ' + pair[0] + ' 的挂载代码'); }
  }
  if (allGlobals) ok('[6] FarmCore / FarmRenderer / SAND_FARM 均在产物中');

  // [7] 四个源文件内容逐字内联（取首行做探针，防止被转义或截断）
  let allInline = true;
  for (const slot of SLOTS) {
    const probe = sources.get(slot.label).trim().split('\n')[0];
    if (!html.includes(probe)) { allInline = false; fail('[7] ' + slot.source + ' 的内联内容疑似被修改（首行未逐字出现）'); }
  }
  if (allInline) ok('[7] 四个源文件内容均逐字内联');

  // [8] Farm-only entry and embedded artwork.
  if (html.includes('legacy/') || html.includes('SAND_GARDEN') || html.includes('class Garden')) fail('[8] 产物仍包含旧沙盒');
  else if (!html.includes('data:image/webp;base64,')) fail('[8] 封面未内嵌');
  else ok('[8] 纯农场版，封面已内嵌，无旧沙盒');

  // [9] .nojekyll 保留
  if (!existsSync(resolve(ROOT, '.nojekyll'))) fail('[9] 仓库根缺少 .nojekyll');
  else ok('[9] .nojekyll 存在');

  // [10] doctype / charset / title 基本完整性
  if (!/^<!doctype html>/i.test(html)) fail('[10] 产物缺少 <!doctype html>');
  else if (!/<meta\s+charset="utf-8">/i.test(html)) fail('[10] 产物缺少 <meta charset="utf-8">');
  else if (!/<title>[^<]+<\/title>/i.test(html)) fail('[10] 产物缺少 <title>');
  else ok('[10] doctype / charset / title 完整');

  return problems.length === 0;
}

// ---------------------------------------------------------------- 主流程

function main() {
  const checkOnly = process.argv.includes('--check');

  let html, sources;
  try {
    const built = build();
    html = built.html;
    sources = built.sources;
  } catch (err) {
    console.error('构建失败：' + err.message);
    process.exit(1);
  }

  if (!checkOnly) {
    for (const name of OUTPUTS) {
      const abs = resolve(ROOT, name);
      const prev = existsSync(abs) ? readFileSync(abs) : null;
      writeFileSync(abs, html, 'utf8');
      const now = readFileSync(abs);
      const state = !prev ? '（新建）' : (prev.equals(now) ? '（内容未变化，幂等）' : '（已更新）');
      console.log('写入 ' + name + '：' + now.length + ' 字节 ' + state);
    }
    const a = readFileSync(resolve(ROOT, OUTPUTS[0]));
    const b = readFileSync(resolve(ROOT, OUTPUTS[1]));
    if (!a.equals(b)) {
      console.error('产物不一致：' + OUTPUTS[0] + ' 与 ' + OUTPUTS[1] + ' 字节不同');
      process.exit(1);
    }
    console.log('两份产物字节相同：' + a.length + ' 字节');
  } else {
    for (const name of OUTPUTS) {
      const abs = resolve(ROOT, name);
      if (!existsSync(abs)) { console.error('--check 失败：缺少产物 ' + name); process.exit(1); }
      if (readFileSync(abs, 'utf8') !== html) { console.error('--check 失败：' + name + ' 与当前 src 不一致，请重新构建'); process.exit(1); }
    }
    console.log('--check 通过：' + OUTPUTS.join(' 与 ') + ' 与 src 一致');
  }

  console.log('');
  console.log('自检：');
  const passed = selfCheck(html, sources);
  for (const line of notes) console.log(line);
  if (!passed) {
    console.error('');
    console.error('自检未通过：');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('');
  console.log('自检全部通过（' + notes.length + ' 项）。产物 ' + Buffer.byteLength(html, 'utf8') + ' 字节。');
}

main();
