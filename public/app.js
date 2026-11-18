import { LEAGUES, SPORTS, TIERS } from './config.js';
import * as api from './api.js';

// ---------------- Estado ----------------
const LS = 'meuplacar:v1';
const defaults = {
  enabled: LEAGUES.filter((l) => l.on).map((l) => l.key),
  favs: {}, // key -> { key, src, leagueKey, teamId, name, logo }
  tiers: ['s', 'a'],
  standingsLeague: 'bra.1',
};
const store = (() => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { ...defaults }; }
})();
const save = () => { try { localStorage.setItem(LS, JSON.stringify(store)); } catch {} };

const ui = {
  tab: 'jogos',
  day: startOfDay(new Date()),
  sport: 'all',
  onlyLive: false,
  matches: [],
  errors: [],
  loading: false,
  detail: null, // { match, data, tab }
};
let pollTimer = null;
let detailTimer = null;

// ---------------- Utilidades ----------------
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el = document) => el.querySelector(sel);
const fmtTime = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDateLong = (d) => d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
const fmtDateShort = (d) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
const leagueByKey = (k) => LEAGUES.find((l) => l.key === k);
const LOGO_PX = { 't-logo': 60, '': 22, mini: 16 };
const logoImg = (src, alt = '', cls = '', px) => {
  if (!src) return `<div class="ph ${cls}">${esc((alt || '?').slice(0, 3))}</div>`;
  const small = api.logoSrc(src, px || LOGO_PX[cls] || 22);
  const fb = small !== src ? ` data-o="${esc(src)}"` : '';
  return `<img class="${cls}" src="${esc(small)}"${fb} alt="" decoding="async" onerror="if(this.dataset.o){this.src=this.dataset.o;this.removeAttribute('data-o')}else{this.style.visibility='hidden'}">`;
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
}

function favKey(m, team) {
  return m.src === 'espn' ? `espn:${m.sport}:${team.id}` : `ps:${m.league.game}:${team.id}`;
}
const isFav = (m, team) => !!store.favs[favKey(m, team)];
const matchHasFav = (m) => isFav(m, m.home) || isFav(m, m.away);

function toggleFav(m, team) {
  if (!team.id) return;
  const k = favKey(m, team);
  if (store.favs[k]) { delete store.favs[k]; toast(`${team.name} removido dos favoritos`); }
  else {
    store.favs[k] = { key: k, src: m.src, leagueKey: m.league.key, teamId: team.id, name: team.name, logo: team.logo };
    toast(`★ ${team.name} adicionado aos favoritos`);
  }
  save();
}

function sportMatch(m, s) {
  if (s === 'all') return true;
  if (s === 'fav') return matchHasFav(m);
  if (s === 'soccer') return m.sport === 'soccer';
  return m.league.key === s;
}

// ---------------- Navegação ----------------
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#btn-refresh').addEventListener('click', () => refresh(true));

function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  render();
  if (tab === 'jogos') refresh();
}

function render() {
  const v = $('#view');
  if (ui.tab === 'jogos') v.innerHTML = viewJogos();
  if (ui.tab === 'agenda') { v.innerHTML = `<h2 class="section-title">Agenda dos favoritos</h2><div id="agenda"><div class="skeleton"></div><div class="skeleton"></div></div>`; loadAgenda(); }
  if (ui.tab === 'tabelas') { v.innerHTML = viewTabelasShell(); loadStandings(); }
  if (ui.tab === 'ajustes') v.innerHTML = viewAjustes();
  bindView();
}

// ---------------- Jogos ----------------
function viewJogos() {
  const today = startOfDay(new Date());
  let dates = '';
  for (let i = -7; i <= 7; i++) {
    const d = addDays(today, i);
    const label = i === 0 ? 'Hoje' : i === -1 ? 'Ontem' : i === 1 ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    const active = +d === +ui.day;
    dates += `<button class="date ${active ? 'active' : ''} ${i === 0 ? 'today' : ''}" data-day="${+d}"><small>${label}</small><strong>${d.getDate()}</strong></button>`;
  }

  const enabledSports = SPORTS.filter((s) => {
    if (s.key === 'all' || s.key === 'fav') return true;
    if (s.key === 'soccer') return LEAGUES.some((l) => l.sport === 'soccer' && store.enabled.includes(l.key));
    return store.enabled.includes(s.key);
  });
  const liveCount = ui.matches.filter((m) => m.state === 'in').length;
  const chips = `<button class="chip live-toggle ${ui.onlyLive ? 'active' : ''}" data-live>Ao vivo${liveCount ? `<span class="n">${liveCount}</span>` : ''}</button>` +
    enabledSports.map((s) => `<button class="chip ${ui.sport === s.key ? 'active' : ''}" data-sport="${s.key}">${s.label}</button>`).join('');

  return `<div class="dates" id="dates">${dates}</div><div class="chips">${chips}</div><div class="fresh" id="fresh">${freshHTML()}</div><div id="list">${listHTML()}</div>`;
}

function listHTML() {
  if (ui.loading && !ui.matches.length) return '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  let ms = ui.matches.filter((m) => sportMatch(m, ui.sport));
  if (ui.onlyLive) ms = ms.filter((m) => m.state === 'in');

  const groups = new Map();
  for (const m of ms) {
    const gk = m.src === 'ps' ? `${m.league.key}|${m.event}` : m.league.key;
    if (!groups.has(gk)) groups.set(gk, { key: gk, league: m.league, sub: m.src === 'ps' ? m.event : '', logo: m.eventLogo, items: [] });
    groups.get(gk).items.push(m);
  }
  const order = (g) => LEAGUES.indexOf(g.league);
  const arr = [...groups.values()].sort((a, b) => {
    const fa = a.items.some(matchHasFav) ? 0 : 1; const fb = b.items.some(matchHasFav) ? 0 : 1;
    const la = a.items.some((m) => m.state === 'in') ? 0 : 1; const lb = b.items.some((m) => m.state === 'in') ? 0 : 1;
    return fa - fb || la - lb || order(a) - order(b) || a.items[0].start - b.items[0].start;
  });

  let html = '';
  const psErr = ui.errors.filter((e) => e.league.src === 'ps');
  if (psErr.length && psErr.some((e) => /503|sem dados/.test(e.error))) html += `<div class="err">CS2/Valorant sem dados: coloque o token grátis da PandaScore nos Secrets do GitHub (veja o LEIA-ME).</div>`;
  else if (ui.errors.length) html += `<div class="err">Não foi possível carregar: ${ui.errors.map((e) => esc(e.league.short)).join(', ')}.</div>`;

  if (!arr.length) {
    const msg = ui.onlyLive ? 'Nenhum jogo ao vivo agora' : ui.sport === 'fav' ? 'Nenhum jogo dos seus favoritos neste dia' : 'Nenhum jogo neste dia';
    return html + `<div class="empty"><b>${msg}</b>Escolha outro dia ou ative mais competições em Ajustes.</div>`;
  }

  for (const g of arr) {
    g.items.sort((a, b) => a.start - b.start);
    const hasTable = g.league.src === 'espn';
    html += `<section class="group"><div class="group-h">${g.logo ? logoImg(g.logo, '') : `<span class="flag">${g.league.flag}</span>`}<span>${esc(g.league.short)}</span>${g.sub ? `<span class="sub">${esc(g.sub)}</span>` : ''}${hasTable ? `<button class="tbl" data-table="${g.league.key}">Tabela ›</button>` : ''}</div>`;
    html += g.items.map(matchRow).join('');
    html += '</section>';
  }
  return html;
}

function matchRow(m) {
  const live = m.state === 'in';
  const post = m.state === 'post';
  const time = live ? esc(m.statusText) : post ? esc(m.statusText || 'Fim') : (m.statusText ? esc(m.statusText) : fmtTime(m.start));
  const side = (t, other) => {
    const lose = post && (t.winner === false && other.winner);
    return `<div class="m-team ${lose ? 'lose' : ''} ${isFav(m, t) ? 'fav' : ''}">${logoImg(t.logo, t.short)}<span>${esc(t.name)}</span></div>`;
  };
  const sc = (t, other) => {
    if (t.score == null || m.state === 'pre') return '<span>&nbsp;</span>';
    const lose = post && other.winner && !t.winner;
    return `<span class="${lose ? 'lose' : ''}">${esc(t.score)}</span>`;
  };
  return `<button class="match" data-uid="${esc(m.uid)}">
    <div class="m-time ${live ? 'live' : ''}">${time}${m.note && m.src === 'ps' ? `<div class="m-meta">${esc(m.note)}</div>` : ''}</div>
    <div class="m-teams">${side(m.home, m.away)}${side(m.away, m.home)}</div>
    <div class="m-score ${live ? 'live' : ''}">${sc(m.home, m.away)}${sc(m.away, m.home)}</div>
    <div class="m-meta">›</div>
  </button>`;
}

async function refresh(manual = false) {
  if (ui.tab !== 'jogos') return;
  const btn = $('#btn-refresh');
  btn.classList.add('spin');
  ui.loading = true;
  const day = ui.day;
  if (manual || !ui.matches.length) { const l = $('#list'); if (l && !ui.matches.length) l.innerHTML = listHTML(); }
  try {
    const [{ matches, errors }, meta] = await Promise.all([api.loadDay(day, store.enabled, store.tiers), api.getMeta()]);
    ui.meta = meta;
    if (+day !== +ui.day) return; // usuário mudou de dia
    ui.matches = matches; ui.errors = errors;
  } catch (e) {
    ui.errors = [{ league: { short: 'conexão', src: 'x' }, error: String(e) }];
  } finally {
    ui.loading = false;
    btn.classList.remove('spin');
  }
  if (ui.tab === 'jogos') {
    const chips = $('.chips');
    const fresh = document.createElement('div'); fresh.innerHTML = viewJogos();
    if (chips) chips.replaceWith(fresh.querySelector('.chips'));
    $('#list').innerHTML = listHTML();
    const fr = $('#fresh'); if (fr) fr.innerHTML = freshHTML();
    bindView();
  }
  schedulePoll();
  prefetchNeighbours();
  if (ui.detail) {
    const upd = ui.matches.find((m) => m.uid === ui.detail.match.uid);
    if (upd) { ui.detail.match = upd; renderDetail(); }
  }
}

// Carrega em segundo plano os dias vizinhos (dados + escudos) para a troca de dia ser instantânea
let prefetchT;
const dayCache = new Map();
function prefetchNeighbours() {
  clearTimeout(prefetchT);
  prefetchT = setTimeout(async () => {
    api.warmLogos(ui.matches.flatMap((m) => [m.home.logo, m.away.logo]));
    for (const off of [1, -1, 2]) {
      const d = addDays(ui.day, off);
      try {
        const r = await api.loadDay(d, store.enabled, store.tiers);
        dayCache.set(+d, { t: Date.now(), ...r });
        api.warmLogos(r.matches.flatMap((m) => [m.home.logo, m.away.logo]));
      } catch {}
    }
  }, 1200);
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const anyLive = ui.matches.some((m) => m.state === 'in');
  const isToday = +ui.day === +startOfDay(new Date());
  const ms = anyLive ? 30_000 : isToday ? 60_000 : 300_000;
  pollTimer = setTimeout(() => { if (document.visibilityState === 'visible') refresh(); else schedulePoll(); }, ms);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ui.tab === 'jogos') refresh(); });

function freshHTML() {
  if (api.liveMode()) return '<span class="dot-live"></span>Ao vivo direto da fonte';
  if (!ui.meta?.generatedAt) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(ui.meta.generatedAt)) / 60000));
  return `Atualizado ${min < 1 ? 'agora' : `há ${min} min`}`;
}

// ---------------- Detalhe da partida ----------------
// Pilha de telas na folha (jogo -> time -> outro jogo ...). Voltar do celular volta uma tela.
const stack = [];
function pushSheet(entry) {
  stack.push(entry);
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  history.pushState({ sheet: stack.length }, '');
  renderSheet();
}
function popSheet() {
  stack.pop();
  clearTimeout(detailTimer);
  if (!stack.length) { ui.detail = null; $('#sheet').hidden = true; document.body.style.overflow = ''; return; }
  renderSheet();
}
function renderSheet() {
  const top = stack[stack.length - 1]; if (!top) return;
  $('.sheet-panel').scrollTop = 0;
  if (top.type === 'match') {
    ui.detail = top; renderDetail();
    if (top.loading && !top.started) { top.started = true; loadDetail(); }
    else if (top.match.state === 'in') { clearTimeout(detailTimer); detailTimer = setTimeout(loadDetail, 30_000); }
  }
  else { ui.detail = null; renderTeam(top); if (!top.data && !top.started) { top.started = true; loadTeam(top); } }
}
function openDetail(m) { pushSheet({ type: 'match', match: m, data: null, extra: null, tab: m.src === 'ps' ? 'maps' : 'resumo', loading: true }); }
function openTeam(t) { pushSheet({ type: 'team', ...t, data: null, tab: 'jogos' }); }
function closeDetail() { const n = stack.length; if (n) history.go(-n); }
window.addEventListener('popstate', () => { if (stack.length) popSheet(); });
$('#sheet').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeDetail();
  else if (e.target.closest('[data-back]')) history.back();
});
const backBar = () => (stack.length > 1 ? `<button class="back" data-back>‹ Voltar</button>` : '');

async function loadDetail() {
  const d = ui.detail; if (!d) return;
  const m = d.match;
  try {
    if (m.src === 'espn') {
      d.data = await api.espnSummary(m.league, m.id);
      // atualiza placar/estado a partir do header
      const comp = d.data.header?.competitions?.[0];
      if (comp) {
        const fake = { id: m.id, date: comp.date || m.start.toISOString(), competitions: [{ ...comp, venue: comp.venue || d.data.gameInfo?.venue }] };
        const nm = api.normEspnEvent(fake, m.league);
        d.match = { ...m, ...nm, venue: nm.venue.name ? nm.venue : m.venue, broadcast: m.broadcast };
      }
    } else {
      const raw = await api.psMatch(m.league, m.id).catch(() => m.raw);
      d.data = raw;
      d.match = { ...api.normPsMatch(raw, m.league) };
      const ids = (raw.opponents || []).map((o) => o.opponent?.id).filter(Boolean);
      d.extra = await api.psTeams(ids, m.league).catch(() => []);
      if (m.league.key === 'valorant') d.vidx = await api.vlrPlayerIndex().catch(() => null);
    }
  } catch (e) {
    d.error = String(e);
  }
  d.loading = false;
  if (stack[stack.length - 1] === d) {
    renderDetail();
    clearTimeout(detailTimer);
    if (d.match.state === 'in') detailTimer = setTimeout(loadDetail, 30_000);
  }
}

function renderDetail() {
  const d = ui.detail; if (!d) return;
  const m = d.match;
  const live = m.state === 'in';
  const showScore = m.state !== 'pre' && m.home.score != null;
  const center = showScore
    ? `<div class="d-score ${live ? 'live' : ''}">${esc(m.home.score)} - ${esc(m.away.score)}<small>${esc(m.statusText || (live ? 'Ao vivo' : 'Fim'))}</small></div>`
    : `<div class="d-score">${fmtTime(m.start)}<small>${esc(m.statusText || fmtDateShort(m.start))}</small></div>`;
  const team = (t) => `<div class="d-team"><button class="d-team-link" data-openteam="${esc(t.id)}">${logoImg(t.logo, t.short, '', 56)}<span>${esc(t.name)}</span></button>${t.id ? `<button class="star ${isFav(m, t) ? 'on' : ''}" data-fav="${esc(t.id)}" aria-label="Favoritar">${isFav(m, t) ? '★' : '☆'}</button>` : ''}</div>`;

  const info = [];
  info.push(`<div>📅 <span><b>${esc(fmtDateLong(m.start))}</b> às <b>${fmtTime(m.start)}</b></span></div>`);
  if (m.src === 'espn') {
    if (m.venue?.name) info.push(`<div>📍 <span><b>${esc(m.venue.name)}</b>${m.venue.city ? ` — ${esc(m.venue.city)}` : ''}</span></div>`);
    if (m.broadcast) info.push(`<div>📺 <span>${esc(m.broadcast)}</span></div>`);
    if (m.note) info.push(`<div>🏷️ <span>${esc(m.note)}</span></div>`);
  } else {
    if (m.event) info.push(`<div>🏆 <span><b>${esc(m.event)}</b>${m.note ? ` · ${esc(m.note)}` : ''}${m.tier ? ` · Tier ${esc(m.tier.toUpperCase())}` : ''}</span></div>`);
  }

  const tabs = m.src === 'ps'
    ? [['maps', 'Mapas'], ...(m.league.key === 'valorant' ? [['vstats', 'Estatísticas']] : []), ['lineups', 'Elencos'], ['h2h', 'Confronto'], ['streams', 'Assistir']]
    : [['resumo', 'Resumo'], ['lineups', m.sport === 'football' ? 'Destaques' : 'Escalação'], ['h2h', 'Confronto'], ['table', 'Tabela']];

  $('#sheet-body').innerHTML = `${backBar()}
    <div class="d-league">${m.league.flag} ${esc(m.league.name)}</div>
    <div class="d-head">${team(m.home)}${center}${team(m.away)}</div>
    <div class="d-info">${info.join('')}</div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-dtab="${k}" class="${d.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div class="pane" id="pane">${paneHTML()}</div>`;

  $('#sheet-body').querySelectorAll('[data-dtab]').forEach((b) => b.addEventListener('click', () => { d.tab = b.dataset.dtab; renderDetail(); }));
  $('#sheet-body').querySelectorAll('[data-openteam]').forEach((b) => b.addEventListener('click', () => {
    const t = [m.home, m.away].find((x) => x.id === b.dataset.openteam); if (!t?.id) return;
    openTeam({ src: m.src, league: m.league, id: t.id, name: t.name, logo: t.logo });
  }));
  bindMatchLinks($('#sheet-body'));
  $('#sheet-body').querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', () => {
    const t = [m.home, m.away].find((x) => x.id === b.dataset.fav);
    toggleFav(m, t); renderDetail(); if (ui.tab === 'jogos') { $('#list').innerHTML = listHTML(); bindView(); }
  }));
  if (d.tab === 'table' && !d.table) loadDetailTable();
  if (d.tab === 'table' && m.league.cup) {
    $('#sheet-body').querySelectorAll('[data-tsub]').forEach((b) => b.onclick = () => { d.tsub = b.dataset.tsub; renderDetail(); });
    if ((d.tsub || 'ko') === 'ko') api.bracket(m.league).then((br) => { const box = $('#ko-box'); if (box && ui.detail === d) renderBracketInto(box, br, m.league, [m.home.id, m.away.id]); });
  }
  if (d.tab === 'h2h' && !d.h2h) loadH2H();
  if (d.tab === 'vstats' && d.vlr === undefined && !d.vlrLoading) { d.vlrLoading = true; api.vlrMatch(m.id).then((v) => { d.vlr = v; if (ui.detail === d && d.tab === 'vstats') $('#pane').innerHTML = paneHTML(); }); }
}

function paneHTML() {
  const d = ui.detail; const m = d.match;
  if (d.loading) return '<div class="skeleton"></div><div class="skeleton"></div>';
  if (d.error && !d.data) return `<div class="empty"><b>Não foi possível carregar os detalhes</b>${esc(d.error)}</div>`;
  if (m.src === 'ps') {
    if (d.tab === 'maps') return psMapsHTML(d);
    if (d.tab === 'lineups') return psLineupsHTML(d);
    if (d.tab === 'streams') return psStreamsHTML(d);
  }
  if (d.tab === 'vstats') return d.vlr === undefined ? '<div class="skeleton"></div>' : vlrMatchHTML(d);
  if (d.tab === 'h2h') return d.h2h ? h2hHTML(d) : '<div class="skeleton"></div><div class="skeleton"></div>';
  if (d.tab === 'resumo') return espnResumoHTML(d);
  if (d.tab === 'lineups') return m.sport === 'football' ? espnLeadersHTML(d) : espnLineupsHTML(d);
  if (d.tab === 'table') {
    if (m.league.cup) {
      const sub = d.tsub || 'ko';
      const seg = `<div class="tabs" style="margin:0 0 12px"><button data-tsub="ko" class="${sub === 'ko' ? 'active' : ''}">Mata-mata</button><button data-tsub="class" class="${sub === 'class' ? 'active' : ''}">Classificação</button></div>`;
      if (sub === 'ko') return seg + '<div id="ko-box"><div class="skeleton"></div></div>';
      return seg + (d.table ? (d.table.length ? standingsHTML(d.table, [m.home.id, m.away.id], m.league) : '<div class="empty"><b>Sem fase de pontos</b></div>') : '<div class="skeleton"></div>');
    }
    return d.table ? standingsHTML(d.table, [m.home.id, m.away.id], m.league) : '<div class="skeleton"></div>';
  }
  return '';
}

function espnResumoHTML(d) {
  const m = d.match; const s = d.data || {};
  let html = '';
  // Placar por período (NBA/NFL)
  const comp = s.header?.competitions?.[0];
  const cs = comp?.competitors || [];
  const ls = cs.map((c) => c.linescores || []);
  if (m.sport !== 'soccer' && ls.some((x) => x.length)) {
    const n = Math.max(...ls.map((x) => x.length));
    const order = [cs.find((c) => c.homeAway === 'home'), cs.find((c) => c.homeAway === 'away')].filter(Boolean);
    html += `<div class="subhead">Placar por ${m.sport === 'basketball' ? 'quarto' : 'período'}</div><div class="card" style="margin:0 0 12px"><div class="table-scroll"><table class="standings"><tr><th></th><th style="text-align:left">Time</th>${Array.from({ length: n }, (_, i) => `<th>${i < 4 ? i + 1 : 'P' + (i - 3)}</th>`).join('')}<th>T</th></tr>` +
      order.map((c) => `<tr><td></td><td class="team"><div>${logoImg(c.team?.logos?.[0]?.href || c.team?.logo, c.team?.abbreviation)}${esc(c.team?.abbreviation || c.team?.displayName)}</div></td>${Array.from({ length: n }, (_, i) => `<td>${esc(c.linescores?.[i]?.displayValue ?? '-')}</td>`).join('')}<td class="pts">${esc(c.score ?? '')}</td></tr>`).join('') +
      '</table></div></div>';
  }

  // Lances (futebol)
  let evs = [];
  if (Array.isArray(s.keyEvents) && s.keyEvents.length) {
    evs = s.keyEvents.map((k) => {
      const t = (k.type?.text || k.type?.type || '').toLowerCase();
      const kind = k.scoringPlay || /goal|gol/.test(t) ? 'goal' : /red/.test(t) ? 'red' : /yellow/.test(t) ? 'yellow' : /substitution/.test(t) ? 'sub' : null;
      if (!kind) return null;
      const who = (k.participants || []).map((p) => p.athlete?.displayName).filter(Boolean);
      return { min: k.clock?.displayValue || '', teamId: String(k.team?.id ?? ''), kind, who: kind === 'sub' ? who.join(' ⇄ ') : who[0] || k.shortText || k.text || '', extra: kind === 'goal' && who[1] ? `assist. ${who[1]}` : '' };
    }).filter(Boolean);
  } else if (Array.isArray(s.rosters)) {
    s.rosters.forEach((r) => (r.roster || []).forEach((p) => (p.plays || []).forEach((pl) => {
      const kind = pl.scoringPlay || pl.didScore ? 'goal' : pl.redCard ? 'red' : pl.yellowCard ? 'yellow' : pl.substitution && pl.didSub !== false && p.subbedIn ? 'sub' : null;
      if (kind) evs.push({ min: pl.clock?.displayValue || '', teamId: String(r.team?.id ?? ''), kind, who: p.athlete?.displayName || '', extra: pl.ownGoal ? 'contra' : pl.penaltyKick ? 'pênalti' : '' });
    })));
    evs.sort((a, b) => parseInt(a.min) - parseInt(b.min));
  }
  const ico = { goal: '⚽', yellow: '🟨', red: '🟥', sub: '🔁' };
  if (evs.length) {
    html += `<div class="subhead">Lances</div><div class="events">` + evs.map((e) => {
      const home = e.teamId === m.home.id;
      const txt = `<span class="ico">${ico[e.kind]}</span> ${esc(e.who)}${e.extra ? ` <small style="color:var(--dim)">(${esc(e.extra)})</small>` : ''}`;
      return `<div class="ev"><div class="l">${home ? txt : ''}</div><div class="min">${esc(e.min)}</div><div>${home ? '' : txt}</div></div>`;
    }).join('') + '</div>';
  }

  // Estatísticas do jogo
  const box = s.boxscore?.teams;
  if (Array.isArray(box) && box.length === 2 && box[0].statistics?.length) {
    const [a, b] = [box.find((t) => String(t.team?.id) === m.home.id) || box[0], box.find((t) => String(t.team?.id) === m.away.id) || box[1]];
    const want = m.sport === 'soccer' ? ['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'foulsCommitted', 'offsides', 'saves'] : null;
    const stats = (a.statistics || []).filter((st) => !want || want.includes(st.name)).slice(0, 12);
    if (stats.length) {
      html += `<div class="subhead">Estatísticas</div><div class="card" style="margin:0 0 12px">` + stats.map((st) => {
        const o = (b.statistics || []).find((x) => x.name === st.name) || {};
        return `<div class="row"><b style="width:56px">${esc(st.displayValue)}</b><div class="grow" style="text-align:center;color:var(--muted);font-size:13px">${esc(st.label || st.name)}</div><b style="width:56px;text-align:right">${esc(o.displayValue ?? '')}</b></div>`;
      }).join('') + '</div>';
    }
  }

  if (!html) html = `<div class="empty"><b>${m.state === 'pre' ? 'O jogo ainda não começou' : 'Sem lances disponíveis'}</b>${m.state === 'pre' ? 'Os lances aparecem aqui durante a partida.' : ''}</div>`;
  return html;
}

function espnLineupsHTML(d) {
  const m = d.match; const s = d.data || {};
  const col = (title, logo, starters, bench, formation) => `<div class="lineup"><h4>${logoImg(logo, '')}${esc(title)}${formation ? ` · ${esc(formation)}` : ''}</h4>` +
    starters.map(pl).join('') + (bench.length ? `<div class="subhead">Reservas</div>${bench.map(pl).join('')}` : '') + '</div>';
  const pl = (p) => `<div class="player"><span class="num">${esc(p.num ?? '')}</span><span>${esc(p.name)}</span><span class="pos">${esc(p.pos ?? '')}</span></div>`;

  // Futebol: rosters
  if (Array.isArray(s.rosters) && s.rosters.some((r) => r.roster?.length)) {
    const sides = ['home', 'away'].map((ha) => s.rosters.find((r) => r.homeAway === ha)).filter(Boolean);
    return `<div class="lineups">` + sides.map((r) => {
      const all = (r.roster || []).map((p) => ({ num: p.jersey, name: p.athlete?.displayName, pos: p.position?.abbreviation, starter: p.starter, order: Number(p.formationPlace || 99) }));
      const st = all.filter((p) => p.starter).sort((a, b) => a.order - b.order);
      return col(r.team?.shortDisplayName || r.team?.displayName || '', r.team?.logos?.[0]?.href || r.team?.logo, st, all.filter((p) => !p.starter), r.formation);
    }).join('') + '</div>';
  }
  // NBA: boxscore.players
  const bp = s.boxscore?.players;
  if (Array.isArray(bp) && bp.length) {
    return `<div class="lineups">` + bp.map((t) => {
      const ath = (t.statistics?.[0]?.athletes || []).map((a) => ({ num: a.athlete?.jersey, name: a.athlete?.displayName || a.athlete?.shortName, pos: a.athlete?.position?.abbreviation, starter: a.starter, pts: a.stats }));
      return col(t.team?.shortDisplayName || t.team?.displayName, t.team?.logo, ath.filter((a) => a.starter), ath.filter((a) => !a.starter));
    }).join('') + '</div>';
  }
  return `<div class="empty"><b>Escalações ainda não divulgadas</b>No futebol elas costumam sair cerca de 1 hora antes do jogo.</div>`;
}

function espnLeadersHTML(d) {
  const s = d.data || {};
  const L = s.leaders || [];
  const cats = { passingYards: 'Passe', rushingYards: 'Corrida', receivingYards: 'Recepção', passingLeader: 'Passe', rushingLeader: 'Corrida', receivingLeader: 'Recepção' };
  if (!L.length) return `<div class="empty"><b>Sem destaques ainda</b>Os líderes de estatística aparecem quando o jogo começa.</div>`;
  return `<div class="lineups">` + L.map((t) => `<div class="lineup"><h4>${logoImg(t.team?.logo, '')}${esc(t.team?.abbreviation || t.team?.displayName || '')}</h4>` +
    (t.leaders || []).slice(0, 4).map((c) => {
      const top = c.leaders?.[0];
      return `<div class="player" style="display:block"><div class="sub" style="color:var(--dim);font-size:11px">${esc(cats[c.name] || c.displayName || c.name)}</div><b>${esc(top?.athlete?.displayName || '-')}</b><div style="color:var(--muted);font-size:12px">${esc(top?.displayValue || '')}</div></div>`;
    }).join('') + '</div>').join('') + '</div>';
}

async function loadH2H() {
  const d = ui.detail; if (!d || d.h2h || d.h2hLoading) return;
  d.h2hLoading = true;
  try { d.h2h = d.match.src === 'ps' ? await api.psH2H(d.match) : await api.espnH2H(d.match, d.data); }
  catch { d.h2h = { form: {}, h2h: [] }; }
  if (ui.detail === d && d.tab === 'h2h') $('#pane').innerHTML = paneHTML();
}

const resBadge = (r) => `<span class="res res-${r === 'V' ? 'w' : r === 'D' ? 'l' : 'd'}">${esc(r || '-')}</span>`;
function formBlock(team, list) {
  if (!list?.length) return `<div class="card" style="margin:0 0 12px"><div class="group-h">${logoImg(team.logo, '')}${esc(team.name)}</div><div class="row"><div class="sub">Sem jogos recentes disponíveis.</div></div></div>`;
  const pts = list.map((x) => resBadge(x.result)).join('');
  return `<div class="card" style="margin:0 0 12px"><div class="group-h">${logoImg(team.logo, '')}<span>${esc(team.name)}</span><span class="form-strip">${pts}</span></div>` +
    list.map((x) => `<div class="row">${resBadge(x.result)}<div class="grow"><div style="display:flex;align-items:center;gap:6px">${x.home ? '<span class="sub">vs</span>' : '<span class="sub">@</span>'}${logoImg(x.opp.logo, x.opp.name)}<span>${esc(x.opp.name)}</span></div><div class="sub">${esc(fmtDateShort(x.date))}${x.comp ? ' · ' + esc(x.comp) : ''}</div></div><b>${esc(x.score)}</b></div>`).join('') + '</div>';
}
function h2hHTML(d) {
  const m = d.match; const { form, h2h } = d.h2h;
  let wins = { h: 0, a: 0, d: 0 };
  h2h.filter((x) => x.done).forEach((x) => {
    const hw = x.home.winner, aw = x.away.winner;
    const homeIsH = x.home.id === m.home.id;
    if (!hw && !aw) wins.d++; else if ((hw && homeIsH) || (aw && !homeIsH)) wins.h++; else wins.a++;
  });
  let html = `<div class="subhead">Confronto direto${d.h2h.years ? ` · últimos ${d.h2h.years} anos + temporada atual` : ''}</div>`;
  if (h2h.length) {
    html += `<div class="h2h-sum"><div><b>${wins.h}</b><span>${esc(m.home.short)}</span></div><div><b>${wins.d}</b><span>Empates</span></div><div><b>${wins.a}</b><span>${esc(m.away.short)}</span></div></div>`;
    html += `<div class="card" style="margin:0 0 12px">` + h2h.slice(0, 25).map((x) => `<div class="row h2h-row"><div class="sub" style="width:64px">${esc(x.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }))}</div>
      <div class="grow"><div class="m-team ${x.done && x.away.winner ? 'lose' : ''}">${logoImg(x.home.logo, x.home.name)}<span>${esc(x.home.name)}</span><b style="margin-left:auto">${esc(x.home.score ?? '-')}</b></div>
      <div class="m-team ${x.done && x.home.winner ? 'lose' : ''}" style="margin-top:4px">${logoImg(x.away.logo, x.away.name)}<span>${esc(x.away.name)}</span><b style="margin-left:auto">${esc(x.away.score ?? '-')}</b></div>
      ${x.comp ? `<div class="sub" style="margin-top:4px">${esc(x.comp)}</div>` : ''}</div></div>`).join('') + '</div>';
  } else html += `<div class="card" style="margin:0 0 12px"><div class="row"><div class="sub">Nenhum confronto recente encontrado entre os dois.</div></div></div>`;
  html += '<div class="subhead">Últimos jogos</div>' + formBlock(m.home, form[m.home.id]) + formBlock(m.away, form[m.away.id]);
  return html;
}

// ---------------- Página do time ----------------
async function loadTeam(entry) {
  try {
    entry.data = entry.src === 'ps' ? await api.psTeamPage(entry.league, entry.id) : await api.teamPage(entry.league, entry.id);
    if (entry.src === 'ps' && entry.league.key === 'valorant') entry.vidx = await api.vlrPlayerIndex().catch(() => null);
    if (!entry.data) entry.error = 'Página deste time ainda não foi gerada. O robô atualiza todos os times a cada ~2 horas.';
  } catch (e) { entry.error = String(e); }
  if (stack[stack.length - 1] === entry) renderTeam(entry);
}

function teamFavKey(entry) { return entry.src === 'espn' ? `espn:${entry.league.sport}:${entry.id}` : `ps:${entry.league.game}:${entry.id}`; }

function renderTeam(entry) {
  const d = entry.data;
  const name = d?.name || entry.name; const logo = d?.logo || entry.logo;
  const fk = teamFavKey(entry); const fav = !!store.favs[fk];
  const tabs = [['jogos', 'Jogos'], ['elenco', 'Elenco']];
  if (entry.src === 'espn' && entry.league.sport === 'soccer') tabs.push(['stats', 'Estatísticas']);
  if (entry.src === 'espn') tabs.push(['hist', 'Histórico']);
  let pane = '';
  if (!d) pane = entry.error ? `<div class="empty"><b>Sem dados do time</b>${esc(entry.error)}</div>` : '<div class="skeleton"></div><div class="skeleton"></div>';
  else if (entry.tab === 'jogos') pane = teamGamesHTML(d);
  else if (entry.tab === 'elenco') pane = teamRosterHTML(entry, d);
  else if (entry.tab === 'hist') pane = entry.hist === undefined ? '<div class="skeleton"></div>' : teamHistHTML(entry);
  else pane = teamStatsHTML(d);
  $('#sheet-body').innerHTML = `${backBar()}
    <div class="t-head">${logoImg(logo, name, 't-logo')}<div class="grow"><h3>${esc(name)}</h3><div class="sub">${esc(entry.league.flag + ' ' + entry.league.name)}${d?.standing ? ' · ' + esc(d.standing) : ''}${d?.record ? ' · ' + esc(d.record) : ''}</div></div>
      <button class="star ${fav ? 'on' : ''}" data-tfav>${fav ? '★' : '☆'}</button></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-ttab="${k}" class="${entry.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div class="pane">${pane}</div>`;
  const body = $('#sheet-body');
  body.querySelectorAll('[data-ttab]').forEach((b) => b.onclick = () => { entry.tab = b.dataset.ttab; renderTeam(entry); });
  if (entry.tab === 'hist' && entry.hist === undefined && !entry.histLoading) { entry.histLoading = true; api.teamHistory(entry.league.sport, entry.id).then((h) => { entry.hist = h; if (stack[stack.length - 1] === entry) renderTeam(entry); }); }
  body.querySelector('[data-tfav]').onclick = () => {
    toggleFav({ src: entry.src, sport: entry.league.sport, league: entry.league }, { id: entry.id, name, logo });
    renderTeam(entry);
  };
  bindMatchLinks(body);
}

function teamGamesHTML(d) {
  const ev = d.events || [];
  const next = ev.filter((m) => m.state !== 'post');
  const past = ev.filter((m) => m.state === 'post').reverse();
  ui.sheetMatches = new Map(ev.map((m) => [m.uid, m]));
  const block = (title, list, empty) => `<div class="subhead">${title}</div>` + (list.length
    ? `<section class="group" style="margin:0 0 12px">${list.map((m) => matchRow(m).replace('<div class="m-meta">›</div>', `<div class="m-meta">›</div>`).replace('</button>', `</button><div class="m-sub">${esc(fmtDateShort(m.start))} · ${esc(m.comp || m.league.short)}${m.venue?.name ? ' · ' + esc(m.venue.name) : ''}</div>`)).join('')}</section>`
    : `<div class="card" style="margin:0 0 12px"><div class="row"><div class="sub">${empty}</div></div></div>`);
  return block('Próximos jogos', next.slice(0, 30), 'Nenhum jogo marcado.') + block('Resultados', past.slice(0, 40), 'Sem resultados ainda.');
}

function teamRosterHTML(entry, d) {
  const r = d.roster || [];
  if (!r.length) return '<div class="empty"><b>Elenco indisponível</b></div>';
  if (entry.src === 'ps') {
    return `<div class="card" style="margin:0;padding:0 12px">${r.map((p) => psPlayerRow(p, entry.vidx)).join('')}</div>${entry.vidx ? '<p class="hint" style="margin:8px 0">Rating, ACS e K/D dos últimos 60 dias · fonte VLR.gg</p>' : ''}`;
  }
  const order = { G: 0, GK: 0, D: 1, M: 2, F: 3 };
  const groups = new Map();
  r.slice().sort((a, b) => (order[a.pos] ?? 9) - (order[b.pos] ?? 9) || Number(a.jersey || 99) - Number(b.jersey || 99)).forEach((p) => {
    const g = p.posName || p.pos || 'Elenco'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p);
  });
  const PT = { Goalkeeper: 'Goleiros', Defender: 'Defensores', Midfielder: 'Meio-campistas', Forward: 'Atacantes', Guard: 'Armadores', Forward_: 'Alas', Center: 'Pivôs' };
  return [...groups].map(([g, ps]) => `<div class="subhead">${esc(PT[g] || g)}</div><div class="card" style="margin:0 0 10px">${ps.map((p) => {
    const st = p.st || {};
    const extra = [st.appearances != null ? `${st.appearances} J` : '', st.totalGoals != null && st.totalGoals !== '0' ? `${st.totalGoals} G` : '', st.goalAssists != null && st.goalAssists !== '0' ? `${st.goalAssists} A` : ''].filter(Boolean).join(' · ');
    return `<div class="player" style="padding:8px 12px"><span class="num">${esc(p.jersey ?? '')}</span><span><b>${esc(p.name)}</b><br><small style="color:var(--dim)">${[p.age ? `${p.age} anos` : '', p.flag].filter(Boolean).map(esc).join(' · ')}</small></span><span class="pos">${esc(extra || p.pos || '')}</span></div>`;
  }).join('')}</div>`).join('');
}

function teamHistHTML(entry) {
  const h = entry.hist; const id = String(entry.id);
  if (!h?.length) return '<div class="empty"><b>Histórico ainda não gerado</b>O robô busca as últimas 5 temporadas de cada time aos poucos (todos os times em ~6 horas depois da primeira publicação).</div>';
  const bySeason = new Map();
  h.forEach((g) => { if (!bySeason.has(g.season)) bySeason.set(g.season, []); bySeason.get(g.season).push(g); });
  const sum = (games) => {
    let v = 0, e = 0, dd = 0, gp = 0, gc = 0;
    games.forEach((g) => { const me = g.home.id === id ? g.home : g.away; const op = g.home.id === id ? g.away : g.home;
      gp += Number(me.score) || 0; gc += Number(op.score) || 0; if (me.winner) v++; else if (op.winner) dd++; else e++; });
    return { j: games.length, v, e, d: dd, gp, gc };
  };
  const sport = entry.league.sport;
  const lineSum = (x) => sport === 'soccer' ? `${x.j} J · <b class="w">${x.v} V</b> · ${x.e} E · <b class="l">${x.d} D</b> · ${x.gp}:${x.gc} gols` : `${x.j} J · <b class="w">${x.v} V</b> · <b class="l">${x.d} D</b>`;
  const seasonLabel = (y) => sport === 'basketball' ? `${y - 1}/${String(y).slice(2)}` : (sport === 'soccer' && !entry.league.key.startsWith('bra.') && entry.league.key !== 'usa.1') ? `${y}/${String(y + 1).slice(2)}` : String(y);
  return [...bySeason].sort((a, b) => b[0] - a[0]).map(([y, games]) => {
    const byComp = new Map(); games.forEach((g) => { if (!byComp.has(g.comp)) byComp.set(g.comp, []); byComp.get(g.comp).push(g); });
    const total = sum(games);
    return `<details class="season"><summary><span class="sy">Temporada ${esc(seasonLabel(y))}</span><span class="sub">${lineSum(total)}</span></summary>
      ${[...byComp].map(([c, gs]) => `<div class="subhead" style="margin:10px 0 4px">${esc(c)} · <span style="text-transform:none">${lineSum(sum(gs))}</span></div>
        <div class="card" style="margin:0 0 8px">${gs.map((g) => {
          const me = g.home.id === id ? g.home : g.away; const op = g.home.id === id ? g.away : g.home;
          const r = me.winner ? 'V' : op.winner ? 'D' : 'E';
          return `<div class="row">${resBadge(r)}<div class="grow"><div style="display:flex;align-items:center;gap:6px"><span class="sub">${g.home.id === id ? 'vs' : '@'}</span>${logoImg(op.logo, op.name)}<span>${esc(op.name)}</span></div><div class="sub">${esc(g.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }))}</div></div><b>${esc(g.home.score)}-${esc(g.away.score)}</b></div>`;
        }).join('')}</div>`).join('')}
    </details>`;
  }).join('');
}

function teamStatsHTML(d) {
  const r = (d.roster || []).filter((p) => p.st && Object.keys(p.st).length);
  const top = (key, label) => {
    const list = r.filter((p) => Number(p.st[key]) > 0).sort((a, b) => Number(b.st[key]) - Number(a.st[key])).slice(0, 8);
    if (!list.length) return '';
    return `<div class="subhead">${label}</div><div class="card" style="margin:0 0 10px">${list.map((p, i) => `<div class="row"><span class="sub" style="width:18px">${i + 1}</span><div class="grow">${esc(p.name)}<div class="sub">${esc(p.pos || '')}${p.st.appearances ? ` · ${esc(p.st.appearances)} jogos` : ''}</div></div><b class="big">${esc(p.st[key])}</b></div>`).join('')}</div>`;
  };
  const html = top('totalGoals', 'Artilheiros do time') + top('goalAssists', 'Assistências') + top('yellowCards', 'Cartões amarelos') + top('saves', 'Defesas (goleiros)');
  return html || '<div class="empty"><b>Sem estatísticas de jogadores</b>A ESPN nem sempre publica números para todas as ligas.</div>';
}

function bindMatchLinks(root) {
  root.querySelectorAll('.match[data-uid]').forEach((b) => b.onclick = () => {
    const m = ui.sheetMatches?.get(b.dataset.uid) || ui.matches.find((x) => x.uid === b.dataset.uid) || ui.agendaIndex?.get(b.dataset.uid);
    if (m) openDetail(m);
  });
  root.querySelectorAll('[data-team]').forEach((b) => b.onclick = () => {
    const [lk, id] = b.dataset.team.split('|'); const lg = leagueByKey(lk);
    if (lg) openTeam({ src: lg.src, league: lg, id, name: b.dataset.name || '', logo: b.dataset.logo || '' });
  });
}

async function loadDetailTable() {
  const d = ui.detail; if (!d || d.table || d.tableLoading) return;
  d.tableLoading = true;
  try { d.table = await api.espnStandings(d.match.league); } catch { d.table = []; }
  if (ui.detail === d && d.tab === 'table') { if (d.match.league.cup && (d.tsub || 'ko') === 'ko') return; $('#pane').innerHTML = paneHTML(); bindMatchLinks($('#pane')); }
}

function psMapsHTML(d) {
  const m = d.match; const raw = d.data || {};
  const games = raw.games || [];
  if (!games.length) return `<div class="empty"><b>Sem mapas ainda</b>Formato ${esc(m.note || '')}.</div>`;
  const names = {}; (raw.opponents || []).forEach((o) => { names[o.opponent?.id] = o.opponent?.acronym || o.opponent?.name; });
  return `<div class="maps">` + games.sort((a, b) => a.position - b.position).map((g) => {
    const st = g.status === 'finished' ? (g.winner?.id ? `vitória ${esc(names[g.winner.id] || '')}` : 'fim') : g.status === 'running' ? '<span style="color:var(--live)">ao vivo</span>' : 'a jogar';
    const map = g.map?.name ? ` · ${esc(g.map.name)}` : '';
    return `<div class="map"><span>Mapa ${g.position}${map}</span><b class="${g.winner?.id ? 'win' : ''}">${st}</b></div>`;
  }).join('') + '</div>';
}

function psLineupsHTML(d) {
  const m = d.match; const teams = d.extra || [];
  if (!teams.length) return `<div class="empty"><b>Elencos indisponíveis</b></div>`;
  const ordered = [m.home.id, m.away.id].map((id) => teams.find((t) => String(t.id) === id)).filter(Boolean);
  return `<div class="lineups">` + ordered.map((t) => `<div class="lineup"><h4>${logoImg(t.image_url, '')}${esc(t.acronym || t.name)}</h4>` +
    (t.players || []).filter((p) => p.active !== false).map((p) => psPlayerRow(p, d.vidx)).join('') +
    '</div>').join('') + '</div>';
}

function psPlayerRow(p, vidx) {
  const v = vidx ? api.vlrFind(vidx, p.name) : null;
  const extra = v ? `<span class="pos" style="text-align:right">R <b style="color:var(--blue-2)">${esc(v.rating)}</b><br>ACS ${esc(v.acs)} · K/D ${esc(v.kd)}</span>` : `<span class="pos">${esc(p.nationality || '')}</span>`;
  return `<div class="player">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : '<div class="ph" style="width:26px;height:26px"></div>'}<span><b>${esc(p.name)}</b><br><small style="color:var(--dim)">${esc([p.first_name, p.last_name].filter(Boolean).join(' '))}${v?.agents?.length ? ' · ' + esc(v.agents.slice(0, 3).join(', ')) : ''}</small></span>${extra}</div>`;
}

function vlrMatchHTML(d) {
  const v = d.vlr; const m = d.match;
  if (!v?.maps?.length) return `<div class="empty"><b>Estatísticas ainda não disponíveis</b>Aparecem alguns minutos depois que cada mapa termina (fonte: VLR.gg).</div>`;
  const cur = d.vmap ?? 0;
  const chips = `<div class="chips" style="padding:0 0 10px">${v.maps.map((mp, i) => `<button class="chip ${i === cur ? 'active' : ''}" data-vmap="${i}">${esc(mp.name || 'Mapa ' + (i + 1))}${mp.score?.[0] != null && mp.score?.[0] !== '' ? ` <span class="n">${esc(mp.score[0])}-${esc(mp.score[1])}</span>` : ''}</button>`).join('')}</div>`;
  const mp = v.maps[cur];
  const table = (name, logo, rows) => `<div class="card" style="margin:0 0 12px"><div class="group-h">${logoImg(logo, '')}<span>${esc(name)}</span></div><div class="table-scroll"><table class="standings vtable">
    <tr><th></th><th style="text-align:left">Jogador</th><th>R</th><th>ACS</th><th>K</th><th>D</th><th>A</th><th>ADR</th><th>HS%</th><th>FK</th></tr>
    ${rows.map((p) => `<tr><td class="pos">${esc((p.agent || '').slice(0, 3))}</td><td class="team"><b>${esc(p.name)}</b></td><td class="pts">${esc(p.rating)}</td><td>${esc(p.acs)}</td><td>${esc(p.k)}</td><td>${esc(p.d)}</td><td>${esc(p.a)}</td><td>${esc(p.adr)}</td><td>${esc(p.hs)}</td><td>${esc(p.fk)}</td></tr>`).join('')}
  </table></div></div>`;
  return chips + table(m.home.name, m.home.logo, mp.players[0]) + table(m.away.name, m.away.logo, mp.players[1]) + `<p class="hint" style="margin:0 0 12px">Fonte: <a href="${esc(v.url)}" target="_blank" rel="noopener">VLR.gg</a></p>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-vmap]'); if (!b || !ui.detail) return;
  ui.detail.vmap = Number(b.dataset.vmap); $('#pane').innerHTML = paneHTML();
});

function psStreamsHTML(d) {
  const s = (d.data?.streams_list || []).filter((x) => x.raw_url);
  if (!s.length) return `<div class="empty"><b>Nenhuma transmissão listada</b></div>`;
  return `<div class="card" style="margin:0">` + s.sort((a, b) => (b.language === 'pt') - (a.language === 'pt') || b.main - a.main).map((x) =>
    `<a class="row" href="${esc(x.raw_url)}" target="_blank" rel="noopener"><div class="grow"><b>${esc(new URL(x.raw_url).hostname.replace('www.', ''))}</b><div class="sub">${esc((x.language || '').toUpperCase())}${x.official ? ' · oficial' : ''}${x.main ? ' · principal' : ''}</div></div>›</a>`).join('') + '</div>';
}

// ---------------- Tabelas ----------------
function viewTabelasShell() {
  const opts = LEAGUES.filter((l) => (l.src === 'espn' || l.key === 'valorant') && store.enabled.includes(l.key))
    .map((l) => `<option value="${l.key}" ${store.standingsLeague === l.key ? 'selected' : ''}>${l.flag} ${esc(l.key === 'valorant' ? 'Valorant — melhores jogadores' : l.name)}</option>`).join('');
  let mode = store.standingsLeague === 'valorant' ? 'lead' : (ui.tblMode || 'class');
  if (mode === 'ko' && !leagueByKey(store.standingsLeague)?.cup) mode = 'class';
  return `<h2 class="section-title">Tabelas</h2><div style="margin:0 10px 10px"><select class="input" id="sel-league">${opts}</select></div>
    ${store.standingsLeague === 'valorant' ? '' : `<div class="tabs"><button data-tmode="class" class="${mode === 'class' ? 'active' : ''}">Classificação</button>${leagueByKey(store.standingsLeague)?.cup ? `<button data-tmode="ko" class="${mode === 'ko' ? 'active' : ''}">Mata-mata</button>` : ''}<button data-tmode="lead" class="${mode === 'lead' ? 'active' : ''}">Artilharia${leagueByKey(store.standingsLeague)?.cup ? '' : ' e líderes'}</button></div>`}
    <div id="stand"><div class="skeleton"></div></div>`;
}

async function loadStandings() {
  const enabledEspn = LEAGUES.filter((l) => (l.src === 'espn' || l.key === 'valorant') && store.enabled.includes(l.key));
  let lg = leagueByKey(store.standingsLeague);
  if (!lg || !enabledEspn.includes(lg)) lg = enabledEspn[0];
  const el = $('#stand');
  if (lg?.key === 'valorant') {
    const v = await api.vlrStats();
    if (ui.tab !== 'tabelas') return;
    const render = () => { el.innerHTML = vlrLeadersHTML(v); el.querySelectorAll('[data-vreg]').forEach((b) => b.onclick = () => { ui.vreg = b.dataset.vreg; render(); }); el.querySelectorAll('[data-vsort]').forEach((b) => b.onclick = () => { ui.vsort = b.dataset.vsort; render(); }); };
    render(); return;
  }
  if (!lg) { el.innerHTML = '<div class="empty"><b>Nenhuma competição ativa</b></div>'; return; }
  let mode = ui.tblMode || 'class';
  if (mode === 'ko' && !lg.cup) mode = 'class';
  try {
    if (mode === 'ko') {
      const br = await api.bracket(lg);
      if (ui.tab !== 'tabelas') return;
      renderBracketInto(el, br, lg);
      return;
    }
    if (mode === 'class') {
      const t = await api.espnStandings(lg);
      if (ui.tab !== 'tabelas') return;
      const favIds = Object.values(store.favs).filter((f) => f.src === 'espn').map((f) => f.teamId);
      el.innerHTML = t.length ? standingsHTML(t, favIds, lg) : '<div class="empty"><b>Tabela indisponível</b>Competições de mata-mata não têm tabela de pontos.</div>';
    } else {
      const cats = await api.leaders(lg);
      if (ui.tab !== 'tabelas') return;
      el.innerHTML = leadersHTML(cats, lg);
      el.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { ui.leadCat = b.dataset.cat; el.innerHTML = leadersHTML(cats, lg); bindLeaders(el, cats, lg); });
      bindLeaders(el, cats, lg);
      return;
    }
  } catch (e) {
    el.innerHTML = `<div class="empty"><b>${mode === 'class' ? 'Tabela' : 'Estatísticas'} ainda não disponível</b>O robô gera esses dados de hora em hora.</div>`;
  }
  bindMatchLinks(el);
}
function bindLeaders(el, cats, lg) {
  el.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { ui.leadCat = b.dataset.cat; el.innerHTML = leadersHTML(cats, lg); bindLeaders(el, cats, lg); });
  bindMatchLinks(el);
}

const STAGE_PT = { 'First Stage': '1ª fase', 'Second Stage': '2ª fase', 'Third Stage': '3ª fase', 'First Round': '1ª fase', 'Second Round': '2ª fase', 'Third Round': '3ª fase', 'Fourth Round': '4ª fase', 'Fifth Round': '5ª fase', 'Knockout Round Playoffs': 'Playoffs', 'Playoffs': 'Playoffs', 'Knockout Playoffs': 'Playoffs', 'Round of 32': '16 avos', 'Rd of 32': '16 avos', 'Rd of 16': 'Oitavas', 'Round of 16': 'Oitavas', 'Quarterfinals': 'Quartas', 'Semifinals': 'Semifinal', 'Final': 'Final', 'Third Place': '3º lugar' };
const stageName = (l) => STAGE_PT[l] || l;

function renderBracketInto(el, br, lg, hl = []) {
  const stages = (br?.stages || []).filter((s) => s.ko && s.ties.length);
  if (!stages.length) {
    const next = (br?.stages || []).find((s) => s.ko && !s.ties.length);
    el.innerHTML = `<div class="empty"><b>Mata-mata ainda não começou</b>${next ? `Próxima fase: ${esc(stageName(next.label))}${next.detail ? ` (${esc(next.detail)})` : ''}.` : 'O robô monta os confrontos aos poucos (pode levar algumas horas na primeira vez).'}</div>`;
    return;
  }
  // chave: a partir da fase com até 16 confrontos
  const tree = stages.filter((s) => s.ties.length <= 16);
  // alinha a chave: cada fase segue a ordem dos confrontos da fase seguinte (de trás para frente)
  for (let i = tree.length - 2; i >= 0; i--) {
    const next = tree[i + 1].ties;
    const pos = (t) => { const w = t.winner || t.teams[0].id; const j = next.findIndex((n) => n.teams.some((x) => x.id === w || t.teams.some((y) => y.id === x.id))); return j < 0 ? 999 : j; };
    tree[i] = { ...tree[i], ties: tree[i].ties.slice().sort((x, y) => pos(x) - pos(y)) };
  }
  let cur = el._stage ?? (tree.length >= 2 ? 'tree' : stages[stages.length - 1].label);
  const draw = () => {
    const chips = `<div class="chips" style="padding:0 0 10px">${tree.length >= 2 ? `<button class="chip ${cur === 'tree' ? 'active' : ''}" data-stage="tree">Chave</button>` : ''}${stages.map((s) => `<button class="chip ${cur === s.label ? 'active' : ''}" data-stage="${esc(s.label)}">${esc(stageName(s.label))}</button>`).join('')}</div>`;
    let body;
    if (cur === 'tree') {
      const future = (br.stages || []).filter((s) => s.ko && !s.ties.length && tree.length && (br.stages.indexOf(s) > br.stages.indexOf(tree[tree.length - 1])));
      body = `<div class="bracket">${tree.map((s) => `<div class="b-col"><div class="b-h">${esc(stageName(s.label))}</div>${s.ties.map((t) => tieMini(t, hl)).join('')}</div>`).join('')}${future.map((s) => `<div class="b-col"><div class="b-h">${esc(stageName(s.label))}</div><div class="b-tie b-tbd">A definir${s.detail ? `<br><small>${esc(s.detail)}</small>` : ''}</div></div>`).join('')}</div>`;
    } else {
      const st = stages.find((s) => s.label === cur) || stages[stages.length - 1];
      body = st.ties.map((t) => tieFull(t, hl)).join('');
    }
    el.innerHTML = chips + body + `<p class="hint" style="margin:6px 2px 12px">Toque num confronto para ver o jogo.</p>`;
    el.querySelectorAll('[data-stage]').forEach((b) => b.onclick = () => { cur = b.dataset.stage; el._stage = cur; draw(); });
    el.querySelectorAll('[data-leg]').forEach((b) => b.onclick = () => {
      const all = stages.flatMap((s) => s.ties); const t = all.find((x) => x.legs.some((l) => l.id === b.dataset.leg)); if (!t) return;
      const leg = t.legs.find((l) => l.id === b.dataset.leg);
      const side = (id) => { const tm = t.teams.find((x) => x.id === id) || {}; return { id, name: tm.name, short: tm.short || tm.name, logo: tm.logo, score: leg.state === 'pre' ? null : leg.score[id], winner: false }; };
      const awayId = t.teams.find((x) => x.id !== leg.home)?.id;
      openDetail({ uid: `espn:${lg.key}:${leg.id}`, id: leg.id, src: 'espn', sport: lg.sport, league: lg, start: new Date(leg.date), state: leg.state, statusText: leg.state === 'post' ? 'Fim' : leg.state === 'in' ? leg.clock : '', home: side(leg.home), away: side(awayId), venue: {}, note: t.note || '' });
    });
  };
  draw();
}

function tieMini(t, hl) {
  const last = t.legs[t.legs.length - 1];
  const row = (tm) => {
    const w = t.winner === tm.id, l = t.winner && !w;
    return `<div class="b-team ${w ? 'w' : ''} ${l ? 'l' : ''} ${hl.includes(tm.id) ? 'hl' : ''}">${logoImg(tm.logo, tm.short, 'mini')}<span>${esc(tm.short || tm.name)}</span><b>${t.agg ? esc(t.agg[tm.id]) : ''}${t.pens ? `<small>(${esc(t.pens[tm.id])})</small>` : ''}</b></div>`;
  };
  return `<button class="b-tie ${t.live ? 'live' : ''}" data-leg="${esc(last.id)}">${row(t.teams[0])}${row(t.teams[1])}${!t.agg ? `<div class="b-date">${esc(new Date(t.legs[0].date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))}</div>` : ''}</button>`;
}

function tieFull(t, hl) {
  const legName = (l, i) => (t.legs.length === 1 ? 'Jogo único' : i === 0 ? 'Ida' : i === 1 ? 'Volta' : `Jogo ${i + 1}`);
  const head = t.legs.map((l, i) => `<th>${legName(l, i)}</th>`).join('') + (t.legs.length > 1 ? '<th>Agr.</th>' : '') + (t.pens ? '<th>Pên.</th>' : '');
  const row = (tm) => {
    const w = t.winner === tm.id;
    return `<tr class="${w ? 'tw' : t.winner ? 'tl' : ''} ${hl.includes(tm.id) ? 'hl' : ''}"><td class="team"><div>${logoImg(tm.logo, tm.short)}<span>${esc(tm.name)}</span>${w ? '<span class="adv">✓</span>' : ''}</div></td>
      ${t.legs.map((l) => `<td>${l.state === 'pre' ? '–' : esc(l.score[tm.id] ?? '-')}</td>`).join('')}
      ${t.legs.length > 1 ? `<td class="pts">${t.agg ? esc(t.agg[tm.id]) : '–'}</td>` : ''}${t.pens ? `<td>${esc(t.pens[tm.id])}</td>` : ''}</tr>`;
  };
  const dates = t.legs.map((l, i) => `<button class="b-leg" data-leg="${esc(l.id)}">${legName(l, i)}: ${esc(new Date(l.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))} ${esc(fmtTime(new Date(l.date)))}${l.state === 'in' ? ' <b style="color:var(--live)">ao vivo</b>' : ''} ›</button>`).join('');
  return `<div class="card" style="margin:0 0 10px"><table class="standings ktable"><tr><th style="text-align:left">Confronto</th>${head}</tr>${row(t.teams[0])}${row(t.teams[1])}</table>
    <div class="b-legs">${dates}</div>${t.note ? `<div class="sub" style="padding:0 12px 10px">${esc(t.note)}</div>` : ''}</div>`;
}

function vlrLeadersHTML(v) {
  if (!v?.regions || !Object.keys(v.regions).length) return '<div class="empty"><b>Estatísticas do Valorant ainda não disponíveis</b>O robô gera de hora em hora (fonte: VLR.gg).</div>';
  const regs = Object.entries(v.regions);
  const cur = v.regions[ui.vreg] ? ui.vreg : regs[0][0];
  const sorts = [['rating', 'Rating'], ['acs', 'ACS'], ['kd', 'K/D'], ['adr', 'ADR'], ['fkpr', 'First kills'], ['hs', 'HS%']];
  const sk = ui.vsort || 'rating';
  const num = (x) => parseFloat(String(x ?? '').replace('%', '')) || 0;
  const rows = (v.regions[cur].rows || []).slice().sort((a, b) => num(b[sk]) - num(a[sk])).slice(0, 40);
  return `<div style="padding:0 10px"><div class="chips" style="padding:0 2px 8px">${regs.map(([k, r]) => `<button class="chip ${k === cur ? 'active' : ''}" data-vreg="${k}">${esc(r.name)}</button>`).join('')}</div>
    <div class="chips" style="padding:0 2px 10px">${sorts.map(([k, l]) => `<button class="chip ${k === sk ? 'active' : ''}" data-vsort="${k}">${l}</button>`).join('')}</div></div>
    <div class="card">${rows.map((r, i) => `<div class="row"><span class="rank">${i + 1}</span><div class="grow"><b>${esc(r.player)}</b><div class="sub">${esc(r.org || '')}${r.agents?.length ? ' · ' + esc(r.agents.slice(0, 3).join(', ')) : ''}</div></div>
      <span class="sub" style="text-align:right;margin-right:8px">R ${esc(r.rating)} · ACS ${esc(r.acs)}<br>K/D ${esc(r.kd)} · ADR ${esc(r.adr)}</span><b class="big">${esc(r[sk])}</b></div>`).join('')}</div>
    <p class="hint">Últimos ${esc(v.timespan)} dias · fonte VLR.gg</p>`;
}

const CAT_PT = { goalsLeaders: 'Gols', assistsLeaders: 'Assistências', pointsPerGame: 'Pontos', reboundsPerGame: 'Rebotes', assistsPerGame: 'Assistências', stealsPerGame: 'Roubos', blocksPerGame: 'Tocos', fieldGoalPercentage: 'Arremessos %', threePointFieldGoalPercentage: '3 pontos %', freeThrowPercentage: 'Lances livres %', passingYards: 'Jardas de passe', rushingYards: 'Jardas corridas', receivingYards: 'Jardas recebidas', passingTouchdowns: 'TD passe', rushingTouchdowns: 'TD corrida', receivingTouchdowns: 'TD recepção', sacks: 'Sacks', totalTackles: 'Tackles', interceptions: 'Interceptações' };
function leadersHTML(cats, lg) {
  if (!cats?.length) return '<div class="empty"><b>Sem estatísticas de jogadores</b>A ESPN não publica líderes para esta competição.</div>';
  const cur = cats.find((c) => c.key === ui.leadCat) || cats[0];
  const chips = `<div class="chips" style="padding:0 2px 10px">${cats.map((c) => `<button class="chip ${c === cur ? 'active' : ''}" data-cat="${esc(c.key)}">${esc(CAT_PT[c.key] || c.title)}</button>`).join('')}</div>`;
  const soccer = lg.sport === 'soccer';
  const rows = cur.rows.map((r, i) => `<div class="row"><span class="rank">${i + 1}</span><div class="grow"><b>${esc(r.player)}</b>
      <div class="sub" ${r.teamId ? `data-team="${esc(lg.key)}|${esc(r.teamId)}" data-name="${esc(r.team)}" data-logo="${esc(r.teamLogo)}" style="display:flex;align-items:center;gap:6px;cursor:pointer"` : ''}>${r.teamLogo ? logoImg(r.teamLogo, '', 'mini') : ''}${esc(r.team || '')}${r.pos ? ' · ' + esc(r.pos) : ''}</div></div>
      ${soccer ? `<span class="sub" style="text-align:right;margin-right:8px">${r.apps != null ? `${r.apps} J` : ''}${r.goals != null && cur.key !== 'goalsLeaders' ? ` · ${r.goals} G` : ''}${r.assists != null && cur.key !== 'assistsLeaders' ? ` · ${r.assists} A` : ''}</span>` : ''}
      <b class="big">${esc(soccer ? Math.round(r.value) : r.display)}</b></div>`).join('');
  return `<div style="padding:0 10px">${chips}</div><div class="card">${rows}</div>`;
}

function standingsHTML(groups, hlIds = [], lg) {
  const sport = lg?.sport || ui.detail?.match.sport || 'soccer';
  const cols = sport === 'soccer'
    ? [['gamesPlayed', 'J'], ['wins', 'V'], ['ties', 'E'], ['losses', 'D'], ['pointDifferential', 'SG'], ['points', 'P', 'pts']]
    : sport === 'basketball'
      ? [['wins', 'V'], ['losses', 'D'], ['winPercent', '%'], ['gamesBehind', 'GB'], ['streak', 'Seq']]
      : [['wins', 'V'], ['losses', 'D'], ['ties', 'E'], ['winPercent', '%'], ['pointDifferential', 'Saldo']];
  return groups.map((g) => `<div class="card">${g.name && groups.length > 1 ? `<div class="group-h">${esc(g.name)}</div>` : ''}<div class="table-scroll"><table class="standings">
    <tr><th>#</th><th>Time</th>${cols.map((c) => `<th>${c[1]}</th>`).join('')}</tr>
    ${g.rows.map((r, i) => `<tr class="${hlIds.includes(r.id) ? 'hl' : ''}"><td class="pos">${r.note ? `<span class="bar" style="background:${esc(r.note)}"></span>` : ''}${esc(r.s.rank || r.s.playoffSeed || i + 1)}</td>
      <td class="team"><div data-team="${esc((lg || ui.detail?.match.league)?.key)}|${esc(r.id)}" data-name="${esc(r.name)}" data-logo="${esc(r.logo)}" style="cursor:pointer">${logoImg(r.logo, r.short)}<span>${esc(r.name)}</span></div></td>
      ${cols.map((c) => `<td class="${c[2] || ''}">${esc(r.s[c[0]] ?? '-')}</td>`).join('')}</tr>`).join('')}
  </table></div></div>`).join('');
}

// ---------------- Agenda (favoritos) ----------------
async function loadAgenda() {
  const favs = Object.values(store.favs);
  const el = $('#agenda');
  if (!favs.length) {
    el.innerHTML = `<div class="empty"><b>Você ainda não tem favoritos</b>Abra um jogo e toque na ☆ do time, ou adicione em Ajustes.</div><div style="text-align:center"><button class="btn" data-go="ajustes">Adicionar times</button></div>`;
    bindView(); return;
  }
  let list = await api.favoritesUpcoming(favs).catch(() => []);
  list = list.slice(0, 60);
  ui.agenda = list;
  if (ui.tab !== 'agenda') return;
  if (!list.length) { el.innerHTML = '<div class="empty"><b>Nenhum jogo futuro encontrado</b>Pode ser pausa no calendário.</div>'; return; }
  const byDay = new Map();
  list.forEach((m) => { const k = +startOfDay(m.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(m); });
  let html = `<p class="hint">${list.length} jogos encontrados · horários no seu fuso.</p><div style="margin:0 10px 12px;display:flex;gap:8px"><button class="btn small" id="btn-ics">📅 Exportar para o calendário (.ics)</button></div>`;
  for (const [k, ms] of byDay) {
    html += `<section class="group"><div class="group-h">${esc(fmtDateLong(new Date(k)))}</div>${ms.map(matchRowAgenda).join('')}</section>`;
  }
  el.innerHTML = html;
  ui.agendaIndex = new Map(list.map((m) => [m.uid, m]));
  $('#btn-ics').addEventListener('click', () => exportICS(list));
  bindView();
}

function matchRowAgenda(m) {
  const row = matchRow(m);
  const place = m.src === 'espn' ? [m.league.short, m.venue?.name].filter(Boolean).join(' · ') : m.event;
  return row.replace('<div class="m-meta">›</div>', `<div class="m-meta">›</div>`).replace('</button>', `</button><div style="padding:0 12px 10px 72px;margin-top:-6px;font-size:12px;color:var(--dim)">${esc(place)}</div>`);
}

function exportICS(list) {
  const dt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const e = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const dur = (m) => (m.sport === 'football' ? 3.5 : m.sport === 'basketball' ? 2.5 : m.sport === 'esports' ? 3 : 2) * 3600e3;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MeuPlacar//PT-BR', 'CALSCALE:GREGORIAN'];
  list.forEach((m) => {
    lines.push('BEGIN:VEVENT', `UID:${m.uid.replace(/:/g, '-')}@meuplacar`, `DTSTAMP:${dt(new Date())}`, `DTSTART:${dt(m.start)}`, `DTEND:${dt(new Date(+m.start + dur(m)))}`,
      `SUMMARY:${e(`${m.home.name} x ${m.away.name}`)}`, `LOCATION:${e([m.venue?.name, m.venue?.city].filter(Boolean).join(', '))}`, `DESCRIPTION:${e(m.src === 'ps' ? m.event : m.league.name)}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'meuplacar-jogos.ics' });
  document.body.appendChild(a); a.click(); a.remove();
  toast('Arquivo .ics gerado — abra para adicionar à sua agenda');
}

// ---------------- Ajustes ----------------
function viewAjustes() {
  const groups = [
    ['Futebol', LEAGUES.filter((l) => l.sport === 'soccer')],
    ['Esportes americanos', LEAGUES.filter((l) => l.sport === 'basketball' || l.sport === 'football')],
    ['E-sports', LEAGUES.filter((l) => l.sport === 'esports')],
  ];
  const favs = Object.values(store.favs);
  const addOpts = LEAGUES.filter((l) => store.enabled.includes(l.key)).map((l) => `<option value="${l.key}">${l.flag} ${esc(l.name)}</option>`).join('');
  return `<h2 class="section-title">Ajustes</h2>
  <div class="subhead" style="margin:0 16px 8px">Times favoritos</div>
  <div class="card">${favs.length ? favs.map((f) => `<div class="row">${logoImg(f.logo, f.name)}<div class="grow" data-team="${esc(f.leagueKey)}|${esc(f.teamId)}" data-name="${esc(f.name)}" data-logo="${esc(f.logo)}" style="cursor:pointer">${esc(f.name)}<div class="sub">${esc(leagueByKey(f.leagueKey)?.short || '')} · ver página ›</div></div><button class="btn ghost small" data-unfav="${esc(f.key)}">Remover</button></div>`).join('') : '<div class="row"><div class="grow sub">Nenhum favorito ainda.</div></div>'}
    <div class="row" style="display:block"><div style="display:flex;gap:8px"><select class="input" id="add-league">${addOpts}</select></div>
      <input class="input" id="add-q" placeholder="Filtrar ou buscar time…" style="margin-top:8px"><div id="add-results"></div></div>
  </div>
  ${groups.map(([title, ls]) => `<div class="subhead" style="margin:14px 16px 8px">${title}</div><div class="card">${ls.map((l) => `<button class="row" style="width:100%;text-align:left" data-league="${l.key}"><span style="font-size:18px">${l.flag}</span><div class="grow">${esc(l.name)}</div><span class="switch ${store.enabled.includes(l.key) ? 'on' : ''}"></span></button>`).join('')}</div>`).join('')}
  <div class="subhead" style="margin:14px 16px 8px">Nível dos torneios de e-sports</div>
  <div class="card"><div class="row" style="flex-wrap:wrap;gap:8px">${TIERS.map((t) => `<button class="chip ${store.tiers.includes(t) ? 'active' : ''}" data-tier="${t}">Tier ${t.toUpperCase()}</button>`).join('')}</div>
  <div class="row"><div class="sub">S = maiores eventos (Majors, Masters). Ative B/C para ver ligas menores.</div></div></div>
  <p class="hint" style="margin-top:16px">Dados: ESPN (futebol, NBA, NFL) e PandaScore (CS2, Valorant). Uso pessoal.</p>`;
}

let teamCache = {};
async function showTeamResults() {
  const lg = leagueByKey($('#add-league').value);
  const q = $('#add-q').value.trim().toLowerCase();
  const box = $('#add-results');
  if (!lg) return;
  try {
    let teams;
    if (lg.src === 'espn') {
      teams = teamCache[lg.key] ||= await api.espnTeams(lg);
      teams = teams.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.short || '').toLowerCase().includes(q));
    } else {
      if (q.length < 2) { box.innerHTML = '<div class="sub" style="padding:8px 2px">Digite pelo menos 2 letras do nome do time.</div>'; return; }
      teams = (await api.psSearchTeams(lg, q)).map((t) => ({ id: String(t.id), name: t.name, short: t.acronym, logo: t.image_url }));
    }
    const sport = lg.sport;
    box.innerHTML = teams.slice(0, 40).map((t) => {
      const k = lg.src === 'espn' ? `espn:${sport}:${t.id}` : `ps:${lg.game}:${t.id}`;
      const on = !!store.favs[k];
      return `<div class="row" style="padding:8px 2px">${logoImg(t.logo, t.short)}<div class="grow">${esc(t.name)}</div><button class="star ${on ? 'on' : ''}" data-addfav="${esc(t.id)}" data-name="${esc(t.name)}" data-logo="${esc(t.logo)}">${on ? '★' : '☆'}</button></div>`;
    }).join('') || '<div class="sub" style="padding:8px 2px">Nenhum time encontrado.</div>';
    box.querySelectorAll('[data-addfav]').forEach((b) => b.addEventListener('click', () => {
      const fake = { src: lg.src, sport: lg.sport, league: lg };
      toggleFav(fake, { id: b.dataset.addfav, name: b.dataset.name, logo: b.dataset.logo });
      const y = window.scrollY; render(); window.scrollTo(0, y);
      $('#add-league').value = lg.key; $('#add-q').value = q; showTeamResults();
    }));
  } catch (e) {
    box.innerHTML = `<div class="err" style="margin:8px 0 0">Não foi possível buscar times${lg.src === 'ps' ? ' (token da PandaScore configurado?)' : ''}.</div>`;
  }
}

// ---------------- Eventos ----------------
function bindView() {
  const v = $('#view');
  v.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => {
    ui.day = new Date(Number(b.dataset.day));
    const pre = dayCache.get(+ui.day);
    if (pre && Date.now() - pre.t < 10 * 60e3) { ui.matches = pre.matches; ui.errors = pre.errors; $('#list').innerHTML = listHTML(); }
    else { ui.matches = []; ui.errors = []; }
    v.querySelectorAll('[data-day]').forEach((x) => x.classList.toggle('active', x === b));
    b.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    refresh();
  });
  v.querySelectorAll('[data-sport]').forEach((b) => b.onclick = () => {
    ui.sport = b.dataset.sport;
    v.querySelectorAll('[data-sport]').forEach((x) => x.classList.toggle('active', x === b));
    $('#list').innerHTML = listHTML(); bindView();
  });
  const lt = v.querySelector('[data-live]');
  if (lt) lt.onclick = () => { ui.onlyLive = !ui.onlyLive; lt.classList.toggle('active', ui.onlyLive); $('#list').innerHTML = listHTML(); bindView(); };
  v.querySelectorAll('.match[data-uid]').forEach((b) => b.onclick = () => {
    const m = ui.matches.find((x) => x.uid === b.dataset.uid) || ui.agendaIndex?.get(b.dataset.uid);
    if (m) openDetail(m);
  });
  v.querySelectorAll('[data-table]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); store.standingsLeague = b.dataset.table; save(); setTab('tabelas'); });
  v.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => setTab(b.dataset.go));

  v.querySelectorAll('[data-tmode]').forEach((b) => b.onclick = () => { ui.tblMode = b.dataset.tmode; v.querySelectorAll('[data-tmode]').forEach((x) => x.classList.toggle('active', x === b)); $('#stand').innerHTML = '<div class="skeleton"></div>'; loadStandings(); });
  const sel = $('#sel-league');
  if (sel) sel.onchange = () => { store.standingsLeague = sel.value; save(); render(); };

  v.querySelectorAll('[data-league]').forEach((b) => b.onclick = () => {
    const k = b.dataset.league;
    store.enabled = store.enabled.includes(k) ? store.enabled.filter((x) => x !== k) : [...store.enabled, k];
    save(); ui.matches = [];
    b.querySelector('.switch').classList.toggle('on', store.enabled.includes(k));
  });
  v.querySelectorAll('[data-tier]').forEach((b) => b.onclick = () => {
    const t = b.dataset.tier;
    store.tiers = store.tiers.includes(t) ? store.tiers.filter((x) => x !== t) : [...store.tiers, t];
    save(); ui.matches = []; b.classList.toggle('active');
  });
  bindMatchLinks(v);
  v.querySelectorAll('[data-unfav]').forEach((b) => b.onclick = () => { delete store.favs[b.dataset.unfav]; save(); render(); });
  const addL = $('#add-league'); const addQ = $('#add-q');
  if (addL) {
    addL.onchange = showTeamResults; let t; addQ.oninput = () => { clearTimeout(t); t = setTimeout(showTeamResults, 300); };
    if (!$('#add-results').innerHTML) showTeamResults();
  }

  // centraliza o dia escolhido
  const act = v.querySelector('.date.active');
  if (act && !bindView._scrolled) { act.scrollIntoView({ inline: 'center', block: 'nearest' }); bindView._scrolled = true; }
}

// ---------------- Início ----------------
render();
refresh();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
