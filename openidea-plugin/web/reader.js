(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var pageSize = 1100;
  var fontSize = 18;
  var pages = [];
  var chapters = [];
  var pageIndex = 0;
  var noticeTimer;
  var library = [];
  var currentId = null;
  var callId = -1;
  var pending = new Map();
  var writes = Promise.resolve();
  var restoring = true;
  var restoreFrame = 0;
  var scrollTimer;
  var viewWasHidden = false;
  var hostHidden = false;

  // The sandbox has an opaque origin. Storage is mediated by the IDE, never by
  // direct access to its localStorage or to arbitrary filesystem paths.
  if (window.addEventListener) window.addEventListener("message", function (event) {
    var message = event.data;
    if (event.source !== window.parent || !message || message.tag !== "openidea-view") return;
    if (typeof message.viewVisible === "boolean") {
      var wasHidden = hostHidden;
      hostHidden = !message.viewVisible;
      if (wasHidden && !hostHidden) {
        var book = library.find(function (item) { return item.id === currentId; });
        if (book) restorePosition(book);
      }
      return;
    }
    if (!pending.has(message.reply)) return;
    var call = pending.get(message.reply); pending.delete(message.reply);
    if (message.error) call.reject(new Error(String(message.error))); else call.resolve(message.value);
  });
  function memory(op, slot, value) {
    if (!window.parent || !window.addEventListener) return Promise.reject(new Error("存储不可用"));
    return new Promise(function (resolve, reject) {
      var id = callId--; pending.set(id, { resolve: resolve, reject: reject });
      window.parent.postMessage({ tag: "openidea-view", call: id, op: "memory." + op, args: { slot: slot, value: value } }, "*");
    });
  }
  function save(slot, value) {
    var snapshot = JSON.stringify(value);
    writes = writes.catch(function () {}).then(function () { return memory("set", slot, snapshot); });
    writes.catch(function () { showNotice("无法保存书架或阅读进度，请检查本地存储空间。"); });
    return writes;
  }
  function saveProgress() {
    if (restoring || !currentId) return;
    var positions = {};
    library.forEach(function (book) { positions[book.id] = { page: book.page || 0, offset: book.offset || 0, tocOpen: !!book.tocOpen }; });
    save("state", { currentId: currentId, positions: positions });
  }
  function refreshLibrary() {
    var select = $("library-books"); select.textContent = "";
    library.forEach(function (book) {
      var option = document.createElement("option"); option.value = book.id; option.textContent = book.name; select.appendChild(option);
    });
    $("library").hidden = library.length === 0;
    if (currentId) select.value = currentId;
  }
  function displayBook(book) {
    currentId = book.id;
    chapters = book.chapters;
    pages = splitPages(book.text, chapters);
    setChapters(chapters, book.epub);
    pageIndex = Math.max(0, Math.min(Number(book.page) || 0, pages.length - 1));
    $("toc-panel").open = !!book.tocOpen;
    $("file-name").textContent = book.name;
    $("file-kind").textContent = book.epub ? "EPUB" : "TXT";
    $("welcome").hidden = true; $("reading-view").hidden = false;
    refreshLibrary(); renderPage();
    restorePosition(book);
  }
  function bookId(name, text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return name + ":" + text.length + ":" + (hash >>> 0).toString(16);
  }
  var ready = Promise.all([memory("get", "content"), memory("get", "state")]).then(function (values) {
    var saved = values[0] ? JSON.parse(values[0]) : [];
    var state = values[1] ? JSON.parse(values[1]) : {};
    if (!Array.isArray(saved)) throw new Error("书架数据无效");
    library = saved.filter(function (b) { return b && typeof b.id === "string" && typeof b.name === "string" && typeof b.text === "string" && Array.isArray(b.chapters); });
    library.forEach(function (book) { var p = (state.positions || {})[book.id] || {}; book.page = p.page; book.offset = p.offset; book.tocOpen = p.tocOpen; });
    var last = library.find(function (book) { return book.id === state.currentId; });
    restoring = false;
    refreshLibrary(); if (last) displayBook(last);
  }).catch(function () { restoring = false; showNotice("书架存储不可用，本次阅读不会被保存。"); });

  function showNotice(message) {
    var notice = $("notice");
    notice.textContent = message;
    notice.hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(function () { notice.hidden = true; }, 4200);
  }

  function splitPages(text, entries) {
    var result = [];
    var boundaries = [0].concat((entries || []).map(function (entry) { return entry.offset; }).filter(function (offset) { return offset > 0 && offset < text.length; }), [text.length]);
    boundaries = boundaries.filter(function (offset, index) { return index === 0 || offset !== boundaries[index - 1]; });
    for (var segment = 0; segment < boundaries.length - 1; segment++) {
      var start = boundaries[segment], segmentEnd = boundaries[segment + 1];
      while (start < segmentEnd) {
      var end = Math.min(start + pageSize, segmentEnd);
      if (end < text.length) {
        var lineBreak = text.lastIndexOf("\n", end);
        if (lineBreak > start + pageSize * 0.55) end = lineBreak + 1;
        else {
          var sentenceBreak = Math.max(text.lastIndexOf("。", end), text.lastIndexOf("！", end), text.lastIndexOf("？", end), text.lastIndexOf(".", end));
          if (sentenceBreak > start + pageSize * 0.65) end = sentenceBreak + 1;
        }
        // Never split a UTF-16 surrogate pair across pages.
        if (end < text.length && end > start &&
            text.charCodeAt(end - 1) >= 0xD800 && text.charCodeAt(end - 1) <= 0xDBFF &&
            text.charCodeAt(end) >= 0xDC00 && text.charCodeAt(end) <= 0xDFFF) end--;
      }
      result.push(text.slice(start, end));
      start = end;
      }
    }
    return result.length ? result : ["（这是一份空白文本）"];
  }

  function renderPage() {
    $("page-text").textContent = pages[pageIndex] || "";
    $("page-current").textContent = String(pageIndex + 1);
    $("page-total").textContent = String(pages.length);
    $("prev-page").disabled = pageIndex <= 0;
    $("next-page").disabled = pageIndex >= pages.length - 1;
    $("footer-status").textContent = "正在阅读 · 第 " + (pageIndex + 1) + " 页，共 " + pages.length + " 页";
    Array.from($("toc-list").children).forEach(function (button, index) { button.setAttribute("aria-current", index === currentChapterIndex() ? "true" : "false"); });
    var book = library.find(function (item) { return item.id === currentId; });
    if (book) { book.page = pageIndex; saveProgress(); }
  }

  function showPage() {
    if (restoreFrame && window.cancelAnimationFrame) window.cancelAnimationFrame(restoreFrame);
    restoreFrame = 0;
    var book = library.find(function (item) { return item.id === currentId; });
    if (book) book.offset = 0;
    renderPage();
    if (typeof $("page-text").scrollIntoView === "function") $("page-text").scrollIntoView({ block: "start" });
  }

  // Store a character position rather than pixels: it remains meaningful when
  // the view width or font size changes and a line wraps differently.
  function rememberPosition() {
    if (restoring || restoreFrame || hostHidden || !currentId) return;
    if (typeof window.innerHeight === "number" && window.innerHeight === 0) return;
    var text = $("page-text"), node = text.firstChild;
    if (!node || !text.getBoundingClientRect) return;
    var rect = text.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    var book = library.find(function (item) { return item.id === currentId; });
    if (!book) return;
    var offset = 0;
    if (rect.top < 0 && rect.bottom > 0) {
      var x = Math.max(1, rect.left + 3);
      var caret = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, 1) : null;
      var range = !caret && document.caretRangeFromPoint ? document.caretRangeFromPoint(x, 1) : null;
      if (caret && caret.offsetNode === node) offset = caret.offset;
      else if (range && range.startContainer === node) offset = range.startOffset;
      else return;
    } else if (rect.bottom <= 0) offset = node.length;
    book.offset = Math.max(0, Math.min(offset, node.length));
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(saveProgress, 250);
  }

  function restorePosition(book) {
    if (!window.requestAnimationFrame || !document.createRange) return;
    if (restoreFrame && window.cancelAnimationFrame) window.cancelAnimationFrame(restoreFrame);
    var id = book.id, page = pageIndex, offset = Number(book.offset) || 0;
    if (offset <= 0) {
      restoreFrame = 0;
      if (window.scrollTo) window.scrollTo(0, 0);
      return;
    }
    var attempts = 0;
    function attemptRestore() {
      var node = $("page-text").firstChild;
      if (hostHidden || !node || currentId !== id || pageIndex !== page) { restoreFrame = 0; return; }
      var range = document.createRange();
      range.setStart(node, Math.max(0, Math.min(offset, node.length)));
      range.collapse(true);
      var rect = range.getBoundingClientRect();
      if (rect.top === 0 && rect.bottom === 0 && rect.width === 0 && rect.height === 0) {
        if (++attempts < 60) { restoreFrame = window.requestAnimationFrame(attemptRestore); return; }
        restoreFrame = 0;
        return;
      }
      window.scrollBy(0, rect.top);
      restoreFrame = 0;
    }
    restoreFrame = window.requestAnimationFrame(attemptRestore);
  }

  function currentChapterIndex() {
    var offset = 0, current = 0;
    for (var i = 0; i < pageIndex; i++) offset += pages[i].length;
    chapters.forEach(function (chapter, index) { if (chapter.offset <= offset) current = index; });
    return current;
  }

  function setChapters(entries, recognized) {
    chapters = entries || [];
    var list = $("toc-list"); list.textContent = "";
    $("toc-count").textContent = chapters.length ? chapters.length + " 章" : "";
    $("toc-empty").hidden = chapters.length > 0;
    $("toc-empty").textContent = recognized ? "未识别到章节标题，暂时无法跳转。" : "未识别到章节标题，TXT 可按“第X章”或“Chapter X”格式尝试。";
    chapters.forEach(function (chapter, index) {
      var button = document.createElement("button");
      button.type = "button"; button.className = "toc-item"; button.textContent = chapter.title;
      button.addEventListener("click", function () {
        var offset = chapter.offset, total = 0;
        pageIndex = pages.findIndex(function (page) { var found = total <= offset && offset < total + page.length; total += page.length; return found; });
        if (pageIndex < 0) pageIndex = 0;
        showPage();
      });
      list.appendChild(button);
    });
  }

  function detectTxtChapters(text) {
    var result = [], re = /^[ \t]*(第[零〇一二三四五六七八九十百千万\d]+[章节回卷部篇][^\r\n]{0,60}|Chapter[ \t]+\d+\b[^\r\n]{0,60})[ \t]*$/gim, match;
    while ((match = re.exec(text))) result.push({ title: match[1].trim(), offset: match.index });
    return result;
  }

  function openLocalFile() {
    if (!window.openidea || typeof window.openidea.openFile !== "function") {
      showNotice("本地文件打开功能需在 OpenIDEA 插件页面中使用。");
      return;
    }
    window.openidea.openFile({ filters: [{ name: "书籍", extensions: ["txt", "epub"] }] })
      .then(async function (file) {
        if (!file) return;
        await ready;
        var bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
        var text;
        var epub = /\.epub$/i.test(file.name || "");
        var epubChapters = [];
        if (epub) { var book = await window.readEpub(bytes); text = typeof book === "string" ? book : book.text; epubChapters = typeof book === "string" ? [] : book.chapters; }
        else {
          try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch (_error) {
            text = new TextDecoder("utf-8").decode(bytes);
            showNotice("文件不是有效的 UTF-8 文本，已尝试以 UTF-8 打开；部分字符可能显示异常。");
          }
        }
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        text = text.replace(/\r\n?/g, "\n");
        var name = file.name || "未命名.txt";
        var id = bookId(name, text);
        var entry = library.find(function (item) { return item.id === id && item.text === text; });
        if (!entry) {
          while (library.some(function (item) { return item.id === id; })) id += "_";
          entry = { id: id, name: name, text: text, chapters: epub ? epubChapters : detectTxtChapters(text), epub: epub, page: 0, tocOpen: false };
          library.push(entry);
          save("content", library);
        }
        displayBook(entry);
        $("page-text").focus();
      })
      .catch(function (error) { showNotice(error && error.message ? error.message : "无法打开文件，请重试。"); });
  }

  function setFontSize(next) {
    fontSize = Math.max(14, Math.min(30, next));
    document.documentElement.style.setProperty("--reader-size", fontSize + "px");
    $("font-size").textContent = String(fontSize);
  }

  $("open-file").addEventListener("click", openLocalFile);
  $("library-open").addEventListener("click", function () { var book = library.find(function (item) { return item.id === $("library-books").value; }); if (book) displayBook(book); });
  $("library-delete").addEventListener("click", function () {
    var id = $("library-books").value;
    library = library.filter(function (book) { return book.id !== id; });
    if (currentId === id) { currentId = null; $("welcome").hidden = false; $("reading-view").hidden = true; }
    refreshLibrary(); save("content", library);
    var positions = {}; library.forEach(function (book) { positions[book.id] = { page: book.page || 0, offset: book.offset || 0, tocOpen: !!book.tocOpen }; });
    save("state", { currentId: currentId, positions: positions });
  });
  $("toc-panel").addEventListener("toggle", function () { var book = library.find(function (item) { return item.id === currentId; }); if (book) { book.tocOpen = $("toc-panel").open; saveProgress(); } });
  $("welcome-open").addEventListener("click", openLocalFile);
  $("prev-page").addEventListener("click", function () { if (pageIndex > 0) { pageIndex -= 1; showPage(); } });
  $("next-page").addEventListener("click", function () { if (pageIndex < pages.length - 1) { pageIndex += 1; showPage(); } });
  $("font-smaller").addEventListener("click", function () { setFontSize(fontSize - 2); });
  $("font-larger").addEventListener("click", function () { setFontSize(fontSize + 2); });
  if (window.addEventListener) window.addEventListener("scroll", rememberPosition, { passive: true });
  if (window.addEventListener) window.addEventListener("resize", function () {
    if (window.innerHeight === 0 || window.innerWidth === 0) { viewWasHidden = true; return; }
    if (!viewWasHidden) return;
    viewWasHidden = false;
    var book = library.find(function (item) { return item.id === currentId; });
    if (book) restorePosition(book);
  });
  if (window.addEventListener) window.addEventListener("pagehide", saveProgress);
  document.addEventListener("keydown", function (event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" && pageIndex > 0) { pageIndex -= 1; showPage(); }
    if (event.key === "ArrowRight" && pageIndex < pages.length - 1) { pageIndex += 1; showPage(); }
  });
}());
