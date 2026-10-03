/*
 * nuu の固定クライアント。作業ごとのページ（data-page="task"）と一覧（data-page="index"）を描く。
 *
 * - データは同じフォルダーのファイルを script 要素で読む。file:// でも動くよう、fetch や
 *   XMLHttpRequest、モジュール、外部の URL は使わない
 * - 「受け取る部分」（ファイルの読み込み）と「描く部分」（NUU.renderTask / NUU.renderIndex）を分ける。
 *   描く部分はただの JSON オブジェクトを受け取り、届け方を知らない
 * - データの値は textContent と setAttribute で入れ、HTML として解釈させない
 * - 開いたあとは 10 秒ごとにデータ、トークン量、好みを読み直し、変わった欄だけを描き直す
 */
(function () {
  'use strict';

  var POLL_MS = 10000;
  var STALE_SECONDS = 15 * 60;
  var FAILURE_LIMIT = 3;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var DEFAULT_PREFS = { theme: 'dark', density: 'airy', accent: '#3CCFBC', taskView: 'kanban' };
  var PREF_CHOICES = { theme: ['dark', 'light'], density: ['dense', 'airy'], taskView: ['kanban', 'list'] };

  var STATES = {
    todo: { label: '未着手', icon: 'todo' },
    doing: { label: '進行中', icon: 'doing' },
    waiting: { label: '待ち', icon: 'waiting' },
    blocked: { label: '停止', icon: 'blocked' },
    done: { label: '完了', icon: 'done' },
    failed: { label: '失敗', icon: 'failed' }
  };
  var TASK_COLUMNS = ['todo', 'doing', 'waiting', 'blocked', 'done'];
  var WORK = {
    active: { label: '進行中', icon: 'doing', tone: 'doing' },
    paused: { label: '中断中', icon: 'paused', tone: 'waiting' },
    done: { label: '完了', icon: 'done', tone: 'done' },
    removed: { label: '一覧から外した作業', icon: 'todo', tone: 'todo' }
  };
  var GROUPS = ['active', 'paused', 'done'];
  // 作業に関係する GitHub / GitLab の項目の種類と状態。状態の色は手順の状態の色を借り、記号と文字も一緒に出す。
  // PR / MR / Issue は番号で、リリースとリポジトリは題名（タグやリポジトリ名）で表す。知らない状態は first の状態として扱う。
  var CHANGE_STATES = {
    draft: { label: '下書き', icon: 'todo', tone: 'todo' },
    open: { label: 'レビュー中', icon: 'doing', tone: 'doing' },
    merged: { label: 'マージ済み', icon: 'done', tone: 'done' },
    closed: { label: '閉じた', icon: 'failed', tone: 'blocked' }
  };
  var REVIEW_KINDS = {
    pr: { label: 'PR', mark: '#', first: 'open', states: CHANGE_STATES },
    mr: { label: 'MR', mark: '!', first: 'open', states: CHANGE_STATES },
    issue: { label: 'Issue', mark: '#', first: 'open', states: {
      open: { label: 'オープン', icon: 'doing', tone: 'doing' },
      closed: { label: 'クローズ', icon: 'done', tone: 'done' }
    } },
    release: { label: 'リリース', first: 'published', states: {
      draft: { label: '下書き', icon: 'todo', tone: 'todo' },
      published: { label: '公開', icon: 'done', tone: 'done' }
    } },
    repo: { label: 'リポジトリ', first: 'public', states: {
      public: { label: '公開', icon: 'done', tone: 'done' },
      private: { label: '非公開', icon: 'todo', tone: 'todo' },
      archived: { label: 'アーカイブ', icon: 'paused', tone: 'todo' }
    } }
  };
  var PROVIDERS = { github: 'GitHub', gitlab: 'GitLab' };
  // 一覧の行に出す札の数。残りは「ほか n 件」にまとめる。
  var INDEX_REVIEWS = 3;

  // ---------------------------------------------------------------- 値の扱い

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && isFinite(value)) return String(value);
    return '';
  }

  function num(value) {
    return typeof value === 'number' && isFinite(value) ? value : null;
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  // 知らない値は進行中として扱う。
  function workStatus(status) {
    return Object.prototype.hasOwnProperty.call(WORK, status) ? status : 'active';
  }

  function stateOf(state) {
    return Object.prototype.hasOwnProperty.call(STATES, state) ? state : 'todo';
  }

  function providerKey(review) {
    return review.provider === 'gitlab' ? 'gitlab' : 'github';
  }

  // 知らない種類は、provider の変更のまとまり（GitHub は PR、GitLab は MR）として扱う。
  function reviewKind(review) {
    if (Object.prototype.hasOwnProperty.call(REVIEW_KINDS, review.kind)) return REVIEW_KINDS[review.kind];
    return REVIEW_KINDS[providerKey(review) === 'gitlab' ? 'mr' : 'pr'];
  }

  function reviewState(review) {
    var kind = reviewKind(review);
    return Object.prototype.hasOwnProperty.call(kind.states, review.state) ? review.state : kind.first;
  }

  function reviewStateMeta(review) {
    return reviewKind(review).states[reviewState(review)];
  }

  // 欄の見出しはサービス名。両方あれば GitHub / GitLab。
  function reviewsTitle(reviews) {
    var names = {};
    reviews.forEach(function (r) { names[providerKey(r)] = true; });
    return names.github && names.gitlab ? 'GitHub / GitLab' : PROVIDERS[names.gitlab ? 'gitlab' : 'github'];
  }

  // 番号で表す種類だけ、GitHub は #7、GitLab の MR は !12 と書く。リリースとリポジトリは null。
  function reviewNumber(review) {
    var kind = reviewKind(review);
    return kind.mark ? kind.mark + text(review.number) : null;
  }

  // 一覧の札の名前。番号で表す種類は「PR #7」、リリースは「リリース v1.0.0」、リポジトリは名前の最後の部分。
  function reviewChipName(review) {
    var kind = reviewKind(review);
    if (kind.mark) return kind.label + ' ' + reviewNumber(review);
    var name = kind === REVIEW_KINDS.repo ? text(review.title).split('/').pop() : text(review.title);
    return kind.label + ' ' + name;
  }

  function isStale(status, updatedAt, nowMs) {
    return workStatus(status) === 'active' && num(updatedAt) !== null && nowMs / 1000 - updatedAt >= STALE_SECONDS;
  }

  // 成果物などの参照は http: と https: だけをリンクにする。
  function safeUrl(ref) {
    return /^https?:\/\/[^\s]+$/i.test(text(ref)) ? text(ref) : null;
  }

  // PR / MR は https: だけをリンクにする。
  function reviewUrl(url) {
    return /^https:\/\/[^\s\/?#]+([\/?#]\S*)?$/.test(text(url)) ? text(url) : null;
  }

  // 合計からキャッシュの読み込みを除いた量（入力 + 出力 + キャッシュの書き込み）。集計前は null。
  // 応答のたびに会話全体をキャッシュから読み直すので、合計のほとんどはキャッシュの読み込みになり、作業の大きさの実感と合わない。
  function freshTokens(totals) {
    if (!isObject(totals) || num(totals.total) === null) return null;
    return Math.max(0, num(totals.total) - (num(totals.cacheRead) || 0));
  }

  // 作業ディレクトリを単一引用符で囲み、中の ' は '\'' に置き換える。
  function resumeCommand(sessionId, cwd) {
    var command = 'claude --resume ' + sessionId;
    if (!cwd) return command;
    return "cd '" + String(cwd).replace(/'/g, "'\\''") + "' && " + command;
  }

  // ---------------------------------------------------------------- 書式

  var numberFormat = new Intl.NumberFormat('ja-JP');

  function exact(value) {
    return numberFormat.format(num(value) || 0);
  }

  // 大きな数を「96 万」「1.2 億」のように短くする。1 万未満は 3 桁区切りのまま。
  function short(value) {
    var n = num(value) || 0;
    var round = function (scaled) { return Math.abs(scaled) >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10; };
    // 9,999.99 万のように丸めると 1 万万になる値は、億で表す。
    if (Math.abs(n) >= 1e8 || Math.abs(round(n / 1e4)) >= 1e4) return numberFormat.format(round(n / 1e8)) + ' 億';
    if (Math.abs(n) >= 1e4) return String(round(n / 1e4)) + ' 万';
    return numberFormat.format(n);
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function clockText(ms) {
    var d = new Date(ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  // 今日なら「18:46」、今年なら「9/27 18:46」、それより前なら「2025/9/27 18:46」。
  function timeText(seconds, nowMs) {
    var d = new Date(seconds * 1000);
    var now = new Date(nowMs);
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return hm;
    var md = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
    return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '/' + md;
  }

  function agoText(seconds, nowMs) {
    var diff = Math.max(0, Math.floor(nowMs / 1000 - seconds));
    if (diff < 60) return 'たった今';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 時間前';
    return Math.floor(diff / 86400) + ' 日前';
  }

  var TIME_FORMATS = {
    time: function (s, now) { return timeText(s, now); },
    ago: function (s, now) { return agoText(s, now); },
    both: function (s, now) { return timeText(s, now) + '（' + agoText(s, now) + '）'; },
    updated: function (s, now) { return agoText(s, now) === 'たった今' ? 'たった今更新' : agoText(s, now) + 'に更新'; }
  };

  // ---------------------------------------------------------------- 要素を作る

  function h(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'on') Object.keys(value).forEach(function (type) { node.addEventListener(type, value[type]); });
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    add(node, children);
    return node;
  }

  function add(node, children) {
    if (children === null || children === undefined || children === false) return node;
    (Array.isArray(children) ? children : [children]).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
    });
    return node;
  }

  var ICONS = {
    todo: [['circle', { cx: 8, cy: 8, r: 5.8 }]],
    doing: [['circle', { cx: 8, cy: 8, r: 5.8 }], ['path', { d: 'M8 2.2a5.8 5.8 0 0 1 0 11.6z', fill: 'currentColor', stroke: 'none' }]],
    waiting: [['circle', { cx: 8, cy: 8, r: 5.8 }], ['path', { d: 'M8 4.8V8l2.2 1.4' }]],
    blocked: [['circle', { cx: 8, cy: 8, r: 5.8 }], ['rect', { x: 5.6, y: 5.6, width: 4.8, height: 4.8, rx: 0.8, fill: 'currentColor', stroke: 'none' }]],
    done: [['circle', { cx: 8, cy: 8, r: 5.8 }], ['path', { d: 'M5.3 8.2l1.9 1.9 3.6-3.8' }]],
    failed: [['circle', { cx: 8, cy: 8, r: 5.8 }], ['path', { d: 'M6 6l4 4M10 6l-4 4' }]],
    paused: [['circle', { cx: 8, cy: 8, r: 5.8 }], ['path', { d: 'M6.6 5.8v4.4M9.4 5.8v4.4' }]],
    alert: [['path', { d: 'M8 2.2l6.2 11H1.8z' }], ['path', { d: 'M8 6.6v3' }], ['circle', { cx: 8, cy: 11.4, r: 0.5, fill: 'currentColor' }]],
    back: [['path', { d: 'M9.8 3.5L5.3 8l4.5 4.5' }]],
    down: [['path', { d: 'M8 3v9.5M4.2 8.8L8 12.6l3.8-3.8' }]],
    copy: [['rect', { x: 5.2, y: 5.2, width: 8, height: 8, rx: 1.6 }], ['path', { d: 'M10.8 5.2V3.6a1.4 1.4 0 0 0-1.4-1.4H3.6a1.4 1.4 0 0 0-1.4 1.4v5.8a1.4 1.4 0 0 0 1.4 1.4h1.6' }]],
    external: [['path', { d: 'M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3' }]],
    file: [['path', { d: 'M4 1.8h5.2l3 3v9.4H4z' }], ['path', { d: 'M9 1.8v3.2h3.2' }]]
  };

  function icon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'nuu-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    (ICONS[name] || ICONS.todo).forEach(function (part) {
      var node = document.createElementNS(SVG_NS, part[0]);
      Object.keys(part[1]).forEach(function (key) { node.setAttribute(key, part[1][key]); });
      svg.appendChild(node);
    });
    return svg;
  }

  function svgNode(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  // 状態は色と、記号と、文字の 3 つで示す。
  function badge(state, label, extraClass) {
    var key = stateOf(state);
    return h('span', { class: 'nuu-badge' + (extraClass ? ' ' + extraClass : ''), 'data-tone': key }, [
      icon(STATES[key].icon),
      h('span', { text: label === undefined ? STATES[key].label : label })
    ]);
  }

  function workBadge(status, extraClass) {
    var meta = WORK[workStatus(status)];
    return h('span', { class: 'nuu-badge' + (extraClass ? ' ' + extraClass : ''), 'data-tone': meta.tone, 'data-status': workStatus(status) }, [
      icon(meta.icon),
      h('span', { text: meta.label })
    ]);
  }

  function timeNode(seconds, format, className) {
    if (num(seconds) === null) return h('span', { class: className, text: '—' });
    return h('span', { class: className, 'data-at': seconds, 'data-format': format, text: TIME_FORMATS[format](seconds, Date.now()) });
  }

  function empty(label) {
    return h('p', { class: 'nuu-empty', text: label || 'なし' });
  }

  function sectionHead(title, count, extra) {
    return h('div', { class: 'nuu-section-head' }, [
      h('h2', { class: 'nuu-h2', text: title }),
      count === undefined || count === null ? null : h('span', { class: 'nuu-count', text: count }),
      extra || null
    ]);
  }

  function pairs(rows) {
    return h('dl', { class: 'nuu-pairs' }, rows.filter(Boolean).map(function (row) {
      return h('div', { class: 'nuu-pair' }, [h('dt', { text: row[0] }), h('dd', null, row[1])]);
    }));
  }

  function bar(value, total, tone) {
    var ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
    var fill = h('span', { class: 'nuu-bar-fill' });
    fill.style.width = (ratio * 100).toFixed(1) + '%';
    return h('span', { class: 'nuu-bar', 'data-tone': tone || null, role: 'presentation' }, fill);
  }

  // ---------------------------------------------------------------- 欄ごとの描き直し

  // 欄の入力が前と同じなら描き直さない。開いた詳細は、同じ data-key のものを開き直す。
  function slot(root, key, input, build) {
    var node = root.querySelector('[data-slot="' + key + '"]');
    if (!node) return false;
    var signature = JSON.stringify(input === undefined ? null : input);
    if (node.nuuSignature === signature) return false;
    var open = {};
    Array.prototype.forEach.call(node.querySelectorAll('details[open][data-key]'), function (d) { open[d.getAttribute('data-key')] = true; });
    var fresh = build(input);
    node.textContent = '';
    add(node, fresh);
    Array.prototype.forEach.call(node.querySelectorAll('details[data-key]'), function (d) {
      if (open[d.getAttribute('data-key')]) d.open = true;
    });
    node.nuuSignature = signature;
    return true;
  }

  function withScrollKept(render) {
    var x = window.scrollX;
    var y = window.scrollY;
    var changed = render();
    if (changed && (window.scrollX !== x || window.scrollY !== y)) window.scrollTo(x, y);
    return changed;
  }

  function countRender(root, changed) {
    if (changed) root.setAttribute('data-renders', String(Number(root.getAttribute('data-renders') || 0) + 1));
  }

  // ---------------------------------------------------------------- 作業ごとのページ

  function taskSkeleton(root) {
    if (root.querySelector('.nuu-shell')) return;
    root.textContent = '';
    add(root, h('div', { class: 'nuu-shell' }, [
      h('nav', { class: 'nuu-nav' }, [
        h('a', { class: 'nuu-back', href: '../index.html' }, [icon('back'), h('span', { text: '作業の一覧へ戻る' })]),
        h('span', { class: 'nuu-brand', 'aria-hidden': 'true', text: 'nuu' })
      ]),
      h('div', { class: 'nuu-alerts' }, [loadWarning(), staleWarning()]),
      h('header', { class: 'nuu-head', 'data-slot': 'head' }),
      h('section', { class: 'nuu-stats', 'data-slot': 'stats', 'aria-label': '要約' }),
      h('section', { class: 'nuu-section nuu-reviews', id: 'reviews', 'data-slot': 'reviews', 'aria-label': 'PR / MR' }),
      h('div', { class: 'nuu-attention', 'data-slot': 'attention' }),
      h('section', { class: 'nuu-section', 'data-slot': 'tasks' }),
      h('section', { class: 'nuu-section', 'data-slot': 'panels' }),
      h('section', { class: 'nuu-section', 'data-slot': 'artifacts' }),
      h('section', { class: 'nuu-section nuu-foot', id: 'session', 'data-slot': 'session' }),
      h('section', { class: 'nuu-section nuu-foot', id: 'usage', 'data-slot': 'usage' })
    ]));
  }

  function loadWarning() {
    return h('div', { class: 'nuu-alert', 'data-role': 'load-warning', 'data-tone': 'blocked', role: 'alert', hidden: true }, [
      icon('alert'),
      h('p', { 'data-role': 'load-warning-text' })
    ]);
  }

  function staleWarning() {
    return h('div', { class: 'nuu-alert', 'data-role': 'stale-warning', 'data-tone': 'waiting', role: 'status', hidden: true }, [
      icon('alert'),
      h('p', null, [
        h('strong', { text: '15 分以上更新がありません。' }),
        '作業が止まっているかもしれません（最終更新 ',
        h('span', { 'data-role': 'stale-since' }),
        '）。',
        h('a', { href: '#session', class: 'nuu-alert-link' }, [h('span', { text: '再開のコマンドへ' }), icon('down')])
      ])
    ]);
  }

  function renderHead(input) {
    if (!input) return h('div', { class: 'nuu-loading', text: '読み込み中…' });
    return [
      h('div', { class: 'nuu-head-main' }, [
        h('div', { class: 'nuu-eyebrow' }, h('span', { class: 'nuu-project', text: input.project })),
        h('h1', { class: 'nuu-title', text: input.title || '（無題の作業）' }),
        input.summary ? h('p', { class: 'nuu-summary', text: input.summary }) : null
      ]),
      h('div', { class: 'nuu-clock' }, [
        h('div', { class: 'nuu-clock-row' }, [h('span', { text: '現在時刻' }), h('strong', { 'data-clock': 'now', text: clockText(Date.now()) })]),
        h('div', { class: 'nuu-clock-row' }, [h('span', { text: '最終更新' }), h('strong', null, timeNode(input.updatedAt, 'time'))]),
        h('div', { class: 'nuu-clock-row nuu-clock-ago' }, timeNode(input.updatedAt, 'updated')),
        h('div', { class: 'nuu-clock-row nuu-clock-started' }, [h('span', { text: '開始' }), timeNode(input.startedAt, 'time')])
      ])
    ];
  }

  function stat(label, value, props, children) {
    return h(props && props.href ? 'a' : 'div', Object.assign({ class: 'nuu-stat' }, props || {}), [
      h('span', { class: 'nuu-stat-label', text: label }),
      h('div', { class: 'nuu-stat-value' }, value),
      children || null
    ]);
  }

  function renderStats(input) {
    if (!input) return null;
    var tokens = input.tokens === null
      ? [h('span', { class: 'nuu-big nuu-muted', text: '集計前' }), icon('down')]
      : [h('span', { class: 'nuu-big', text: short(input.tokens) }), h('span', { class: 'nuu-unit', text: 'トークン' }), icon('down')];
    var tokenNote = input.tokens === null ? null : h('span', { class: 'nuu-stat-note', 'data-role': 'token-note', text: 'キャッシュ読み込みを除く' });
    return [
      stat('状態', workBadge(input.status, 'nuu-badge-lg')),
      stat('完了した手順', [h('span', { class: 'nuu-big', text: input.done + ' / ' + input.total })], null, bar(input.done, input.total, 'done')),
      stat('未回答の質問', [h('span', { class: 'nuu-big', 'data-tone': input.questions ? 'waiting' : null, text: input.questions }), h('span', { class: 'nuu-unit', text: '件' })]),
      stat('止まっているもの', [h('span', { class: 'nuu-big', 'data-tone': input.blockers ? 'blocked' : null, text: input.blockers }), h('span', { class: 'nuu-unit', text: '件' })]),
      stat('トークン量', tokens, { href: '#usage', class: 'nuu-stat nuu-stat-link', 'data-role': 'token-total' }, tokenNote)
    ];
  }

  function reviewBadge(review) {
    var meta = reviewStateMeta(review);
    return h('span', { class: 'nuu-badge nuu-review-state', 'data-tone': meta.tone, 'data-state': reviewState(review) }, [
      icon(meta.icon),
      h('span', { text: meta.label })
    ]);
  }

  // 新しい順に並べる。GitHub / GitLab の項目がなければ欄を出さない。
  function renderReviews(input) {
    if (!input || !input.length) return null;
    var items = input.slice().sort(function (a, b) { return (num(b.at) || 0) - (num(a.at) || 0); });
    return [
      sectionHead(reviewsTitle(items), items.length + ' 件'),
      h('ul', { class: 'nuu-review-list' }, items.map(function (r) {
        var url = reviewUrl(r.url);
        var number = reviewNumber(r);
        var label = [number ? h('span', { class: 'nuu-review-number', text: number }) : null, h('span', { class: 'nuu-review-title', text: text(r.title) })];
        return h('li', { class: 'nuu-review', 'data-provider': providerKey(r), 'data-kind': r.kind, 'data-state': reviewState(r) }, [
          h('span', { class: 'nuu-review-provider', text: PROVIDERS[providerKey(r)] + ' ' + reviewKind(r).label }),
          url
            ? h('a', { class: 'nuu-review-main', href: url, target: '_blank', rel: 'noopener' }, label)
            : h('span', { class: 'nuu-review-main' }, label),
          h('span', { class: 'nuu-review-meta' }, [
            reviewBadge(r),
            h('span', { class: 'nuu-review-time' }, ['最終更新 ', timeNode(r.at, 'both')])
          ])
        ]);
      }))
    ];
  }

  function questionCard(q, answered) {
    return h('article', { class: 'nuu-card nuu-question', 'data-tone': answered ? 'done' : 'waiting' }, [
      h('p', { class: 'nuu-card-title', text: text(q.question) }),
      pairs([
        ['既定の対応', text(q.default)],
        answered ? null : ['進め方', q.proceeding ? '既定の対応で進めています' : '回答を待って止めています'],
        answered ? ['回答', text(q.answer)] : null,
        ['状態', answered ? badge('done', '回答済み') : badge('waiting', '回答待ち')],
        ['追加', timeNode(q.askedAt, 'both')],
        answered && num(q.answeredAt) !== null ? ['回答した時刻', timeNode(q.answeredAt, 'both')] : null
      ])
    ]);
  }

  function renderAttention(input) {
    if (!input) return null;
    var open = input.questions.filter(function (q) { return !isAnswered(q); });
    var answered = input.questions.filter(isAnswered);
    var questions = h('section', { class: 'nuu-section nuu-questions', 'aria-label': '利用者への質問' }, [
      sectionHead('利用者への質問', open.length ? open.length + ' 件未回答' : null, null),
      open.length ? h('div', { class: 'nuu-stack' }, open.map(function (q) { return questionCard(q, false); })) : empty('未回答の質問はありません'),
      answered.length ? h('details', { class: 'nuu-details', 'data-key': 'answered' }, [
        h('summary', { text: '回答済みの質問 ' + answered.length + ' 件' }),
        h('div', { class: 'nuu-stack' }, answered.map(function (q) { return questionCard(q, true); }))
      ]) : null
    ]);
    var blockers = h('section', { class: 'nuu-section nuu-blockers', 'aria-label': '止まっているもの' }, [
      sectionHead('止まっているもの', input.blockers.length ? input.blockers.length + ' 件' : null),
      input.blockers.length ? h('div', { class: 'nuu-stack' }, input.blockers.map(function (b) {
        return h('article', { class: 'nuu-card nuu-blocker', 'data-tone': 'blocked' }, [
          h('p', { class: 'nuu-card-title' }, [icon('blocked'), h('span', { text: text(b.what) })]),
          pairs([['理由', text(b.why)], ['いつから', timeNode(b.since, 'both')], ['次の手', text(b.next)]])
        ]);
      })) : empty('止まっているものはありません')
    ]);
    return [questions, blockers];
  }

  function isAnswered(q) {
    return isObject(q) && typeof q.answer === 'string' && q.answer !== '';
  }

  function taskCard(task) {
    return h('li', { class: 'nuu-task', 'data-tone': stateOf(task.status) }, [
      h('span', { class: 'nuu-task-id', text: '手順 ' + text(task.id) }),
      h('span', { class: 'nuu-task-title', text: text(task.title) }),
      task.note ? h('span', { class: 'nuu-task-note', text: text(task.note) }) : null
    ]);
  }

  function renderTasks(input) {
    if (!input) return null;
    var tasks = input.tasks;
    var done = tasks.filter(function (t) { return t.status === 'done'; }).length;
    var head = sectionHead('手順', tasks.length ? done + ' / ' + tasks.length + ' 完了' : null);
    if (!tasks.length) return [head, empty('手順はまだありません')];
    if (input.view === 'list') {
      return [head, h('ol', { class: 'nuu-tasklist', 'data-view': 'list' }, tasks.map(function (task) {
        return h('li', { class: 'nuu-task-row', 'data-tone': stateOf(task.status) }, [
          badge(task.status),
          h('span', { class: 'nuu-task-id', text: '手順 ' + text(task.id) }),
          h('span', { class: 'nuu-task-title', text: text(task.title) }),
          task.note ? h('span', { class: 'nuu-task-note', text: text(task.note) }) : null
        ]);
      }))];
    }
    return [head, h('div', { class: 'nuu-kanban', 'data-view': 'kanban' }, TASK_COLUMNS.map(function (column) {
      var cards = tasks.filter(function (t) { return stateOf(t.status) === column; });
      return h('section', { class: 'nuu-column' + (cards.length ? '' : ' is-empty'), 'data-tone': column, 'aria-label': STATES[column].label }, [
        h('div', { class: 'nuu-column-head' }, [
          h('span', { class: 'nuu-column-name' }, [icon(STATES[column].icon), h('span', { text: STATES[column].label })]),
          h('span', { class: 'nuu-count', text: cards.length + ' 件' })
        ]),
        cards.length ? h('ol', { class: 'nuu-column-body' }, cards.map(taskCard)) : h('p', { class: 'nuu-empty nuu-column-empty', text: 'なし' })
      ]);
    }))];
  }

  // ---------------------------------------------------------------- 型付きパネル

  var PANELS = {
    progress: function (panel) {
      var items = list(panel.items);
      if (!items.length) return empty();
      return h('ul', { class: 'nuu-progress' }, items.map(function (item) {
        var value = num(item.value) || 0;
        var total = num(item.total) || 0;
        var ratio = total > 0 ? value / total : 0;
        return h('li', { class: 'nuu-progress-item' }, [
          h('div', { class: 'nuu-progress-top' }, [
            h('span', { class: 'nuu-progress-label', text: text(item.label) }),
            h('span', { class: 'nuu-progress-value' }, [
              h('strong', { text: exact(value) + ' / ' + exact(total) }),
              item.unit ? h('span', { class: 'nuu-unit', text: text(item.unit) }) : null,
              h('span', { class: 'nuu-progress-pct', text: Math.round(ratio * 100) + '%' })
            ])
          ]),
          bar(value, total, ratio >= 1 ? 'done' : null)
        ]);
      }));
    },

    grid: function (panel) {
      var items = list(panel.items);
      if (!items.length) return empty();
      return h('ul', { class: 'nuu-grid' }, items.map(function (item) {
        var state = stateOf(item.state);
        return h('li', { class: 'nuu-cell', 'data-tone': state }, [
          h('span', { class: 'nuu-cell-state' }, [icon(STATES[state].icon), h('span', { text: STATES[state].label })]),
          h('span', { class: 'nuu-cell-label', text: text(item.label) }),
          item.note ? h('span', { class: 'nuu-cell-note', text: text(item.note) }) : null
        ]);
      }));
    },

    table: function (panel) {
      var columns = list(panel.columns).map(function (c) { return text(isObject(c) ? c.label : c); });
      var rows = list(panel.rows);
      if (!rows.length) return empty();
      return h('div', { class: 'nuu-table-wrap' }, h('table', { class: 'nuu-table' }, [
        h('thead', null, h('tr', null, columns.map(function (label) { return h('th', { scope: 'col', text: label }); }))),
        h('tbody', null, rows.map(function (row) {
          return h('tr', null, list(row).map(function (cell, i) {
            var label = columns[i] || '';
            if (isObject(cell)) return h('td', { 'data-label': label }, badge(cell.state, text(cell.text)));
            if (num(cell) !== null) return h('td', { class: 'nuu-num', 'data-label': label, text: exact(cell) });
            return h('td', { 'data-label': label, class: text(cell) ? null : 'nuu-blank', text: text(cell) || '—' });
          }));
        }))
      ]));
    },

    keyvalue: function (panel) {
      var items = list(panel.items);
      if (!items.length) return empty();
      return h('dl', { class: 'nuu-kv' }, items.map(function (item) {
        var value = num(item.value) !== null ? exact(item.value) : text(item.value);
        return h('div', { class: 'nuu-kv-row', 'data-tone': item.state ? stateOf(item.state) : null }, [
          h('dt', { text: text(item.label) }),
          h('dd', null, item.state ? badge(item.state, value) : h('span', { class: 'nuu-kv-value', text: value }))
        ]);
      }));
    },

    text: function (panel) {
      var paragraphs = text(panel.body).split(/\n\s*\n/).filter(function (p) { return p.trim(); });
      if (!paragraphs.length) return empty();
      return h('div', { class: 'nuu-text' }, paragraphs.map(function (p) { return h('p', { text: p }); }));
    },

    trend: renderTrend,

    flow: function (panel) {
      var steps = list(panel.steps);
      if (!steps.length) return empty();
      return h('ol', { class: 'nuu-flow' }, steps.map(function (step, i) {
        var state = stateOf(step.state);
        return h('li', { class: 'nuu-step', 'data-tone': state }, [
          h('span', { class: 'nuu-step-mark' }, [icon(STATES[state].icon)]),
          h('span', { class: 'nuu-step-body' }, [
            h('span', { class: 'nuu-step-index', text: String(i + 1) }),
            h('span', { class: 'nuu-step-label', text: text(step.label) }),
            h('span', { class: 'nuu-step-state', text: STATES[state].label }),
            step.note ? h('span', { class: 'nuu-step-note', text: text(step.note) }) : null
          ])
        ]);
      }));
    }
  };

  // 目盛りをきりのよい値にそろえる。
  function niceTicks(min, max, count) {
    if (min === max) {
      var padding = Math.abs(min) * 0.1 || 1;
      min -= padding;
      max += padding;
    }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
    var err = (count * step) / span;
    if (err <= 0.15) step *= 10;
    else if (err <= 0.35) step *= 5;
    else if (err <= 0.75) step *= 2;
    var start = Math.floor(min / step) * step;
    var end = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return ticks;
  }

  // 推移はインラインの SVG で線だけを描き、目盛りの文字は同じ縮尺の位置に HTML で置く。
  // 幅に合わせて伸び縮みしても、文字の大きさが変わらないようにするため。
  function renderTrend(panel) {
    var unit = text(panel.unit);
    var series = list(panel.series).slice(0, 4).map(function (s) {
      return { label: text(s && s.label), points: list(s && s.points).filter(function (p) { return isObject(p) && num(p.at) !== null && num(p.value) !== null; }) };
    }).filter(function (s) { return s.points.length; });
    if (!series.length) return empty('まだ点がありません');
    var all = [];
    series.forEach(function (s) { all = all.concat(s.points); });
    var values = all.map(function (p) { return p.value; });
    var times = all.map(function (p) { return p.at; });
    var ticks = niceTicks(Math.min.apply(null, values), Math.max.apply(null, values), 4);
    var yMin = ticks[0];
    var yMax = ticks[ticks.length - 1];
    var tMin = Math.min.apply(null, times);
    var tMax = Math.max.apply(null, times);
    if (tMin === tMax) { tMin -= 60; tMax += 60; }
    var x = function (t) { return ((t - tMin) / (tMax - tMin)) * 100; };
    var y = function (v) { return (1 - (v - yMin) / (yMax - yMin)) * 100; };

    var svg = svgNode('svg', { class: 'nuu-trend-svg', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    ticks.forEach(function (t) {
      svg.appendChild(svgNode('line', { x1: 0, x2: 100, y1: y(t), y2: y(t), class: 'nuu-trend-grid' }));
    });
    var area = h('div', { class: 'nuu-trend-area' }, svg);
    series.forEach(function (s, i) {
      svg.appendChild(svgNode('polyline', {
        class: 'nuu-trend-line',
        'data-series': i,
        points: s.points.map(function (p) { return x(p.at).toFixed(2) + ',' + y(p.value).toFixed(2); }).join(' ')
      }));
      var last = s.points[s.points.length - 1];
      var dot = h('span', { class: 'nuu-trend-dot', 'data-series': i });
      dot.style.left = x(last.at) + '%';
      dot.style.top = y(last.value) + '%';
      area.appendChild(dot);
    });
    var yLabels = h('div', { class: 'nuu-trend-y', 'aria-hidden': 'true' }, ticks.map(function (t) {
      var label = h('span', { text: short(t) });
      label.style.top = y(t) + '%';
      return label;
    }));
    var now = Date.now();
    var xLabels = h('div', { class: 'nuu-trend-x', 'aria-hidden': 'true' }, [
      h('span', { text: timeText(Math.min.apply(null, times), now) }),
      h('span', { text: timeText(Math.max.apply(null, times), now) })
    ]);
    var legend = h('ul', { class: 'nuu-trend-legend' }, series.map(function (s, i) {
      var last = s.points[s.points.length - 1];
      return h('li', { 'data-series': i }, [
        h('span', { class: 'nuu-swatch', 'data-series': i }),
        h('span', { class: 'nuu-legend-label', text: s.label }),
        h('strong', { text: exact(last.value) }),
        unit ? h('span', { class: 'nuu-unit', text: unit }) : null
      ]);
    }));
    var summary = series.map(function (s) {
      var last = s.points[s.points.length - 1];
      return s.label + ' の最新 ' + exact(last.value) + (unit ? ' ' + unit : '');
    }).join('、');
    return h('figure', { class: 'nuu-trend', role: 'img', 'aria-label': summary }, [
      legend,
      h('div', { class: 'nuu-trend-plot' }, [yLabels, area]),
      xLabels
    ]);
  }

  function renderPanel(panel) {
    var type = isObject(panel) ? text(panel.type) : '';
    var known = Object.prototype.hasOwnProperty.call(PANELS, type);
    var node = h('article', {
      class: 'nuu-panel' + (known ? '' : ' nuu-panel-unknown') + (panel && panel.wide === true ? ' is-wide' : ''),
      'data-type': known ? type : 'unknown',
      'data-panel': isObject(panel) ? text(panel.id) : null
    }, [
      h('header', { class: 'nuu-panel-head' }, h('h3', { class: 'nuu-h3', text: (isObject(panel) && text(panel.title)) || '（無題のパネル）' }))
    ]);
    if (!known) {
      node.appendChild(h('p', { class: 'nuu-empty', text: '未対応の種類のパネルです（type: ' + (type || '空') + '）' }));
      return node;
    }
    try {
      add(node, PANELS[type](panel));
    } catch (error) {
      // 1 つのパネルが壊れていても、ほかの欄の描画は続ける。
      node.appendChild(h('p', { class: 'nuu-empty', text: 'このパネルを描けませんでした' }));
    }
    if (panel.note) node.appendChild(h('p', { class: 'nuu-panel-note', text: text(panel.note) }));
    return node;
  }

  function renderPanels(input) {
    if (!input || !input.length) return null;
    return [sectionHead('作業の様子', null), h('div', { class: 'nuu-panels' }, input.map(renderPanel))];
  }

  function renderArtifacts(input) {
    if (!input) return null;
    var items = input.slice().sort(function (a, b) { return (num(b.at) || 0) - (num(a.at) || 0); });
    return [
      sectionHead('最新の成果物', items.length ? items.length + ' 件' : null),
      items.length ? h('ul', { class: 'nuu-artifacts' }, items.map(function (a) {
        var url = safeUrl(a.ref);
        return h('li', { class: 'nuu-artifact' }, [
          h('span', { class: 'nuu-artifact-icon' }, icon(url ? 'external' : 'file')),
          h('div', { class: 'nuu-artifact-main' }, [
            h('div', { class: 'nuu-artifact-top' }, [
              h('span', { class: 'nuu-artifact-name', text: text(a.name) }),
              timeNode(a.at, 'both', 'nuu-artifact-time')
            ]),
            url
              ? h('a', { class: 'nuu-ref', href: url, target: '_blank', rel: 'noopener noreferrer', text: url })
              : h('code', { class: 'nuu-ref', text: text(a.ref) }),
            a.note ? h('span', { class: 'nuu-artifact-note', text: text(a.note) }) : null
          ])
        ]);
      })) : empty('成果物はまだありません')
    ];
  }

  function copyRow(label, value, role) {
    var code = h('code', { class: 'nuu-code', 'data-role': role, text: value });
    var status = h('span', { class: 'nuu-copy-status', 'aria-live': 'polite', 'data-role': role + '-status' });
    var button = h('button', { type: 'button', class: 'nuu-button', 'data-role': role + '-copy', on: { click: function () { copyText(code, status); } } }, [
      icon('copy'), h('span', { text: 'コピー' })
    ]);
    return h('div', { class: 'nuu-copy-row' }, [
      h('span', { class: 'nuu-field-label', text: label }),
      h('div', { class: 'nuu-copy-line' }, [code, button]),
      status
    ]);
  }

  function copyText(code, status) {
    var value = code.textContent;
    var show = function (message, tone) {
      status.textContent = message;
      status.setAttribute('data-tone', tone);
      clearTimeout(status.nuuTimer);
      status.nuuTimer = setTimeout(function () { status.textContent = ''; }, 6000);
    };
    var fallback = function () {
      var selection = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);
      show('選びました。⌘C か Ctrl+C でコピーしてください', 'waiting');
    };
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return fallback();
      navigator.clipboard.writeText(value).then(function () { show('コピーしました', 'done'); }, fallback);
    } catch (error) {
      fallback();
    }
  }

  function renderSession(input) {
    var head = sectionHead('セッション', null);
    if (!input || !input.sessionId) return [head, empty('集計前')];
    return [
      head,
      h('div', { class: 'nuu-card nuu-session' }, [
        copyRow('セッションの ID', input.sessionId, 'session-id'),
        h('div', { class: 'nuu-copy-row' }, [
          h('span', { class: 'nuu-field-label', text: '作業ディレクトリ' }),
          input.cwd ? h('code', { class: 'nuu-code', 'data-role': 'cwd', text: input.cwd }) : h('span', { class: 'nuu-muted', 'data-role': 'cwd', text: '記録なし' })
        ]),
        copyRow('再開のコマンド', resumeCommand(input.sessionId, input.cwd), 'resume')
      ])
    ];
  }

  var USAGE_PARTS = [
    ['内訳', [['作業本体', 'byCategory', 'main'], ['ほかのサブエージェント', 'byCategory', 'subagents'], ['ダッシュボードの作成と更新', 'byCategory', 'dashboard']]],
    ['種類', [['入力', 'totals', 'input'], ['出力', 'totals', 'output'], ['キャッシュ読み込み', 'totals', 'cacheRead'], ['キャッシュ書き込み', 'totals', 'cacheWrite']]]
  ];

  function usageValue(usage, group, key) {
    var holder = isObject(usage[group]) ? usage[group][key] : null;
    return group === 'byCategory' ? (isObject(holder) ? num(holder.total) : null) : num(holder);
  }

  var AGENT_MODELS = [['作成（builder）', 'dashboard-builder', 'builder'], ['更新（updater）', 'dashboard-updater', 'updater']];

  // claude-opus-5-5 は Opus 5.5、claude-haiku-4-5-20251001 は Haiku 4.5 と短く出す。形が違えばそのまま出す。
  function modelName(id) {
    var match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
    if (!match) return id;
    return match[1].charAt(0).toUpperCase() + match[1].slice(1) + ' ' + match[2] + (match[3] ? '.' + match[3] : '');
  }

  // 作業のデータを書いたモデルを、エージェントごとに書いた順で並べる。記録がなければ「記録なし」。
  function agentModelsGroup(input) {
    var records = isObject(input.agentModels) ? input.agentModels : {};
    return h('div', { class: 'nuu-usage-group', 'data-role': 'agent-models' }, [
      h('h3', { class: 'nuu-h3', text: 'ダッシュボードのモデル' }),
      h('dl', { class: 'nuu-usage-list' }, AGENT_MODELS.map(function (item) {
        var ids = (Array.isArray(records[item[1]]) ? records[item[1]] : []).filter(function (id) { return typeof id === 'string' && id; });
        return h('div', { class: 'nuu-usage-item' }, [
          h('dt', { text: item[0] }),
          ids.length
            ? h('dd', { 'data-role': 'model-' + item[2], title: ids.join('、') }, [h('strong', { text: ids.map(modelName).join('、') })])
            : h('dd', { 'data-role': 'model-' + item[2] }, [h('span', { class: 'nuu-muted', text: '記録なし' })])
        ]);
      }))
    ]);
  }

  function usageTotal(label, value, role) {
    return h('div', { class: 'nuu-usage-total' }, [
      h('span', { class: 'nuu-field-label', text: label }),
      h('div', { class: 'nuu-usage-values' }, [
        h('strong', { class: 'nuu-big', 'data-role': role + '-short', text: short(value) }),
        h('span', { class: 'nuu-unit', text: 'トークン' }),
        h('span', { class: 'nuu-exact', 'data-role': role + '-exact', text: exact(value) })
      ])
    ]);
  }

  function renderUsage(input) {
    var head = sectionHead('トークン量', null);
    if (!isObject(input) || !isObject(input.totals)) return [head, h('p', { class: 'nuu-empty', 'data-role': 'usage-empty', text: '集計前' })];
    return [
      head,
      h('div', { class: 'nuu-card nuu-usage' }, [
        usageTotal('キャッシュ読み込みを除く', freshTokens(input.totals) || 0, 'usage-fresh'),
        usageTotal('合計（キャッシュ読み込みを含む）', num(input.totals.total) || 0, 'usage'),
        h('div', { class: 'nuu-usage-groups' }, USAGE_PARTS.map(function (part) {
          return h('div', { class: 'nuu-usage-group' }, [
            h('h3', { class: 'nuu-h3', text: part[0] }),
            h('dl', { class: 'nuu-usage-list' }, part[1].map(function (item) {
              var value = usageValue(input, item[1], item[2]) || 0;
              return h('div', { class: 'nuu-usage-item' }, [
                h('dt', { text: item[0] }),
                h('dd', null, [h('strong', { text: short(value) }), h('span', { class: 'nuu-exact', text: exact(value) })])
              ]);
            }))
          ]);
        }).concat([agentModelsGroup(input)])),
        h('p', { class: 'nuu-usage-meta' }, ['集計した時刻 ', timeNode(input.updatedAt, 'both')]),
        h('p', { class: 'nuu-note', text: '目安です。サブエージェントの出力トークンは少なめに出ることがあります' })
      ])
    ];
  }

  // 作業のデータ（と .usage.js の値）を受け取り、変わった欄だけを描き直す。
  function renderTask(root, data, usage) {
    taskSkeleton(root);
    var d = isObject(data) ? data : null;
    var u = isObject(usage) ? usage : null;
    var view = (currentPrefs.taskView === 'list') ? 'list' : 'kanban';
    var tasks = d ? list(d.tasks).filter(isObject) : [];
    var questions = d ? list(d.questions).filter(isObject) : [];
    var blockers = d ? list(d.blockers).filter(isObject) : [];
    root.nuuTask = d ? { status: d.status, updatedAt: num(d.updatedAt) } : null;
    if (d && d.title) document.title = text(d.title) + ' — nuu';
    var changed = withScrollKept(function () {
      var any = false;
      any = slot(root, 'head', d && {
        title: text(d.title), project: text(d.project), summary: text(d.summary),
        status: workStatus(d.status), updatedAt: num(d.updatedAt), startedAt: num(d.startedAt)
      }, renderHead) || any;
      any = slot(root, 'stats', d && {
        status: workStatus(d.status),
        done: tasks.filter(function (t) { return t.status === 'done'; }).length,
        total: tasks.length,
        questions: questions.filter(function (q) { return !isAnswered(q); }).length,
        blockers: blockers.length,
        tokens: u ? freshTokens(u.totals) : null
      }, renderStats) || any;
      var reviews = d ? list(d.reviews).filter(isObject) : [];
      any = slot(root, 'reviews', d && reviews, renderReviews) || any;
      var reviewsNode = root.querySelector('[data-slot="reviews"]');
      if (reviewsNode) reviewsNode.setAttribute('aria-label', reviewsTitle(reviews));
      any = slot(root, 'attention', d && { questions: questions, blockers: blockers }, renderAttention) || any;
      any = slot(root, 'tasks', d && { tasks: tasks, view: view }, renderTasks) || any;
      any = slot(root, 'panels', d && list(d.panels), renderPanels) || any;
      any = slot(root, 'artifacts', d && list(d.artifacts).filter(isObject), renderArtifacts) || any;
      any = slot(root, 'session', u && { sessionId: text(u.sessionId), cwd: text(u.cwd) }, renderSession) || any;
      any = slot(root, 'usage', u, renderUsage) || any;
      return any;
    });
    countRender(root, changed);
    tick(root);
    return root;
  }

  // ---------------------------------------------------------------- 一覧

  function indexSkeleton(root) {
    if (root.querySelector('.nuu-shell')) return;
    root.textContent = '';
    add(root, h('div', { class: 'nuu-shell' }, [
      h('header', { class: 'nuu-head nuu-index-head' }, [
        h('div', { class: 'nuu-head-main' }, [
          h('div', { class: 'nuu-eyebrow' }, h('span', { class: 'nuu-brand', text: 'nuu' })),
          h('h1', { class: 'nuu-title', text: '作業の一覧' }),
          h('p', { class: 'nuu-summary', text: '長い作業ごとの進捗ダッシュボード' })
        ]),
        h('div', { class: 'nuu-clock' }, h('div', { class: 'nuu-clock-row' }, [h('span', { text: '現在時刻' }), h('strong', { 'data-clock': 'now', text: clockText(Date.now()) })]))
      ]),
      h('div', { class: 'nuu-alerts' }, [loadWarning()]),
      h('div', { class: 'nuu-summary-strip', 'data-slot': 'overview' }),
      h('div', { class: 'nuu-groups', 'data-slot': 'groups' })
    ]));
  }

  // 一覧の href は <プロジェクト名>/<作業名>.html の形のときだけリンクにする。
  function itemHref(item) {
    var project = text(item.project);
    var slug = text(item.slug);
    if (!project || !slug || /[\/\\]/.test(project + slug) || item.href !== project + '/' + slug + '.html') return null;
    return encodeURIComponent(project) + '/' + encodeURIComponent(slug) + '.html';
  }

  // 一覧の行の GitHub / GitLab の札。押すとその項目のページを開く。多いときは先頭の数件と「ほか n 件」にする。
  function reviewChips(reviews, href) {
    if (!reviews.length) return null;
    var shown = reviews.slice(0, INDEX_REVIEWS);
    var rest = reviews.length - shown.length;
    return h('div', { class: 'nuu-row-reviews', 'data-role': 'row-reviews' }, shown.map(function (r) {
      var meta = reviewStateMeta(r);
      var url = reviewUrl(r.url);
      var props = {
        class: 'nuu-review-chip', 'data-tone': meta.tone, 'data-state': reviewState(r), 'data-kind': r.kind,
        title: PROVIDERS[providerKey(r)] + ' ' + (reviewNumber(r) ? reviewChipName(r) : reviewKind(r).label + ' ' + text(r.title)) + '（' + meta.label + '）'
      };
      if (url) Object.assign(props, { href: url, target: '_blank', rel: 'noopener' });
      return h(url ? 'a' : 'span', props, [icon(meta.icon), h('span', { text: reviewChipName(r) })]);
    }).concat(rest > 0 ? [href
      ? h('a', { class: 'nuu-review-more', href: href + '#reviews', text: 'ほか ' + rest + ' 件' })
      : h('span', { class: 'nuu-review-more', text: 'ほか ' + rest + ' 件' })] : []));
  }

  function indexRow(item) {
    var href = itemHref(item);
    var usage = item.usage;
    var tokens = usage ? freshTokens(usage.totals) : null;
    var session = usage && text(usage.sessionId) ? text(usage.sessionId).slice(0, 8) : null;
    var status = workStatus(item.status);
    var done = num(item.done) || 0;
    var total = num(item.total) || 0;
    var questions = num(item.questions) || 0;
    var blockers = num(item.blockers) || 0;
    return h('article', { class: 'nuu-row', 'data-status': status, 'data-updated': num(item.updatedAt), 'data-key': text(item.project) + '/' + text(item.slug) }, [
      h('div', { class: 'nuu-row-main' }, [
        href ? h('a', { class: 'nuu-row-title', href: href, text: text(item.title) || text(item.slug) })
          : h('span', { class: 'nuu-row-title', text: text(item.title) || text(item.slug) }),
        h('div', { class: 'nuu-row-sub' }, [
          h('span', { class: 'nuu-project', text: text(item.project) }),
          session ? h('span', { class: 'nuu-session-id', 'data-role': 'session-short', text: 'セッション ' + session }) : null
        ]),
        reviewChips(list(item.reviews).filter(isObject), href)
      ]),
      h('div', { class: 'nuu-row-status' }, [
        workBadge(status),
        h('span', { class: 'nuu-badge nuu-stale-badge', 'data-tone': 'waiting', 'data-role': 'stale', hidden: true }, [icon('alert'), h('span', { text: '15 分以上更新なし' })])
      ]),
      h('dl', { class: 'nuu-row-stats' }, [
        h('div', { class: 'nuu-row-stat' }, [h('dt', { text: '完了した手順' }), h('dd', null, [h('strong', { text: done + ' / ' + total }), bar(done, total, 'done')])]),
        h('div', { class: 'nuu-row-stat' }, [h('dt', { text: '未回答の質問' }), h('dd', null, h('strong', { 'data-tone': questions ? 'waiting' : null, text: questions + ' 件' }))]),
        h('div', { class: 'nuu-row-stat' }, [h('dt', { text: '止まっているもの' }), h('dd', null, h('strong', { 'data-tone': blockers ? 'blocked' : null, text: blockers + ' 件' }))]),
        h('div', { class: 'nuu-row-stat' }, [h('dt', { text: 'トークン' }), h('dd', { 'data-role': 'row-tokens' }, tokens === null
          ? h('strong', { class: 'nuu-muted', text: '集計前' })
          : [h('strong', { text: short(tokens) }), h('span', { class: 'nuu-exact', text: exact(tokens) })])])
      ]),
      h('div', { class: 'nuu-row-time' }, [h('span', { text: '最終更新 ' }), timeNode(item.updatedAt, 'both')])
    ]);
  }

  // 進行中、中断中、完了の順に分け、それぞれ最終更新が新しい順に並べる。
  function groupItems(items) {
    var groups = { active: [], paused: [], done: [] };
    items.forEach(function (item) {
      var status = workStatus(item.status);
      (groups[status] || groups.active).push(item);
    });
    GROUPS.forEach(function (key) {
      groups[key].sort(function (a, b) { return (num(b.updatedAt) || 0) - (num(a.updatedAt) || 0); });
    });
    return groups;
  }

  function renderGroups(input) {
    if (!input) return h('div', { class: 'nuu-loading', text: '読み込み中…' });
    var groups = groupItems(input);
    var shown = GROUPS.filter(function (key) { return groups[key].length; });
    if (!shown.length) return empty('まだ作業がありません');
    return shown.map(function (key) {
      return h('section', { class: 'nuu-section nuu-group', 'data-group': key }, [
        sectionHead(WORK[key].label, groups[key].length + ' 件'),
        h('div', { class: 'nuu-rows' }, groups[key].map(indexRow))
      ]);
    });
  }

  function renderOverview(input) {
    if (!input) return null;
    var groups = groupItems(input);
    return GROUPS.map(function (key) {
      return h('div', { class: 'nuu-overview', 'data-tone': WORK[key].tone }, [
        icon(WORK[key].icon),
        h('span', { text: WORK[key].label }),
        h('strong', { text: groups[key].length })
      ]);
    }).concat([h('p', { class: 'nuu-note nuu-overview-note', 'data-role': 'token-note', text: 'トークン量は、キャッシュの読み込みを除いた量です' })]);
  }

  // 一覧のデータ（と作業ごとの .usage.js の値）を受け取り、変わった欄だけを描き直す。
  function renderIndex(root, data, usages) {
    indexSkeleton(root);
    var items = isObject(data) ? list(data.items).filter(isObject) : null;
    var byKey = isObject(usages) ? usages : {};
    var rows = items && items.map(function (item) {
      var usage = byKey[text(item.project) + '/' + text(item.slug)];
      return Object.assign({}, item, { usage: isObject(usage) ? { sessionId: text(usage.sessionId), totals: usage.totals } : null });
    });
    var changed = withScrollKept(function () {
      var any = slot(root, 'overview', items, renderOverview);
      return slot(root, 'groups', rows, renderGroups) || any;
    });
    countRender(root, changed);
    tick(root);
    return root;
  }

  // ---------------------------------------------------------------- 時計と警告

  // 1 秒ごとに、時計、相対時刻、止まっている警告を書き換える。データの読み直しとは別に動く。
  function tick(root) {
    var now = Date.now();
    Array.prototype.forEach.call(root.querySelectorAll('[data-clock]'), function (node) {
      node.textContent = clockText(now);
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-at]'), function (node) {
      var format = TIME_FORMATS[node.getAttribute('data-format')];
      if (format) node.textContent = format(Number(node.getAttribute('data-at')), now);
    });
    var warning = root.querySelector('[data-role="stale-warning"]');
    if (warning) {
      var task = root.nuuTask;
      var stale = !!task && isStale(task.status, task.updatedAt, now);
      warning.hidden = !stale;
      if (stale) root.querySelector('[data-role="stale-since"]').textContent = TIME_FORMATS.both(task.updatedAt, now);
    }
    Array.prototype.forEach.call(root.querySelectorAll('.nuu-row'), function (row) {
      var stale = isStale(row.getAttribute('data-status'), Number(row.getAttribute('data-updated')), now);
      row.toggleAttribute('data-stale', stale);
      var chip = row.querySelector('[data-role="stale"]');
      if (chip) chip.hidden = !stale;
    });
  }

  // 3 回続けて読めなかったときだけ警告を出し、読めたら消す。
  function setFailures(root, failures, dataFile) {
    root.setAttribute('data-load-failures', String(failures));
    var warning = root.querySelector('[data-role="load-warning"]');
    if (!warning) return;
    warning.hidden = failures < FAILURE_LIMIT;
    root.querySelector('[data-role="load-warning-text"]').textContent =
      'データを読み込めません。' + dataFile + ' が、この HTML と同じフォルダーにあるか、形が崩れていないか確かめてください。';
  }

  // ---------------------------------------------------------------- 好み

  var currentPrefs = Object.assign({}, DEFAULT_PREFS);

  function normalizePrefs(prefs) {
    var p = isObject(prefs) ? prefs : {};
    var result = {};
    Object.keys(PREF_CHOICES).forEach(function (key) {
      result[key] = PREF_CHOICES[key].indexOf(p[key]) >= 0 ? p[key] : DEFAULT_PREFS[key];
    });
    result.accent = typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : DEFAULT_PREFS.accent;
    return result;
  }

  // アクセントの上に置く文字の色を、明るさから決める。
  function onAccent(hex) {
    var channel = function (i) {
      var c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    var luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    return luminance > 0.36 ? '#0B1214' : '#FFFFFF';
  }

  function applyPrefs(prefs) {
    var p = normalizePrefs(prefs);
    var html = document.documentElement;
    html.setAttribute('data-theme', p.theme);
    html.setAttribute('data-density', p.density);
    html.setAttribute('data-task-view', p.taskView);
    html.style.setProperty('--accent', p.accent);
    html.style.setProperty('--on-accent', onAccent(p.accent));
    var changed = JSON.stringify(p) !== JSON.stringify(currentPrefs);
    currentPrefs = p;
    if (changed && page && page.render) page.render();
    return p;
  }

  // ---------------------------------------------------------------- 受け取る部分

  var sequence = 0;

  // script 要素でファイルを読む。キャッシュを避けるため ?t= を付け、終わったら要素を外す。
  function loadScript(src, done) {
    var script = document.createElement('script');
    var finished = false;
    var finish = function (ok) {
      if (finished) return;
      finished = true;
      if (script.parentNode) script.parentNode.removeChild(script);
      done(ok);
    };
    sequence += 1;
    script.src = src + (src.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now() + '-' + sequence;
    script.onload = function () { finish(true); };
    script.onerror = function () { finish(false); };
    document.head.appendChild(script);
  }

  // コールバックを呼ぶ形のファイル（作業のデータ、一覧のデータ、好み）を読む。
  // onload までにコールバックが呼ばれたときだけ成功とする。書き込み途中の構文エラーは失敗になる。
  function loadCallbackFile(src, name, done) {
    var called = false;
    var value;
    var previous = window[name];
    window[name] = function (v) { called = true; value = v; };
    loadScript(src, function (ok) {
      window[name] = previous;
      done(ok && called, value, !ok);
    });
  }

  // .usage.js はコールバックを呼ばず window.NUU_USAGE[key] に代入する。
  // 読む前の値を覚えておき、別のオブジェクトに入れ替わっていれば成功とする。
  function loadUsage(src, key, done) {
    var store = window.NUU_USAGE = isObject(window.NUU_USAGE) ? window.NUU_USAGE : {};
    var before = store[key];
    loadScript(src, function (ok) {
      var after = isObject(window.NUU_USAGE) ? window.NUU_USAGE[key] : undefined;
      if (!ok) done('missing');
      else if (isObject(after) && after !== before) done('ok', after);
      else done('failed');
    });
  }

  window.nuuDashboardPrefs = applyPrefs;
  var page = null;

  function fileName() {
    var parts = location.pathname.split('/');
    var last = parts.pop() || '';
    var dir = parts.pop() || '';
    return { name: decodeURIComponent(last).replace(/\.html$/i, ''), dir: decodeURIComponent(dir) };
  }

  function taskPage(root) {
    var file = fileName();
    var base = encodeURIComponent(file.name);
    var dataFile = file.name + '.data.js';
    var key = file.dir + '/' + file.name;
    var state = { data: undefined, usage: undefined, failures: 0, loading: false, usageLoading: false };
    var self = {
      render: function () { renderTask(root, state.data, state.usage); },
      poll: function () {
        if (!state.loading) {
          state.loading = true;
          loadCallbackFile(base + '.data.js', 'nuuDashboardData', function (ok, value) {
            state.loading = false;
            if (ok && isObject(value)) {
              state.failures = 0;
              state.data = value;
            } else {
              state.failures += 1;
            }
            setFailures(root, state.failures, dataFile);
            self.render();
            countLoad(root, 'data-loads');
          });
        }
        if (!state.usageLoading) {
          state.usageLoading = true;
          loadUsage(base + '.usage.js', key, function (result, value) {
            state.usageLoading = false;
            root.setAttribute('data-usage-state', result === 'missing' && state.usage ? 'missing-kept' : result);
            if (result === 'ok') {
              state.usage = value;
              self.render();
            }
            countLoad(root, 'data-usage-loads');
          });
        }
        pollPrefs('../prefs.data.js', root);
      }
    };
    return self;
  }

  function indexPage(root) {
    var state = { data: undefined, usages: {}, failures: 0, loading: false, usageLoading: {} };
    var self = {
      render: function () { renderIndex(root, state.data, state.usages); },
      poll: function () {
        if (!state.loading) {
          state.loading = true;
          loadCallbackFile('index.data.js', 'nuuDashboardData', function (ok, value) {
            state.loading = false;
            if (ok && isObject(value)) {
              state.failures = 0;
              state.data = value;
              loadIndexUsages();
            } else {
              state.failures += 1;
            }
            setFailures(root, state.failures, 'index.data.js');
            self.render();
            countLoad(root, 'data-loads');
          });
        } else {
          loadIndexUsages();
        }
        pollPrefs('prefs.data.js', root);
      }
    };
    function loadIndexUsages() {
      var items = isObject(state.data) ? list(state.data.items).filter(isObject) : [];
      items.forEach(function (item) {
        var href = itemHref(item);
        var key = text(item.project) + '/' + text(item.slug);
        if (!href || state.usageLoading[key]) return;
        state.usageLoading[key] = true;
        loadUsage(href.replace(/\.html$/, '.usage.js'), key, function (result, value) {
          state.usageLoading[key] = false;
          if (result === 'ok') {
            state.usages[key] = value;
            self.render();
          }
          countLoad(root, 'data-usage-loads');
        });
      });
    }
    return self;
  }

  var prefsLoading = false;

  // 好みのファイルがなければ既定の見た目に戻す。壊れていれば今の見た目を保つ。
  function pollPrefs(src, root) {
    if (prefsLoading) return;
    prefsLoading = true;
    loadCallbackFile(src, 'nuuDashboardPrefs', function (ok, value, missing) {
      prefsLoading = false;
      if (ok) applyPrefs(value);
      else if (missing) applyPrefs(null);
      countLoad(root, 'data-prefs-loads');
    });
  }

  // 読み込みを終えた回数を属性に残す。読み直しが済んだことを外から確かめられるようにするため。
  function countLoad(root, name) {
    root.setAttribute(name, String(Number(root.getAttribute(name) || 0) + 1));
  }

  function boot() {
    var root = document.querySelector('[data-page]');
    if (!root) return;
    var kind = root.getAttribute('data-page');
    if (kind === 'task') page = taskPage(root);
    else if (kind === 'index') page = indexPage(root);
    else return;
    page.render();
    page.poll();
    setInterval(page.poll, POLL_MS);
    setInterval(function () { tick(root); }, 1000);
  }

  applyPrefs(null);

  // 描く部分を、ファイルの読み込みを通さずに使えるようにしておく（テストや、別の届け方のため）。
  window.NUU = {
    renderTask: renderTask,
    renderIndex: renderIndex,
    applyPrefs: applyPrefs,
    resumeCommand: resumeCommand,
    format: { short: short, exact: exact, time: timeText, ago: agoText, clock: clockText, model: modelName }
  };

  // スタブでは nuu.js のあとに好みのファイルを読む。最初の描画に好みが当たるよう、読み終えてから始める。
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
