const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { TextDecoder, TextEncoder } = require('node:util');
const script = fs.readFileSync(require('node:path').join(__dirname, '../web/reader.js'), 'utf8');
const storage = {};
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

function start() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const e = { hidden: false, children: [], open: false, value: '', disabled: false,
        setAttribute(name, value) { this[name] = value; },
        appendChild(child) { this.children.push(child); if (!this.value) this.value = child.value; },
        addEventListener(type, fn) { this[type] = fn; }, focus() {} };
      Object.defineProperty(e, 'textContent', { get() { return this.text || ''; }, set(value) { this.text = value; this.children = []; } });
      elements.set(id, e);
    }
    return elements.get(id);
  }
  const handlers = {};
  let visibleOffset = 0, restoredOffset = null, emptyRects = 0, scrollCalls = 0;
  const pageNode = { length: 1000 };
  element('page-text').firstChild = pageNode;
  element('page-text').getBoundingClientRect = () => ({ top: -100, bottom: 300, left: 10 });
  const documentHandlers = {};
  const document = { getElementById: element, createElement() { return element(Symbol()); },
    caretPositionFromPoint() { return { offsetNode: pageNode, offset: visibleOffset }; },
    createRange() { return { setStart(node, offset) { restoredOffset = offset; }, collapse() {}, getBoundingClientRect() { if (emptyRects > 0) { emptyRects--; return { top: 0, bottom: 0, width: 0, height: 0 }; } return { top: 20, bottom: 40, width: 0, height: 20 }; } }; },
    documentElement: { style: { setProperty() {} } }, addEventListener(type, fn) { documentHandlers[type] = fn; } };
  const parent = { postMessage(message) {
    queueMicrotask(() => {
      let value = null;
      if (message.op === 'memory.get') value = storage[message.args.slot] || null;
      if (message.op === 'memory.set') storage[message.args.slot] = message.args.value;
      handlers.message({ source: parent, data: { tag: 'openidea-view', reply: message.call, value } });
    });
  } };
  const window = { parent, innerHeight: 600, innerWidth: 400, addEventListener(type, fn) { handlers[type] = fn; }, clearTimeout, setTimeout,
    requestAnimationFrame(fn) { return setTimeout(fn, 0); }, cancelAnimationFrame: clearTimeout, scrollBy() { scrollCalls++; }, scrollTo() {},
    openidea: { openFile: async () => null } };
  vm.runInNewContext(script, { window, document, TextDecoder, Uint8Array, Map, Promise });
  return { element, window, delayLayout(frames) { emptyRects = frames; }, getScrollCalls() { return scrollCalls; }, hostVisible(value) { handlers.message({ source: parent, data: { tag: 'openidea-view', viewVisible: value } }); }, exportLog() { documentHandlers.keydown({ key: 'D', ctrlKey: true, shiftKey: true, preventDefault() {} }); }, useLegacyCaret() { delete document.caretPositionFromPoint; document.caretRangeFromPoint = () => ({ startContainer: pageNode, startOffset: visibleOffset }); }, scrollToOffset(offset) { visibleOffset = offset; handlers.scroll(); }, resize(width, height) { window.innerWidth = width; window.innerHeight = height; handlers.resize(); }, getRestoredOffset() { return restoredOffset; } };
}

async function run() {
  let app = start(); await settle();
  const a = '第1章 开始\n' + '甲'.repeat(1200) + '\n第2章 结束\n结尾';
  app.window.openidea.openFile = async () => ({ name: 'a.txt', data: new TextEncoder().encode(a) });
  app.element('open-file').click(); await settle();
  app.element('toc-list').children[1].click();
  app.scrollToOffset(7);
  app.resize(0, 0);
  app.scrollToOffset(0); // Hidden frames may report a scroll reset.
  app.resize(400, 600); await settle();
  assert.equal(app.getRestoredOffset(), 7);
  app.useLegacyCaret();
  app.scrollToOffset(8);
  app.hostVisible(false);
  app.scrollToOffset(0); // Chromium may reset scrolling without resizing the frame.
  app.delayLayout(3);
  const beforeRestore = app.getScrollCalls();
  app.hostVisible(true); await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(app.getRestoredOffset(), 8);
  assert.equal(app.getScrollCalls(), beforeRestore + 1);
  app.element('toc-panel').open = true; app.element('toc-panel').toggle(); await settle();
  app.window.openidea.openFile = async () => ({ name: 'b.txt', data: new TextEncoder().encode('另一本') });
  app.element('open-file').click(); await settle();
  assert.equal(JSON.parse(storage.content).length, 2);
  app = start(); await settle();
  assert.equal(app.element('file-name').textContent, 'b.txt');
  const aId = app.element('library-books').children[0].value;
  app.element('library-books').value = aId; app.element('library-open').click(); await settle();
  assert.equal(app.element('file-name').textContent, 'a.txt');
  assert.ok(app.element('page-text').textContent.startsWith('第2章'));
  assert.equal(app.getRestoredOffset(), 8);
  assert.equal(app.element('toc-panel').open, true);
  app.element('library-delete').click(); await settle();
  assert.equal(JSON.parse(storage.content).length, 1);
  app = start(); await settle();
  assert.equal(app.element('library-books').children.length, 1);
  console.log('memory tests passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
