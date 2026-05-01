// MyClaude dashboard — vanilla JS + SVG. No build step.
// Imports aggregator.js as a frozen API.

import * as Aggregator from './aggregator.js';

// ─── Aggregator binding (defensive — accept common export shapes) ──
// Picks the directory, then calls the aggregator with the handle.
async function pickAndAggregate(opts) {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('Directory picker not available — use a Chromium-based browser (Chrome, Edge, Arc, Brave).');
  }
  const dirHandle = await window.showDirectoryPicker({ id: 'myclaude-projects', mode: 'read' });
  const onProgress = opts && opts.onProgress;

  const candidates = [
    'aggregate', 'pickAndAggregate', 'pickDirectoryAndAggregate',
    'run', 'runAggregator', 'analyze', 'main', 'default',
  ];
  for (const k of candidates) {
    const fn = Aggregator[k];
    if (typeof fn === 'function') return fn(dirHandle, onProgress);
  }
  throw new Error(
    'aggregator.js exposes no known entry. Expected one of: ' + candidates.join(', '),
  );
}

// ─── State ──────────────────────────────────────────────────────────

const state = {
  agg: null,             // full aggregate from aggregator.js
  filter: { mode: 'all', year: null, month: null }, // mode: all|year|month
  project: null,         // active project filter (string name) or null
  derivedCache: new Map(), // key → derived view
};

// ─── DOM refs ───────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const dom = {
  body: document.body,
  landing: $('landing'),
  loading: $('loading'),
  loadingFill: $('loading-fill'),
  loadingSpinner: $('loading-spinner'),
  loadingStatus: $('loading-status'),
  loadingCount: $('loading-count'),
  errorState: $('error-state'),
  errorMsg: $('error-msg'),
  dashboard: $('dashboard'),
  btnPick: $('btn-pick'),
  btnPng: $('btn-png'),
  btnRetry: $('btn-retry'),
  displayName: $('display-name'),
  greet: $('greet'),
  greetName: $('greet-name'),
  greetSince: $('greet-since'),
  filters: document.querySelector('.filters'),
  yearSelect: $('year-select'),
  monthSelect: $('month-select'),
  rangeMeta: $('range-meta'),
  projectPin: $('project-pin'),
  projectPinName: $('project-pin-name'),
  projectClear: $('project-clear'),
  // metrics
  mCost: $('m-cost'),
  mMsgs: $('m-msgs'),
  mPrompts: $('m-prompts'),
  mTokens: $('m-tokens'),
  totalsSub: $('totals-sub'),
  totalsWindow: $('totals-window'),
  // streak
  streakCurrent: $('streak-current'),
  streakLongest: $('streak-longest'),
  // heatmap
  heatmap: $('heatmap'),
  hmTip: $('hm-tip'),
  // projects, models, tools
  projectsEl: $('projects'),
  modelBar: $('model-bar'),
  modelLegend: $('model-legend'),
  toolsEl: $('tools'),
  footNow: $('foot-now'),
};

// ─── Boot ───────────────────────────────────────────────────────────

dom.btnPick.addEventListener('click', onPick);
dom.btnRetry.addEventListener('click', onPick);
dom.btnPng.addEventListener('click', onPng);
dom.displayName.addEventListener('input', onDisplayNameChange);
dom.filters.addEventListener('click', onChipClick);
dom.yearSelect.addEventListener('change', () => {
  setFilter({ mode: 'year', year: dom.yearSelect.value });
});
dom.monthSelect.addEventListener('change', () => {
  setFilter({ mode: 'month', month: dom.monthSelect.value });
});
dom.projectClear.addEventListener('click', () => setProject(null));

// Restore display name from localStorage
const savedName = localStorage.getItem('myclaude.displayName') || '';
if (savedName) {
  dom.displayName.value = savedName;
}

// Browser capability check
if (!('showDirectoryPicker' in window)) {
  showError(
    'This browser does not support the File System Access API.\n' +
    'Please open in a Chromium-based browser (Chrome, Edge, Brave, Arc).',
  );
}

// ─── Picker / loader ────────────────────────────────────────────────

async function onPick() {
  hide(dom.errorState);
  hide(dom.dashboard);
  hide(dom.landing);
  show(dom.loading);
  // Braille spinner — same vibe as Hermes loaders.
  const BRAILLE = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let _frame = 0;
  const spinnerTimer = setInterval(() => {
    if (dom.loadingSpinner) dom.loadingSpinner.textContent = BRAILLE[_frame++ % BRAILLE.length];
  }, 80);
  setLoading('Reading directory…', 0);

  try {
    const t0 = performance.now();
    const agg = await pickAndAggregate({
      onProgress: (p) => {
        // Accept either {processed, total} or {percent}
        if (p && typeof p === 'object') {
          if (typeof p.percent === 'number') setLoading(p.label || 'Parsing…', p.percent);
          else if (typeof p.processed === 'number' && typeof p.total === 'number') {
            const pct = p.total ? p.processed / p.total : 0;
            setLoading(`Parsing JSONL · ${p.processed.toLocaleString()} / ${p.total.toLocaleString()}`, pct);
            dom.loadingCount.textContent = `${p.processed.toLocaleString()} files`;
          } else if (typeof p.processed === 'number') {
            dom.loadingCount.textContent = `${p.processed.toLocaleString()} files`;
          }
        }
      },
    });

    if (!agg || typeof agg !== 'object') {
      throw new Error('Aggregator returned no data.');
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    state.agg = agg;
    state.derivedCache.clear();
    state.project = null;

    populateSelects(agg);
    setFilter({ mode: 'all' }, /*skipRender*/ true);
    render();

    clearInterval(spinnerTimer);
    hide(dom.loading);
    show(dom.dashboard);
    dom.btnPng.disabled = false;
    dom.btnPick.textContent = 'Choose another folder';

    console.log(`[myclaude] aggregated in ${elapsed}s`, agg);
  } catch (err) {
    clearInterval(spinnerTimer);
    if (err && (err.name === 'AbortError' || /aborted|user activation/i.test(err.message || ''))) {
      // user cancelled — go back to landing
      hide(dom.loading);
      show(dom.landing);
      return;
    }
    showError(err);
  }
}

function setLoading(text, pct) {
  dom.loadingStatus.textContent = text;
  dom.loadingFill.style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;
}

function showError(err) {
  hide(dom.loading);
  hide(dom.dashboard);
  hide(dom.landing);
  show(dom.errorState);
  const msg = err instanceof Error ? `${err.name}: ${err.message}\n\n${err.stack || ''}` : String(err);
  dom.errorMsg.textContent = msg;
  console.error('[myclaude]', err);
}

// ─── Filter chips ───────────────────────────────────────────────────

function onChipClick(e) {
  const btn = e.target.closest('.chip[data-mode]');
  if (!btn) return;
  const mode = btn.dataset.mode;
  if (mode === 'year') {
    setFilter({ mode: 'year', year: dom.yearSelect.value || dom.yearSelect.options[0]?.value });
  } else if (mode === 'month') {
    setFilter({ mode: 'month', month: dom.monthSelect.value || dom.monthSelect.options[0]?.value });
  } else {
    setFilter({ mode: 'all' });
  }
}

function setFilter(next, skipRender) {
  state.filter = { ...state.filter, ...next };
  // sync chip active state
  document.querySelectorAll('.chip[data-mode]').forEach((c) => {
    const isActive = c.dataset.mode === state.filter.mode;
    c.classList.toggle('chip--active', isActive);
    c.setAttribute('aria-selected', isActive);
  });
  // sync selects
  if (state.filter.mode === 'year' && state.filter.year) dom.yearSelect.value = state.filter.year;
  if (state.filter.mode === 'month' && state.filter.month) dom.monthSelect.value = state.filter.month;
  // disable selects when not active
  dom.yearSelect.disabled = state.filter.mode !== 'year' && dom.yearSelect.options.length === 0;
  dom.monthSelect.disabled = state.filter.mode !== 'month' && dom.monthSelect.options.length === 0;
  if (!skipRender) render();
}

function setProject(name) {
  state.project = name;
  if (name) {
    dom.projectPinName.textContent = name;
    show(dom.projectPin);
  } else {
    hide(dom.projectPin);
  }
  render();
}

function populateSelects(agg) {
  // Populate year select
  const years = Object.keys(agg.yearly || {}).sort();
  dom.yearSelect.innerHTML = '';
  for (const y of years) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    dom.yearSelect.appendChild(opt);
  }
  if (years.length) dom.yearSelect.value = years[years.length - 1];
  dom.yearSelect.disabled = years.length === 0;

  // Populate month select
  const months = Object.keys(agg.monthly || {}).sort();
  dom.monthSelect.innerHTML = '';
  for (const m of months) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = formatMonthLong(m);
    dom.monthSelect.appendChild(opt);
  }
  if (months.length) dom.monthSelect.value = months[months.length - 1];
  dom.monthSelect.disabled = months.length === 0;
}

// ─── Derived view (memoized) ────────────────────────────────────────
// Returns: { totals, daily, byModel, byTool, streak, projectsRanked, range }

function deriveView() {
  const k = JSON.stringify(state.filter) + '|' + (state.project || '');
  if (state.derivedCache.has(k)) return state.derivedCache.get(k);

  const agg = state.agg;
  const filter = state.filter;
  let source;

  if (state.project) {
    source = (agg.byProject || []).find((p) => p.name === state.project) || null;
  }

  // Determine date window
  const range = computeRange(agg, filter);

  // Per-day map — prefer project-scoped daily; if absent, use global daily.
  const projectHasDaily = !!(source && source.daily);
  const dailySource = projectHasDaily ? source.daily : (agg.daily || {});
  const daily = {};
  for (const [date, bucket] of Object.entries(dailySource)) {
    if (!isInRange(date, range)) continue;
    daily[date] = bucket;
  }

  // Totals: if project-scoped without daily, use flat metrics (time window N/A);
  // otherwise sum buckets in window.
  let totals;
  if (source && !projectHasDaily) {
    totals = {
      messages:       numFromBucket(source, 'messages'),
      input_tokens:   numFromBucket(source, 'input_tokens'),
      output_tokens:  numFromBucket(source, 'output_tokens'),
      cache_creation: numFromBucket(source, 'cache_creation'),
      cache_read:     numFromBucket(source, 'cache_read'),
      cost:           numFromBucket(source, 'cost'),
      tool_calls:     numFromBucket(source, 'tool_calls'),
      user_prompts:   numFromBucket(source, 'user_prompts'),
    };
  } else {
    totals = sumBuckets(Object.values(daily));
  }

  // Model & tool split: prefer source-scoped, else compute from full agg using window
  let byModel = {};
  let byTool = {};

  if (source && source.byModel) {
    byModel = filterByMonthlyOrYearly(source.byModel, filter, source) || source.byModel;
  } else {
    // For global filter: aggregator-provided byModel is global (all-time). For year/month
    // we don't have per-model-per-day. Best-effort: scale by ratio of window cost to all-time cost,
    // which preserves model proportions when filtering. If no all-time totals, leave as-is.
    byModel = scaleSplit(agg.byModel || {}, totals, agg.totals || {});
  }
  if (source && source.byTool) {
    byTool = source.byTool;
  } else {
    byTool = scaleSplit(agg.byTool || {}, totals, agg.totals || {}, /*isCount*/ true);
  }

  // Projects ranking (by cost) within window — best-effort: if byProject items have daily
  // we recompute; otherwise we use their flat metrics (representing all-time).
  const projectsRanked = rankProjects(agg.byProject || [], range);

  // Streak within window
  const streak = computeStreak(daily, range);

  const view = { totals, daily, byModel, byTool, streak, projectsRanked, range };
  state.derivedCache.set(k, view);
  return view;
}

function sumBuckets(buckets) {
  const out = {
    messages: 0, input_tokens: 0, output_tokens: 0,
    cache_creation: 0, cache_read: 0, cost: 0,
    tool_calls: 0, user_prompts: 0,
  };
  for (const b of buckets) {
    if (!b) continue;
    for (const k of Object.keys(out)) {
      const v = b[k];
      if (typeof v === 'number') out[k] += v;
    }
  }
  return out;
}

function isInRange(dateStr, range) {
  if (!range) return true;
  return dateStr >= range.from && dateStr <= range.to;
}

function computeRange(agg, filter) {
  const firstSeen = agg.firstSeen || (agg.daily && Object.keys(agg.daily).sort()[0]) || null;
  const lastSeen  = agg.lastSeen  || (agg.daily && Object.keys(agg.daily).sort().slice(-1)[0]) || null;
  if (filter.mode === 'all') {
    return { from: firstSeen, to: lastSeen, label: 'All-time' };
  }
  if (filter.mode === 'year' && filter.year) {
    return { from: `${filter.year}-01-01`, to: `${filter.year}-12-31`, label: `${filter.year}` };
  }
  if (filter.mode === 'month' && filter.month) {
    const [y, m] = filter.month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      from: `${filter.month}-01`,
      to:   `${filter.month}-${String(lastDay).padStart(2, '0')}`,
      label: formatMonthLong(filter.month),
    };
  }
  return { from: firstSeen, to: lastSeen, label: 'All-time' };
}

// Scale a {key: value-or-bucket} split by ratio of window-cost / total-cost.
// Used when aggregator only provides global byModel/byTool — preserves proportions.
function scaleSplit(split, windowTotals, allTotals, isCount) {
  const ratio = (allTotals && allTotals.cost && allTotals.cost > 0)
    ? (windowTotals.cost / allTotals.cost)
    : 1;
  const out = {};
  for (const [k, v] of Object.entries(split)) {
    if (typeof v === 'number') {
      out[k] = isCount ? Math.round(v * ratio) : v * ratio;
    } else if (v && typeof v === 'object') {
      const scaled = {};
      for (const [kk, vv] of Object.entries(v)) {
        scaled[kk] = typeof vv === 'number' ? vv * ratio : vv;
      }
      out[k] = scaled;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function filterByMonthlyOrYearly(_split, _filter, _source) { return null; /* placeholder */ }

function rankProjects(byProject, _range) {
  // For now use the project-level metrics as-is (all-time).
  // Adding per-project per-day filtering would require aggregator support.
  const items = (byProject || [])
    .map((p) => ({
      name: p.name || p.path || 'unknown',
      path: p.path,
      cost: numFromBucket(p, 'cost'),
      messages: numFromBucket(p, 'messages'),
      tokens: numFromBucket(p, 'input_tokens') + numFromBucket(p, 'output_tokens'),
      original: p,
    }))
    .filter((p) => p.cost > 0 || p.messages > 0)
    .sort((a, b) => b.cost - a.cost);
  return items;
}

function numFromBucket(obj, key) {
  if (!obj) return 0;
  const v = obj[key];
  if (typeof v === 'number') return v;
  // sometimes nested under .totals
  if (obj.totals && typeof obj.totals[key] === 'number') return obj.totals[key];
  return 0;
}

function computeStreak(daily, range) {
  // current = consecutive days ending at min(today, range.to) with activity
  // longest = longest run of consecutive active days within window
  const dates = Object.keys(daily).sort();
  if (!dates.length) return { current: 0, longest: 0 };
  const set = new Set(dates);
  let longest = 0, run = 0;
  let prev = null;
  for (const d of dates) {
    if (prev && addDays(prev, 1) === d) run += 1;
    else run = 1;
    if (run > longest) longest = run;
    prev = d;
  }
  // current streak: walk back from range.to (or last date) while present
  const today = todayISO();
  const endRef = (range && range.to && range.to < today) ? range.to : today;
  let cur = 0;
  let cursor = endRef;
  while (set.has(cursor)) {
    cur += 1;
    cursor = addDays(cursor, -1);
  }
  return { current: cur, longest };
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDays(iso, delta) {
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
}

// ─── Render ─────────────────────────────────────────────────────────

function render() {
  if (!state.agg) return;
  const v = deriveView();
  renderMeta(v);
  renderGreet();
  renderTotals(v);
  renderStreak(v);
  renderHeatmap(v);
  renderProjects(v);
  renderModelSplit(v);
  renderTools(v);
  dom.footNow.textContent = new Date().toLocaleString();
}

function renderMeta(v) {
  const r = v.range;
  if (!r || !r.from) {
    dom.rangeMeta.textContent = '';
    dom.totalsWindow.textContent = '';
    return;
  }
  dom.rangeMeta.textContent = `${r.from} → ${r.to}`;
  // If project-scoped without daily, label notes that totals are project all-time
  const source = state.project ? (state.agg.byProject || []).find((p) => p.name === state.project) : null;
  const noScopedDaily = source && !source.daily;
  dom.totalsWindow.textContent = noScopedDaily ? `${state.project} · all-time` : r.label;
}

function renderGreet() {
  const name = (dom.displayName.value || '').trim();
  if (!name) { hide(dom.greet); return; }
  show(dom.greet);
  dom.greetName.textContent = name;
  const since = state.agg.firstSeen;
  dom.greetSince.textContent = since ? `· using Claude Code since ${formatDate(since)}` : '';
}

function onDisplayNameChange() {
  const v = (dom.displayName.value || '').trim();
  localStorage.setItem('myclaude.displayName', v);
  if (state.agg) renderGreet();
}

function renderTotals(v) {
  const t = v.totals;
  dom.mCost.textContent    = fmtMoney(t.cost);
  dom.mMsgs.textContent    = fmtInt(t.messages);
  dom.mPrompts.textContent = fmtInt(t.user_prompts);
  dom.mTokens.textContent  = fmtIntCompact(t.input_tokens + t.output_tokens);
  const cacheRead = t.cache_read || 0;
  const cacheCreate = t.cache_creation || 0;
  const tools = t.tool_calls || 0;
  dom.totalsSub.textContent =
    `cache read ${fmtIntCompact(cacheRead)} · ` +
    `cache write ${fmtIntCompact(cacheCreate)} · ` +
    `tool calls ${fmtInt(tools)}`;
}

function renderStreak(v) {
  dom.streakCurrent.textContent = v.streak.current;
  dom.streakLongest.textContent = v.streak.longest;
}

// Heatmap: day-of-week rows, week columns. Range is filter window.
const HM = {
  cell: 12, gap: 3,
  marginTop: 18, marginLeft: 28,
  monthLabelOffset: 14,
  dayLabels: ['Mon','Wed','Fri'],
  dayLabelRows: [1, 3, 5],
};

function renderHeatmap(v) {
  const svg = dom.heatmap;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const range = v.range;
  if (!range || !range.from || !range.to) {
    svg.setAttribute('width', 0); svg.setAttribute('height', 0);
    return;
  }

  // Compute quartile thresholds from values in window
  const counts = Object.values(v.daily).map(activityScore).filter((n) => n > 0);
  counts.sort((a,b) => a-b);
  const q = (p) => counts.length ? counts[Math.floor((counts.length - 1) * p)] : 0;
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75), t4 = q(0.9);

  const startDate = parseISO(range.from);
  const endDate = parseISO(range.to);

  // Snap startDate back to Sunday (column-aligned weeks)
  const startSunday = new Date(startDate);
  startSunday.setUTCDate(startSunday.getUTCDate() - startSunday.getUTCDay());

  const weeks = Math.ceil(((endDate - startSunday) / 86400000 + 1) / 7);
  const w = HM.marginLeft + weeks * (HM.cell + HM.gap) + 4;
  const h = HM.marginTop + 7 * (HM.cell + HM.gap) + 4;

  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // Day-of-week labels
  const NS = 'http://www.w3.org/2000/svg';
  HM.dayLabels.forEach((label, i) => {
    const row = HM.dayLabelRows[i];
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'hm-day-label');
    t.setAttribute('x', 0);
    t.setAttribute('y', HM.marginTop + row * (HM.cell + HM.gap) + HM.cell - 2);
    t.textContent = label;
    svg.appendChild(t);
  });

  // Cells
  let lastMonth = -1;
  for (let week = 0; week < weeks; week++) {
    for (let dow = 0; dow < 7; dow++) {
      const date = new Date(startSunday);
      date.setUTCDate(startSunday.getUTCDate() + week * 7 + dow);
      const iso = isoUTC(date);
      if (iso < range.from || iso > range.to) continue;
      const x = HM.marginLeft + week * (HM.cell + HM.gap);
      const y = HM.marginTop + dow * (HM.cell + HM.gap);
      const bucket = v.daily[iso];
      const count = bucket ? activityScore(bucket) : 0;
      const lvl = bucketLevel(count, t1, t2, t3, t4);
      const fill = ['var(--hm-empty)', 'var(--hm-1)', 'var(--hm-2)', 'var(--hm-3)', 'var(--hm-4)'][lvl];
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('class', 'hm-cell');
      r.setAttribute('x', x);
      r.setAttribute('y', y);
      r.setAttribute('width', HM.cell);
      r.setAttribute('height', HM.cell);
      r.setAttribute('fill', count === 0 ? 'var(--hm-empty)' : fill);
      r.setAttribute('data-date', iso);
      r.setAttribute('data-count', count);
      r.setAttribute('data-cost', bucket ? (bucket.cost || 0).toFixed(2) : '0');
      r.addEventListener('mouseenter', onHmEnter);
      r.addEventListener('mouseleave', onHmLeave);
      r.addEventListener('focus', onHmEnter);
      r.addEventListener('blur', onHmLeave);
      svg.appendChild(r);

      // Month labels along top: when month changes at top of column
      if (dow === 0) {
        const m = date.getUTCMonth();
        if (m !== lastMonth && date.getUTCDate() <= 7) {
          const txt = document.createElementNS(NS, 'text');
          txt.setAttribute('class', 'hm-month-label');
          txt.setAttribute('x', x);
          txt.setAttribute('y', HM.monthLabelOffset);
          txt.textContent = MONTHS_SHORT[m];
          svg.appendChild(txt);
          lastMonth = m;
        }
      }
    }
  }
}

function activityScore(bucket) {
  // Use messages as primary score; fall back to tokens/cost
  if (!bucket) return 0;
  if (typeof bucket.messages === 'number' && bucket.messages > 0) return bucket.messages;
  const tok = (bucket.input_tokens || 0) + (bucket.output_tokens || 0);
  if (tok > 0) return Math.ceil(tok / 1000);
  if (bucket.cost) return Math.ceil(bucket.cost * 10);
  return 0;
}

function bucketLevel(count, t1, t2, t3, t4) {
  if (count <= 0) return 0;
  if (count <= t1) return 1;
  if (count <= t2) return 2;
  if (count <= t3) return 3;
  if (count <= t4) return 4;
  return 4;
}

function onHmEnter(e) {
  const r = e.currentTarget;
  const date = r.getAttribute('data-date');
  const count = +r.getAttribute('data-count');
  const cost = parseFloat(r.getAttribute('data-cost'));
  const tip = dom.hmTip;
  const label = count > 0
    ? `${formatDate(date)} · ${count} ${count === 1 ? 'msg' : 'msgs'} · $${cost.toFixed(2)}`
    : `${formatDate(date)} · no activity`;
  tip.textContent = label;
  show(tip);
  const rect = r.getBoundingClientRect();
  tip.style.left = `${rect.left + rect.width/2}px`;
  tip.style.top  = `${rect.top}px`;
}
function onHmLeave() { hide(dom.hmTip); }

function renderProjects(v) {
  const list = v.projectsRanked.slice(0, 10);
  const max = list.length ? list[0].cost : 1;
  dom.projectsEl.innerHTML = '';
  if (!list.length) {
    dom.projectsEl.innerHTML = '<div class="dim mono" style="padding:12px">No projects in window.</div>';
    return;
  }
  list.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'proj' + (state.project === p.name ? ' proj--active' : '');
    btn.innerHTML = `
      <span class="proj__rank">${String(i+1).padStart(2,'0')}</span>
      <span class="proj__main">
        <span class="proj__name" title="${escapeAttr(p.path || p.name)}">${escapeHtml(p.name)}</span>
        <span class="proj__bar"><span class="proj__bar-fill" style="width:${(p.cost / max * 100).toFixed(1)}%"></span></span>
      </span>
      <span class="proj__cost">${fmtMoney(p.cost)}</span>
    `;
    btn.addEventListener('click', () => {
      setProject(state.project === p.name ? null : p.name);
    });
    dom.projectsEl.appendChild(btn);
  });
}

function renderModelSplit(v) {
  const entries = Object.entries(v.byModel || {})
    .map(([name, val]) => ({
      name,
      cost: typeof val === 'number' ? val : (val && val.cost) || 0,
      output: typeof val === 'object' ? (val.output_tokens || 0) : 0,
    }))
    .filter((e) => e.cost > 0 || e.output > 0);

  const denom = entries.reduce((s, e) => s + (e.output || e.cost), 0) || 1;
  entries.sort((a, b) => (b.output || b.cost) - (a.output || a.cost));

  // Render bar
  dom.modelBar.innerHTML = '';
  if (!entries.length) {
    dom.modelBar.innerHTML = `<div style="flex:1; display:flex; align-items:center; justify-content:center; color:var(--muted); font-family:var(--font-mono); font-size:11px">no model data in window</div>`;
    dom.modelLegend.innerHTML = '';
    return;
  }

  entries.forEach((e) => {
    const pct = ((e.output || e.cost) / denom) * 100;
    const seg = document.createElement('div');
    seg.className = 'model-bar__seg';
    seg.style.flex = `${pct} 1 0`;
    const { color, ink } = modelColor(e.name);
    seg.style.background = color;
    seg.dataset.light = ink ? '1' : '0';
    if (pct >= 6) seg.textContent = `${pct.toFixed(0)}%`;
    seg.title = `${e.name} · ${pct.toFixed(1)}% · ${fmtMoney(e.cost)}`;
    dom.modelBar.appendChild(seg);
  });

  dom.modelLegend.innerHTML = '';
  entries.forEach((e) => {
    const pct = ((e.output || e.cost) / denom) * 100;
    const li = document.createElement('li');
    const { color } = modelColor(e.name);
    li.innerHTML = `
      <span class="model-legend__swatch" style="background:${color}"></span>
      <span class="model-legend__name">${escapeHtml(prettyModelName(e.name))}</span>
      <span class="model-legend__pct">${pct.toFixed(1)}%</span>
      <span class="model-legend__cost">${fmtMoney(e.cost)}</span>
    `;
    dom.modelLegend.appendChild(li);
  });
}

function modelColor(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('opus'))   return { color: 'var(--model-opus)',   ink: false };
  if (n.includes('sonnet')) return { color: 'var(--model-sonnet)', ink: false };
  if (n.includes('haiku'))  return { color: 'var(--model-haiku)',  ink: true };
  return { color: 'var(--model-other)', ink: false };
}
function prettyModelName(n) {
  return (n || '').replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-/g, ' ');
}

function renderTools(v) {
  const entries = Object.entries(v.byTool || {})
    .map(([name, count]) => ({ name, count: typeof count === 'number' ? count : (count && count.count) || 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  dom.toolsEl.innerHTML = '';
  if (!entries.length) {
    dom.toolsEl.innerHTML = '<div class="dim mono" style="padding:12px">No tool calls in window.</div>';
    return;
  }
  entries.forEach((e, i) => {
    const div = document.createElement('div');
    div.className = 'tool';
    div.innerHTML = `
      <span class="tool__rank">${String(i+1).padStart(2,'0')}</span>
      <span class="tool__name">${escapeHtml(e.name)}</span>
      <span class="tool__count">${fmtInt(e.count)}</span>
    `;
    dom.toolsEl.appendChild(div);
  });
}

// ─── Download PNG ───────────────────────────────────────────────────

async function onPng() {
  if (!state.agg) return;
  if (typeof window.domtoimage === 'undefined') {
    alert('PNG exporter failed to load (CDN blocked?). Use the browser\'s built-in screenshot.');
    return;
  }
  dom.btnPng.disabled = true;
  const original = dom.btnPng.textContent;
  dom.btnPng.textContent = 'Rendering…';

  // Build a share-only stage off-screen: toolbar + greeting + totals + streak + heatmap.
  // Clone the live nodes so we don't disturb the dashboard.
  const stage = document.createElement('div');
  stage.className = 'share-stage';
  stage.style.cssText = `
    position: fixed; left: -10000px; top: 0;
    width: 1280px;
    background: ${getCss('--bg') || '#FAF9F5'};
    padding: 64px 72px;
    box-sizing: border-box;
    font-family: ${getComputedStyle(document.body).fontFamily};
    color: ${getCss('--ink') || '#1a1a1a'};
  `;

  const sources = [
    document.querySelector('.toolbar'),
    document.querySelector('#greet'),
    document.querySelector('.grid--top'),         // totals + streak row
    document.querySelector('.card--heatmap'),
  ].filter(Boolean);

  for (const src of sources) {
    if (src.hasAttribute('hidden')) continue;
    const clone = src.cloneNode(true);
    clone.style.marginBottom = '32px';
    // Drop interactive affordances inside the clone so it reads as static.
    clone.querySelectorAll('button, select, input').forEach(el => {
      el.style.pointerEvents = 'none';
    });
    // Hide the project pin if not active.
    const pin = clone.querySelector('#project-pin');
    if (pin && pin.hasAttribute('hidden')) pin.remove();
    stage.appendChild(clone);
  }

  // Footer brand line.
  const foot = document.createElement('div');
  foot.style.cssText = `margin-top: 24px; font-family: ${getCss('--font-mono') || 'monospace'}; font-size: 12px; color: ${getCss('--muted') || '#888'}; display:flex; justify-content:space-between;`;
  foot.innerHTML = `<span>myclaude · stats.howtoai.sh</span><span>${todayISO()}</span>`;
  stage.appendChild(foot);

  document.body.appendChild(stage);

  try {
    // Wait one frame so cloned SVG layout settles.
    await new Promise(r => requestAnimationFrame(r));
    const scale = 2;
    const w = stage.offsetWidth;
    const h = stage.offsetHeight;
    const blob = await window.domtoimage.toBlob(stage, {
      bgcolor: getCss('--bg') || '#FAF9F5',
      width: w * scale,
      height: h * scale,
      style: {
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        width: w + 'px',
        height: h + 'px',
      },
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = (dom.displayName.value || 'myclaude').trim().replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    a.download = `${name || 'myclaude'}-stats-${todayISO()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    console.error(err);
    alert('PNG export failed: ' + (err.message || err));
  } finally {
    stage.remove();
    dom.btnPng.textContent = original;
    dom.btnPng.disabled = false;
  }
}

function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';
}

// ─── Helpers ────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatMonthLong(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  return `${MONTHS_LONG[m-1]} ${y}`;
}
function formatDate(iso) {
  const [y,m,d] = iso.split('-').map(Number);
  return `${MONTHS_SHORT[m-1]} ${d}, ${y}`;
}
function parseISO(iso) {
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m-1, d));
}
function isoUTC(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function fmtInt(n) {
  return Math.round(n || 0).toLocaleString();
}
function fmtIntCompact(n) {
  n = n || 0;
  if (n < 1000) return n.toString();
  if (n < 1e6)  return (n/1e3).toFixed(n < 1e4 ? 1 : 0) + 'K';
  if (n < 1e9)  return (n/1e6).toFixed(n < 1e7 ? 1 : 0) + 'M';
  return (n/1e9).toFixed(1) + 'B';
}
function fmtMoney(n) {
  n = n || 0;
  if (n >= 1000) return '$' + (n/1000).toFixed(1) + 'K';
  if (n >= 100)  return '$' + n.toFixed(0);
  if (n >= 10)   return '$' + n.toFixed(1);
  return '$' + n.toFixed(2);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }
