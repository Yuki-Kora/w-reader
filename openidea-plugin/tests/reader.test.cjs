const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { TextDecoder, TextEncoder } = require('node:util');

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    textContent: '', hidden: false, disabled: false, scrollTop: 0,
    children: [], setAttribute(name, value) { this[name] = value; }, appendChild(child) { this.children.push(child); },
    addEventListener(type, callback) { this[type] = callback; },
    focus() {},
  });
  return elements.get(id);
}
const document = {
  getElementById: element,
  createElement() { return { addEventListener(type, callback) { this[type] = callback; }, setAttribute(name, value) { this[name] = value; } }; },
  documentElement: { style: { setProperty() {} } },
  addEventListener() {},
};
const text = '甲'.repeat(1099) + '😀' + '乙'.repeat(100);
const window = {
  clearTimeout() {}, setTimeout() {},
  openidea: { openFile: async () => ({ name: 'sample.txt', data: new TextEncoder().encode(text) }) },
};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../web/reader.js'), 'utf8'), {
  document, window, TextDecoder, Uint8Array,
});

async function test() {
  element('open-file').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('file-name').textContent, 'sample.txt');
  const first = element('page-text').textContent;
  assert.equal(element('page-total').textContent, '2');
  element('next-page').click();
  const second = element('page-text').textContent;
  assert.equal(first + second, text);
  assert.ok(!/[\uD800-\uDBFF]$/.test(first));
  assert.ok(!/^[\uDC00-\uDFFF]/.test(second));
  element('prev-page').click();
  assert.equal(element('page-text').textContent, first);
  window.readEpub = async () => ({ text: 'EPUB 正文', chapters: [{ title: '开篇', offset: 0 }] });
  window.openidea.openFile = async () => ({ name: 'book.epub', data: new Uint8Array([1, 2]) });
  element('open-file').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('file-name').textContent, 'book.epub');
  assert.equal(element('file-kind').textContent, 'EPUB');
  assert.equal(element('page-text').textContent, 'EPUB 正文');
  assert.equal(element('toc-list').children[0].textContent, '开篇');
  element('toc-list').children[0].click();
  assert.equal(element('page-current').textContent, '1');
  const html = fs.readFileSync(require('node:path').join(__dirname, '../web/index.html'), 'utf8');
  const css = fs.readFileSync(require('node:path').join(__dirname, '../web/reader.css'), 'utf8');
  assert.match(html, /id="toc-panel"/);
  assert.doesNotMatch(css, /\.toc nav\s*\{[^}]*\b(?:overflow|max-height)\s*:/);
  assert.doesNotMatch(css, /\.page-text\s*\{[^}]*\b(?:overflow\s*:|max-height\s*:)/);
  const chapterText = '引子\n前文\n第1章 开始\n章节内容\n\nChapter 2 End\n后续';
  window.openidea.openFile = async () => ({ name: 'chapters.txt', data: new TextEncoder().encode(chapterText) });
  element('open-file').click();
  await new Promise(resolve => setImmediate(resolve));
  // The minimal DOM stub does not clear childNodes when textContent is assigned.
  element('toc-list').children.splice(0, 1);
  assert.equal(element('toc-list').children.length, 2);
  assert.equal(element('toc-list').children[0].textContent, '第1章 开始');
  element('toc-list').children[1].click();
  assert.ok(element('page-text').textContent.startsWith('Chapter 2 End'));
  assert.equal(element('toc-list').children[1]['aria-current'], 'true');
  console.log('reader tests passed');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
