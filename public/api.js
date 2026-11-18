// Dados: arquivos em ./data/ gerados pelo GitHub Actions a cada ~5 min.
// Se o navegador conseguir falar direto com a ESPN, usa a ESPN ao vivo (mais rápido).
import { LEAGUES } from './config.js';

const DATA = './data';
const ESPN = 'https://site.api.espn.com';

const sameLocalDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export { sameLocalDay };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

// ---------- busca ----------
const bust = () => Math.floor(Date.now() / 30000); // novo a cada 30 s
const memo = new Map();
async function getData(rel, { fresh = false } = {}) {
  const key = rel;
  const hit = memo.get(key);
  if (hit && !fresh && Date.now() - hit.t < 25000) return hit.v;
  const r = await fetch(`${DATA}/${rel}?v=${bust()}`);
  if (!r.ok) throw new Error(r.status === 404 ? 'sem dados ainda' : `HTTP ${r.status}`);
  const v = await r.json();
  memo.set(key, { t: Date.now(), v });
  return v;
}

// Teste único: a ESPN responde direto ao navegador? (depende de CORS)
let directOK = null;
try { const s = sessionStorage.getItem('mp:direct'); if (s) directOK = s === '1'; } catch {}
async function direct(path) {
  if (directOK === false) throw new Error('direto indisponível');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(ESPN + path, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (directOK !== true) { directOK = true; try { sessionStorage.setItem('mp:direct', '1'); } catch {} }
    return j;
  } catch (e) {
    if (directOK === null && e.name !== 'AbortError' && !/^HTTP /.test(e.message)) { directOK = false; try { sessionStorage.setItem('mp:direct', '0'); } catch {} }
    throw e;
  } finally { clearTimeout(t); }
}
export const liveMode = () => directOK === true;
const singleDay = new Set();

export async function getMeta() {
  try { return await getData('meta.json', { fresh: true }); } catch { return null; }
}

// ---------- ESPN ----------
function espnTeam(c) {
  const t = c.team || {};
  return {
    id: String(t.id ?? c.id ?? ''),
    name: t.displayName || t.name || '?',
    short: t.shortDisplayName || t.abbreviation || t.displayName || '?',
    logo: t.logo || t.logos?.[0]?.href || '',
    score: c.score != null && c.score !== '' ? (typeof c.score === 'object' ? c.score.displayValue : c.score) : null,
    winner: !!c.winner,
  };
}

export function normEspnEvent(ev, league) {
  const comp = ev.competitions?.[0] || {};
  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home') || cs[0] || {};
  const away = cs.find((c) => c.homeAway === 'away') || cs[1] || {};
  const st = comp.status || ev.status || {};
  const type = st.type || {};
  const state = type.state || 'pre';
  let statusText = '';
  if (state === 'in') statusText = type.shortDetail || st.displayClock || 'Ao vivo';
  else if (state === 'post') statusText = 'Fim';
  if (type.name === 'STATUS_HALFTIME') statusText = 'Intervalo';
  if (type.name === 'STATUS_POSTPONED') statusText = 'Adiado';
  if (type.name === 'STATUS_CANCELED') statusText = 'Cancelado';
  const v = comp.venue || ev.venue || {};
  return {
    uid: `espn:${league.key}:${ev.id}`,
    id: String(ev.id),
    src: 'espn',
    sport: league.sport,
    league,
    start: new Date(ev.date || comp.date),
    state,
    statusText,
    home: espnTeam(home),
    away: espnTeam(away),
    venue: { name: v.fullName || v.displayName || '', city: [v.address?.city, v.address?.country || v.address?.state].filter(Boolean).join(', ') },
    note: comp.notes?.[0]?.headline || '',
    broadcast: (comp.broadcasts || []).flatMap((b) => b.names || []).join(', '),
  };
}

async function leagueEvents(league) {
  return (await getData(`espn/${league.key}.json`)).map((e) => normEspnEvent(e, league));
}

export async function espnDay(league, day) {
  const isNear = Math.abs(startOfDay(new Date()) - startOfDay(day)) <= 86400e3;
  if (isNear && directOK !== false) {
    try {
      let evs;
      if (!singleDay.has(league.key)) {
        try { evs = (await direct(`/apis/site/v2/sports/${league.path}/scoreboard?dates=${ymd(addDays(day, -1))}-${ymd(addDays(day, 1))}&limit=300`)).events || []; }
        catch (e) { if (/^HTTP 400/.test(e.message)) singleDay.add(league.key); else throw e; }
      }
      if (!evs) { // liga que só aceita um dia por vez: o dia local no Brasil cai no dia anterior e no mesmo dia nos EUA
        const [a, b] = await Promise.all([direct(`/apis/site/v2/sports/${league.path}/scoreboard?dates=${ymd(addDays(day, -1))}`), direct(`/apis/site/v2/sports/${league.path}/scoreboard?dates=${ymd(day)}`)]);
        evs = [...(a.events || []), ...(b.events || [])];
      }
      return evs.map((e) => normEspnEvent(e, league)).filter((m) => sameLocalDay(m.start, day));
    } catch { /* cai para os arquivos */ }
  }
  return (await leagueEvents(league)).filter((m) => sameLocalDay(m.start, day));
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

export async function espnSummary(league, id) {
  if (directOK !== false) {
    try { return await direct(`/apis/site/v2/sports/${league.path}/summary?event=${id}`); } catch {}
  }
  try { return await getData(`summary/${league.key}/${id}.json`); }
  catch { return {}; } // jogos distantes ainda não têm detalhes salvos
}

function parseStandings(groups) {
  return groups.map((g) => ({
    name: g.name,
    rows: g.entries.map((e) => {
      const s = {};
      (e.stats || []).forEach((x) => { s[x.name] = x.displayValue ?? x.value; });
      return { id: String(e.team?.id), name: e.team?.displayName || e.team?.name, short: e.team?.abbreviation, logo: e.team?.logos?.[0]?.href || '', note: e.note?.color || '', s };
    }).sort((a, b) => (Number(a.s.rank || a.s.playoffSeed || 0) - Number(b.s.rank || b.s.playoffSeed || 0)) || 0),
  }));
}

export async function espnStandings(league) {
  if (directOK === true) {
    try {
      const d = await direct(`/apis/v2/sports/${league.path}/standings`);
      const groups = [];
      const walk = (n, name) => { if (n.standings?.entries?.length) groups.push({ name: n.name || name || '', entries: n.standings.entries }); (n.children || []).forEach((c) => walk(c, c.name)); };
      walk(d, d.name);
      return parseStandings(groups);
    } catch {}
  }
  return parseStandings(await getData(`standings/${league.key}.json`));
}

export async function espnTeams(league) {
  return getData(`teams/${league.key}.json`);
}

// ---------- PandaScore (e-sports) ----------
export function normPsMatch(m, league) {
  const ops = m.opponents || [];
  const team = (i) => {
    const o = ops[i]?.opponent || {};
    const res = (m.results || []).find((r) => r.team_id === o.id);
    return {
      id: String(o.id ?? ''),
      name: o.name || 'A definir',
      short: o.acronym || o.name || 'TBD',
      logo: o.image_url || '',
      score: m.status === 'not_started' || res == null ? null : String(res.score),
      winner: m.winner_id != null && m.winner_id === o.id,
    };
  };
  const state = m.status === 'running' ? 'in' : (m.status === 'finished' || m.status === 'canceled') ? 'post' : 'pre';
  let statusText = state === 'in' ? 'Ao vivo' : state === 'post' ? 'Fim' : '';
  if (m.status === 'canceled') statusText = 'Cancelado';
  if (m.status === 'postponed') statusText = 'Adiado';
  const t = m.tournament || {};
  return {
    uid: `ps:${league.key}:${m.id}`,
    id: String(m.id),
    src: 'ps',
    sport: 'esports',
    league,
    start: new Date(m.begin_at || m.scheduled_at),
    state,
    statusText,
    home: team(0),
    away: team(1),
    venue: { name: m.serie?.full_name || '', city: t.name || '' },
    event: [m.league?.name, m.serie?.full_name || m.serie?.name, t.name].filter(Boolean).join(' · '),
    eventLogo: m.league?.image_url || '',
    tier: (t.tier || m.serie?.tier || '').toLowerCase(),
    note: m.number_of_games ? `MD${m.number_of_games}` : '',
    raw: m,
  };
}

async function psAll(league) {
  try { return (await getData(`ps/${league.key}.json`)).map((m) => normPsMatch(m, league)); }
  catch (e) {
    const meta = await getMeta();
    if (meta && meta.esports === 'off') throw new Error('503 token');
    throw e;
  }
}

export async function psDay(league, day, tiers) {
  return (await psAll(league))
    .filter((m) => !tiers?.length || !m.tier || tiers.includes(m.tier))
    .filter((m) => sameLocalDay(m.start, day) || (m.state === 'in' && sameLocalDay(day, new Date())));
}

export async function psMatch(league, id) {
  const m = (await psAll(league)).find((x) => x.id === String(id));
  if (!m) throw new Error('partida não encontrada');
  return m.raw;
}

export async function psTeams(ids, league) {
  if (!ids.length || !league) return [];
  const all = await getData(`ps-teams/${league.key}.json`);
  return all.filter((t) => ids.map(String).includes(String(t.id)));
}

export async function psSearchTeams(league, q) {
  const all = await getData(`ps-teams/${league.key}.json`);
  const s = q.toLowerCase();
  return all.filter((t) => (t.name || '').toLowerCase().includes(s) || (t.acronym || '').toLowerCase().includes(s)).slice(0, 15);
}

// ---------- Agenda dos favoritos ----------
export async function favoritesUpcoming(favs) {
  const keys = [...new Set(favs.map((f) => f.leagueKey))];
  // Times de futebol jogam várias competições: procura em todas as ligas do mesmo esporte.
  const sportsOfFav = new Set(favs.map((f) => (f.src === 'espn' ? leagueByKey(f.leagueKey)?.sport : 'ps:' + f.leagueKey)));
  const leagues = LEAGUES.filter((l) => (l.src === 'espn' ? sportsOfFav.has(l.sport) : sportsOfFav.has('ps:' + l.key)) || keys.includes(l.key));
  const ids = new Set(favs.map((f) => `${f.src === 'espn' ? leagueByKey(f.leagueKey)?.sport : leagueByKey(f.leagueKey)?.game}:${f.teamId}`));
  const res = await Promise.allSettled(leagues.map((l) => (l.src === 'espn' ? leagueEvents(l) : psAll(l))));
  const now = Date.now();
  const out = [];
  res.forEach((r) => r.status === 'fulfilled' && r.value.forEach((m) => {
    const sk = m.src === 'espn' ? m.sport : m.league.game;
    if (!ids.has(`${sk}:${m.home.id}`) && !ids.has(`${sk}:${m.away.id}`)) return;
    if (m.state === 'in' || (m.state === 'pre' && +m.start > now - 3 * 3600e3)) out.push(m);
  }));
  return out.sort((a, b) => a.start - b.start);
}
const leagueByKey = (k) => LEAGUES.find((l) => l.key === k);

// ---------- Geral ----------
export async function loadDay(day, enabledKeys, tiers) {
  const leagues = LEAGUES.filter((l) => enabledKeys.includes(l.key));
  const results = await Promise.allSettled(leagues.map((l) => (l.src === 'espn' ? espnDay(l, day) : psDay(l, day, tiers))));
  const matches = [];
  const errors = [];
  results.forEach((r, i) => (r.status === 'fulfilled' ? matches.push(...r.value) : errors.push({ league: leagues[i], error: String(r.reason) })));
  return { matches, errors };
}

// ---------- Artilharia / líderes ----------
export async function leaders(league) {
  return getData(`leaders/${league.key}.json`);
}

// ---------- Página do time ----------
export async function teamPage(league, teamId) {
  const sport = league.sport;
  let d = null;
  try { d = await getData(`team/${sport}/${teamId}.json`); } catch {}
  if (!d && directOK !== false) {
    try {
      const base = `/apis/site/v2/sports/${league.path}/teams/${teamId}`;
      const [ro, sc] = await Promise.all([direct(`${base}/roster`).catch(() => ({})), direct(`${base}/schedule`)]);
      const flat = (ro.athletes || []).flatMap((a) => (a.items ? a.items : [a]));
      d = { id: teamId, name: sc.team?.displayName, logo: sc.team?.logo, leagueKey: league.key, record: sc.team?.recordSummary, standing: sc.team?.standingSummary,
        roster: flat.map((a) => ({ id: a.id, name: a.displayName, jersey: a.jersey, pos: a.position?.abbreviation, posName: a.position?.displayName, age: a.age, flag: a.citizenshipCountry?.abbreviation || '', st: {} })),
        events: sc.events || [] };
    } catch {}
  }
  if (!d) return null;
  const lg = LEAGUES.find((l) => l.key === d.leagueKey) || league;
  const events = (d.events || []).map((e) => ({ ...normEspnEvent(e, lg), comp: e.comp || '' }));
  // junta jogos de outras competições que já estão nos arquivos das ligas (Libertadores, Copa etc.)
  const others = await Promise.allSettled(LEAGUES.filter((l) => l.src === 'espn' && l.sport === sport && l.key !== lg.key).map((l) => leagueEvents(l)));
  const ids = new Set(events.map((m) => m.id));
  others.forEach((r) => r.status === 'fulfilled' && r.value.forEach((m) => {
    if (!ids.has(m.id) && (m.home.id === String(teamId) || m.away.id === String(teamId))) { ids.add(m.id); events.push(m); }
  }));
  events.sort((a, b) => a.start - b.start);
  return { ...d, events };
}

// ---------- Confronto direto + últimos jogos ----------
// formato comum: form = { [teamId]: [{ date, result:'V'|'E'|'D', opp:{name,logo}, score, home:boolean, comp }] }, h2h = [{ date, home:{...}, away:{...}, comp }]
const RES = { W: 'V', L: 'D', D: 'E', T: 'E' };
export async function espnH2H(match, summary) {
  const form = {}; let h2h = [];
  const s = summary || {};
  (s.lastFiveGames || []).forEach((t) => {
    form[String(t.team?.id)] = (t.events || []).map((ev) => ({
      date: new Date(ev.gameDate), result: RES[ev.gameResult] || ev.gameResult || '', comp: ev.competitionName || '',
      opp: { name: ev.opponent?.displayName || '?', logo: ev.opponent?.logo || '' }, home: ev.atVs !== '@',
      score: ev.homeTeamScore != null ? `${ev.homeTeamScore}-${ev.awayTeamScore}` : ev.score || '',
    }));
  });
  (s.seasonseries || []).forEach((ss) => (ss.events || []).forEach((ev) => {
    const cs = ev.competitors || [];
    const h = cs.find((c) => c.homeAway === 'home') || cs[0]; const a = cs.find((c) => c.homeAway === 'away') || cs[1];
    if (!h || !a) return;
    const side = (c) => ({ id: String(c.team?.id), name: c.team?.displayName, logo: c.team?.logo, score: c.score, winner: c.winner });
    h2h.push({ id: ev.id, date: new Date(ev.date), comp: ev.competitionName || '', home: side(h), away: side(a), done: ev.statusType?.completed !== false && h.score != null });
  }));

  // complementa com o calendário completo dos times (arquivos das páginas de time)
  const need = !form[match.home.id] || !form[match.away.id] || !h2h.length;
  if (need) {
    const [A, B] = await Promise.all([teamPage(match.league, match.home.id).catch(() => null), teamPage(match.league, match.away.id).catch(() => null)]);
    const past = (tp) => (tp?.events || []).filter((m) => m.state === 'post' && m.home.score != null).sort((a, b) => b.start - a.start);
    const toForm = (tp, id) => past(tp).slice(0, 5).map((m) => {
      const me = m.home.id === id ? m.home : m.away; const op = m.home.id === id ? m.away : m.home;
      const r = me.winner ? 'V' : op.winner ? 'D' : 'E';
      return { date: m.start, result: r, comp: m.comp || m.league.short, opp: { name: op.name, logo: op.logo }, home: m.home.id === id, score: `${m.home.score}-${m.away.score}` };
    });
    if (!form[match.home.id] && A) form[match.home.id] = toForm(A, match.home.id);
    if (!form[match.away.id] && B) form[match.away.id] = toForm(B, match.away.id);
    if (!h2h.length && A) {
      h2h = past(A).filter((m) => m.home.id === match.away.id || m.away.id === match.away.id).map((m) => ({ id: m.id, date: m.start, comp: m.comp || m.league.short, home: m.home, away: m.away, done: true }));
    }
  }
  // temporadas anteriores (até 5 anos)
  const hist = await teamHistory(match.sport, match.home.id).catch(() => null)
    || await teamHistory(match.sport, match.away.id).catch(() => null);
  if (hist) {
    const ids = new Set(h2h.map((x) => String(x.id)));
    hist.filter((g) => (g.home.id === match.home.id && g.away.id === match.away.id) || (g.home.id === match.away.id && g.away.id === match.home.id))
      .forEach((g) => { if (!ids.has(String(g.id))) { ids.add(String(g.id)); h2h.push(g); } });
  }
  h2h = h2h.filter((x) => x.id !== match.id).sort((a, b) => b.date - a.date);
  return { form, h2h, years: hist ? 5 : 0 };
}

export async function psH2H(match) {
  let d;
  try { d = await getData(`ps-h2h/${match.league.key}/${match.id}.json`); } catch { return { form: {}, h2h: [] }; }
  const conv = (m, id) => {
    const n = normPsMatch(m, match.league);
    const me = n.home.id === String(id) ? n.home : n.away; const op = n.home.id === String(id) ? n.away : n.home;
    return { date: n.start, result: me.winner ? 'V' : op.winner ? 'D' : 'E', comp: n.event, opp: { name: op.name, logo: op.logo }, home: true, score: `${me.score ?? '-'}-${op.score ?? '-'}` };
  };
  const form = {};
  const done = (m) => m.status === 'finished' && String(m.id) !== match.id;
  Object.entries(d.form || {}).forEach(([id, list]) => { form[String(id)] = list.filter(done).map((m) => conv(m, id)); });
  const h2h = (d.h2h || []).filter(done).map((m) => { const n = normPsMatch(m, match.league); return { id: n.id, date: n.start, comp: n.event, home: n.home, away: n.away, done: true }; });
  return { form, h2h };
}

export async function psTeamPage(league, teamId) {
  const [teams, all] = await Promise.all([getData(`ps-teams/${league.key}.json`).catch(() => []), psAll(league).catch(() => [])]);
  const t = teams.find((x) => String(x.id) === String(teamId));
  const events = all.filter((m) => m.home.id === String(teamId) || m.away.id === String(teamId)).sort((a, b) => a.start - b.start);
  const any = events[0] && (events[0].home.id === String(teamId) ? events[0].home : events[0].away);
  return { id: String(teamId), name: t?.name || any?.name || 'Time', logo: t?.image_url || any?.logo || '', leagueKey: league.key, roster: (t?.players || []).filter((p) => p.active !== false), events };
}

// ---------- Histórico das últimas temporadas (ESPN) ----------
export async function teamHistory(sport, teamId) {
  let d;
  try { d = await getData(`history/${sport}/${teamId}.json`); } catch { return null; }
  const T = d.teams || {};
  const side = (id, score, win) => ({ id, name: T[id]?.[0] || '?', logo: T[id]?.[1] || '', short: T[id]?.[0] || '?', score, winner: win });
  return (d.games || []).map(([id, date, h, a, hs, as, comp, season, w]) => ({
    id, date: new Date(date), comp, season, done: true,
    home: side(h, hs, w === 'h'), away: side(a, as, w === 'a'),
  }));
}

// ---------- Valorant: estatísticas (VLR.gg) ----------
const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
let vlrIdx = null;
export async function vlrStats() {
  try { return await getData('vlr/stats.json'); } catch { return null; }
}
export async function vlrPlayerIndex() {
  if (vlrIdx) return vlrIdx;
  const d = await vlrStats(); const idx = new Map();
  Object.values(d?.regions || {}).forEach((r) => (r.rows || []).forEach((x) => { if (!idx.has(nrm(x.player))) idx.set(nrm(x.player), x); }));
  vlrIdx = idx; return idx;
}
export const vlrFind = (idx, name) => idx?.get(nrm(name));
export async function vlrMatch(matchId) {
  try { return await getData(`vlr/match/${matchId}.json`); } catch { return null; }
}

// ---------- Mata-mata ----------
export async function bracket(league) {
  try { return await getData(`bracket/${league.key}.json`); } catch { return null; }
}

// ---------- Escudos: versão pequena (carrega bem mais rápido) ----------
// A ESPN tem um redimensionador de imagens; logos de 500px viram ~2 KB.
export function logoSrc(url, px = 40) {
  if (!url) return '';
  const m = String(url).match(/^https?:\/\/a\d?\.espncdn\.com(\/i\/teamlogos\/[^?]+\.png)/i);
  if (m) return `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${px * 2}&h=${px * 2}&scale=crop&cquality=60`;
  return url;
}
const warmed = new Set();
export function warmLogos(urls, px = 20) {
  urls.forEach((u) => {
    const src = logoSrc(u, px); if (!src || warmed.has(src)) return;
    warmed.add(src); const im = new Image(); im.decoding = 'async'; im.src = src;
  });
}
