/* 中药学题库 · 交互逻辑 */
(function () {
  "use strict";

  var DB = window.QB;
  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");
  if (!DB || !DB.questions || !DB.questions.length) {
    app.innerHTML = '<div class="empty"><div class="big">!</div><p>题库数据未能加载</p></div>';
    return;
  }

  var BY_ID = {};
  DB.questions.forEach(function (q) { BY_ID[q.id] = q; });
  var UNIT = {};
  DB.units.forEach(function (u) { UNIT[u.id] = u; });

  /* 扩展题型：名词解释 / 病例问答 / 多选题 / 问答题 */
  var EXTRA = window.QB_EXTRA || {};
  var SPECIAL = {
    term: { label: "名词解释", list: EXTRA.terms || null },
    case: { label: "病例问答", list: EXTRA.cases || null },
    multi: { label: "多选题", list: EXTRA.multi || null },
    essay: { label: "问答题", list: EXTRA.essay || null }
  };
  var SPECIAL_NO = { term: "释", case: "案", multi: "多", essay: "问" };
  var SPECIAL_DESC = {
    term: "总论概念 · 各论分类",
    case: "病例题改写成问答",
    multi: "同功效药物辨析",
    essay: "性味归经与功效"
  };

  /* ---------------- 药物小词典（教材数据，题库兜底） ----------------
     DB.drugs: { 药名: [功效串, 附加信息(性味归经 或 主治)] }
     DB.alias: { 别名: 规范名 } */
  var DRUGS = DB.drugs || {};
  var ALIAS = DB.alias || {};
  var TOKEN2 = {};   // 单个功效词 -> [药名]，用于反查「这句功效是哪味药的」
  Object.keys(DRUGS).forEach(function (name) {
    var eff = (DRUGS[name] || [])[0] || "";
    eff.split(/[，,]/).forEach(function (tok) {
      tok = tok.trim();
      if (tok.length < 2) return;
      (TOKEN2[tok] = TOKEN2[tok] || []).push(name);
    });
  });

  function flat(s) {
    return String(s == null ? "" : s).replace(/[\s。．.，,；;、]/g, "");
  }
  function clip(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
  function canon(name) {
    if (DRUGS[name]) return name;
    var c = ALIAS[name];
    return c && DRUGS[c] ? c : "";
  }
  function drugNote(label, key, limit) {
    var v = DRUGS[key] || [];
    return {
      eff: label + "：" + clip(v[0] || "", limit || 26),
      prop: v[1] || "",
      key: flat(v[0] || "")
    };
  }
  /* 选项是一句功效时，反查是哪味药的功效；只认功效词完全一致的，不做近似 */
  function reverseNote(text) {
    var tokens = String(text || "").split(/[，,、；;]/).map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length >= 2; });
    if (!tokens.length) return "";
    var cand = null;
    for (var i = 0; i < tokens.length; i++) {
      var list = TOKEN2[tokens[i]];
      if (!list) return "";
      cand = cand ? cand.filter(function (n) { return list.indexOf(n) >= 0; }) : list.slice();
      if (!cand.length) return "";
    }
    var want = tokens.slice().sort().join("|");
    cand = cand.filter(function (n) {
      var eff = (DRUGS[n] || [])[0] || "";
      return eff.split(/[，,]/).map(function (s) { return s.trim(); }).filter(Boolean).sort().join("|") === want;
    });
    if (!cand.length) return "";
    if (cand.length === 1) return "＝ " + cand[0] + " 的功效";
    if (cand.length <= 3) return "＝ " + cand.join("、") + " 的共同功效";
    return "＝ " + cand.slice(0, 2).join("、") + " 等 " + cand.length + " 味药共有的功效";
  }
  /* 选项注解：药名 -> 功效 + 性味归经；功效原句 -> 哪味药的功效；同题功效相同 -> 标「易混」 */
  function notesFor(q) {
    var notes = [];
    q.o.forEach(function (text) {
      var raw = String(text == null ? "" : text).trim();
      var one = canon(raw);
      if (one) { notes.push(drugNote(raw, one)); return; }
      // 药组：只标注认得的药，不因为缺一味就整条放弃
      var parts = raw.split(/[、，,/／]|和|与/).map(function (s) { return s.trim(); }).filter(Boolean);
      var known = parts.filter(function (p) { return canon(p); });
      if (parts.length > 1 && known.length) {
        var limit = known.length >= 3 ? 12 : (known.length === 2 ? 16 : 26);
        notes.push({
          eff: known.slice(0, 3).map(function (p) {
            return p + "：" + clip((DRUGS[canon(p)] || [""])[0] || "", limit);
          }).join("；"),
          prop: "", key: ""
        });
        return;
      }
      var rev = reverseNote(raw);
      notes.push(rev ? { eff: rev, prop: "", key: "" } : null);
    });
    // 易混：同一题里两个选项的功效完全一样
    for (var i = 0; i < notes.length; i++) {
      if (!notes[i] || !notes[i].key) continue;
      for (var j = 0; j < notes.length; j++) {
        if (i === j || !notes[j] || notes[j].key !== notes[i].key) continue;
        notes[i].eff += "（与" + String(q.o[j]).trim() + "易混）";
        break;
      }
    }
    return notes;
  }

  /* 把注解拼成两行：功效 + 性味归经 */
  function noteHtml(n) {
    if (!n || !n.eff) return "";
    return '<span class="opt-note"><span class="note-eff">' + esc(n.eff) + "</span>"
      + (n.prop ? '<span class="note-prop">' + esc(n.prop) + "</span>" : "") + "</span>";
  }
  function noteNode(n) {
    var wrap = document.createElement("span");
    wrap.className = "opt-note";
    var a = document.createElement("span");
    a.className = "note-eff";
    a.textContent = n.eff;
    wrap.appendChild(a);
    if (n.prop) {
      var b = document.createElement("span");
      b.className = "note-prop";
      b.textContent = n.prop;
      wrap.appendChild(b);
    }
    return wrap;
  }

  /* ---------------- 本地存储 ---------------- */
  var KEY = "zyx.qb.v1";
  var store = { wrong: {}, fav: {}, stat: { seen: 0, right: 0 }, unit: {}, theme: null };
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var s = JSON.parse(raw);
      store.wrong = s.wrong || {};
      store.fav = s.fav || {};
      store.stat = s.stat || { seen: 0, right: 0 };
      store.unit = s.unit || {};
      store.theme = s.theme || null;
    }
  } catch (e) { /* 隐私模式忽略 */ }

  /* 清理历史遗留的无效题目 id（如误存的「第 0 题」），避免计数虚高 */
  (function prune() {
    var dirty = false;
    ["wrong", "fav"].forEach(function (k) {
      Object.keys(store[k] || {}).forEach(function (id) {
        if (!BY_ID[id]) { delete store[k][id]; dirty = true; }
      });
    });
    if (dirty) { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }
  })();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
  }

  /* ---------------- 主题 ---------------- */
  function applyTheme() {
    var t = store.theme;
    if (!t) t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#14171a" : "#f4f1e8");
  }
  applyTheme();

  /* ---------------- 状态 ---------------- */
  var state = {
    view: "home",
    units: [],
    size: 20,
    shuffle: true,
    session: null,
    listType: null,
    search: "",
    detailId: null,
    special: null
  };

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove("on"); }, 1800);
  }

  /* 页面内确认弹层（替代 window.confirm：手机浏览器/微信 WebView 会屏蔽原生弹窗） */
  var dialogEl = null, dialogOk = null;
  function askConfirm(title, desc, onOk) {
    if (!dialogEl) {
      dialogEl = document.createElement("div");
      dialogEl.className = "mask";
      dialogEl.setAttribute("hidden", "");
      document.body.appendChild(dialogEl);
      dialogEl.addEventListener("click", function (e) {
        var b = e.target.closest("[data-dlg]");
        if (!b) {
          if (e.target === dialogEl) closeDialog(false);
          return;
        }
        closeDialog(b.getAttribute("data-dlg") === "ok");
      });
    }
    dialogOk = onOk;
    dialogEl.innerHTML = '<div class="dialog" role="dialog" aria-modal="true">'
      + "<h3>" + esc(title) + "</h3>"
      + (desc ? "<p>" + esc(desc) + "</p>" : "")
      + '<div class="dialog-actions">'
      + '<button class="btn" data-dlg="cancel">取消</button>'
      + '<button class="btn btn-primary" data-dlg="ok">确定</button>'
      + "</div></div>";
    dialogEl.removeAttribute("hidden");
  }
  function closeDialog(ok) {
    if (!dialogEl) return;
    dialogEl.setAttribute("hidden", "");
    dialogEl.innerHTML = "";
    var fn = dialogOk;
    dialogOk = null;
    if (ok && fn) fn();
  }
  function unitName(id) {
    if (id === 0) return "综合练习";
    return UNIT[id] ? "第" + cn(id) + "单元 · " + UNIT[id].name : "未分类";
  }
  function cn(n) {
    var d = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if (n <= 10) return n === 10 ? "十" : d[n];
    if (n < 20) return "十" + d[n % 10];
    if (n % 10 === 0) return d[(n / 10) | 0] + "十";
    return d[(n / 10) | 0] + "十" + d[n % 10];
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    var x = a.slice().sort(), y = b.slice().sort();
    return x.join() === y.join();
  }
  function choseText(q, letters) {
    return letters.map(function (L) {
      var i = L.charCodeAt(0) - 65;
      return L + ". " + (q.o[i] || "");
    }).join("；");
  }
  function timeText(ms) {
    var t = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(t / 60), s = t % 60;
    return (m ? m + " 分 " : "") + s + " 秒";
  }

  /* ---------------- 图标 ---------------- */
  var ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.8 6.2 20.8l1.1-6.4L2.6 9.8l6.5-.9z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.8 6.2 20.8l1.1-6.4L2.6 9.8l6.5-.9z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  /* ---------------- 视图：首页 ---------------- */
  function viewHome() {
    var all = DB.questions;
    var wrongN = Object.keys(store.wrong).length;
    var favN = Object.keys(store.fav).length;
    var seen = store.stat.seen, right = store.stat.right;
    var rate = pct(right, seen);

    var unitN = DB.units.filter(function (u) { return u.id; }).length;
    var html = "";
    html += topbar("home");
    html += '<section class="hero">'
      + '<div class="hero-kicker">逐题精练 · 自动判分</div>'
      + '<h1>中药学<em>题库</em></h1>'
      + '<p>' + DB.total + ' 道选择题（覆盖总论与各论 ' + unitN + ' 个单元），另有名词解释、病例问答、多选题与问答题。</p>'
      + '<div class="hero-stats">'
      + '<div class="stat"><b>' + DB.total + '</b><span>题目总数</span></div>'
      + '<div class="stat"><b>' + unitN + '</b><span>单元</span></div>'
      + '<div class="stat"><b>' + seen + '</b><span>累计作答</span></div>'
      + '<div class="stat"><b>' + (seen ? rate + '%' : "—") + '</b><span>正确率</span></div>'
      + '</div></section>';

    /* 练习设置 */
    html += '<div class="card card-pad fade">';
    html += '<div class="field"><div class="field-label"><span>练习范围</span><span class="val" id="scopeVal">' + (state.units.length ? state.units.length + " 个单元" : "全部单元") + "</span></div>";
    html += '<div class="chips" id="unitChips">';
    html += chip("-1", "全部", DB.total, state.units.length === 0);
    DB.units.forEach(function (u) {
      html += chip(String(u.id), u.name, u.count, state.units.indexOf(u.id) >= 0);
    });
    html += "</div></div>";

    html += '<div class="field"><div class="field-label"><span>题目数量</span></div>';
    html += '<div class="seg" id="sizeSeg">';
    [[10, "10 题"], [20, "20 题"], [50, "50 题"], [0, "全部"]].forEach(function (p) {
      html += '<button data-act="size" data-size="' + p[0] + '" aria-pressed="' + (state.size === p[0]) + '">' + p[1] + "</button>";
    });
    html += "</div></div>";

    html += '<div class="field"><div class="field-label"><span>出题顺序</span></div>';
    html += '<div class="seg">';
    html += '<button data-act="order" data-order="1" aria-pressed="' + state.shuffle + '">随机</button>';
    html += '<button data-act="order" data-order="0" aria-pressed="' + !state.shuffle + '">顺序</button>';
    html += "</div></div>";

    var pool = poolOf(state.units);
    var n = state.size ? Math.min(state.size, pool.length) : pool.length;
    html += '<button class="btn btn-primary" id="startBtn" data-act="start">开始练习 · ' + n + " 题</button>";
    html += "</div>";

    /* 快捷入口 */
    html += '<div class="tiles" style="margin-top:12px">';
    html += tile("错题本", String(wrongN), "wrong", "答错自动收录");
    html += tile("收藏夹", String(favN), "favList", "随时回看");
    html += tile("看进度", seen ? rate + "%" : "0%", "stat", "累计 " + seen + " 题");
    html += "</div>";

    /* 专项练习：名词解释 / 病例问答 / 多选题 / 问答题 */
    var hasSpecial = ["term", "case", "multi", "essay"].some(function (k) {
      return SPECIAL[k].list && SPECIAL[k].list.length;
    });
    if (hasSpecial) {
      html += '<div class="section-title"><h2>其他题型</h2><div class="line"></div><span class="hint">教材总论 + 题库改写</span></div>';
      html += '<div class="unit-grid">';
      ["term", "case", "multi", "essay"].forEach(function (k) {
        var s = SPECIAL[k];
        if (!s.list || !s.list.length) return;
        html += '<button class="unit" data-act="special" data-kind="' + k + '">'
          + '<span class="unit-no">' + SPECIAL_NO[k] + "</span>"
          + '<span class="unit-main">'
          + '<span class="unit-name">' + s.label + "</span>"
          + '<span class="unit-desc">' + SPECIAL_DESC[k] + "</span>"
          + "</span>"
          + '<span class="unit-cnt">' + s.list.length + " 题</span>"
          + "</button>";
      });
      html += "</div>";
    }

    /* 搜索 */
    html += '<div class="section-title"><h2>查题</h2><div class="line"></div><span class="hint">题干 / 选项 / 知识点</span></div>';
    html += '<div class="search">' + ICON.search + '<input id="searchInput" type="search" placeholder="输入关键词，如：麻黄、十九畏、归经" value="' + esc(state.search) + '" autocomplete="off"></div>';
    html += '<div class="card card-pad" id="hitsWrap"' + (state.search ? "" : ' style="display:none"') + '><div id="hits"></div></div>';

    /* 单元列表 */
    html += '<div class="section-title"><h2>按单元练习</h2><div class="line"></div><span class="hint">共 ' + unitN + ' 个单元</span></div>';
    html += '<div class="unit-grid">';
    DB.units.forEach(function (u) {
      var st = store.unit[u.id] || { seen: 0, right: 0 };
      var p = pct(st.seen, u.count);
      html += '<button class="unit" data-act="unit" data-unit="' + u.id + '">'
        + '<span class="unit-no">' + (u.id ? ("0" + u.id).slice(-2) : "综") + "</span>"
        + '<span class="unit-main">'
        + '<span class="unit-name">' + esc(u.name) + "</span>"
        + '<span class="unit-desc">' + esc(u.desc || "") + "</span>"
        + '<span class="unit-bar"><i style="width:' + (p ? Math.max(p, 4) : 0) + '%"></i></span>'
        + "</span>"
        + '<span class="unit-cnt">' + u.count + " 题</span>"
        + "</button>";
    });
    html += "</div>";

    html += '<div class="foot">'
      + "题库整理自《中药学》单元练习表，已合并去重，共 " + DB.total + " 题。选项注解用教材药物数据（功效/性味/归经）标注。"
      + "题目文字可能存在个别录入误差，以教材为准。<br>"
      + "进度保存在本机浏览器，换设备或清理缓存会丢失。<br>"
      + '<span style="opacity:.7">版本 v9 · 2026-11-12</span>'
      + "</div>";

    app.innerHTML = html;
    bindSearch();
    return;
  }

  function topbar(view) {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    var h = '<header class="topbar">';
    if (view === "home") {
      h += '<div class="brand"><div class="brand-mark">药</div><div class="brand-text">'
        + '<div class="brand-title">中药学题库</div>'
        + '<div class="brand-sub">TCM Question Bank</div></div></div>';
    } else {
      h += '<button class="icon-btn" data-act="home" aria-label="返回首页">' + ICON.back + "</button>"
        + '<div class="brand-text"><div class="brand-title">中药学题库</div></div>';
    }
    h += '<div class="spacer"></div>';
    h += '<button class="icon-btn" data-act="theme" aria-label="切换主题">' + (dark ? ICON.sun : ICON.moon) + "</button>";
    h += "</header>";
    return h;
  }

  function chip(val, label, n, on) {
    return '<button class="chip" data-act="chip" data-unit="' + val + '" aria-pressed="' + on + '">'
      + esc(label) + '<span class="n">' + n + "</span></button>";
  }
  function tile(label, big, act, sub) {
    return '<button class="tile" data-act="' + act + '"><b>' + esc(big) + "</b><span>" + esc(label) + "</span></button>";
  }

  /* ---------------- 搜索 ---------------- */
  function bindSearch() {
    var input = document.getElementById("searchInput");
    if (!input) return;
    var timer = null;
    input.addEventListener("input", function () {
      state.search = input.value.trim();
      clearTimeout(timer);
      timer = setTimeout(updateHits, 120);
    });
    if (state.search) updateHits();
  }
  function updateHits() {
    var wrap = document.getElementById("hitsWrap");
    var box = document.getElementById("hits");
    if (!wrap || !box) return;
    var kw = state.search;
    if (!kw) { wrap.style.display = "none"; box.innerHTML = ""; return; }
    wrap.style.display = "";
    var k = kw.toLowerCase();
    var hits = [];
    for (var i = 0; i < DB.questions.length && hits.length < 60; i++) {
      var q = DB.questions[i];
      var hay = q.q + " " + q.o.join(" ") + " " + (q.k || "");
      if (hay.toLowerCase().indexOf(k) >= 0) hits.push(q);
    }
    if (!hits.length) {
      box.innerHTML = '<div class="empty" style="padding:26px 10px"><p>没有找到「' + esc(kw) + '」</p></div>';
      return;
    }
    var h = '<div class="hit-meta" style="padding-bottom:8px">找到 ' + hits.length + (hits.length >= 60 ? "+" : "") + " 题</div>";
    hits.forEach(function (q) {
      h += '<button class="hit" data-act="detail" data-id="' + q.id + '">'
        + '<div class="hit-stem">' + esc(q.q) + "</div>"
        + '<div class="hit-meta">' + esc(unitName(q.u)) + (q.k && q.k !== (UNIT[q.u] || {}).name ? " · " + esc(q.k) : "") + "</div>"
        + "</button>";
    });
    box.innerHTML = h;
  }

  /* ---------------- 组卷 ---------------- */
  function poolOf(units) {
    if (!units.length) return DB.questions.slice();
    return DB.questions.filter(function (q) { return units.indexOf(q.u) >= 0; });
  }

  /* 局部刷新练习设置，避免整页重绘造成闪烁 */
  function syncSetup() {
    if (state.view !== "home") return;
    var chips = document.querySelectorAll("#unitChips .chip");
    for (var i = 0; i < chips.length; i++) {
      var v = Number(chips[i].getAttribute("data-unit"));
      var on = v === -1 ? state.units.length === 0 : state.units.indexOf(v) >= 0;
      chips[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var scope = document.getElementById("scopeVal");
    if (scope) scope.textContent = state.units.length ? state.units.length + " 个单元" : "全部单元";

    var sizes = document.querySelectorAll('[data-act="size"]');
    for (var j = 0; j < sizes.length; j++) {
      sizes[j].setAttribute("aria-pressed", Number(sizes[j].getAttribute("data-size")) === state.size ? "true" : "false");
    }
    var orders = document.querySelectorAll('[data-act="order"]');
    for (var m = 0; m < orders.length; m++) {
      var want = orders[m].getAttribute("data-order") === "1";
      orders[m].setAttribute("aria-pressed", want === state.shuffle ? "true" : "false");
    }

    var pool = poolOf(state.units);
    var n = state.size ? Math.min(state.size, pool.length) : pool.length;
    var btn = document.getElementById("startBtn");
    if (btn) {
      btn.textContent = "开始练习 · " + n + " 题";
      btn.disabled = n === 0;
    }
  }
  function startSession(ids, title) {
    if (!ids.length) { toast("没有可用题目"); return; }
    state.session = {
      ids: ids,
      i: 0,
      answers: {},
      pending: [],
      startedAt: Date.now(),
      title: title || "练习"
    };
    state.view = "quiz";
    render();
    window.scrollTo(0, 0);
  }
  function startFromSetup() {
    var pool = poolOf(state.units).map(function (q) { return q.id; });
    if (state.shuffle) pool = shuffle(pool);
    var ids = state.size ? pool.slice(0, state.size) : pool;
    startSession(ids, state.units.length === 1 ? unitName(state.units[0]) : "练习");
  }

  /* ---------------- 视图：答题 ---------------- */
  function quizMeta() {
    var s = state.session;
    var done = Object.keys(s.answers).length;
    var right = 0;
    for (var id in s.answers) {
      if (sameSet(s.answers[id], BY_ID[id].a)) right++;
    }
    return "第 <b>" + (s.i + 1) + "</b> / " + s.ids.length + " 题" + (done ? " · 已对 " + right : "");
  }

  function viewQuiz() {
    var s = state.session;
    if (!s) { state.view = "home"; return viewHome(); }
    if (s.i >= s.ids.length) return viewResult();
    var q = BY_ID[s.ids[s.i]];
    var answered = s.answers[q.id];
    var multi = q.a.length > 1 || q.t === "多选题";
    var isFav = !!store.fav[q.id];

    var h = "";
    h += '<div class="quiz">';
    h += '<div class="qtop">'
      + '<button class="icon-btn" data-act="quit" aria-label="退出练习">' + ICON.back + "</button>"
      + '<div class="qmeta" id="qmeta">' + quizMeta() + "</div>"
      + '<button class="icon-btn" data-act="fav" data-id="' + q.id + '" aria-label="收藏" style="' + (isFav ? "color:var(--gold);border-color:var(--gold)" : "") + '">' + (isFav ? ICON.starOn : ICON.star) + "</button>"
      + "</div>";
    h += '<div class="pbar"><i style="width:' + pct(s.i, s.ids.length) + '%"></i></div>';

    var isNewQ = state._qid !== q.id;
    state._qid = q.id;
    h += '<div class="card qcard' + (isNewQ ? " fade" : "") + '">';
    h += '<div class="qhead"><span class="badge unit">' + esc(unitName(q.u)) + "</span>"
      + (q.k && q.k !== (UNIT[q.u] || {}).name ? '<span class="badge">' + esc(q.k) + "</span>" : "")
      + '<span class="badge">' + esc(q.t) + "</span></div>";
    h += '<h2 class="stem">' + esc(q.q) + "</h2>";
    h += '<div class="options">';
    var notes = answered ? notesFor(q) : [];
    q.o.forEach(function (text, idx) {
      var L = String.fromCharCode(65 + idx);
      var st = "";
      if (answered) {
        if (q.a.indexOf(L) >= 0) st = "right";
        else if (answered.indexOf(L) >= 0) st = "wrong";
        else st = "dim";
      } else if (multi && s.pending.indexOf(L) >= 0) {
        st = "right";
      }
      var noteHtmlStr = noteHtml(notes[idx]);
      h += '<button class="opt" data-act="pick" data-letter="' + L + '" data-state="' + st + '"' + (answered ? " disabled" : "") + ">"
        + '<span class="opt-letter">' + L + "</span>"
        + '<span class="opt-body"><span class="opt-text">' + esc(text) + "</span>"
        + noteHtmlStr
        + "</span></button>";
    });
    h += "</div>";

    if (answered) {
      var ok = sameSet(answered, q.a);
      h += '<div class="feedback' + (ok ? "" : " bad") + '" id="fb">'
        + (ok ? '<b class="ok">回答正确</b>' : '<b class="no">回答错误</b>')
        + "　正确答案：<b>" + q.a.join("") + ". " + esc(q.o[q.a[0].charCodeAt(0) - 65]) + "</b>"
        + "</div>";
    } else if (multi) {
      h += '<div class="feedback" id="fb">多选题，选好后点「提交」</div>';
    } else {
      h += '<div class="feedback" id="fb" style="color:var(--muted)">点击选项作答</div>';
    }
    h += "</div>";

    h += '<div class="qfoot">';
    h += '<button class="btn" data-act="prev"' + (s.i === 0 ? " disabled" : "") + ">上一题</button>";
    if (!answered && multi) {
      h += '<button class="btn btn-primary" data-act="submit" id="qfootBtn">提交</button>';
    } else if (s.i >= s.ids.length - 1 && answered) {
      h += '<button class="btn btn-primary" data-act="finish" id="qfootBtn">查看结果</button>';
    } else {
      h += '<button class="btn btn-primary" data-act="next" id="qfootBtn">下一题</button>';
    }
    h += "</div>";
    h += "</div>";

    app.innerHTML = h;
  }

  /* 作答后就地更新，不重建 DOM（重建会造成一次白闪） */
  function paintAnswer(q, chosen) {
    var s = state.session;
    var ok = sameSet(chosen, q.a);
    var notes = notesFor(q);
    var opts = document.querySelectorAll(".options .opt");
    for (var i = 0; i < opts.length; i++) {
      var L = opts[i].getAttribute("data-letter");
      opts[i].setAttribute("data-state",
        q.a.indexOf(L) >= 0 ? "right" : (chosen.indexOf(L) >= 0 ? "wrong" : "dim"));
      opts[i].disabled = true;
      // 就地补上该选项对应的药物/功效注解
      var body = opts[i].querySelector(".opt-body");
      if (body) {
        var old = body.querySelector(".opt-note");
        if (old) old.parentNode.removeChild(old);
        var n = notes[i];
        if (n && n.eff) body.appendChild(noteNode(n));
      }
    }
    var fb = document.getElementById("fb");
    if (fb) {
      fb.className = "feedback" + (ok ? "" : " bad");
      fb.style.color = "";
      fb.innerHTML = (ok ? '<b class="ok">回答正确</b>' : '<b class="no">回答错误</b>')
        + "　正确答案：<b>" + q.a.join("") + ". " + esc(q.o[q.a[0].charCodeAt(0) - 65]) + "</b>";
    }
    var meta = document.getElementById("qmeta");
    if (meta) meta.innerHTML = quizMeta();
    var footBtn = document.getElementById("qfootBtn");
    if (footBtn) {
      if (s.i >= s.ids.length - 1) {
        footBtn.setAttribute("data-act", "finish");
        footBtn.textContent = "查看结果";
      } else {
        footBtn.setAttribute("data-act", "next");
        footBtn.textContent = "下一题";
      }
    }
  }

  /* 多选题勾选状态就地更新 */
  function paintPending() {
    var s = state.session;
    var opts = document.querySelectorAll(".options .opt");
    for (var i = 0; i < opts.length; i++) {
      var L = opts[i].getAttribute("data-letter");
      opts[i].setAttribute("data-state", s.pending.indexOf(L) >= 0 ? "right" : "");
    }
  }

  /* ---------------- 视图：结果 ---------------- */
  var lastResult = null;
  function viewResult() {
    var s = state.session;
    if (!s) { state.view = "home"; return viewHome(); }
    var total = s.ids.length;
    var doneN = Object.keys(s.answers).length;
    var rightN = 0, wrongList = [];
    s.ids.forEach(function (id) {
      var q = BY_ID[id];
      if (!s.answers[id]) return;
      if (sameSet(s.answers[id], q.a)) rightN++;
      else wrongList.push(id);
    });
    var rate = pct(rightN, doneN || total);
    var spent = Date.now() - s.startedAt;
    lastResult = { ids: s.ids, answers: s.answers };

    var h = topbar("result");
    h += '<section class="result">';
    h += '<div class="ring" style="--p:' + rate + '"><div class="ring-in"><b>' + rate + "</b><span>正确率</span></div></div>";
    h += "<h2>答对 " + rightN + " / " + (doneN || total) + " 题</h2>";
    h += '<p class="sub">用时 ' + timeText(spent) + "　·　错题已加入错题本</p>";

    h += '<div class="result-actions">';
    if (wrongList.length) {
      h += '<button class="btn btn-primary" data-act="redo" >重做错题 · ' + wrongList.length + " 题</button>";
      h += '<button class="btn" data-act="start">再练一组</button>';
    } else {
      h += '<button class="btn btn-primary" data-act="start">再练一组</button>';
    }
    h += '<button class="btn btn-ghost" data-act="home">回到首页</button>';
    h += "</div>";

    if (wrongList.length) {
      h += '<div class="review"><div class="section-title"><h2>错题回顾</h2><div class="line"></div></div>';
      wrongList.slice(0, 60).forEach(function (id) {
        var q = BY_ID[id];
        var chose = s.answers[id] || [];
        h += '<div class="review-item">'
          + '<div class="review-stem">' + esc(q.q) + "</div>"
          + '<div class="review-line bad"><b>你的答案</b><span>' + esc(choseText(q, chose)) + "</span></div>"
          + '<div class="review-line good"><b>正确答案</b><span>' + esc(choseText(q, q.a)) + "</span></div>"
          + '<div class="review-line"><b>所属</b><span style="color:var(--muted)">' + esc(unitName(q.u)) + "</span></div>"
          + "</div>";
      });
      if (wrongList.length > 60) {
        h += '<p class="sub" style="padding:10px 0">还有 ' + (wrongList.length - 60) + " 题未展开，可到错题本查看。</p>";
      }
      h += "</div>";
    }
    h += "</section>";
    app.innerHTML = h;
  }

  /* ---------------- 视图：列表（错题 / 收藏） ---------------- */
  function viewList(type) {
    state.listType = type;
    var isWrong = type === "wrong";
    var map = isWrong ? store.wrong : store.fav;
    var ids = Object.keys(map).map(Number);
    if (isWrong) ids.sort(function (a, b) { return (map[b] || 0) - (map[a] || 0); });

    var h = topbar("list");
    h += '<div class="list-head"><h1>' + (isWrong ? "错题本" : "收藏夹") + '</h1><span class="n">' + ids.length + " 题</span></div>";

    if (!ids.length) {
      h += '<div class="empty"><div class="big">' + (isWrong ? "✓" : "☆") + "</div><p>"
        + (isWrong ? "还没有错题，去练几组吧" : "还没有收藏题目") + "</p></div>";
    } else {
      h += '<div style="display:flex;gap:8px;margin-bottom:6px">'
        + '<button class="btn" style="flex:1" data-act="practiceList" data-type="' + type + '">开始练习</button>'
        + '<button class="btn" data-act="clearList" data-type="' + type + '">清空</button>'
        + "</div>";
      h += '<div class="list">';
      ids.forEach(function (id) {
        var q = BY_ID[id];
        if (!q) return;
        h += '<div class="list-item">'
          + '<button class="li-main" data-act="detail" data-id="' + id + '" style="text-align:left">'
          + '<div class="li-stem">' + esc(q.q) + "</div>"
          + '<div class="li-meta">' + esc(unitName(q.u))
          + (isWrong && map[id] > 1 ? " · 答错 " + map[id] + " 次" : "")
          + " · 正确答案 " + q.a.join("") + "</div>"
          + "</button>"
          + '<button class="li-x" data-act="unmark" data-type="' + type + '" data-id="' + id + '" aria-label="移除">' + ICON.x + "</button>"
          + "</div>";
      });
      h += "</div>";
    }
    h += '<div class="foot">' + (isWrong ? "答对后会自动从错题本移除。" : "收藏用于标记重点，随时回看。") + "</div>";
    app.innerHTML = h;
  }

  /* ---------------- 视图：单题详情 ---------------- */
  function viewDetail(id) {
    var q = BY_ID[id];
    if (!q) { state.view = "home"; return viewHome(); }
    var isFav = !!store.fav[id];
    var label = state.backTo === "list" ? (state.listType === "wrong" ? "错题本" : "收藏夹") : "题库";
    var h = '<div class="quiz detail">';
    h += '<div class="qtop"><button class="icon-btn" data-act="detailBack" aria-label="返回">' + ICON.back + "</button>"
      + '<div class="qmeta">单题查看 · ' + label + "</div>"
      + '<button class="icon-btn" data-act="fav" data-id="' + id + '" aria-label="收藏" style="' + (isFav ? "color:var(--gold);border-color:var(--gold)" : "") + '">' + (isFav ? ICON.starOn : ICON.star) + "</button></div>";
    h += '<div class="card qcard">'
      + '<div class="qhead"><span class="badge unit">' + esc(unitName(q.u)) + "</span>"
      + (q.k && q.k !== (UNIT[q.u] || {}).name ? '<span class="badge">' + esc(q.k) + "</span>" : "") + "</div>"
      + '<h2 class="stem">' + esc(q.q) + "</h2>"
      + '<div class="options">';
    var detailNotes = notesFor(q);
    q.o.forEach(function (text, idx) {
      var L = String.fromCharCode(65 + idx);
      var isAns = q.a.indexOf(L) >= 0;
      var noteHtmlStr = noteHtml(detailNotes[idx]);
      h += '<div class="opt" data-state="' + (isAns ? "right" : "dim") + '">'
        + '<span class="opt-letter">' + L + "</span>"
        + '<span class="opt-body"><span class="opt-text">' + esc(text) + "</span>"
        + noteHtmlStr
        + "</span></div>";
    });
    h += "</div>";
    h += '<div class="feedback">正确答案：<b>' + esc(choseText(q, q.a)) + "</b></div>";
    h += "</div>";
    h += '<div class="qfoot"><button class="btn" data-act="detailBack" style="flex:1">返回</button>'
      + '<button class="btn" data-act="practiceOne" data-id="' + id + '" style="flex:1">单独练这题</button></div>';
    h += "</div>";
    app.innerHTML = h;
  }

  /* ---------------- 视图：专项练习（名词解释 / 病例问答 / 多选题 / 问答题） ---------------- */
  function startSpecial(kind) {
    var s = SPECIAL[kind];
    if (!s || !s.list || !s.list.length) { toast("暂无可练习内容"); return; }
    state.special = { kind: kind, list: shuffle(s.list.slice()), i: 0, revealed: false, picked: [], done: 0, right: 0 };
    state.view = "special";
    render();
    window.scrollTo(0, 0);
  }

  function answerHtml(kind, item) {
    if (kind === "term") {
      return '<div class="answer-label">解释</div><div class="term-def">' + esc(item.d) + "</div>";
    }
    if (kind === "case") {
      return '<div class="answer-label">参考答案</div><div class="term-def"><b>' + esc(item.a) + "</b>"
        + (item.x ? '<span class="note-prop">' + esc(item.x) + "</span>" : "") + "</div>";
    }
    return '<div class="answer-label">参考答案</div><div class="term-def">' + esc(item.a) + "</div>";
  }

  function specialMeta(sp) {
    return '<div class="qmeta">' + SPECIAL[sp.kind].label + "　<b>" + (sp.i + 1) + "</b> / " + sp.list.length
      + (sp.kind === "multi" && sp.done ? " · 已对 " + sp.right : "") + "</div>";
  }

  function viewSpecial() {
    var sp = state.special;
    if (!sp) { state.view = "home"; return viewHome(); }
    if (sp.i >= sp.list.length) return viewSpecialDone();
    var item = sp.list[sp.i];

    var h = '<div class="quiz">';
    h += '<div class="qtop"><button class="icon-btn" data-act="specialHome" aria-label="返回">' + ICON.back + "</button>"
      + specialMeta(sp) + '<span style="width:38px"></span></div>';
    h += '<div class="pbar"><i style="width:' + pct(sp.i, sp.list.length) + '%"></i></div>';

    if (sp.kind === "multi") {
      h += '<div class="card qcard fade">';
      h += '<div class="qhead"><span class="badge unit">多选题</span><span class="badge">可多选</span></div>';
      h += '<h2 class="stem">' + esc(item.q) + "</h2>";
      h += '<div class="options">';
      item.o.forEach(function (text, idx) {
        var L = String.fromCharCode(65 + idx);
        var picked = sp.picked.indexOf(L) >= 0;
        h += '<button class="opt" data-act="mpick" data-letter="' + L + '" data-state="' + (picked ? "right" : "") + '">'
          + '<span class="opt-letter">' + L + "</span>"
          + '<span class="opt-body"><span class="opt-text">' + esc(text) + "</span></span></button>";
      });
      h += "</div>";
      h += '<div class="feedback" id="fb">' + (sp.revealed ? "" : "选出所有符合的药物后点「提交」") + "</div>";
      h += "</div>";
      h += '<div class="qfoot"><button class="btn" data-act="specialPrev"' + (sp.i === 0 ? " disabled" : "") + ">上一题</button>";
      h += '<button class="btn btn-primary" id="specialBtn" data-act="' + (sp.revealed ? "specialNext" : "msubmit") + '">'
        + (sp.revealed ? (sp.i >= sp.list.length - 1 ? "完成" : "下一题") : "提交") + "</button></div>";
      h += "</div>";
      app.innerHTML = h;
      return;
    }

    // 名词解释 / 病例问答 / 问答题：先想，再看答案
    h += '<div class="card qcard fade">';
    var badge = SPECIAL[sp.kind].label + (item.g ? " · " + item.g : "");
    h += '<div class="qhead"><span class="badge unit">' + esc(badge) + "</span></div>";
    if (sp.kind === "case") {
      h += '<div class="case-body">' + esc(item.q) + "</div>";
      h += '<div class="case-ask">问：' + esc(item.ask) + "</div>";
    } else {
      h += '<h2 class="stem">' + esc(sp.kind === "term" ? item.n : item.q) + "</h2>";
      if (sp.kind === "term") h += '<div class="term-hint">先在心里解释一遍，再点下面看答案</div>';
    }
    h += '<div class="special-answer" id="specialAnswer" hidden></div>';
    h += "</div>";
    h += '<div class="qfoot"><button class="btn" data-act="specialPrev"' + (sp.i === 0 ? " disabled" : "") + ">上一题</button>";
    h += '<button class="btn btn-primary" id="specialBtn" data-act="' + (sp.revealed ? "specialNext" : "specialReveal") + '">'
      + (sp.revealed ? (sp.i >= sp.list.length - 1 ? "完成" : "下一题") : "看答案") + "</button></div>";
    h += "</div>";
    app.innerHTML = h;
    if (sp.revealed) {
      var box = document.getElementById("specialAnswer");
      if (box) { box.innerHTML = answerHtml(sp.kind, item); box.removeAttribute("hidden"); }
    }
  }

  function viewSpecialDone() {
    var sp = state.special;
    var rate = pct(sp.right, sp.done);
    var h = topbar("result");
    h += '<section class="result">';
    h += '<div class="ring" style="--p:' + (sp.kind === "multi" ? rate : 100) + '"><div class="ring-in"><b>'
      + (sp.kind === "multi" ? rate : sp.list.length) + "</b><span>"
      + (sp.kind === "multi" ? "正确率" : "已完成") + "</span></div></div>";
    h += "<h2>" + SPECIAL[sp.kind].label + " 完成</h2>";
    h += '<p class="sub">' + (sp.kind === "multi" ? "答对 " + sp.right + " / " + sp.done + " 题" : "共 " + sp.list.length + " 题") + "</p>";
    h += '<div class="result-actions">';
    h += '<button class="btn btn-primary" data-act="specialRestart" data-kind="' + sp.kind + '">再来一遍</button>';
    h += '<button class="btn" data-act="specialHome">回到首页</button>';
    h += "</div></section>";
    app.innerHTML = h;
  }

  function revealSpecial() {
    var sp = state.special;
    if (!sp || sp.revealed) return;
    var item = sp.list[sp.i];
    var box = document.getElementById("specialAnswer");
    var btn = document.getElementById("specialBtn");
    if (!box || !btn) return;
    box.innerHTML = answerHtml(sp.kind, item);
    box.removeAttribute("hidden");
    var hint = document.querySelector(".term-hint");
    if (hint) hint.style.display = "none";
    sp.revealed = true;
    btn.setAttribute("data-act", "specialNext");
    btn.textContent = sp.i >= sp.list.length - 1 ? "完成" : "下一题";
  }

  function msubmit() {
    var sp = state.special;
    if (!sp || !sp.picked.length) { toast("请先选择选项"); return; }
    var item = sp.list[sp.i];
    var ok = sameSet(sp.picked, item.a);
    sp.done++;
    if (ok) sp.right++;
    var notes = notesFor({ o: item.o, q: item.q });
    var opts = document.querySelectorAll(".options .opt");
    for (var i = 0; i < opts.length; i++) {
      var L = opts[i].getAttribute("data-letter");
      opts[i].setAttribute("data-state",
        item.a.indexOf(L) >= 0 ? "right" : (sp.picked.indexOf(L) >= 0 ? "wrong" : "dim"));
      opts[i].disabled = true;
      var body = opts[i].querySelector(".opt-body");
      if (body && notes[i] && notes[i].eff) body.appendChild(noteNode(notes[i]));
    }
    var fb = document.getElementById("fb");
    if (fb) {
      fb.className = "feedback" + (ok ? "" : " bad");
      fb.innerHTML = (ok ? '<b class="ok">回答正确</b>' : '<b class="no">回答错误</b>')
        + "　正确答案：<b>" + item.a.join("") + "</b>";
    }
    sp.revealed = true;
    var btn = document.getElementById("specialBtn");
    if (btn) {
      btn.setAttribute("data-act", "specialNext");
      btn.textContent = sp.i >= sp.list.length - 1 ? "完成" : "下一题";
    }
    var meta = document.querySelector(".qmeta");
    if (meta) meta.innerHTML = specialMeta(sp).replace(/^<div class="qmeta">|<\/div>$/g, "");
  }

  function specialStep(d) {
    var sp = state.special;
    if (!sp) return;
    if (d > 0 && !sp.revealed) { revealSpecial(); return; }
    var n = sp.i + d;
    if (n < 0) return;
    if (n >= sp.list.length) { render(); window.scrollTo(0, 0); return; }
    sp.i = n;
    sp.revealed = false;
    sp.picked = [];
    render();
    window.scrollTo(0, 0);
  }

  /* ---------------- 渲染 ---------------- */
  function render(silent) {
    if (state.view === "home") viewHome();
    else if (state.view === "quiz") viewQuiz();
    else if (state.view === "result") viewResult();
    else if (state.view === "list") viewList(state.listType);
    else if (state.view === "detail") viewDetail(state.detailId);
    else if (state.view === "special") viewSpecial();
    if (!silent) syncHistory(state.view);
  }

  /* ---------------- 浏览器/系统返回键 ---------------- */
  // 维护一份「视图栈」，让页内返回与系统返回键行为一致，也不会产生重复历史条目
  var suppressSync = false;
  var vstack = ["home"];
  function syncHistory(view) {
    if (suppressSync) return;
    var top = vstack[vstack.length - 1];
    if (view === top) return;
    if (view === "result") {                       // 结果页替换当前条目，返回时直接回上一屏
      vstack[vstack.length - 1] = "result";
      try { history.replaceState({ v: "result" }, ""); } catch (e) {}
      return;
    }
    if (view === vstack[vstack.length - 2]) {      // 回到上一屏：退掉一条历史
      vstack.pop();
      try { history.back(); } catch (e) {}
      return;
    }
    vstack.push(view);
    try { history.pushState({ v: view }, ""); } catch (e) {}
  }
  window.addEventListener("popstate", function (e) {
    var v = (e.state && e.state.v) || "home";
    var i = vstack.indexOf(v);
    if (i > 0) vstack.length = i + 1;
    else { vstack = ["home"]; v = "home"; }
    suppressSync = true;
    if (v === "quiz" && state.session) state.view = "quiz";
    else if (v === "detail" && state.detailId) state.view = "detail";
    else if (v === "list" && state.listType) state.view = "list";
    else if (v === "special" && state.special) state.view = "special";
    else if (v === "result") state.view = "result";
    else { state.view = "home"; state.session = null; }
    render(true);
    suppressSync = false;
    window.scrollTo(0, 0);
  });
  try { history.replaceState({ v: "home" }, ""); } catch (e) {}

  /* ---------------- 事件 ---------------- */
  app.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el || !app.contains(el)) return;
    var act = el.getAttribute("data-act");

    if (act === "theme") {
      var cur = document.documentElement.getAttribute("data-theme");
      store.theme = cur === "dark" ? "light" : "dark";
      applyTheme(); save();
      el.innerHTML = store.theme === "dark" ? ICON.sun : ICON.moon;
      return;
    }
    if (act === "home") { state.view = "home"; state.session = null; render(); window.scrollTo(0, 0); return; }
    if (act === "back") { state.view = "home"; render(); return; }

    if (act === "chip") {
      var v = Number(el.getAttribute("data-unit"));
      if (v === -1) state.units = [];
      else {
        var i = state.units.indexOf(v);
        if (i >= 0) state.units.splice(i, 1);
        else state.units.push(v);
      }
      syncSetup();
      return;
    }
    if (act === "size") { state.size = Number(el.getAttribute("data-size")); syncSetup(); return; }
    if (act === "order") { state.shuffle = el.getAttribute("data-order") === "1"; syncSetup(); return; }
    if (act === "start") {
      if (state.view === "result") { state.units = []; state.size = 20; }
      startFromSetup(); return;
    }
    if (act === "unit") {
      var u = Number(el.getAttribute("data-unit"));
      var pool = poolOf([u]).map(function (q) { return q.id; });
      startSession(shuffle(pool), unitName(u)); return;
    }
    if (act === "wrong" || act === "favList") {
      state.view = "list";
      state.listType = act === "wrong" ? "wrong" : "fav";
      render(); window.scrollTo(0, 0); return;
    }
    if (act === "fav") {
      var fid = Number(el.getAttribute("data-id"));
      if (!fid || !BY_ID[fid]) return;
      var wasFav = !!store.fav[fid];
      if (wasFav) delete store.fav[fid]; else store.fav[fid] = 1;
      save();
      toast(wasFav ? "已取消收藏" : "已收藏");
      if (el.classList.contains("icon-btn")) {
        el.innerHTML = wasFav ? ICON.star : ICON.starOn;
        el.style.color = wasFav ? "" : "var(--gold)";
        el.style.borderColor = wasFav ? "" : "var(--gold)";
      } else {
        render();
      }
      return;
    }
    if (act === "stat") { toast("累计作答 " + store.stat.seen + " 题，正确 " + store.stat.right + " 题"); return; }
    if (act === "detail") {
      state.backTo = state.view === "list" ? "list" : "home";
      state.detailId = Number(el.getAttribute("data-id"));
      state.view = "detail";
      render(); window.scrollTo(0, 0); return;
    }
    if (act === "detailBack") {
      state.view = state.backTo || "home";
      render(); window.scrollTo(0, 0); return;
    }
    if (act === "practiceOne") {
      startSession([Number(el.getAttribute("data-id"))], "单题练习"); return;
    }
    /* 专项练习 */
    if (act === "special") { startSpecial(el.getAttribute("data-kind")); return; }
    if (act === "specialHome") {
      state.special = null; state.view = "home"; render(); window.scrollTo(0, 0); return;
    }
    if (act === "specialReveal") { revealSpecial(); return; }
    if (act === "specialNext") { specialStep(1); return; }
    if (act === "specialPrev") { specialStep(-1); return; }
    if (act === "specialRestart") { startSpecial(el.getAttribute("data-kind")); return; }
    if (act === "mpick") {
      var sp0 = state.special;
      if (!sp0 || sp0.revealed) return;
      var L0 = el.getAttribute("data-letter");
      var k0 = sp0.picked.indexOf(L0);
      if (k0 >= 0) sp0.picked.splice(k0, 1); else sp0.picked.push(L0);
      el.setAttribute("data-state", k0 >= 0 ? "" : "right");
      return;
    }
    if (act === "msubmit") { msubmit(); return; }
    if (act === "pick") { pick(el.getAttribute("data-letter")); return; }
    if (act === "submit") { submitMulti(); return; }
    if (act === "next") { go(1); return; }
    if (act === "prev") { go(-1); return; }
    if (act === "finish") { state.view = "result"; render(); window.scrollTo(0, 0); return; }
    if (act === "quit") {
      var answeredN = state.session ? Object.keys(state.session.answers).length : 0;
      if (answeredN) {
        // 不用 window.confirm：部分手机浏览器/内嵌 WebView 会屏蔽原生弹窗，
        // 表现就是「返回键点不动」。这里改用页面内弹层。
        askConfirm("退出本次练习？", "已答的 " + answeredN + " 题会保留在统计与错题本里", function () {
          state.session = null; state.view = "home"; render(); window.scrollTo(0, 0);
        });
        return;
      }
      state.session = null; state.view = "home"; render(); window.scrollTo(0, 0); return;
    }
    if (act === "redo") {
      if (!lastResult) return;
      var w = lastResult.ids.filter(function (id) { return lastResult.answers[id] && !sameSet(lastResult.answers[id], BY_ID[id].a); });
      startSession(w, "错题重做"); return;
    }
    if (act === "practiceList") {
      var t = el.getAttribute("data-type");
      var m = t === "wrong" ? store.wrong : store.fav;
      var ids = shuffle(Object.keys(m).map(Number));
      startSession(ids, t === "wrong" ? "错题本" : "收藏夹"); return;
    }
    if (act === "unmark") {
      var t2 = el.getAttribute("data-type");
      var id2 = Number(el.getAttribute("data-id"));
      if (t2 === "wrong") delete store.wrong[id2]; else delete store.fav[id2];
      save(); render(); toast("已移除"); return;
    }
    if (act === "clearList") {
      var t3 = el.getAttribute("data-type");
      askConfirm(t3 === "wrong" ? "清空全部错题？" : "清空全部收藏？", "清空后无法恢复", function () {
        if (t3 === "wrong") store.wrong = {}; else store.fav = {};
        save(); render(); toast("已清空");
      });
      return;
    }
  });

  function pick(letter) {
    var s = state.session;
    if (!s) return;
    var q = BY_ID[s.ids[s.i]];
    if (s.answers[q.id]) return;
    var multi = q.a.length > 1 || q.t === "多选题";
    if (multi) {
      var i = s.pending.indexOf(letter);
      if (i >= 0) s.pending.splice(i, 1); else s.pending.push(letter);
      paintPending();
      return;
    }
    record(q, [letter]);
  }
  function submitMulti() {
    var s = state.session;
    if (!s || !s.pending.length) { toast("请先选择选项"); return; }
    var q = BY_ID[s.ids[s.i]];
    record(q, s.pending.slice());
  }
  function record(q, chosen) {
    var s = state.session;
    var ok = sameSet(chosen, q.a);
    s.answers[q.id] = chosen;
    s.pending = [];
    store.stat.seen++;
    if (ok) store.stat.right++;
    var us = store.unit[q.u] || { seen: 0, right: 0 };
    us.seen++;
    if (ok) us.right++;
    store.unit[q.u] = us;
    if (!ok) store.wrong[q.id] = (store.wrong[q.id] || 0) + 1;
    else if (store.wrong[q.id]) { delete store.wrong[q.id]; toast("答对了，已移出错题本"); }
    save();
    paintAnswer(q, chosen);
  }
  function go(d) {
    var s = state.session;
    if (!s) return;
    var n = s.i + d;
    if (n < 0) return;
    if (n >= s.ids.length) { state.view = "result"; render(); window.scrollTo(0, 0); return; }
    s.i = n;
    s.pending = [];
    render();
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  /* 键盘 */
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (state.view !== "quiz") return;
    var s = state.session;
    if (!s) return;
    var q = BY_ID[s.ids[s.i]];
    if (/^[1-6]$/.test(e.key)) {
      var idx = Number(e.key) - 1;
      if (idx < q.o.length) { e.preventDefault(); pick(String.fromCharCode(65 + idx)); }
    } else if (e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      if (s.answers[q.id]) go(1); else if (q.a.length > 1) submitMulti();
    } else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      if (store.fav[q.id]) delete store.fav[q.id]; else store.fav[q.id] = 1;
      save(); render();
    }
  });

  /* 浏览器返回键（不强制，仅提示） */
  window.addEventListener("beforeunload", function (e) {
    if (state.view === "quiz" && state.session && Object.keys(state.session.answers).length) {
      save();
    }
  });

  render();
})();
