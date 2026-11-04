const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { JSDOM } = require('jsdom');

function zip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name), source = Buffer.from(text), compressed = zlib.deflateRawSync(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(source.length, 22); local.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(source.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, filename, compressed); central.push(directory, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, index, end]);
}
const files = {
  'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
  'OPS/book.opf': '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="a.xhtml"/><item id="b" href="chapters/b.xhtml"/><item id="nav" href="nav/toc.xhtml" properties="nav"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>',
  'OPS/nav/toc.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><a href="../chapters/b.xhtml#top">嵌套第一章</a><a href="../a.xhtml">嵌套第二章</a></nav></body></html>',
  'OPS/a.xhtml': '<html><body><p>第二章</p></body></html>',
  'OPS/chapters/b.xhtml': '<html><body><h1>第一章</h1><script>恶意内容</script><p>正文</p></body></html>',
};
const dom = new JSDOM('');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/epub.js'), 'utf8'), {
  window, DOMParser: dom.window.DOMParser, Uint8Array, DataView, TextDecoder, Map, Blob, DecompressionStream,
});
(async () => {
  const result = await window.readEpub(zip(files));
  assert.ok(result.text.indexOf('第一章') < result.text.indexOf('第二章'));
  assert.ok(result.text.includes('正文'));
  assert.ok(!result.text.includes('恶意内容'));
  assert.deepEqual(JSON.parse(JSON.stringify(result.chapters.map(c => c.title))), ['嵌套第一章', '嵌套第二章']);
  assert.equal(result.text.slice(result.chapters[1].offset, result.chapters[1].offset + 3), '第二章');
  await assert.rejects(window.readEpub(Buffer.from('bad')));
  await assert.rejects(window.readEpub(zip({ ...files, 'META-INF/encryption.xml': '<encryption/>' })), /加密/);
  console.log('epub tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
