const headline = document.getElementById('headline');
const summary = document.getElementById('summary');
const fields = document.getElementById('fields');
const indicator = document.getElementById('indicator');
let busy = false;
const historyRows = document.getElementById('history-rows');
const historyDetail = document.getElementById('history-detail');
const labels = ['No data', 'Operational', 'Planned release', 'Maintenance / attention', 'Errors recorded', 'Missing updates', 'Unavailable'];
function renderHistory(data) {
  const history = data.history || {};
  const names = new Set(['Overall service']);
  for (const day of Object.values(history)) for (const name of Object.keys(day.services || {})) names.add(name);
  const today = new Date((data.serverTime || Date.now() / 1000) * 1000);
  today.setUTCMinutes(0, 0, 0);
  historyRows.replaceChildren();
  for (const name of names) {
    const overall = name === 'Overall service';
    const count = overall ? 90 : 24;
    const step = overall ? 86400000 : 3600000;
    const endTime = new Date(today);
    if (overall) endTime.setUTCHours(0, 0, 0, 0);
    const source = overall ? data.overallHistory || {} : history;
    const row = document.createElement('section');
    row.className = 'history-row';
    const heading = document.createElement('h3');
    heading.textContent = name + (overall ? ' · Last 90 days' : ' · Last 24 hours');
    const bars = document.createElement('div');
    bars.className = 'bars';
    bars.style.gridTemplateColumns = `repeat(${count}, minmax(0, 1fr))`;
    bars.setAttribute('aria-label', name + (overall ? ' daily status' : ' hourly status'));
    for (let offset = count - 1; offset >= 0; offset--) {
      const timestamp = new Date(endTime.getTime() - offset * step).toISOString().replace('.000Z', 'Z');
      const date = overall ? timestamp.slice(0, 10) : timestamp;
      const day = source[date];
      const observed = day?.services?.[name] || 0;
      const level = day?.gap ? Math.max(observed, 5) : observed;
      const bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'bar level-' + level;
      const detail = `${name} · ${overall ? date : date.slice(0, 10) + ' ' + date.slice(11, 16)} UTC · ${labels[level]}${day?.gap && observed ? ' · Observed status: ' + labels[observed] : ''} · ${day?.samples || 0} updates received`;
      bar.title = detail;
      bar.setAttribute('aria-label', detail);
      // One tab stop per row; arrow keys navigate its time buckets.
      bar.tabIndex = offset === 0 ? 0 : -1;
      bar.addEventListener('click', () => { historyDetail.textContent = detail; });
      bar.addEventListener('focus', () => { historyDetail.textContent = detail; });
      bar.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowLeft') next = bar.previousElementSibling;
        if (event.key === 'ArrowRight') next = bar.nextElementSibling;
        if (event.key === 'Home') next = bars.firstElementChild;
        if (event.key === 'End') next = bars.lastElementChild;
        if (next) { event.preventDefault(); bar.tabIndex = -1; next.tabIndex = 0; next.focus(); }
      });
      bars.append(bar);
    }
    const axis = document.createElement('div');
    axis.className = 'history-axis';
    const start = document.createElement('span');
    start.textContent = overall ? '89 days ago' : '23 hours ago';
    const end = document.createElement('span');
    end.textContent = overall ? 'Today' : 'Current hour';
    axis.append(start, end);
    row.append(heading, bars, axis);
    historyRows.append(row);
  }
}
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const response = await fetch('api.php', {cache: 'no-store', signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    // Preserve keyboard focus while a visitor inspects a history bar.
    if (!historyRows.contains(document.activeElement)) renderHistory(data);
    historyRows.classList.remove('stale');
    if (data.state === 'waiting') {
      headline.textContent = 'Waiting for the first update';
      summary.textContent = 'The dashboard is ready. The bot has not sent a status update yet.';
      indicator.style.background = '#efbc66';
      document.getElementById('updated').textContent = 'No updates received yet';
      fields.replaceChildren();
      return;
    }
    const stale = data.state !== 'fresh';
    const snapshot = data.snapshot;
    headline.textContent = stale ? 'Bot unreachable' : snapshot.connected ? 'Bot connected to Discord' : 'Disconnected from Discord';
    summary.textContent = stale ? 'No updates received for over 60 seconds. The data below shows the last known status.' : snapshot.summary;
    indicator.style.background = stale ? '#e77474' : '#' + snapshot.color.toString(16).padStart(6, '0');
    document.getElementById('updated').textContent = 'Last update: ' + new Date(data.receivedAt * 1000).toLocaleString('en-GB');
    fields.classList.toggle('stale', stale);
    fields.replaceChildren();
    for (const field of snapshot.fields) {
      const card = document.createElement('section');
      card.className = 'card' + (field.inline ? ' metric' : '') + (field.name.startsWith('Recent health') ? ' wide' : '');
      const title = document.createElement('h3');
      const value = document.createElement('p');
      title.textContent = field.name;
      value.textContent = field.value;
      card.append(title, value);
      fields.append(card);
    }
  } catch {
    headline.textContent = 'Status currently unavailable';
    summary.textContent = 'The dashboard cannot retrieve current data. Any data shown is outdated. We will retry automatically.';
    indicator.style.background = '#efbc66';
    fields.classList.add('stale');
    historyRows.classList.add('stale');
    historyDetail.textContent = 'History could not be refreshed. Displayed observations may be outdated.';
  } finally { busy = false; }
}
document.getElementById('refresh').addEventListener('click', refresh);
setInterval(refresh, 15000);
void refresh();
