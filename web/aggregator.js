/**
 * Claude JSONL aggregator — File System Access API edition.
 *
 * Processes files one-by-one (stream parse) to stay memory-flat across 13k+ files.
 * Export shape:
 *   { totals, daily, monthly, yearly, byProject, byModel, byTool, firstSeen, lastSeen, streak }
 */

// USD per million tokens. Extend when new models appear in real data.
export const PRICING = {
  // Claude 4 — Opus
  'claude-opus-4-7':                  { input: 5.00,  output: 25.00, cacheWrite5m:  6.25, cacheWrite1h: 10.00, cacheRead: 0.50 },
  'claude-opus-4-6':                  { input: 5.00,  output: 25.00, cacheWrite5m:  6.25, cacheWrite1h: 10.00, cacheRead: 0.50 },
  'claude-opus-4-5':                  { input: 5.00,  output: 25.00, cacheWrite5m:  6.25, cacheWrite1h: 10.00, cacheRead: 0.50 },
  // Claude 4 — Sonnet
  'claude-sonnet-4-7':                { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 },
  'claude-sonnet-4-6':                { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 },
  'claude-sonnet-4-5':                { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 },
  // Claude 4 — Haiku
  'claude-haiku-4-5':                 { input: 1.00,  output:  5.00, cacheWrite5m:  1.25, cacheWrite1h:  2.00, cacheRead: 0.10 },
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
  ['claude-opus-4',     { input: 5.00,  output: 25.00, cacheWrite5m:  6.25, cacheWrite1h: 10.00, cacheRead: 0.50 }],
  ['claude-sonnet-4',   { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 }],
  ['claude-haiku-4',    { input: 1.00,  output:  5.00, cacheWrite5m:  1.25, cacheWrite1h:  2.00, cacheRead: 0.10 }],
  ['claude-3-opus',     { input: 15.00, output: 75.00, cacheWrite5m: 18.75, cacheWrite1h: 30.00, cacheRead: 1.50 }],
  ['claude-3-5-sonnet', { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 }],
  ['claude-3-sonnet',   { input: 3.00,  output: 15.00, cacheWrite5m:  3.75, cacheWrite1h:  6.00, cacheRead: 0.30 }],
  ['claude-3-haiku',    { input: 0.25,  output:  1.25, cacheWrite5m:  0.30, cacheWrite1h:  0.50, cacheRead: 0.03 }],
  ['claude-2',          { input: 8.00,  output: 24.00, cacheWrite5m: 10.00, cacheWrite1h: 16.00, cacheRead: 0.80 }],
];

function pricingFor(model) {
  if (!model) return null;
  const m = model.toLowerCase();
  if (PRICING[m]) return PRICING[m];
  for (const [prefix, p] of PRICING_FALLBACKS) {
    if (m.startsWith(prefix)) return p;
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

/** Extract project name: last segment after final '-' in the folder name. */
export function projectNameFromFolder(folderName) {
  if (!folderName) return 'unknown';
  const idx = folderName.lastIndexOf('-');
  if (idx < 0 || idx === folderName.length - 1) return folderName;
  return folderName.slice(idx + 1);
}

function dateKey(ts) {
  // ts is ISO-8601; slice is faster than Date construction
  return ts ? ts.slice(0, 10) : null;
}

function bucketFor(map, key) {
  if (!map[key]) map[key] = newBucket();
  return map[key];
}

/**
 * Process a single parsed JSONL record into the running state.
 * seenMsgIds: Set — per-file dedup of message.id to avoid double-counting
 *             usage from split streaming records (thinking + tool_use entries
 *             share the same message.id and usage).
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
  } else if (type === 'user' && record.promptId) {
    // promptId distinguishes genuine user turns from tool_result messages
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
  };
}

async function processFileHandle(fileHandle, projectFolder, state) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  const seenMsgIds = new Set();
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
  // Pass null at root so depth=0 children get to set themselves as project name.
  await walkDirectory(dirHandle, null, state, onProgress, 0);
  return finalizeState(state);
}

export function finalizeState(state) {
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
  };
}

/**
 * Convenience: aggregate an array of {projectFolder, records[]} pairs.
 * Used by tests and programmatic callers that don't need the FS API.
 */
export function aggregateRecords(projectRecords) {
  const state = newState();
  for (const { projectFolder, records } of projectRecords) {
    const seenMsgIds = new Set();
    for (const record of records) {
      processRecord(record, projectFolder, state, seenMsgIds);
    }
  }
  return finalizeState(state);
}
