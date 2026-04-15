const CAT_COLORS = {
  feature:        '#3b82f6',
  bugfix:         '#ef4444',
  learning:       '#8b5cf6',
  review:         '#14b8a6',
  design:         '#ec4899',
  documentation:  '#6b7280',
  refactor:       '#f59e0b',
  infrastructure: '#10b981',
  meeting:        '#6366f1',
  other:          '#94a3b8',
};

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Timestamp helpers ────────────────────────────────────────────────────
function tsToDate(ts) { return new Date(ts * 1000); }
function tsToDateKey(ts) {
  const d = tsToDate(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function tsToMonthKey(ts) {
  const d = tsToDate(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

let currentView = 'timeline';
let currentPeriod = 'this_year';
let allData = [];
let debounceTimer = null;
let currentPage = 1;
const PAGE_SIZE = 7;
let monthShown = {};
let monthlySummaries = {};  // keyed by YYYY-MM
const MONTH_PAGE_SIZE = 5;

// ── Fetch stats ────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const r = await fetch('/api/stats');
    const s = await r.json();
    setText('stat-total',  s.total);
    setText('stat-today',  s.today);
    setText('stat-week',   s.this_week);
    setText('stat-year',   s.this_year);
    setText('stat-high',   s.high_impact);
  } catch { /* ignore */ }
}

function setText(id, val) {
  document.querySelector(`#${id} .value`).textContent = val ?? '—';
}

async function loadMonthlySummaries() {
  try {
    const r = await fetch('/api/monthly-summaries');
    const list = await r.json();
    monthlySummaries = {};
    for (const s of list) {
      monthlySummaries[s.month] = s;
    }
  } catch (_) {
    monthlySummaries = {};
  }
}

// ── Fetch accomplishments ───────────────────────────────────────────────
async function loadData(params = {}) {
  document.getElementById('content').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const qs = new URLSearchParams(Object.fromEntries(
      Object.entries(params).filter(([, v]) => v)
    )).toString();
    const url = '/api/accomplishments' + (qs ? '?' + qs : '');
    const r = await fetch(url);
    allData = await r.json();
    currentPage = 1;
    monthShown = {};
    renderView();
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<div class="empty"><div class="icon">⚠️</div><h3>Failed to load</h3><p>${e.message}</p></div>`;
  }
}

// ── Render ──────────────────────────────────────────────────────────────
function renderView() {
  document.getElementById('result-info').textContent =
    allData.length === 0 ? '' : `${allData.length} accomplishment${allData.length !== 1 ? 's' : ''}`;

  if (currentView !== 'timeline') document.getElementById('pagination').innerHTML = '';
  if (currentView === 'timeline') renderTimeline();
  else if (currentView === 'annual') renderAnnual();
  else if (currentView === 'tags') renderTags();
}

function renderTimeline() {
  if (allData.length === 0) {
    document.getElementById('content').innerHTML = emptyState();
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  // Group by date (local TZ)
  var groups = {};
  for (var idx = 0; idx < allData.length; idx++) {
    var item = allData[idx];
    var key = tsToDateKey(item.date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  var sortedGroups = Object.entries(groups).sort(function(a, b) { return b[0].localeCompare(a[0]); });
  var totalPages = Math.ceil(sortedGroups.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(currentPage, totalPages));

  var start = (currentPage - 1) * PAGE_SIZE;
  var pageGroups = sortedGroups.slice(start, start + PAGE_SIZE);

  var today = new Date(); today.setHours(0,0,0,0);
  var yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  var html = '';
  for (var gi = 0; gi < pageGroups.length; gi++) {
    var date = pageGroups[gi][0];
    var items = pageGroups[gi][1];
    var d = new Date(date + 'T12:00:00');
    var dCopy = new Date(d); dCopy.setHours(0,0,0,0);

    var dayNum = String(d.getDate()).padStart(2, '0');
    var dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    var monthYear = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    var specialLabel = '';
    if (dCopy.getTime() === today.getTime()) specialLabel = 'Today';
    else if (dCopy.getTime() === yesterday.getTime()) specialLabel = 'Yesterday';

    var entriesHtml = '';
    for (var ii = 0; ii < items.length; ii++) {
      entriesHtml += renderCard(items[ii]);
    }

    html += '<div class="tl-day">'
      + '<div class="tl-date-col">'
      + '<div class="tl-day-num">' + dayNum + '</div>'
      + '<div class="tl-day-meta">' + esc(dayName) + '</div>'
      + '<div class="tl-day-meta">' + esc(monthYear) + '</div>'
      + (specialLabel ? '<div class="tl-special-label">' + esc(specialLabel) + '</div>' : '')
      + '<div class="tl-entry-count">' + items.length + (items.length === 1 ? ' entry' : ' entries') + '</div>'
      + '</div>'
      + '<div class="tl-body-col">'
      + entriesHtml
      + '</div>'
      + '</div>';
  }

  document.getElementById('content').innerHTML = '<div class="tl-wrapper">' + html + '</div>';
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const el = document.getElementById('pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  // Build the set of page numbers to show: first, last, and a window around currentPage
  const pages = new Set([1, totalPages]);
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) pages.add(i);
  const pageList = [...pages].sort((a, b) => a - b);

  let btns = '';
  let prev = null;
  for (const p of pageList) {
    if (prev !== null && p - prev > 1) btns += `<span class="page-ellipsis">…</span>`;
    btns += `<button class="page-btn${p === currentPage ? ' active' : ''}" onclick="goToPage(${p})">${p}</button>`;
    prev = p;
  }

  el.innerHTML = `<div class="pagination">
    <button class="page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>‹ Prev</button>
    ${btns}
    <button class="page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>Next ›</button>
  </div>`;
}

function goToPage(n) {
  currentPage = n;
  renderTimeline();
  document.getElementById('content').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function renderAnnual() {
  // Use already-loaded summaries; refresh in background for next render
  loadMonthlySummaries();
  if (allData.length === 0) {
    document.getElementById('content').innerHTML = emptyState();
    return;
  }

  // Group by month (local TZ)
  const months = {};
  for (const item of allData) {
    const month = tsToMonthKey(item.date);
    if (!months[month]) months[month] = [];
    months[month].push(item);
  }

  const sortedMonths = Object.entries(months).sort(([a], [b]) => b.localeCompare(a));
  const currentMonth = tsToMonthKey(Date.now() / 1000);

  var html = '';
  for (var mi = 0; mi < sortedMonths.length; mi++) {
    var month = sortedMonths[mi][0];
    var items = sortedMonths[mi][1];
    var parts = month.split('-');
    var year = parts[0];
    var mo = parts[1];
    var monthLabel = MONTH_NAMES[parseInt(mo, 10) - 1];
    var high = items.filter(function(i) { return i.impact_level === 'high'; }).length;
    var isCurrentMonth = month === currentMonth;
    var cardsStyle = isCurrentMonth ? '' : ' style="display:none"';
    var arrow = isCurrentMonth ? '\u25bc' : '\u25b6';

    // Category color dots (unique categories)
    var seenCats = {};
    var catDotsHtml = '';
    for (var ci = 0; ci < items.length; ci++) {
      var cat = items[ci].category;
      if (!seenCats[cat]) {
        seenCats[cat] = true;
        catDotsHtml += '<span class="month-cat-dot" style="background:' + (CAT_COLORS[cat] || '#94a3b8') + '" title="' + esc(cat) + '"></span>';
      }
    }

    html += '<div class="month-section" data-month="' + month + '">'
      + '<div class="month-header" onclick="toggleMonth(this)">'
      + '<div class="month-date-block">'
      + '<div class="month-year-label">' + esc(year) + '</div>'
      + '<div class="month-name-large">' + esc(monthLabel) + '</div>'
      + '</div>'
      + '<div class="month-meta">'
      + '<div class="month-cat-dots">' + catDotsHtml + '</div>'
      + '<div class="month-stats">' + items.length + ' accomplished'
      + (high > 0 ? ' \u00b7 ' + high + ' high-impact' : '')
      + '</div>'
      + '</div>'
      + '<span class="month-arrow">' + arrow + '</span>'
      + '</div>'
      + renderSummaryBanner(monthlySummaries[month] || null)
      + '<div class="month-cards"' + cardsStyle + '>'
      + renderMonthPage(month, items)
      + '</div>'
      + '</div>';
  }

  document.getElementById('content').innerHTML = '<div class="monthly-grid">' + html + '</div>';
}

function renderMonthPage(month, items) {
  const cats = [...new Set(items.map(i => i.category))];
  const catBadges = cats.map(c =>
    `<span class="cat-badge" style="background:${CAT_COLORS[c]||'#94a3b8'}">${c}</span>`
  ).join('');

  const shown = monthShown[month] || MONTH_PAGE_SIZE;
  const visibleItems = items.slice(0, shown);
  const remaining = items.length - shown;

  const showMore = remaining > 0 ? `
    <button class="show-more-btn" onclick="showMoreMonth('${month}')">
      Show ${Math.min(remaining, MONTH_PAGE_SIZE)} more
      <span class="show-more-count">(${remaining} remaining)</span>
    </button>` : '';

  return `
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.75rem">${catBadges}</div>
    ${visibleItems.map(renderCard).join('')}
    ${showMore}`;
}

function renderSummaryBanner(summary) {
  if (!summary) return '';
  var stats = summary.stats || {};
  var keyWins = stats.key_wins || [];
  var winsHtml = '';
  for (var wi = 0; wi < keyWins.length; wi++) {
    var w = keyWins[wi];
    winsHtml += '<li class="msb-win">'
      + '<span class="msb-win-star">\u2605</span>'
      + '<span class="msb-win-title">' + esc(w.title) + '</span>'
      + (w.why ? '<span class="msb-win-why"> \u2014 ' + esc(w.why) + '</span>' : '')
      + '</li>';
  }
  return '<div class="month-summary-banner">'
    + '<div class="msb-quote-mark">\u201C</div>'
    + '<div class="msb-body">'
    + '<p class="msb-narrative">' + esc(summary.narrative) + '</p>'
    + (winsHtml ? '<ul class="msb-wins">' + winsHtml + '</ul>' : '')
    + '<div><span class="msb-label">Monthly Summary</span></div>'
    + '</div>'
    + '</div>';
}

function showMoreMonth(month) {
  monthShown[month] = (monthShown[month] || MONTH_PAGE_SIZE) + MONTH_PAGE_SIZE;
  const section = document.querySelector(`[data-month="${month}"]`);
  if (!section) return;
  const items = allData.filter(i => tsToMonthKey(i.date) === month);
  section.querySelector('.month-cards').innerHTML = renderMonthPage(month, items);
}

function contextClass(ctx) {
  const known = ['work', 'side_project', 'personal'];
  return 'context-' + (known.includes(ctx) ? ctx : 'other');
}

function renderCard(item) {
  var catColor = CAT_COLORS[item.category] || '#94a3b8';
  var tags = (item.tags || []).map(function(t) { return '<span class="tag-badge">' + esc(t) + '</span>'; }).join('');
  var time = item.created_at ? tsToDate(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  var ctx = item.context || 'work';
  var ctxLabel = ctx.replace(/_/g, ' ');
  var proj = item.project;
  var impactClass = 'card--' + (item.impact_level || 'low');

  return '<div class="card ' + impactClass + '" data-id="' + item.id + '">'
    + '<div class="card-actions">'
    + '<button class="action-btn" onclick="openEdit(' + item.id + ')" title="Edit">\u270e Edit</button>'
    + '<button class="action-btn delete" onclick="deleteItem(' + item.id + ')" title="Delete">\u2715 Delete</button>'
    + '</div>'
    + '<div class="card-eyebrow">'
    + '<span class="card-cat-label" style="color:' + catColor + '">' + esc(item.category) + '</span>'
    + (proj ? '<span class="card-proj-label">' + esc(proj) + '</span>' : '')
    + '</div>'
    + '<div class="card-title">' + esc(item.title) + '</div>'
    + '<div class="card-description">' + esc(item.description) + '</div>'
    + '<div class="card-footer">'
    + '<span class="context-badge ' + contextClass(ctx) + '">' + esc(ctxLabel) + '</span>'
    + tags
    + (time ? '<span class="card-time">' + time + '</span>' : '')
    + '</div>'
    + '</div>';
}

function emptyState() {
  return `<div class="empty">
    <div class="icon">📋</div>
    <h3>No accomplishments found</h3>
    <p>Ask Claude to log some accomplishments at the end of your next session!</p>
  </div>`;
}

// ── Controls ────────────────────────────────────────────────────────────
function setView(v) {
  if (v !== currentView) currentPage = 1;
  currentView = v;
  const isSettings = v === 'settings';
  const isTags = v === 'tags';
  const isData = !isSettings && !isTags;

  document.getElementById('view-toggle').style.display    = isSettings ? 'none' : '';
  document.getElementById('result-info').style.display    = isData ? '' : 'none';
  document.getElementById('content').style.display        = isData ? '' : 'none';
  document.getElementById('pagination').style.display     = isData ? '' : 'none';
  document.getElementById('settings-panel').style.display = isSettings ? '' : 'none';
  document.getElementById('tags-panel').style.display     = isTags ? '' : 'none';
  document.getElementById('btn-settings').classList.toggle('active', isSettings);
  document.getElementById('btn-timeline').classList.toggle('active', v === 'timeline');
  document.getElementById('btn-annual').classList.toggle('active', v === 'annual');
  document.getElementById('btn-tags').classList.toggle('active', isTags);

  if (isData) renderView();
  else if (isSettings) loadSettings();
  else if (isTags) renderTags();
}

async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    if (!r.ok) throw new Error(`Server returned ${r.status} — try restarting the server`);
    const s = await r.json();
    document.getElementById('db-path-display').textContent = s.db_path || 'Unknown';
    document.getElementById('db-path-input').placeholder = s.db_path || '/path/to/accomplishments.db';
  } catch (e) {
    document.getElementById('db-path-display').textContent = e.message;
  }
  loadHistory();
  loadPaletteSettings();
}

async function loadHistory() {
  try {
    const r = await fetch('/api/db-history');
    if (!r.ok) return;
    const history = await r.json();
    const wrap = document.getElementById('db-history-wrap');
    const list = document.getElementById('db-history-list');

    if (!history.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    const activePath = document.getElementById('db-path-display').textContent;
    const TYPE_ICON = { active: '🗄️', merge: '🔀', export: '📤' };

    list.innerHTML = history.map(h => {
      const isCurrent = h.path === activePath;
      const icon = TYPE_ICON[h.type] || '🗄️';
      const ago = timeAgo(h.last_used);
      return `
        <div class="history-item">
          <span class="history-icon">${icon}</span>
          <div class="history-info">
            <div class="history-name">${esc(h.display_name)}</div>
            <div class="history-path" title="${esc(h.path)}">${esc(h.path)}</div>
          </div>
          <span style="font-size:0.7rem;color:var(--muted);flex-shrink:0">${ago}</span>
          <button class="history-load-btn ${isCurrent ? 'current' : ''}"
            ${isCurrent ? 'disabled' : `onclick="loadFromHistory('${esc(h.path)}'  )"`}>
            ${isCurrent ? 'Active' : 'Load'}
          </button>
        </div>`;
    }).join('');
  } catch { /* ignore */ }
}

async function loadFromHistory(path) {
  const feedback = document.getElementById('db-path-feedback');
  feedback.textContent = 'Switching…';
  feedback.className = 'import-feedback';
  feedback.style.display = 'block';
  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db_path: path }),
    });
    const data = await r.json();
    if (!r.ok) {
      feedback.textContent = '✕ ' + (data.error || 'Failed');
      feedback.className = 'import-feedback err';
    } else {
      document.getElementById('db-path-display').textContent = data.db_path;
      feedback.textContent = `✓ Now using ${data.db_path} — ${data.count} record${data.count !== 1 ? 's' : ''} loaded`;
      feedback.className = 'import-feedback ok';
      loadHistory();
      loadStats();
      loadData(periodToParams(currentPeriod));
      setTimeout(() => { feedback.style.display = 'none'; }, 5000);
    }
  } catch (e) {
    feedback.textContent = '✕ ' + e.message;
    feedback.className = 'import-feedback err';
  }
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function mergeDb(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const feedback = document.getElementById('merge-feedback');
  feedback.textContent = 'Merging…';
  feedback.className = 'import-feedback';
  feedback.style.display = 'block';

  const form = new FormData();
  form.append('file', file);

  try {
    const r = await fetch('/api/merge', { method: 'POST', body: form });
    if (!r.ok) {
      const data = await r.json();
      feedback.textContent = '✕ ' + (data.error || 'Merge failed');
      feedback.className = 'import-feedback err';
      return;
    }

    // Read stats from response headers
    const added  = r.headers.get('X-Merge-Added');
    const skipped = r.headers.get('X-Merge-Skipped');
    const total   = r.headers.get('X-Merge-Total');

    // Trigger download of the merged DB
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'merged_accomplishments.db';
    a.click();
    URL.revokeObjectURL(url);

    const name = r.headers.get('X-Merge-Name') || 'merged_accomplishments.db';
    feedback.textContent = `✓ ${added} new record${added != 1 ? 's' : ''} from ${total} merged, ${skipped} duplicate${skipped != 1 ? 's' : ''} skipped — saved as "${name}"`;
    feedback.className = 'import-feedback ok';
  } catch (e) {
    feedback.textContent = '✕ ' + e.message;
    feedback.className = 'import-feedback err';
  }
}

function toggleChangeDb() {
  const form = document.getElementById('change-db-form');
  const visible = form.style.display !== 'none';
  form.style.display = visible ? 'none' : '';
  if (!visible) document.getElementById('db-path-input').focus();
}

async function saveDbPath() {
  const input = document.getElementById('db-path-input').value.trim();
  const feedback = document.getElementById('db-path-feedback');
  if (!input) return;

  feedback.textContent = 'Switching…';
  feedback.className = 'import-feedback';
  feedback.style.display = 'block';

  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db_path: input }),
    });
    const data = await r.json();
    if (!r.ok) {
      feedback.textContent = '✕ ' + (data.error || 'Failed to switch database');
      feedback.className = 'import-feedback err';
    } else {
      document.getElementById('db-path-display').textContent = data.db_path;
      document.getElementById('db-path-input').value = '';
      document.getElementById('change-db-form').style.display = 'none';
      feedback.textContent = `✓ Now using ${data.db_path} — ${data.count} record${data.count !== 1 ? 's' : ''} loaded`;
      feedback.className = 'import-feedback ok';
      loadStats();
      loadData(periodToParams(currentPeriod));
      setTimeout(() => { feedback.style.display = 'none'; }, 5000);
    }
  } catch (e) {
    feedback.textContent = '✕ ' + e.message;
    feedback.className = 'import-feedback err';
  }
}

function statFilter(type) {
  if (currentView === 'settings') setView('timeline');

  // Clear stat active states, then highlight the clicked one
  document.querySelectorAll('.stat').forEach(s => s.classList.remove('active'));
  const statIdMap = { all_time: 'stat-total', today: 'stat-today', this_week: 'stat-week', this_year: 'stat-year', high_impact: 'stat-high' };
  document.getElementById(statIdMap[type])?.classList.add('active');

  // Clear sidebar period selection and filters
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  clearDateFilters();

  if (type === 'high_impact') {
    document.getElementById('filter-impact').value = 'high';
    currentPeriod = 'all_time';
    loadData({ impact_level: 'high' });
  } else {
    currentPeriod = type;
    loadData(periodToParams(type));
  }
}

function setPeriod(btn) {
  if (currentView === 'settings') setView('timeline');
  document.querySelectorAll('.stat').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentPeriod = btn.dataset.period;
  clearDateFilters();
  loadData(periodToParams(currentPeriod));
}

function periodToParams(period) {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  const t = fmt(today);
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1));
  const map = {
    today:      { date_from: t, date_to: t },
    this_week:  { date_from: fmt(monday), date_to: t },
    this_month: { date_from: `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`, date_to: t },
    this_year:  { date_from: `${today.getFullYear()}-01-01`, date_to: t },
    last_year:  { date_from: `${today.getFullYear()-1}-01-01`, date_to: `${today.getFullYear()-1}-12-31` },
    all_time:   {},
  };
  return map[period] || {};
}

function applyFilters() {
  const search   = document.getElementById('filter-search').value.trim();
  const from     = document.getElementById('filter-from').value;
  const to       = document.getElementById('filter-to').value;
  const category = document.getElementById('filter-category').value;
  const impact   = document.getElementById('filter-impact').value;
  const context  = document.getElementById('filter-context').value;
  const project  = document.getElementById('filter-project').value.trim();

  document.querySelectorAll('.stat').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));

  loadData({ search, date_from: from, date_to: to, category, impact_level: impact, context, project });
}

function clearFilters() {
  document.getElementById('filter-search').value = '';
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-impact').value = '';
  document.getElementById('filter-context').value = '';
  document.getElementById('filter-project').value = '';
  document.querySelectorAll('.stat').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.period === 'this_year');
  });
  currentPeriod = 'this_year';
  loadData(periodToParams('this_year'));
}

function clearDateFilters() {
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value = '';
  document.getElementById('filter-search').value = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-impact').value = '';
  document.getElementById('filter-context').value = '';
  document.getElementById('filter-project').value = '';
}

function debounceSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const q = document.getElementById('filter-search').value.trim();
    if (q.length >= 2 || q.length === 0) applyFilters();
  }, 350);
}

function toggleMonth(header) {
  const cards = header.parentElement.querySelector('.month-cards');
  const arrow = header.querySelector('.month-arrow');
  const hidden = cards.style.display === 'none';
  cards.style.display = hidden ? '' : 'none';
  arrow.textContent = hidden ? '▼' : '▶';
}

function refresh() {
  loadStats();
  loadData(periodToParams(currentPeriod));
}

// ── Helpers ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatDateLabel(d) {
  const today = new Date(); today.setHours(0,0,0,0);
  const yd = new Date(today); yd.setDate(today.getDate() - 1);
  d.setHours(0,0,0,0);
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yd.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
}

// ── Edit / Delete ────────────────────────────────────────────────────────
let editingId = null;

function openEdit(id) {
  const item = allData.find(i => i.id === id);
  if (!item) return;
  editingId = id;
  document.getElementById('edit-title').value       = item.title;
  document.getElementById('edit-description').value = item.description;
  document.getElementById('edit-category').value    = item.category;
  document.getElementById('edit-impact').value      = item.impact_level;
  document.getElementById('edit-date').value        = tsToDateKey(item.date);
  document.getElementById('edit-context').value     = item.context || 'work';
  document.getElementById('edit-project').value     = item.project || '';
  document.getElementById('edit-tags').value        = (item.tags || []).join(', ');
  document.getElementById('edit-modal').classList.add('open');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('edit-modal')) return;
  document.getElementById('edit-modal').classList.remove('open');
  editingId = null;
}

async function saveEdit() {
  if (editingId === null) return;
  const tagsRaw = document.getElementById('edit-tags').value;
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const body = {
    title:        document.getElementById('edit-title').value.trim(),
    description:  document.getElementById('edit-description').value.trim(),
    category:     document.getElementById('edit-category').value,
    impact_level: document.getElementById('edit-impact').value,
    date:         document.getElementById('edit-date').value,
    context:      document.getElementById('edit-context').value.trim() || 'work',
    project:      document.getElementById('edit-project').value.trim() || null,
    tags,
  };
  try {
    const r = await fetch(`/api/accomplishments/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { alert('Save failed'); return; }
    document.getElementById('edit-modal').classList.remove('open');
    editingId = null;
    refresh();
  } catch (e) { alert('Save failed: ' + e.message); }
}

async function deleteItem(id) {
  const item = allData.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`Delete "${item.title}"?`)) return;
  try {
    const r = await fetch(`/api/accomplishments/${id}`, { method: 'DELETE' });
    if (!r.ok) { alert('Delete failed'); return; }
    refresh();
  } catch (e) { alert('Delete failed: ' + e.message); }
}

// ── Tag Intelligence ─────────────────────────────────────────────────────
const TAG_PALETTE_LIGHT = [
  { bg: '#eff6ff', text: '#1d4ed8' },  // blue
  { bg: '#f5f3ff', text: '#6d28d9' },  // violet
  { bg: '#fdf4ff', text: '#a21caf' },  // fuchsia
  { bg: '#fef2f2', text: '#b91c1c' },  // red
  { bg: '#fff7ed', text: '#c2410c' },  // orange
  { bg: '#fefce8', text: '#a16207' },  // yellow
  { bg: '#f0fdf4', text: '#15803d' },  // green
  { bg: '#ecfdf5', text: '#047857' },  // emerald
  { bg: '#f0fdfa', text: '#0f766e' },  // teal
  { bg: '#ecfeff', text: '#0e7490' },  // cyan
  { bg: '#eef2ff', text: '#4338ca' },  // indigo
  { bg: '#fdf2f8', text: '#be185d' },  // pink
];

const TAG_PALETTE_DARK = [
  { bg: '#1e3a5f', text: '#93c5fd' },  // blue
  { bg: '#2e1065', text: '#c4b5fd' },  // violet
  { bg: '#4a044e', text: '#f0abfc' },  // fuchsia
  { bg: '#450a0a', text: '#fca5a5' },  // red
  { bg: '#431407', text: '#fdba74' },  // orange
  { bg: '#422006', text: '#fde68a' },  // yellow
  { bg: '#052e16', text: '#86efac' },  // green
  { bg: '#022c22', text: '#6ee7b7' },  // emerald
  { bg: '#042f2e', text: '#5eead4' },  // teal
  { bg: '#083344', text: '#67e8f9' },  // cyan
  { bg: '#1e1b4b', text: '#a5b4fc' },  // indigo
  { bg: '#500724', text: '#f9a8d4' },  // pink
];

function isDarkMode() {
  const t = localStorage.getItem('theme') || 'system';
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function tagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffffffff;
  const idx = Math.abs(hash) % TAG_PALETTE_LIGHT.length;
  return isDarkMode() ? TAG_PALETTE_DARK[idx] : TAG_PALETTE_LIGHT[idx];
}

// Tag Intelligence state
let _tiTagMap = {};
let _tiTotalUses = 0;
let _tiExpanded = null;
let _tiShowAll = false;
const TI_PAGE_SIZE = 20;

function relativeTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() / 1000 - ts;
  if (diff < 86400) return 'today';
  if (diff < 86400 * 2) return 'yesterday';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
  if (diff < 86400 * 30) return Math.floor(diff / 86400 / 7) + 'w ago';
  if (diff < 86400 * 365) return Math.floor(diff / 86400 / 30) + 'mo ago';
  return Math.floor(diff / 86400 / 365) + 'y ago';
}

function tiSparklineSVG(uses, now, color) {
  const buckets = new Array(12).fill(0);
  for (const ts of uses) {
    const mago = Math.floor((now - ts) / (30.44 * 86400));
    if (mago < 12) buckets[11 - mago]++;
  }
  const max = Math.max(...buckets, 1);
  const W = 72, H = 20;
  const pts = buckets.map((v, i) => {
    const x = ((i / 11) * W).toFixed(1);
    const y = (H - Math.max((v / max) * H, v > 0 ? 2 : 0)).toFixed(1);
    return x + ',' + y;
  }).join(' ');
  const safeId = 'sg' + Math.abs(color.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xfffff, 0));
  const first = 'M0,' + H + ' ';
  const mid = buckets.map((v, i) => {
    const x = ((i / 11) * W).toFixed(1);
    const y = (H - Math.max((v / max) * H, v > 0 ? 2 : 0)).toFixed(1);
    return 'L' + x + ',' + y;
  }).join(' ');
  const areaD = first + mid + ' L' + W + ',' + H + ' Z';
  return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" class="ti-spark"><defs>'
    + '<linearGradient id="' + safeId + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.25"/>'
    + '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/>'
    + '</linearGradient></defs>'
    + '<path d="' + areaD + '" fill="url(#' + safeId + ')"/>'
    + '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'
    + '</svg>';
}

async function renderTags() {
  const rowsEl = document.getElementById('ti-rows');
  if (rowsEl) rowsEl.innerHTML = '<div class="ti-empty">Loading\u2026</div>';

  let data = allData;
  if (!data.length) {
    try { data = await (await fetch('/api/accomplishments')).json(); }
    catch { return; }
  }

  _tiTagMap = {};
  for (const item of data) {
    for (const raw of (item.tags || [])) {
      const tag = raw.trim().toLowerCase();
      if (!tag) continue;
      if (!_tiTagMap[tag]) _tiTagMap[tag] = { count: 0, uses: [], lastUsed: 0, items: [] };
      _tiTagMap[tag].count++;
      _tiTagMap[tag].uses.push(item.date);
      if (item.date > _tiTagMap[tag].lastUsed) _tiTagMap[tag].lastUsed = item.date;
      _tiTagMap[tag].items.push(item);
    }
  }

  _tiTotalUses = Object.values(_tiTagMap).reduce((s, d) => s + d.count, 0);
  const unique = Object.keys(_tiTagMap).length;
  const sub = document.getElementById('ti-subtitle');
  if (sub) sub.textContent = unique + ' unique tag' + (unique !== 1 ? 's' : '') + ' \u00b7 ' + _tiTotalUses + ' total use' + (_tiTotalUses !== 1 ? 's' : '');

  _tiExpanded = null;
  _tiShowAll = false;
  requestAnimationFrame(renderBubbleChart);
  renderTagTable();
}

function filterByTag(tag) {
  setView('timeline');
  document.getElementById('filter-search').value = tag;
  applyFilters();
}

function renderBubbleChart() {
  var container = document.getElementById('ti-bubbles');
  if (!container) return;
  var entries = Object.entries(_tiTagMap).sort(function(a, b) { return b[1].count - a[1].count; }).slice(0, 50);
  if (!entries.length) { while (container.firstChild) container.removeChild(container.firstChild); return; }

  // Use real pixel dimensions — viewBox matches exactly so font-size units = px
  var W = container.clientWidth || 700;
  var H = 230;
  var maxCount = entries[0][1].count;
  var maxR = Math.min(H * 0.38, W / Math.max(entries.length, 8) * 1.6);
  var minR = Math.max(10, maxR * 0.22);

  // Spread circles across full width initially (not spiralled to center)
  var circles = entries.map(function(e, i) {
    var tag = e[0], d = e[1];
    var r = minR + (maxR - minR) * Math.sqrt(d.count / maxCount);
    var angle = i * 2.39996;
    var spreadX = (W * 0.45) * Math.cos(angle);
    var spreadY = (H * 0.38) * Math.sin(angle);
    return { tag: tag, count: d.count, r: r, x: W / 2 + spreadX, y: H / 2 + spreadY };
  });

  // Push apart with asymmetric gravity: strong vertical (keeps flat), weak horizontal (keeps wide)
  for (var iter = 0; iter < 160; iter++) {
    for (var i = 0; i < circles.length; i++) {
      for (var j = i + 1; j < circles.length; j++) {
        var a = circles[i], b = circles[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var dd = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var overlap = a.r + b.r + 3 - dd;
        if (overlap > 0) {
          var f = overlap * 0.55 / dd;
          a.x -= dx * f; a.y -= dy * f;
          b.x += dx * f; b.y += dy * f;
        }
      }
      // Strong vertical gravity compresses height; weak horizontal keeps spread wide
      circles[i].x += (W / 2 - circles[i].x) * 0.004;
      circles[i].y += (H / 2 - circles[i].y) * 0.06;
    }
  }

  // Clamp to canvas bounds
  circles.forEach(function(c) {
    c.x = Math.max(c.r + 2, Math.min(W - c.r - 2, c.x));
    c.y = Math.max(c.r + 2, Math.min(H - c.r - 2, c.y));
  });

  var ns = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', H);
  svg.style.display = 'block';

  circles.forEach(function(c) {
    var colors = tagColor(c.tag);
    var g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'ti-bubble');
    g.style.cursor = 'pointer';
    (function(tag) { g.addEventListener('click', function() { filterByTag(tag); }); })(c.tag);

    var circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', c.x.toFixed(1));
    circle.setAttribute('cy', c.y.toFixed(1));
    circle.setAttribute('r', c.r.toFixed(1));
    circle.setAttribute('fill', colors.bg);
    circle.setAttribute('stroke', colors.text);
    circle.setAttribute('stroke-width', '1.5');
    var title = document.createElementNS(ns, 'title');
    title.textContent = c.tag + ': ' + c.count + ' use' + (c.count !== 1 ? 's' : '');
    g.appendChild(circle);
    g.appendChild(title);

    if (c.r >= 14) {
      var fs = Math.max(9, Math.min(13, c.r * 0.46));
      var maxChars = Math.floor(c.r * 1.8 / (fs * 0.58));
      var label = c.tag.length > maxChars ? c.tag.slice(0, maxChars - 1) + '\u2026' : c.tag;
      var text = document.createElementNS(ns, 'text');
      text.setAttribute('x', c.x.toFixed(1));
      text.setAttribute('y', (c.y + fs * 0.38).toFixed(1));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', fs);
      text.setAttribute('fill', colors.text);
      text.setAttribute('font-weight', '600');
      text.setAttribute('font-family', "'DM Mono', monospace");
      text.setAttribute('pointer-events', 'none');
      text.textContent = label;
      g.appendChild(text);
    }
    svg.appendChild(g);
  });

  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(svg);
}

function tiToggleExpand(tag) {
  _tiExpanded = (_tiExpanded === tag) ? null : tag;
  renderTagTable();
}

function tiShowMore() {
  _tiShowAll = true;
  renderTagTable();
}

function tiGetSorted() {
  const sort = (document.getElementById('ti-sort-select') || {}).value || 'freq';
  const search = ((document.getElementById('ti-search-input') || {}).value || '').toLowerCase();
  let entries = Object.entries(_tiTagMap);
  if (search) entries = entries.filter(function(e) { return e[0].includes(search); });
  const now = Date.now() / 1000;
  if (sort === 'freq') {
    entries.sort(function(a, b) { return b[1].count - a[1].count; });
  } else if (sort === 'az') {
    entries.sort(function(a, b) { return a[0].localeCompare(b[0]); });
  } else if (sort === 'recent') {
    entries.sort(function(a, b) { return b[1].lastUsed - a[1].lastUsed; });
  } else if (sort === 'trend') {
    entries.sort(function(a, b) {
      function score(d) {
        const r = d.uses.filter(function(ts) { return now - ts < 86400 * 90; }).length;
        const o = d.uses.filter(function(ts) { return now - ts >= 86400 * 90 && now - ts < 86400 * 270; }).length;
        return r - o * 0.5;
      }
      return score(b[1]) - score(a[1]);
    });
  }
  return entries;
}

function renderTagTable() {
  const entries = tiGetSorted();
  const showMoreEl = document.getElementById('ti-show-more');
  const rowsEl = document.getElementById('ti-rows');
  if (!rowsEl) return;
  if (!entries.length) {
    rowsEl.innerHTML = '<div class="ti-empty">No tags match your filter.</div>';
    if (showMoreEl) showMoreEl.style.display = 'none';
    return;
  }
  const visible = _tiShowAll ? entries : entries.slice(0, TI_PAGE_SIZE);
  const now = Date.now() / 1000;
  const CAT_COLORS = {
    feature: '#3b82f6', bugfix: '#ef4444', learning: '#8b5cf6',
    review: '#14b8a6', design: '#ec4899', documentation: '#6b7280',
    refactor: '#f59e0b', infrastructure: '#10b981', meeting: '#6366f1', other: '#94a3b8'
  };
  const rows = visible.map(function(entry, idx) {
    const tag = entry[0], d = entry[1];
    const rank = String(idx + 1).padStart(2, '0');
    const pct = _tiTotalUses ? ((d.count / _tiTotalUses) * 100).toFixed(1) : '0.0';
    const colors = tagColor(tag);
    const bg = colors.bg, tc = colors.text;
    const spark = tiSparklineSVG(d.uses, now, tc);
    const isExp = _tiExpanded === tag;

    // Build detail section using DOM methods to avoid XSS with user content
    let detailHtml = '';
    if (isExp) {
      const recent = d.items.slice().sort(function(a, b) { return b.date - a.date; }).slice(0, 5);
      const projects = [];
      d.items.forEach(function(i) { if (i.project && projects.indexOf(i.project) < 0) projects.push(i.project); });
      const projChips = projects.slice(0, 6).map(function(p) {
        return '<span class="ti-proj-chip">' + esc(p) + '</span>';
      }).join('');
      const detailRows = recent.map(function(item) {
        const catColor = CAT_COLORS[item.category] || CAT_COLORS.other;
        return '<div class="ti-detail-row">'
          + '<span class="ti-detail-cat" style="background:' + catColor + '">' + esc(item.category || 'other') + '</span>'
          + '<span class="ti-detail-title">' + esc(item.title) + '</span>'
          + '<span class="ti-detail-when">' + relativeTime(item.date) + '</span>'
          + '</div>';
      }).join('');
      detailHtml = '<div class="ti-detail"><div class="ti-detail-inner">'
        + (projChips ? '<div class="ti-detail-projects">' + projChips + '</div>' : '')
        + '<div class="ti-detail-rows">' + detailRows + '</div>'
        + '<div class="ti-detail-footer"><button class="ti-filter-btn" onclick="filterByTag(\'' + esc(tag) + '\')">'
        + 'View all ' + d.count + ' accomplishment' + (d.count !== 1 ? 's' : '') + ' \u2192'
        + '</button></div>'
        + '</div></div>';
    }

    return '<div class="ti-row' + (isExp ? ' ti-row-expanded' : '') + '" data-tag="' + esc(tag) + '">'
      + '<div class="ti-row-main" onclick="tiToggleExpand(\'' + esc(tag) + '\')">'
      + '<span class="ti-col-rank ti-rank-num">' + rank + '</span>'
      + '<span class="ti-col-tag"><span class="ti-tag-badge" style="background:' + bg + ';color:' + tc + '">' + esc(tag) + '</span></span>'
      + '<span class="ti-col-uses ti-mono">' + d.count + '</span>'
      + '<span class="ti-col-spark">' + spark + '</span>'
      + '<span class="ti-col-share"><span class="ti-share-text">' + pct + '%</span>'
      + '<span class="ti-share-bar"><span class="ti-share-fill" style="width:' + pct + '%;background:' + tc + '"></span></span></span>'
      + '<span class="ti-col-last">' + relativeTime(d.lastUsed) + '</span>'
      + '<span class="ti-col-arrow">\u25be</span>'
      + '</div>'
      + detailHtml
      + '</div>';
  }).join('');

  rowsEl.innerHTML = rows;

  if (!_tiShowAll && entries.length > TI_PAGE_SIZE) {
    if (showMoreEl) { showMoreEl.textContent = 'Show all ' + entries.length + ' tags'; showMoreEl.style.display = ''; }
  } else {
    if (showMoreEl) showMoreEl.style.display = 'none';
  }
}

// (renderPieChart, pieOver, pieOut removed — replaced by Tag Intelligence panel)

// ── Palette theming ──────────────────────────────────────────────────────

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
    h *= 360;
  }
  return { h, s, l };
}

function extractHueFromImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.getElementById('palette-canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.height = 80;
      ctx.drawImage(img, 0, 0, 80, 80);
      URL.revokeObjectURL(url);

      const data = ctx.getImageData(0, 0, 80, 80).data;
      let sinSum = 0, cosSum = 0, totalWeight = 0;
      let satSum = 0, satCount = 0;

      for (let i = 0; i < data.length; i += 16) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const { h, s, l } = rgbToHsl(r, g, b);
        if (s < 0.1 || l < 0.05 || l > 0.95) continue;
        const weight = s * (1 - Math.abs(l - 0.45) * 1.5);
        if (weight <= 0) continue;
        const rad = h * Math.PI / 180;
        sinSum += Math.sin(rad) * weight;
        cosSum += Math.cos(rad) * weight;
        totalWeight += weight;
        satSum += s; satCount++;
      }

      if (totalWeight === 0) { resolve(null); return; }
      const hue = ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;
      const saturation = satCount > 0 ? satSum / satCount : 0.5;
      resolve({ hue, saturation });
    };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

function buildPaletteCSS(h, s) {
  return `
    :root,[data-theme="light"]{--primary:hsl(${h},${s}%,50%);--primary-h:hsl(${h},${s}%,40%);--primary-bg:hsl(${h},${Math.round(s*.7)}%,93%);--bg:hsl(${h},${Math.round(s*.15)}%,94%);--surface:hsl(${h},${Math.round(s*.08)}%,99%);--border:hsl(${h},${Math.round(s*.15)}%,88%);--stat-hover:hsl(${h},${Math.round(s*.15)}%,97%)}
    :root[data-theme="dark"]{--primary:hsl(${h},${Math.round(s*.75)}%,65%);--primary-h:hsl(${h},${Math.round(s*.75)}%,55%);--primary-bg:hsl(${h},${Math.round(s*.3)}%,18%);--bg:hsl(${h},${Math.round(s*.2)}%,8%);--surface:hsl(${h},${Math.round(s*.15)}%,13%);--border:hsl(${h},${Math.round(s*.15)}%,21%);--stat-hover:hsl(${h},${Math.round(s*.2)}%,17%)}
    @media(prefers-color-scheme:dark){:root:not([data-theme="light"]):not([data-theme="dark"]){--primary:hsl(${h},${Math.round(s*.75)}%,65%);--primary-h:hsl(${h},${Math.round(s*.75)}%,55%);--primary-bg:hsl(${h},${Math.round(s*.3)}%,18%);--bg:hsl(${h},${Math.round(s*.2)}%,8%);--surface:hsl(${h},${Math.round(s*.15)}%,13%);--border:hsl(${h},${Math.round(s*.15)}%,21%);--stat-hover:hsl(${h},${Math.round(s*.2)}%,17%)}}`;
}

function applyPalette(hue, saturation) {
  const h = Math.round(hue);
  const s = Math.round(Math.min(Math.max(saturation * 100, 30), 75));
  let style = document.getElementById('palette-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'palette-style';
    document.head.appendChild(style);
  }
  style.textContent = buildPaletteCSS(h, s);
  localStorage.setItem('paletteHue', hue);
  localStorage.setItem('paletteSat', saturation);
}

function clearPalette() {
  const style = document.getElementById('palette-style');
  if (style) style.textContent = '';
  localStorage.removeItem('paletteHue');
  localStorage.removeItem('paletteSat');
  document.getElementById('clear-palette-btn').style.display = 'none';
  document.getElementById('palette-preview-wrap').style.display = 'none';
  const fb = document.getElementById('palette-feedback');
  fb.textContent = '✓ Palette cleared — default colours restored.';
  fb.className = 'import-feedback ok';
  setTimeout(() => { fb.style.display = 'none'; }, 3000);
}

function renderPaletteSwatches(hue, saturation, filename) {
  const h = Math.round(hue);
  const s = Math.round(Math.min(Math.max(saturation * 100, 30), 75));
  const swatches = [
    { color: `hsl(${h},${s}%,50%)`,              title: 'Primary (light)' },
    { color: `hsl(${h},${Math.round(s*.75)}%,65%)`, title: 'Primary (dark)' },
    { color: `hsl(${h},${Math.round(s*.7)}%,93%)`,  title: 'Accent bg' },
    { color: `hsl(${h},${Math.round(s*.15)}%,94%)`,  title: 'Background (light)' },
    { color: `hsl(${h},${Math.round(s*.2)}%,8%)`,   title: 'Background (dark)' },
  ];
  document.getElementById('palette-swatches').innerHTML =
    swatches.map(sw => `<span class="swatch" style="background:${sw.color}" title="${sw.title}"></span>`).join('');
  if (filename) document.getElementById('palette-source').textContent = filename;
  document.getElementById('palette-preview-wrap').style.display = '';
  document.getElementById('clear-palette-btn').style.display = '';
}

async function handlePaletteUpload(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const fb = document.getElementById('palette-feedback');
  fb.textContent = 'Extracting palette…';
  fb.className = 'import-feedback';
  fb.style.display = 'block';

  try {
    const result = await extractHueFromImage(file);
    if (!result) {
      fb.textContent = '✕ No distinct colours found — try a more colourful image.';
      fb.className = 'import-feedback err';
      return;
    }
    const { hue, saturation } = result;
    applyPalette(hue, saturation);
    renderPaletteSwatches(hue, saturation, file.name);
    fb.textContent = `✓ Palette applied from "${file.name}" — hue ${Math.round(hue)}°`;
    fb.className = 'import-feedback ok';
    setTimeout(() => { fb.style.display = 'none'; }, 4000);
  } catch (e) {
    fb.textContent = '✕ ' + e.message;
    fb.className = 'import-feedback err';
  }
}

function loadPaletteSettings() {
  const hue = localStorage.getItem('paletteHue');
  const sat = localStorage.getItem('paletteSat');
  if (hue && sat) renderPaletteSwatches(parseFloat(hue), parseFloat(sat));
}

// ── Theme ────────────────────────────────────────────────────────────────
const THEME_CYCLE = ['system', 'light', 'dark'];
const THEME_ICONS = { system: '🖥️', light: '☀️', dark: '🌙' };
const THEME_LABELS = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

function setTheme(theme) {
  localStorage.setItem('theme', theme);
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  const btn = document.getElementById('btn-theme');
  btn.innerHTML = THEME_ICONS[theme];
  btn.title = THEME_LABELS[theme];
  if (currentView === 'tags') renderTags();
}

function cycleTheme() {
  const current = localStorage.getItem('theme') || 'system';
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
  setTheme(next);
}

// React to OS-level theme changes when set to system
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('theme') || 'system') === 'system') {
    document.documentElement.removeAttribute('data-theme');
  }
});

// Sync icon on load
(function() {
  const t = localStorage.getItem('theme') || 'system';
  const btn = document.getElementById('btn-theme');
  btn.innerHTML = THEME_ICONS[t];
  btn.title = THEME_LABELS[t];
})();

// Re-render bubble chart on resize (debounced)
var _tiResizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(_tiResizeTimer);
  _tiResizeTimer = setTimeout(function() {
    if (currentView === 'tags') renderBubbleChart();
  }, 120);
});

// ── Init ────────────────────────────────────────────────────────────────
loadStats();
loadMonthlySummaries();
loadData(periodToParams('this_year'));
