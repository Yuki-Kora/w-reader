const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const storage = {};
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://w-reader.test/' });
const { window } = dom;
window.Range.prototype.getBoundingClientRect = () => ({ top: 12, bottom: 20, width: 1, height: 8 });
window.parent = { postMessage(message) {
  queueMicrotask(() => {
    let value = null;
    if (message.op === 'memory.get') value = storage[message.args.slot] || null;
    if (message.op === 'memory.set') storage[message.args.slot] = message.args.value;
    window.dispatchEvent(new window.MessageEvent('message', { source: window.parent, data: { tag: 'openidea-view', reply: message.call, value } }));
  });
} };
window.scrollBy = () => {};
window.scrollTo = () => {};
window.openidea = { openFile: async () => ({ name: 'chapters.txt', data: new TextEncoder().encode('前言\n第1章 开始\n' + '正文'.repeat(700) + '\n第2章 继续\n结尾') }) };
window.eval(fs.readFileSync(path.join(__dirname, '../web/reader.js'), 'utf8'));
const $ = id => window.document.getElementById(id);
const click = id => $(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const wait = () => new Promise(resolve => setTimeout(resolve, 20));

(async () => {
  const text = $('page-text');
  let scrollOffset = 4;
  text.getBoundingClientRect = () => ({ top: -10, bottom: 100, left: 10, width: 300, height: 110 });
  window.document.caretPositionFromPoint = () => ({ offsetNode: text.firstChild, offset: scrollOffset });
  click('open-file'); await wait();
  assert.equal($('file-name').textContent, 'chapters.txt');
  assert.equal($('toc-list').children.length, 2, '真实 HTML 中章节列表已生成');
  click('show-toc');
  assert.equal($('toc-view').hidden, false);
  $('toc-list').children[1].click();
  assert.equal($('reading-view').hidden, false, '章节点击后回到阅读页');
  assert.ok($('page-text').textContent.includes('第2章 继续'));
  let scrolledChapter = null;
  Array.from($('toc-list').children).forEach(button => { button.scrollIntoView = options => { scrolledChapter = { button, options }; }; });
  click('show-toc');
  assert.equal(scrolledChapter.button, $('toc-list').children[1], '打开目录时定位到当前章节');
  assert.equal(scrolledChapter.options.block, 'center');
  assert.equal(scrolledChapter.button.getAttribute('aria-current'), 'true');
  $('toc-view').querySelector('.view-back').click();
  assert.ok($('page-text').textContent.includes('第2章 继续'), '返回阅读页保留章节');

  // 模拟阅读位置测量，并验证离开阅读区后的滚动不能覆盖该位置。
  text.getBoundingClientRect = () => ({ top: -10, bottom: 100, left: 10, width: 300, height: 110 });
  window.document.caretPositionFromPoint = () => ({ offsetNode: text.firstChild, offset: scrollOffset });
  window.dispatchEvent(new window.Event('scroll')); await wait();
  const saved = JSON.parse(storage.state);
  const bookId = saved.currentId;
  assert.equal(saved.positions[bookId].offset, scrollOffset);
  click('show-library');
  assert.equal($('library-view').hidden, false);
  scrollOffset = 0;
  window.dispatchEvent(new window.Event('scroll')); await wait();
  assert.equal(JSON.parse(storage.state).positions[bookId].offset, 4, '书架视图不得覆盖阅读位置');
  $('library-list').querySelector('button').click(); await wait();
  assert.equal($('reading-view').hidden, false);
  assert.equal($('file-name').textContent, 'chapters.txt');
  assert.equal($('library-delete').textContent, '删除当前书籍');
  click('show-library'); click('library-delete'); await wait();
  assert.equal(JSON.parse(storage.content).length, 0, '删除当前书籍会从书架移除');
  dom.window.close();
  console.log('ui integration tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; dom.window.close(); });
