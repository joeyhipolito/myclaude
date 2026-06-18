/**
 * Claude JSONL aggregator — File System Access API edition.
 *
 * Processes files one-by-one (stream parse) to stay memory-flat across 13k+ files.
 * Export shape:
 *   { totals, daily, monthly, yearly, byProject, byModel, byTool, firstSeen, lastSeen, streak }
 */

// USD per million tokens. Extend when new models appear in real data.
export const PRICING = {
  // Claude 5 — Fable / Mythos (most capable; 2× Opus-tier list price)
  'claude-fable-5':                   { input: 10.00, output: 50.00, cacheWrite5m: 12.50, cacheWrite1h: 20.00, cacheRead: 1.00 },
  'claude-mythos-5':                  { input: 10.00, output: 50.00, cacheWrite5m: 12.50, cacheWrite1h: 20.00, cacheRead: 1.00 },
  // Claude 4 — Opus
  'claude-opus-4-8':                  { input: 5.00,  output: 25.00, cacheWrite5m:  6.25, cacheWrite1h: 10.00, cacheRead: 0.50 },
  'claude-opus-4-7':                  { input: 5.00,  output: 25.00, cacheWrite5m:  6.25, cacheWrite1h: 10.00, cacheRead: 0.50 },
  'claude-opus-4-6':                  { input: 5.00,  output: 25.00, cacheWrite5m:  6.25, cacheWrite1h: 10.00, cacheRead: 0.50 },
  'claude-opus-4-5':                  { input: 5.00,  output: 25.00, cacheWrite5m:  6.25, cacheWrite1h: 10.00, cacheRead: 0.50 },
  // Claude 4 — Sonnet
  'claude-sonnet-4-7':                { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 },
  'claude-sonnet-4-6':                { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 },
  'claude-sonnet-4-5':                { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 },
  // Claude 4 — Haiku
  'claude-haiku-4-5':                 { input: 1.00,  output:  5.00, cacheWrite5m:  1.25, cacheWrite1h:  2.00, cacheRead: 0.10 },
  'claude-haiku-4-5-20251001':        { input: 1.00,  output:  5.00, cacheWrite5m:  1.25, cacheWrite1h:  2.00, cacheRead: 0.10 },
  // Claude 3.7
  'claude-3-7-sonnet-20250219':       { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 },
  // Claude 3.5
  'claude-3-5-sonnet-20241022':       { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 },
  'claude-3-5-sonnet-20240620':       { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 },
  'claude-3-5-haiku-20241022':        { input: 0.80,  output:  4.00, cacheWrite5m:  1.00, cacheWrite1h:  1.60, cacheRead: 0.08 },
  // Claude 3
  'claude-3-opus-20240229':           { input: 15.00, output: 75.00, cacheWrite5m: 18.75, cacheWrite1h: 30.00, cacheRead: 1.50 },
  'claude-3-sonnet-20240229':         { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 },
  'claude-3-haiku-20240307':          { input: 0.25,  output:  1.25, cacheWrite5m:  0.30, cacheWrite1h:  0.50, cacheRead: 0.03 },
  // Claude 2
  'claude-2.1':                       { input: 8.00,  output: 24.00, cacheWrite5m: 10.00, cacheWrite1h: 16.00, cacheRead: 0.80 },
  'claude-2.0':                       { input: 8.00,  output: 24.00, cacheWrite5m: 10.00, cacheWrite1h: 16.00, cacheRead: 0.80 },
};

// Fallback pricing when model isn't in the table — match by prefix.
const PRICING_FALLBACKS = [
  ['claude-fable',      { input: 10.00, output: 50.00, cacheWrite5m: 12.50, cacheWrite1h: 20.00, cacheRead: 1.00 }],
  ['claude-mythos',     { input: 10.00, output: 50.00, cacheWrite5m: 12.50, cacheWrite1h: 20.00, cacheRead: 1.00 }],
  ['claude-opus-4',     { input: 5.00,  output: 25.00, cacheWrite5m:  6.25, cacheWrite1h: 10.00, cacheRead: 0.50 }],
  ['claude-sonnet-4',   { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 }],
  ['claude-haiku-4',    { input: 1.00,  output:  5.00, cacheWrite5m:  1.25, cacheWrite1h:  2.00, cacheRead: 0.10 }],
  ['claude-3-opus',     { input: 15.00, output: 75.00, cacheWrite5m: 18.75, cacheWrite1h: 30.00, cacheRead: 1.50 }],
  ['claude-3-5-sonnet', { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 }],
  ['claude-3-sonnet',   { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 }],
  ['claude-3-haiku',    { input: 0.25,  output:  1.25, cacheWrite5m:  0.30, cacheWrite1h:  0.50, cacheRead: 0.03 }],
  ['claude-2',          { input: 8.00,  output: 24.00, cacheWrite5m: 10.00, cacheWrite1h: 16.00, cacheRead: 0.80 }],
];

// Bare aliases Claude Code sometimes records instead of the full model id.
const MODEL_ALIASES = {
  opus:   'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku:  'claude-haiku-4-5',
  fable:  'claude-fable-5',
  mythos: 'claude-mythos-5',
};

const _unpricedWarned = new Set();

/** Canonicalise a model string: strip a provider prefix ("anthropic/…"),
 *  strip a context-window suffix ("[1m]"), and expand bare aliases. */
export function normalizeModel(model) {
  if (!model) return '';
  let m = String(model).toLowerCase().trim();
  const slash = m.lastIndexOf('/');        // "anthropic/claude-…" → "claude-…"
  if (slash >= 0) m = m.slice(slash + 1);
  m = m.replace(/\[[^\]]*\]\s*$/, '');      // "claude-opus-4-8[1m]" → "claude-opus-4-8"
  if (MODEL_ALIASES[m]) m = MODEL_ALIASES[m];
  return m;
}

function pricingFor(model) {
  const m = normalizeModel(model);
  if (!m) return null;
  if (PRICING[m]) return PRICING[m];
  for (const [prefix, p] of PRICING_FALLBACKS) {
    if (m.startsWith(prefix)) return p;
  }
  // Unknown but token-bearing model: its tokens are still counted, so warn once
  // rather than letting cost silently fall to $0 with no signal.
  if (m && m !== '<synthetic>' && !_unpricedWarned.has(m)) {
    _unpricedWarned.add(m);
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[myclaude] no pricing for model "${model}" — tokens counted, cost charged as $0. Add it to PRICING in aggregator.js.`);
    }
  }
  return null;
}

export function newBucket() {
  return { messages: 0, input_tokens: 0, output_tokens: 0, cache_creation: 0, cache_read: 0, cost: 0, tool_calls: 0, user_prompts: 0 };
}

function addToBucket(dst, src) {
  dst.messages      += src.messages;
  dst.input_tokens  += src.input_tokens;
  dst.output_tokens += src.output_tokens;
  dst.cache_creation+= src.cache_creation;
  dst.cache_read    += src.cache_read;
  dst.cost          += src.cost;
  dst.tool_calls    += src.tool_calls;
  dst.user_prompts  += src.user_prompts;
}

function computeCost(usage, model) {
  const p = pricingFor(model);
  if (!p) return 0;
  const M = 1_000_000;

  const inp   = (usage.input_tokens || 0) * p.input  / M;
  const out   = (usage.output_tokens || 0) * p.output / M;
  const cRead = (usage.cache_read_input_tokens || 0) * p.cacheRead / M;

  // Prefer split cache_creation object (5m vs 1h) when available
  let cWrite = 0;
  const cc = usage.cache_creation;
  if (cc && typeof cc === 'object') {
    cWrite += (cc.ephemeral_5m_input_tokens || 0) * p.cacheWrite5m / M;
    cWrite += (cc.ephemeral_1h_input_tokens || 0) * p.cacheWrite1h / M;
  } else {
    // Fall back to flat cache_creation_input_tokens at 5m rate
    cWrite += (usage.cache_creation_input_tokens || 0) * p.cacheWrite5m / M;
  }

  return inp + out + cRead + cWrite;
}

/** Classify a cwd-encoded project folder so non-interactive sessions
 *  (orchestrator workers, git worktrees, OS/Go test sandboxes) can be excluded
 *  from "your usage". Returns 'project' | 'worktree' | 'workspace' | 'test'. */
export function classifyFolder(folderName) {
  if (!folderName) return 'project';
  const f = folderName.toLowerCase();
  if (f.startsWith('-private-tmp') || f.startsWith('-private-var') ||
      f.startsWith('-tmp-') || f.includes('-var-folders-') ||
      f.includes('-t-test') || f.includes('tmp-claude-')) return 'test';
  if (f.includes('-worktrees-')) return 'worktree';
  if (f.includes('-workspaces-')) return 'workspace';
  return 'project';
}

const NOISE_CATEGORIES = new Set(['worktree', 'workspace', 'test']);

/** Human-readable project label from a cwd-encoded folder name. Strips trailing
 *  orchestrator suffixes (…-workers-<persona>-phase-N, …-agents-…, bare phase
 *  numbers / hashes) so the label is the repo, not a phase number. */
export function projectNameFromFolder(folderName) {
  if (!folderName) return 'unknown';
  const segs = folderName.split('-').filter(Boolean);
  if (!segs.length) return folderName;
  const NOISE = new Set(['workers', 'agents', 'phase', 'workspaces', 'worktrees']);
  let end = segs.length;
  while (end > 1) {
    const s = segs[end - 1];
    if (NOISE.has(s) || /^\d+$/.test(s) || /^[0-9a-f]{8,}$/.test(s)) { end--; continue; }
    break;
  }
  return segs[end - 1];
}

function dateKey(ts) {
  // Bucket by the viewer's LOCAL calendar day. Transcripts are UTC ('…Z'); a raw
  // slice(0,10) misfiles early-local-morning work to the previous day for non-UTC
  // users (and can zero out an active streak). Format the local Y-M-D instead.
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function bucketFor(map, key) {
  if (!map[key]) map[key] = newBucket();
  return map[key];
}

/** True only for a genuine typed user turn — NOT the synthetic user record
 *  Claude Code writes after each tool call (carries a tool_result block), and
 *  not meta/sidechain turns. record.promptId does NOT distinguish these — it is
 *  present on ~100% of user records, so counting on it overstates "your prompts"
 *  by ~10×. The real discriminator is the content shape. */
export function isGenuineUserPrompt(record) {
  if (!record || record.type !== 'user' || !record.message) return false;
  if (record.toolUseResult || record.isMeta || record.isSidechain) return false;
  const content = record.message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    let hasText = false;
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'tool_result') return false; // synthetic post-tool turn
      if (block.type === 'text' || typeof block === 'string') hasText = true;
    }
    return hasText;
  }
  return false;
}

/**
 * Process a single parsed JSONL record into the running state.
 * seenMsgIds: Set — dataset-wide dedup of message.id. Resumed/forked sessions
 *             replay the same assistant turn across files; deduping per-file
 *             (the old behaviour) double-counted those, inflating tokens/cost.
 */
export function processRecord(record, projectFolder, state, seenMsgIds) {
  const { type, timestamp, message } = record;

  if (type === 'assistant' && message) {
    const model   = message.model || '';
    const usage   = message.usage || {};
    const msgId   = message.id;
    const day     = dateKey(timestamp);

    // Count tool_uses from content (may be split across records for same msgId)
    let toolsThisRecord = 0;
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block && block.type === 'tool_use' && block.name) {
          toolsThisRecord++;
          state.byTool[block.name] = (state.byTool[block.name] || 0) + 1;
        }
      }
    }

    // Dedup usage on message.id to avoid double-counting streaming splits
    const countUsage = !msgId || !seenMsgIds.has(msgId);
    if (msgId) seenMsgIds.add(msgId);

    if (countUsage) {
      const inputTok  = usage.input_tokens || 0;
      const outputTok = usage.output_tokens || 0;
      const cacheC    = usage.cache_creation_input_tokens || 0;
      const cacheR    = usage.cache_read_input_tokens || 0;
      const cost      = computeCost(usage, model);

      const delta = {
        messages: 1,
        input_tokens: inputTok,
        output_tokens: outputTok,
        cache_creation: cacheC,
        cache_read: cacheR,
        cost,
        tool_calls: toolsThisRecord,
        user_prompts: 0,
      };

      addToBucket(state.totals, delta);
      if (record.isSidechain) addToBucket(state.subagent, delta); // Task/subagent spend (disclosed separately)
      if (day) {
        addToBucket(bucketFor(state.daily, day), delta);
        addToBucket(bucketFor(state.monthly, day.slice(0, 7)), delta);
        addToBucket(bucketFor(state.yearly, day.slice(0, 4)), delta);
        state._days.add(day);
      }
      if (projectFolder) addToBucket(bucketFor(state.byProject, projectFolder), delta);
      if (model) addToBucket(bucketFor(state.byModel, model), delta);

      if (day) {
        if (!state.firstSeen || day < state.firstSeen) state.firstSeen = day;
        if (!state.lastSeen  || day > state.lastSeen)  state.lastSeen  = day;
      }
    } else if (toolsThisRecord > 0) {
      // Still record tool_calls for the duplicate usage record
      state.totals.tool_calls += toolsThisRecord;
      if (day) {
        bucketFor(state.daily,   day).tool_calls           += toolsThisRecord;
        bucketFor(state.monthly, day.slice(0, 7)).tool_calls += toolsThisRecord;
        bucketFor(state.yearly,  day.slice(0, 4)).tool_calls += toolsThisRecord;
      }
      if (projectFolder) bucketFor(state.byProject, projectFolder).tool_calls += toolsThisRecord;
      if (model) bucketFor(state.byModel, model).tool_calls += toolsThisRecord;
    }
  } else if (isGenuineUserPrompt(record)) {
    const day = dateKey(timestamp);
    state.totals.user_prompts++;
    if (day) {
      bucketFor(state.daily,   day).user_prompts++;
      bucketFor(state.monthly, day.slice(0, 7)).user_prompts++;
      bucketFor(state.yearly,  day.slice(0, 4)).user_prompts++;
      state._days.add(day);
      if (!state.firstSeen || day < state.firstSeen) state.firstSeen = day;
      if (!state.lastSeen  || day > state.lastSeen)  state.lastSeen  = day;
    }
    if (projectFolder) bucketFor(state.byProject, projectFolder).user_prompts++;
  }
}

function computeStreak(sortedDays) {
  if (sortedDays.length === 0) return { current: 0, longest: 0 };

  const today = new Date().toISOString().slice(0, 10);
  let longest = 1, run = 1, current = 0;

  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(sortedDays[i - 1]);
    const curr = new Date(sortedDays[i]);
    const diff = (curr - prev) / 86_400_000;
    if (diff === 1) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Current streak: consecutive days ending at today or yesterday
  const last = sortedDays[sortedDays.length - 1];
  const daysBehind = (new Date(today) - new Date(last)) / 86_400_000;
  if (daysBehind <= 1) {
    // Walk backwards from last
    current = 1;
    for (let i = sortedDays.length - 2; i >= 0; i--) {
      const a = new Date(sortedDays[i]);
      const b = new Date(sortedDays[i + 1]);
      if ((b - a) / 86_400_000 === 1) current++;
      else break;
    }
  }

  return { current, longest };
}

function newState() {
  return {
    totals: newBucket(),
    daily: {},
    monthly: {},
    yearly: {},
    byProject: {},
    byModel: {},
    byTool: {},
    firstSeen: null,
    lastSeen: null,
    _days: new Set(),
    seenMsgIds: new Set(),        // dataset-wide (not per-file) — kills cross-file dup over-count
    subagent: newBucket(),        // isSidechain (Task/subagent) spend, for disclosure
    skipped: { worktree: 0, workspace: 0, test: 0 }, // non-interactive folders excluded
    history: null,                // long-range prompt calendar from history.jsonl (Oct→now)
    archive: null,                // pre-pruning aggregate from stats-cache.json (Dec→Apr)
  };
}

/**
 * Ingest ~/.claude/history.jsonl — Claude Code's append-only prompt history.
 * It survives the 30-day projects pruning, so it carries the FULL activity
 * calendar (months further back than the transcript corpus) and the authoritative
 * "your prompts" count. Lines: { display, pastedContents, project, timestamp(ms) }.
 */
export function ingestHistoryText(text, state) {
  if (!state.history) state.history = { days: {}, total: 0 };
  let start = 0;
  const len = text.length;
  while (start < len) {
    const end = text.indexOf('\n', start);
    const line = end < 0 ? text.slice(start) : text.slice(start, end);
    start = end < 0 ? len : end + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try { rec = JSON.parse(trimmed); } catch { continue; }
    if (typeof rec.timestamp !== 'number') continue;
    const day = dateKey(rec.timestamp);
    if (!day) continue;
    state.history.days[day] = (state.history.days[day] || 0) + 1;
    state.history.total++;
  }
}

/**
 * Parse ~/.claude/stats-cache.json — Claude Code's pre-computed /stats aggregate.
 * Spans before the projects pruning floor (e.g. Dec→Apr) but is frozen at
 * lastComputedDate. Surfaced as a disclosed "archived" addendum, never merged
 * into the live cost/token totals (different, non-overlapping window).
 */
export function parseStatsCache(j) {
  if (!j || typeof j !== 'object') return null;
  const mu = j.modelUsage || {};
  let input = 0, output = 0, cacheRead = 0, cacheCreate = 0, cost = 0;
  for (const [model, u] of Object.entries(mu)) {
    const inp = u.inputTokens || 0, out = u.outputTokens || 0;
    const cr = u.cacheReadInputTokens || 0, cc = u.cacheCreationInputTokens || 0;
    input += inp; output += out; cacheRead += cr; cacheCreate += cc;
    cost += computeCost({
      input_tokens: inp, output_tokens: out,
      cache_read_input_tokens: cr, cache_creation_input_tokens: cc,
    }, model);
  }
  return {
    from: (j.firstSessionDate || '').slice(0, 10) || null,
    to: j.lastComputedDate || null,
    sessions: j.totalSessions || 0,
    messages: j.totalMessages || 0,
    input_tokens: input, output_tokens: output,
    cache_read: cacheRead, cache_creation: cacheCreate,
    cost,
    computed: !!(input || output || cacheRead || cacheCreate),
  };
}

async function processFileHandle(fileHandle, projectFolder, state) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  const seenMsgIds = state.seenMsgIds; // dataset-wide dedup (shared across files)
  let start = 0;
  const len = text.length;
  while (start < len) {
    const end = text.indexOf('\n', start);
    const line = end < 0 ? text.slice(start) : text.slice(start, end);
    start = end < 0 ? len : end + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record;
    try { record = JSON.parse(trimmed); } catch { continue; }
    processRecord(record, projectFolder, state, seenMsgIds);
  }
}

async function walkDirectory(dirHandle, parentFolder, state, onProgress, depth = 0) {
  // The immediate children of the root are project folders.
  // Deeper recursion passes the folder name along unchanged.
  // Iterate directory entries — Chromium versions disagree on the API:
  //   • current spec: dirHandle.values() yields handles (handle.name lives on the handle)
  //   • older:        dirHandle.entries() yields [name, handle]
  //   • briefly:      dirHandle itself was async-iterable
  let iter;
  if (typeof dirHandle.values === 'function') {
    iter = dirHandle.values();
  } else if (typeof dirHandle.entries === 'function') {
    iter = dirHandle.entries();
  } else if (typeof dirHandle[Symbol.asyncIterator] === 'function') {
    iter = dirHandle;
  } else {
    throw new Error('Directory handle is not iterable in this browser. Use Chromium 86+.');
  }
  for await (const entry of iter) {
    // Normalise: values() gives handle, entries() gives [name, handle].
    const handle = Array.isArray(entry) ? entry[1] : entry;
    const name = Array.isArray(entry) ? entry[0] : entry.name;
    if (handle.kind === 'file' && name.endsWith('.jsonl')) {
      await processFileHandle(handle, parentFolder, state);
      onProgress && onProgress({ file: name, project: parentFolder });
    } else if (handle.kind === 'directory') {
      // At the root, skip non-interactive folders (orchestrator workers, git
      // worktrees, OS/Go test sandboxes) so totals reflect YOUR work, not automation.
      if (depth === 0) {
        const cat = classifyFolder(name);
        if (NOISE_CATEGORIES.has(cat)) {
          state.skipped[cat] = (state.skipped[cat] || 0) + 1;
          continue;
        }
      }
      // Each immediate child of the root IS a project folder.
      // Deeper subdirs (sessions, subagents) inherit the project they live under.
      const folder = depth === 0 ? name : parentFolder;
      await walkDirectory(handle, folder, state, onProgress, depth + 1);
    }
  }
}

/**
 * Main entry point. Pass the FileSystemDirectoryHandle from showDirectoryPicker().
 * onProgress(info) is called after each file with { file, project }.
 */
export async function aggregate(dirHandle, onProgress) {
  const state = newState();

  // Prefer picking ~/.claude (root): then we also get history.jsonl + stats-cache.json,
  // which survive the 30-day projects pruning and back-fill the long-range view.
  // Back-compat: if the user picked ~/.claude/projects directly, just aggregate it.
  let projectsHandle = null;
  try { projectsHandle = await dirHandle.getDirectoryHandle('projects'); } catch { /* not the root */ }

  if (projectsHandle) {
    await walkDirectory(projectsHandle, null, state, onProgress, 0);
    try {
      const fh = await dirHandle.getFileHandle('history.jsonl');
      ingestHistoryText(await (await fh.getFile()).text(), state);
    } catch { /* history.jsonl absent — long prompt view unavailable */ }
    try {
      const fh = await dirHandle.getFileHandle('stats-cache.json');
      state.archive = parseStatsCache(JSON.parse(await (await fh.getFile()).text()));
    } catch { /* stats-cache.json absent — archived totals unavailable */ }
  } else {
    // Legacy: dirHandle IS the projects folder. Recent window only.
    await walkDirectory(dirHandle, null, state, onProgress, 0);
  }

  return finalizeState(state);
}

export function finalizeState(state) {
  // Merge the long-range prompt calendar (history.jsonl) into the daily map so the
  // heatmap, streak, active-days, "using since", and prompt count span the FULL
  // history — not just the ~38-day transcript window. history.jsonl is the
  // authoritative prompt source, so it OVERWRITES projects-derived prompt counts
  // (which only cover recent days) rather than adding to them.
  if (state.history) {
    for (const [day, cnt] of Object.entries(state.history.days)) {
      const b = bucketFor(state.daily, day);
      b.user_prompts = cnt;
      b.activity = (b.activity || 0) + cnt; // heatmap intensity = prompts/day (uniform across range)
      state._days.add(day);
      if (!state.firstSeen || day < state.firstSeen) state.firstSeen = day;
      if (!state.lastSeen  || day > state.lastSeen)  state.lastSeen  = day;
    }
    // Rebuild monthly/yearly from the merged daily map so prompt counts stay
    // consistent and the year/month dropdowns include the historical periods.
    state.monthly = {};
    state.yearly = {};
    for (const [day, b] of Object.entries(state.daily)) {
      addToBucket(bucketFor(state.monthly, day.slice(0, 7)), b);
      addToBucket(bucketFor(state.yearly,  day.slice(0, 4)), b);
    }
  }

  const days = Array.from(state._days).sort();

  const byProject = Object.entries(state.byProject).map(([path, bucket]) => ({
    name: projectNameFromFolder(path),
    path,
    ...bucket,
  })).sort((a, b) => b.cost - a.cost);

  return {
    totals:    state.totals,
    daily:     state.daily,
    monthly:   state.monthly,
    yearly:    state.yearly,
    byProject,
    byModel:   state.byModel,
    byTool:    state.byTool,
    firstSeen: state.firstSeen,
    lastSeen:  state.lastSeen,
    streak:    computeStreak(days),
    subagent:  state.subagent,   // Task/subagent (isSidechain) spend, disclosed separately
    skipped:   state.skipped,    // count of non-interactive folders excluded
    archive:   state.archive || null,                          // pre-pruning stats-cache aggregate
    promptsTotal: state.history ? state.history.total : null,  // full-range prompt count
  };
}

/**
 * Convenience: aggregate an array of {projectFolder, records[]} pairs.
 * Used by tests and programmatic callers that don't need the FS API.
 */
export function aggregateRecords(projectRecords) {
  const state = newState();
  for (const { projectFolder, records } of projectRecords) {
    for (const record of records) {
      processRecord(record, projectFolder, state, state.seenMsgIds);
    }
  }
  return finalizeState(state);
}
