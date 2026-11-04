(function () {
  "use strict";
  var limit = 64 * 1024 * 1024;
  function fail() { throw new Error("无法解析此 EPUB，文件可能损坏、受保护或使用了不支持的压缩格式。"); }
  function xml(text) {
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) fail();
    return doc;
  }
  function resolve(base, path) {
    path = path.split("#")[0].split("?")[0];
    try { path = decodeURIComponent(path); } catch (_) { fail(); }
    if (/^(?:[a-z]+:|\/)/i.test(path)) fail();
    var parts = base ? base.split("/") : [];
    path.split("/").forEach(function (part) {
      if (part === "..") { if (!parts.length) fail(); parts.pop(); }
      else if (part && part !== ".") parts.push(part);
    });
    return parts.join("/");
  }
  async function readEpub(bytes) {
    if (bytes.length > limit || bytes.length < 22) fail();
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
    }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail();
    var count = view.getUint16(end + 10, true), offset = view.getUint32(end + 16, true);
    if (count > 10000) fail();
    var entries = new Map(), decoder = new TextDecoder("utf-8"), total = 0;
    for (i = 0; i < count; i++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail();
      var flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
      var compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
      var nameLen = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
      var local = view.getUint32(offset + 42, true), next = offset + 46 + nameLen + extra + comment;
      if (next > end || flags & 1 || size > limit || (total += size) > limit) fail();
      var name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      entries.set(name, { method: method, compressed: compressed, size: size, local: local });
      offset = next;
    }
    async function file(name) {
      var e = entries.get(name);
      if (!e || e.local + 30 > bytes.length || view.getUint32(e.local, true) !== 0x04034b50) fail();
      var start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
      if (start + e.compressed > bytes.length) fail();
      var data = bytes.slice(start, start + e.compressed);
      if (e.method === 8) {
        if (typeof DecompressionStream !== "function") fail();
        var reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
        var chunks = [], length = 0, part;
        while (!(part = await reader.read()).done) {
          length += part.value.length;
          if (length > e.size || length > limit) { await reader.cancel(); fail(); }
          chunks.push(part.value);
        }
        data = new Uint8Array(length);
        var position = 0;
        chunks.forEach(function (chunk) { data.set(chunk, position); position += chunk.length; });
      } else if (e.method !== 0) fail();
      if (data.length !== e.size) fail();
      return decoder.decode(data);
    }
    var container = xml(await file("META-INF/container.xml"));
    var root = container.getElementsByTagNameNS("*", "rootfile")[0];
    if (!root) fail();
    var packagePath = resolve("", root.getAttribute("full-path") || "");
    var pkg = xml(await file(packagePath)), base = packagePath.split("/").slice(0, -1).join("/");
    if (entries.has("META-INF/encryption.xml")) throw new Error("此 EPUB 包含加密内容，暂不支持。");
    var items = new Map();
    var toc = [];
    var navPath = "";
    var navItem = Array.from(pkg.getElementsByTagNameNS("*", "item")).find(function (item) { return /nav/.test(item.getAttribute("properties") || ""); });
    if (navItem) {
      try {
        navPath = resolve(base, navItem.getAttribute("href"));
        var navDoc = xml(await file(navPath));
        Array.from(navDoc.getElementsByTagNameNS("*", "a")).forEach(function (a) {
          var label = (a.textContent || "").trim();
          var target = (a.getAttribute("href") || "").split("#")[0];
          if (label && target) toc.push({ href: resolve(navPath.split("/").slice(0, -1).join("/"), target), title: label });
        });
      } catch (_) { toc = []; }
    }
    Array.from(pkg.getElementsByTagNameNS("*", "item")).forEach(function (item) {
      items.set(item.getAttribute("id"), item.getAttribute("href"));
    });
    var spine = pkg.getElementsByTagNameNS("*", "itemref"), chapters = [], chapterEntries = [], fullText = "";
    for (i = 0; i < spine.length; i++) {
      if (spine[i].getAttribute("linear") === "no") continue;
      var href = items.get(spine[i].getAttribute("idref"));
      if (!href) fail();
      var doc = new DOMParser().parseFromString(await file(resolve(base, href)), "text/html");
      doc.querySelectorAll("script, style, svg, nav").forEach(function (el) { el.remove(); });
      doc.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, br, li, blockquote, section").forEach(function (el) { el.appendChild(doc.createTextNode("\n")); });
      var text = (doc.body ? doc.body.textContent : "").replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n").trim();
      if (text) {
        var title = (doc.querySelector("h1,h2,h3,title") || {}).textContent || (doc.body && doc.body.textContent.split(/\n/)[0]);
        var chapterOffset = fullText.length + (fullText ? 2 : 0);
        var matched = toc.find(function (entry) { return entry.href === resolve(base, href); });
        chapterEntries.push({ title: (matched && matched.title) || (title && title.trim()) || ("第 " + (chapterEntries.length + 1) + " 章"), offset: chapterOffset });
        chapters.push(text);
        fullText += (fullText ? "\n\n" : "") + text;
      }
    }
    if (!chapters.length) fail();
    return { text: fullText, chapters: chapterEntries };
  }
  window.readEpub = readEpub;
}());
