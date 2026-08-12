/* Dataiku standard web app — JavaScript tab.
   Talks to backend.py. In DSS, getWebAppBackendUrl() builds the backend URL;
   standalone_app.py defines the same shim so this file is unchanged either way. */
(function () {
  "use strict";

  // Backend URL helper: DSS provides getWebAppBackendUrl; fall back to relative.
  var BK = (typeof getWebAppBackendUrl === "function")
    ? getWebAppBackendUrl
    : function (p) { return p; };

  var $ = function (id) { return document.getElementById(id); };
  var selected = [];        // {key, file}
  var lastJob = null;

  var el = {
    drop: $("afxDrop"), input: $("afxInput"),
    queueWrap: $("afxQueueWrap"), list: $("afxList"), count: $("afxCount"),
    convert: $("afxConvert"), clear: $("afxClear"),
    summary: $("afxSummary"), sumDone: $("afxSumDone"), sumFlip: $("afxSumFlip"),
    sumReview: $("afxSumReview"), sumFail: $("afxSumFail"), sumFailWrap: $("afxSumFailWrap"),
    downloadAll: $("afxDownloadAll"),
    health: $("afxHealth"), healthText: $("afxHealthText"),
  };

  // ---- health chip -------------------------------------------------------
  fetch(BK("/api/health"))
    .then(function (r) { return r.json(); })
    .then(function (h) {
      el.health.classList.add("ok");
      var g = h.glossary || {};
      el.healthText.textContent = (g.entries || "?") + " terms · " +
        (g.arabic_variants || "?") + " variants";
    })
    .catch(function () {
      el.health.classList.add("bad");
      el.healthText.textContent = "backend offline";
    });

  // ---- file selection ----------------------------------------------------
  function keyOf(f) { return f.name + "|" + f.size; }
  function extOf(name) { var m = /\.([^.]+)$/.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
  var ALLOWED = ["xlsx", "xlsm", "xls", "csv", "xltx"];

  function addFiles(fileList) {
    Array.prototype.forEach.call(fileList, function (f) {
      if (ALLOWED.indexOf(extOf(f.name)) === -1) return;
      var k = keyOf(f);
      if (selected.some(function (s) { return s.key === k; })) return;
      selected.push({ key: k, file: f });
    });
    render();
  }

  function removeKey(k) {
    selected = selected.filter(function (s) { return s.key !== k; });
    render();
  }

  function humanSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function render() {
    el.count.textContent = selected.length;
    el.queueWrap.hidden = selected.length === 0;
    el.list.innerHTML = "";
    selected.forEach(function (s) {
      var ext = extOf(s.file.name);
      var li = document.createElement("li");
      li.className = "afx-row " + ext;
      li.dataset.key = s.key;
      li.innerHTML =
        '<div class="afx-row-icon">' + (ext.toUpperCase().slice(0, 4)) + '</div>' +
        '<div class="afx-row-body">' +
          '<div class="afx-row-name" title="' + esc(s.file.name) + '">' + esc(s.file.name) + '</div>' +
          '<div class="afx-row-meta">' +
            '<span>' + humanSize(s.file.size) + '</span>' +
            '<span class="afx-status queued" data-role="status">queued</span>' +
          '</div>' +
        '</div>' +
        '<div class="afx-row-actions" data-role="actions">' +
          '<button class="afx-icon-btn" title="Remove" data-remove="' + s.key + '">✕</button>' +
        '</div>';
      el.list.appendChild(li);
    });
    el.summary.hidden = true;
    el.downloadAll.hidden = true;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- convert -----------------------------------------------------------
  function setRowProcessing() {
    Array.prototype.forEach.call(el.list.querySelectorAll(".afx-row"), function (li) {
      var st = li.querySelector('[data-role="status"]');
      st.className = "afx-status processing";
      st.innerHTML = '<span class="afx-spin"></span> processing…';
    });
  }

  function applyResults(job) {
    lastJob = job.job_id;
    var byName = {};
    (job.results || []).forEach(function (r) { byName[r.name] = r; });

    Array.prototype.forEach.call(el.list.querySelectorAll(".afx-row"), function (li) {
      var name = li.querySelector(".afx-row-name").getAttribute("title");
      var r = byName[name];
      var meta = li.querySelector(".afx-row-meta");
      var actions = li.querySelector('[data-role="actions"]');
      if (!r) return;

      if (r.status === "done") {
        var badges = '<span class="afx-status done">✓ done</span>' +
          '<span class="afx-badge">' + r.sheets + ' sheet' + (r.sheets === 1 ? '' : 's') + '</span>' +
          (r.flipped ? '<span class="afx-badge flip">↔ ' + r.flipped + ' RTL flipped</span>' : '') +
          (r.review ? '<span class="afx-badge review">⚑ ' + r.review + ' to review</span>'
                    : '<span class="afx-badge clean">✓ all matched</span>');
        meta.innerHTML = '<span>' + humanSize(sizeFor(name)) + '</span>' + badges;
        if (r.sample_terms && r.sample_terms.length) {
          var terms = document.createElement("div");
          terms.className = "afx-terms";
          terms.innerHTML = "Add to glossary: " +
            r.sample_terms.slice(0, 5).map(function (t) { return "<code>" + esc(t) + "</code>"; }).join(" ");
          li.querySelector(".afx-row-body").appendChild(terms);
        }
        actions.innerHTML =
          '<a class="afx-dl" href="' + BK("/api/download/" + job.job_id + "/" + r.fid) +
          '" download>⤓ Download</a>';
      } else {
        meta.innerHTML = '<span class="afx-status error">✕ ' + esc(r.message || "failed") + '</span>';
        actions.innerHTML = "";
      }
    });

    el.sumDone.textContent = job.succeeded;
    el.sumFlip.textContent = (job.results || []).reduce(function (a, r) { return a + (r.flipped || 0); }, 0);
    el.sumReview.textContent = job.total_review;
    el.sumFail.textContent = job.failed;
    el.sumFailWrap.hidden = !job.failed;
    el.summary.hidden = false;
    el.downloadAll.hidden = job.succeeded === 0;
    el.convert.disabled = false;
    el.convert.querySelector(".afx-btn-label").textContent = "Convert all";
  }

  function sizeFor(name) {
    var s = selected.find(function (x) { return x.file.name === name; });
    return s ? s.file.size : 0;
  }

  function convertAll() {
    if (!selected.length) return;
    el.convert.disabled = true;
    el.convert.querySelector(".afx-btn-label").textContent = "Converting…";
    setRowProcessing();

    var fd = new FormData();
    selected.forEach(function (s) { fd.append("files", s.file, s.file.name); });

    fetch(BK("/api/convert"), { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (job) {
        if (job.error) throw new Error(job.error);
        applyResults(job);
      })
      .catch(function (e) {
        Array.prototype.forEach.call(el.list.querySelectorAll('[data-role="status"]'), function (st) {
          st.className = "afx-status error";
          st.textContent = "✕ " + (e.message || "request failed");
        });
        el.convert.disabled = false;
        el.convert.querySelector(".afx-btn-label").textContent = "Convert all";
      });
  }

  // ---- wiring ------------------------------------------------------------
  el.drop.addEventListener("click", function () { el.input.click(); });
  el.drop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.input.click(); }
  });
  el.input.addEventListener("change", function (e) { addFiles(e.target.files); el.input.value = ""; });

  ["dragenter", "dragover"].forEach(function (ev) {
    el.drop.addEventListener(ev, function (e) { e.preventDefault(); el.drop.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    el.drop.addEventListener(ev, function (e) { e.preventDefault(); el.drop.classList.remove("drag"); });
  });
  el.drop.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  el.list.addEventListener("click", function (e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-remove");
    if (k) removeKey(k);
  });
  el.clear.addEventListener("click", function () { selected = []; render(); });
  el.convert.addEventListener("click", convertAll);
  el.downloadAll.addEventListener("click", function () {
    if (lastJob) window.location = BK("/api/download_all/" + lastJob);
  });
})();
