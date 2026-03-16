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
  const groups = {};
  for (const item of allData) {
    const key = tsToDateKey(item.date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  const sortedGroups = Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  const totalPages = Math.ceil(sortedGroups.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(currentPage, totalPages));

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageGroups = sortedGroups.slice(start, start + PAGE_SIZE);

  const html = pageGroups.map(([date, items]) => {
    const d = new Date(date + 'T12:00:00');
    const label = formatDateLabel(d);
    return `
      <div class="day-group">
        <div class="day-header">
          <span class="day-label">${label}</span>
          <span class="day-count">${items.length}</span>
          <div class="day-line"></div>
        </div>
        ${items.map(renderCard).join('')}
      </div>`;
  }).join('');

  document.getElementById('content').innerHTML = html;
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

function renderAnnual() {
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

  const html = Object.entries(months)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, items]) => {
      const [year, mo] = month.split('-');
      const label = `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${year}`;
      const high = items.filter(i => i.impact_level === 'high').length;

      return `
        <div class="month-section" data-month="${month}">
          <div class="month-header" onclick="toggleMonth(this)">
            <span class="month-name">📅 ${label}</span>
            <div class="month-stats">
              <span>${items.length} accomplished</span>
              ${high > 0 ? `<span>🔴 ${high} high-impact</span>` : ''}
            </div>
            <span style="color:var(--muted);font-size:0.8rem">▼</span>
          </div>
          <div class="month-cards">
            ${renderMonthPage(month, items)}
          </div>
        </div>`;
    }).join('');

  document.getElementById('content').innerHTML = `<div class="monthly-grid">${html}</div>`;
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
  const catColor = CAT_COLORS[item.category] || '#94a3b8';
  const tags = (item.tags || []).map(t => `<span class="tag-badge">${esc(t)}</span>`).join('');
  const time = item.created_at ? tsToDate(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const ctx = item.context || 'work';
  const ctxLabel = ctx.replace(/_/g, ' ');
  const proj = item.project;
  return `
    <div class="card" data-id="${item.id}">
      <div class="card-actions">
        <button class="action-btn" onclick="openEdit(${item.id})" title="Edit">✎ Edit</button>
        <button class="action-btn delete" onclick="deleteItem(${item.id})" title="Delete">✕ Delete</button>
      </div>
      <div class="card-header">
        <span class="impact-dot ${item.impact_level}" title="${item.impact_level} impact"></span>
        <span class="card-title">${esc(item.title)}</span>
      </div>
      <div class="card-description">${esc(item.description)}</div>
      <div class="card-footer">
        <span class="context-badge ${contextClass(ctx)}">${esc(ctxLabel)}</span>
        <span class="cat-badge" style="background:${catColor}">${item.category}</span>
        ${proj ? `<span class="project-badge">${esc(proj)}</span>` : ''}
        ${tags}
        ${time ? `<span class="card-time">${time}</span>` : ''}
      </div>
    </div>`;
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
  const cards = header.nextElementSibling;
  const arrow = header.querySelector('span:last-child');
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

// ── Tag Visualizer ───────────────────────────────────────────────────────
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

async function renderTags() {
  document.getElementById('tag-cloud').innerHTML = '<span style="color:var(--muted);font-size:0.85rem">Loading…</span>';
  document.getElementById('tag-chart').innerHTML = '';
  document.getElementById('tag-pie').innerHTML = '';

  // Fetch all accomplishments (respect current period filter)
  let data = allData;
  if (!data.length) {
    try {
      const r = await fetch('/api/accomplishments');
      data = await r.json();
    } catch { return; }
  }

  // Count tags
  const counts = {};
  for (const item of data) {
    for (const tag of (item.tags || [])) {
      const t = tag.trim().toLowerCase();
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
  }

  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);

  if (!sorted.length) {
    document.getElementById('tag-cloud').innerHTML =
      '<span style="color:var(--muted);font-size:0.85rem">No tags found in the current view.</span>';
    document.getElementById('tag-pie').innerHTML = '';
    return;
  }

  const max = sorted[0][1];
  const min = sorted[sorted.length - 1][1];

  // Cloud — alphabetical order, font size between 0.85rem and 2.4rem by frequency
  const cloudHtml = [...sorted].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => {
    const ratio = max === min ? 1 : (count - min) / (max - min);
    const size = (0.85 + ratio * 1.55).toFixed(2);
    const { bg, text } = tagColor(tag);
    return `<span class="cloud-tag"
      style="font-size:${size}rem;background:${bg};color:${text}"
      onclick="filterByTag('${esc(tag)}')"
      title="${count} use${count !== 1 ? 's' : ''}">${esc(tag)}</span>`;
  }).join('');
  document.getElementById('tag-cloud').innerHTML = cloudHtml;

  // Bar chart — top 20, bars coloured per tag
  const top = sorted.slice(0, 20);
  const barHtml = top.map(([tag, count]) => {
    const pct = ((count / max) * 100).toFixed(1);
    const { text } = tagColor(tag);
    return `
      <div class="bar-row">
        <span class="bar-label">${esc(tag)}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%;background:${text}"></div>
        </div>
        <span class="bar-count">${count}</span>
      </div>`;
  }).join('');
  document.getElementById('tag-chart').innerHTML = barHtml;
  renderPieChart(sorted);
}

function filterByTag(tag) {
  setView('timeline');
  document.getElementById('filter-search').value = tag;
  applyFilters();
}

function renderPieChart(sorted) {
  const container = document.getElementById('tag-pie');
  if (!container) return;

  const MAX = 10;
  const top = sorted.slice(0, MAX);
  const rest = sorted.slice(MAX);
  const restCount = rest.reduce((s, [, c]) => s + c, 0);

  const entries = [...top];
  if (restCount > 0) entries.push([`other tags (${rest.length})`, restCount]);

  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (!total) { container.innerHTML = ''; return; }

  const cx = 100, cy = 100, R = 80, ri = 44;
  let a = -Math.PI / 2;

  function pt(angle, rad) { return [cx + rad * Math.cos(angle), cy + rad * Math.sin(angle)]; }

  const slices = entries.map(([tag, count]) => {
    const sa = a;
    a += (count / total) * 2 * Math.PI;
    const ea = a;
    const large = ea - sa > Math.PI ? 1 : 0;
    const [x1, y1] = pt(sa, R), [x2, y2] = pt(ea, R);
    const [x3, y3] = pt(ea, ri), [x4, y4] = pt(sa, ri);
    const d = `M${x1},${y1}A${R},${R},0,${large},1,${x2},${y2}L${x3},${y3}A${ri},${ri},0,${large},0,${x4},${y4}Z`;
    const isOther = tag.startsWith('other tags');
    const color = isOther ? (isDarkMode() ? '#4b5563' : '#9ca3af') : tagColor(tag).text;
    const pct = ((count / total) * 100).toFixed(1);
    return { tag, count, pct, d, color, isOther };
  });

  window._pieSlices = slices;
  window._pieTotal = total;

  const paths = slices.map((s, i) =>
    `<path d="${s.d}" fill="${s.color}" opacity="0.85" class="pie-slice"
      onmouseenter="pieOver(${i})" onmouseleave="pieOut()"
      onclick="${s.isOther ? '' : `filterByTag('${esc(s.tag)}')`}"
      style="cursor:${s.isOther ? 'default' : 'pointer'};transition:opacity .12s"/>`
  ).join('');

  const legendRows = slices.map((s, i) =>
    `<div class="pie-leg" onmouseenter="pieOver(${i})" onmouseleave="pieOut()"
       onclick="${s.isOther ? '' : `filterByTag('${esc(s.tag)}')`}"
       style="cursor:${s.isOther ? 'default' : 'pointer'}">
      <span class="pie-dot" style="background:${s.color}"></span>
      <span class="pie-leg-tag">${esc(s.tag)}</span>
      <span class="pie-leg-pct">${s.pct}%</span>
    </div>`
  ).join('');

  container.innerHTML = `
    <div class="pie-layout">
      <svg viewBox="0 0 200 200" class="pie-svg">
        ${paths}
        <circle cx="${cx}" cy="${cy}" r="${ri - 1}" fill="var(--surface)"/>
        <text id="pie-c1" x="${cx}" y="${cy - 5}" text-anchor="middle" class="pie-c1">${total}</text>
        <text id="pie-c2" x="${cx}" y="${cy + 14}" text-anchor="middle" class="pie-c2">total uses</text>
      </svg>
      <div class="pie-legend">${legendRows}</div>
    </div>`;
}

function pieOver(idx) {
  const s = window._pieSlices?.[idx];
  if (!s) return;
  document.querySelectorAll('.pie-slice').forEach((el, i) => { el.style.opacity = i === idx ? '1' : '0.3'; });
  document.querySelectorAll('.pie-leg').forEach((el, i) => { el.style.opacity = i === idx ? '1' : '0.4'; });
  const c1 = document.getElementById('pie-c1');
  const c2 = document.getElementById('pie-c2');
  if (c1) c1.textContent = s.pct + '%';
  if (c2) c2.textContent = s.isOther ? 'other tags' : esc(s.tag);
}

function pieOut() {
  if (!window._pieSlices) return;
  document.querySelectorAll('.pie-slice').forEach(el => { el.style.opacity = '0.85'; });
  document.querySelectorAll('.pie-leg').forEach(el => { el.style.opacity = '1'; });
  const c1 = document.getElementById('pie-c1');
  const c2 = document.getElementById('pie-c2');
  if (c1) c1.textContent = window._pieTotal;
  if (c2) c2.textContent = 'total uses';
}

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

// ── Init ────────────────────────────────────────────────────────────────
loadStats();
loadData(periodToParams('this_year'));
