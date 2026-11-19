// Coleta os dados (roda no GitHub Actions a cada ~5 min) e grava em public/data/.
// ESPN: sem chave.  PandaScore: token no secret PANDASCORE_TOKEN (opcional).
import fs from 'node:fs/promises';
import path from 'node:path';
import { LEAGUES } from '../public/config.js';

const ESPN = process.env.ESPN_BASE || 'https://site.api.espn.com';
const PS = process.env.PS_BASE || 'https://api.pandascore.co';
const TOKEN = process.env.PANDASCORE_TOKEN || '';
const VLR = process.env.VLR_BASE || ''; // servidor local do vlrggapi (iniciado pelo workflow)
const HIST_YEARS = 5;
const FD = process.env.FD_BASE || 'https://api.football-data.org/v4';
const FD_TOKEN = process.env.FOOTBALL_DATA_TOKEN || '';
// Códigos do football-data.org (fonte reserva, plano grátis) para as ligas do app
const FD_CODES = { 'eng.1': 'PL', 'esp.1': 'PD', 'ita.1': 'SA', 'ger.1': 'BL1', 'fra.1': 'FL1', 'por.1': 'PPL', 'uefa.champions': 'CL', 'bra.1': 'BSA' };
const OUT = path.resolve(process.argv[2] || 'public/data');
const DAYS_BACK = 3, DAYS_FWD = 21;

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, headers = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'MeuPlacar/1.0 (uso pessoal; github actions)', accept: 'application/json', ...headers } });
      if (r.ok) return await r.json();
      if (r.status === 404 || r.status === 400 || r.status === 401 || r.status === 403) throw new Error(`HTTP ${r.status}`);
    } catch (e) { if (i === tries - 1) throw e; }
    await sleep(800 * (i + 1));
  }
  throw new Error('falhou');
}
async function write(rel, data) {
  const f = path.join(OUT, rel);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify(data));
}
async function readOld(rel) { try { return JSON.parse(await fs.readFile(path.join(OUT, rel), 'utf8')); } catch { return null; } }
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const addDays = (d, n) => new Date(d.getTime() + n * 86400e3);
// limita concorrência
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch((e) => ({ __error: String(e) })); } }));
  return out;
}

// ---------- enxugar respostas da ESPN ----------
const slimTeam = (t = {}) => ({ id: t.id, displayName: t.displayName, shortDisplayName: t.shortDisplayName, abbreviation: t.abbreviation, logo: t.logo || t.logos?.[0]?.href });
const slimComp = (c = {}) => ({
  date: c.date,
  competitors: (c.competitors || []).map((x) => ({ homeAway: x.homeAway, winner: x.winner, score: typeof x.score === 'object' ? x.score?.displayValue : x.score, team: slimTeam(x.team), linescores: x.linescores?.map((l) => ({ displayValue: l.displayValue })) })),
  venue: c.venue ? { fullName: c.venue.fullName, address: c.venue.address } : undefined,
  status: c.status ? { displayClock: c.status.displayClock, type: { state: c.status.type?.state, name: c.status.type?.name, shortDetail: c.status.type?.shortDetail } } : undefined,
  broadcasts: c.broadcasts?.map((b) => ({ names: b.names })),
  notes: c.notes?.slice(0, 1).map((n) => ({ headline: n.headline })),
});
const slimEvent = (e) => ({ id: e.id, date: e.date, competitions: [slimComp(e.competitions?.[0])] });

function slimSummary(s) {
  return {
    header: { competitions: (s.header?.competitions || []).slice(0, 1).map(slimComp) },
    gameInfo: s.gameInfo?.venue ? { venue: { fullName: s.gameInfo.venue.fullName, address: s.gameInfo.venue.address } } : undefined,
    keyEvents: s.keyEvents?.map((k) => ({ type: { text: k.type?.text, type: k.type?.type }, scoringPlay: k.scoringPlay, clock: { displayValue: k.clock?.displayValue }, team: k.team ? { id: k.team.id } : undefined, participants: k.participants?.map((p) => ({ athlete: { displayName: p.athlete?.displayName } })), shortText: k.shortText })),
    rosters: s.rosters?.map((r) => ({ homeAway: r.homeAway, formation: r.formation, team: { ...slimTeam(r.team), logos: r.team?.logos?.slice(0, 1) }, roster: (r.roster || []).map((p) => ({ athlete: { displayName: p.athlete?.displayName }, jersey: p.jersey, position: { abbreviation: p.position?.abbreviation }, starter: p.starter, subbedIn: p.subbedIn, formationPlace: p.formationPlace, plays: p.plays?.map((pl) => ({ clock: { displayValue: pl.clock?.displayValue }, scoringPlay: pl.scoringPlay, didScore: pl.didScore, redCard: pl.redCard, yellowCard: pl.yellowCard, substitution: pl.substitution, ownGoal: pl.ownGoal, penaltyKick: pl.penaltyKick })) })) })),
    boxscore: s.boxscore ? {
      teams: s.boxscore.teams?.map((t) => ({ team: { id: t.team?.id }, statistics: t.statistics?.map((x) => ({ name: x.name, label: x.label, displayValue: x.displayValue })) })),
      players: s.boxscore.players?.map((t) => ({ team: slimTeam(t.team), statistics: (t.statistics || []).slice(0, 1).map((st) => ({ athletes: (st.athletes || []).map((a) => ({ starter: a.starter, athlete: { displayName: a.athlete?.displayName, shortName: a.athlete?.shortName, jersey: a.athlete?.jersey, position: { abbreviation: a.athlete?.position?.abbreviation } } })) })) })),
    } : undefined,
    lastFiveGames: s.lastFiveGames?.map((t) => ({ team: slimTeam(t.team), events: (t.events || []).slice(0, 5).map((ev) => ({ id: ev.id, gameDate: ev.gameDate, atVs: ev.atVs, score: ev.score, homeTeamId: ev.homeTeamId, awayTeamId: ev.awayTeamId, homeTeamScore: ev.homeTeamScore, awayTeamScore: ev.awayTeamScore, gameResult: ev.gameResult, competitionName: ev.competitionName || ev.leagueName, opponent: { id: ev.opponent?.id, displayName: ev.opponent?.displayName, abbreviation: ev.opponent?.abbreviation, logo: ev.opponent?.logo || ev.opponentLogo } })) })),
    seasonseries: s.seasonseries?.map((ss) => ({ title: ss.title, summary: ss.summary, events: (ss.events || []).map((ev) => ({ id: ev.id, date: ev.date, statusType: ev.statusType, competitionName: ev.competitionName, competitors: (ev.competitors || []).map((c) => ({ homeAway: c.homeAway, winner: c.winner, score: typeof c.score === 'object' ? c.score?.displayValue : c.score, team: slimTeam(c.team) })) })) })),
    leaders: s.leaders?.map((t) => ({ team: slimTeam(t.team), leaders: (t.leaders || []).slice(0, 4).map((c) => ({ name: c.name, displayName: c.displayName, leaders: (c.leaders || []).slice(0, 1).map((l) => ({ displayValue: l.displayValue, athlete: { displayName: l.athlete?.displayName } })) })) })),
  };
}

const slimPs = (m) => ({
  id: m.id, begin_at: m.begin_at, scheduled_at: m.scheduled_at, status: m.status, number_of_games: m.number_of_games, winner_id: m.winner_id,
  opponents: (m.opponents || []).map((o) => ({ opponent: { id: o.opponent?.id, name: o.opponent?.name, acronym: o.opponent?.acronym, image_url: o.opponent?.image_url } })),
  results: m.results, league: { name: m.league?.name, image_url: m.league?.image_url }, serie: { full_name: m.serie?.full_name, name: m.serie?.name, tier: m.serie?.tier },
  tournament: { name: m.tournament?.name, tier: m.tournament?.tier },
  games: (m.games || []).map((g) => ({ position: g.position, status: g.status, winner: { id: g.winner?.id }, map: g.map ? { name: g.map.name } : undefined })),
  streams_list: (m.streams_list || []).map((s) => ({ raw_url: s.raw_url, language: s.language, main: s.main, official: s.official })),
});


// ---------- Valorant: VLR.gg (via vlrggapi rodando no próprio robô) ----------
let vlrChain = Promise.resolve();
function vlrGet(path) { // limite do vlrggapi: 20/min nas rotas pesadas -> 1 a cada 3,3 s
  const run = vlrChain.then(async () => { const j = await get(`${VLR}${path}`, {}, 2); return j?.data?.segments ?? j?.data ?? j; });
  vlrChain = run.catch(() => {}).then(() => sleep(3300));
  return run;
}
const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(team|esports?|gaming|club|gg)\b/g, '').replace(/[^a-z0-9]/g, '');
const sameTeam = (a, b) => { const x = normName(a), y = normName(b); return !!x && !!y && (x === y || (x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x)))); };

// ---------- histórico: competições extras por região ----------
const CUPS = {
  br: ['bra.1', 'bra.2', 'bra.copa_do_brazil', 'conmebol.libertadores', 'conmebol.sudamericana'],
  eu: ['uefa.champions', 'uefa.europa', 'uefa.europa.conf'],
};
const COMP_NAME = { 'bra.1': 'Brasileirão', 'bra.2': 'Série B', 'bra.copa_do_brazil': 'Copa do Brasil', 'conmebol.libertadores': 'Libertadores', 'conmebol.sudamericana': 'Sul-Americana', 'uefa.champions': 'Champions', 'uefa.europa': 'Liga Europa', 'uefa.europa.conf': 'Conference League', 'usa.1': 'MLS', 'eng.1': 'Premier League', 'esp.1': 'La Liga', 'ita.1': 'Serie A', 'ger.1': 'Bundesliga', 'fra.1': 'Ligue 1', 'por.1': 'Liga Portugal', nba: 'NBA', nfl: 'NFL' };

// ---------- fonte reserva: football-data.org ----------
let fdChain = Promise.resolve();
function fdGet(path) { // fila: 1 chamada a cada 6,5 s (plano grátis = 10/min)
  const run = fdChain.then(() => get(`${FD}${path}`, { 'X-Auth-Token': FD_TOKEN }, 2));
  fdChain = run.catch(() => {}).then(() => sleep(6500));
  return run;
}
const fdState = (st) => ({ SCHEDULED: 'pre', TIMED: 'pre', POSTPONED: 'pre', SUSPENDED: 'in', IN_PLAY: 'in', PAUSED: 'in', FINISHED: 'post', AWARDED: 'post', CANCELLED: 'post' }[st] || 'pre');
const fdName = (st) => ({ PAUSED: 'STATUS_HALFTIME', POSTPONED: 'STATUS_POSTPONED', CANCELLED: 'STATUS_CANCELED', FINISHED: 'STATUS_FULL_TIME' }[st] || (fdState(st) === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED'));
const fdTeam = (t = {}) => ({ id: `fd${t.id}`, displayName: t.shortName || t.name, shortDisplayName: t.shortName || t.name, abbreviation: t.tla, logo: t.crest });
function fdEvent(m) {
  const ft = m.score?.fullTime || {};
  const hs = ft.home, as = ft.away;
  const state = fdState(m.status);
  return { id: `fd${m.id}`, date: m.utcDate, competitions: [{
    competitors: [
      { homeAway: 'home', score: hs != null ? String(hs) : (state === 'pre' ? '0' : null), winner: m.score?.winner === 'HOME_TEAM', team: fdTeam(m.homeTeam) },
      { homeAway: 'away', score: as != null ? String(as) : (state === 'pre' ? '0' : null), winner: m.score?.winner === 'AWAY_TEAM', team: fdTeam(m.awayTeam) },
    ],
    venue: m.venue ? { fullName: m.venue } : undefined,
    status: { displayClock: m.minute ? `${m.minute}'` : '', type: { state, name: fdName(m.status), shortDetail: m.minute ? `${m.minute}'` : '' } },
    notes: m.stage && m.stage !== 'REGULAR_SEASON' ? [{ headline: m.stage.replace(/_/g, ' ') }] : undefined,
  }] };
}
async function fdMatches(code, from, to) {
  const d = await fdGet(`/competitions/${code}/matches?dateFrom=${from.toISOString().slice(0, 10)}&dateTo=${to.toISOString().slice(0, 10)}`);
  return (d.matches || []).map(fdEvent);
}
async function fdStandings(code) {
  const d = await fdGet(`/competitions/${code}/standings`);
  return (d.standings || []).filter((g) => g.type === 'TOTAL').map((g) => ({
    name: g.group ? g.group.replace(/_/g, ' ') : '',
    entries: (g.table || []).map((r) => ({ team: { id: `fd${r.team.id}`, displayName: r.team.shortName || r.team.name, abbreviation: r.team.tla, logos: [{ href: r.team.crest }] },
      stats: [['rank', r.position], ['gamesPlayed', r.playedGames], ['wins', r.won], ['ties', r.draw], ['losses', r.lost], ['pointDifferential', r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference], ['points', r.points]].map(([name, v]) => ({ name, displayValue: String(v) })) })),
  }));
}
async function fdScorers(code) {
  const d = await fdGet(`/competitions/${code}/scorers?limit=25`);
  const rows = (d.scorers || []).map((x) => ({ player: x.player?.name, team: x.team?.shortName || x.team?.name, teamId: `fd${x.team?.id}`, teamLogo: x.team?.crest || '', value: x.goals, display: String(x.goals), apps: x.playedMatches, goals: x.goals, assists: x.assists }));
  const ass = rows.filter((r) => r.assists).slice().sort((a, b) => b.assists - a.assists).map((r) => ({ ...r, value: r.assists, display: String(r.assists) }));
  return [{ key: 'goalsLeaders', title: 'Gols', rows }, ...(ass.length ? [{ key: 'assistsLeaders', title: 'Assistências', rows: ass }] : [])];
}

// ---------- coleta ----------
async function main() {
  const now = new Date();
  const meta = { generatedAt: now.toISOString(), leagues: {}, esports: TOKEN ? 'on' : 'off', backup: FD_TOKEN ? 'on' : 'off' };
  const espnLeagues = LEAGUES.filter((l) => l.src === 'espn');
  const fullRun = process.env.FULL === '1' || now.getUTCMinutes() < 10 || !(await readOld('teams/bra.1.json'));

  // 1) calendário/placar de cada liga (janela de dias)
  const range = `${ymd(addDays(now, -DAYS_BACK))}-${ymd(addDays(now, DAYS_FWD))}`;
  const allEvents = [];
  // Algumas ligas (NBA, NFL, MLS, copas...) recusam intervalo de datas: nelas busca dia a dia.
  const dayList = (from, to) => { const out = []; for (let d = addDays(now, from); d <= addDays(now, to); d = addDays(d, 1)) out.push(ymd(d)); return out; };
  const singleState = (await readOld('single-day.json')) || {};
  await pool(espnLeagues, 4, async (lg) => {
    try {
      let evs;
      if (!singleState[lg.key]) {
        try {
          const d = await get(`${ESPN}/apis/site/v2/sports/${lg.path}/scoreboard?dates=${range}&limit=1000`, {}, 2);
          evs = (d.events || []).map(slimEvent);
        } catch (e) {
          if (!/HTTP 400/.test(String(e))) throw e;
          singleState[lg.key] = true; log(`  ${lg.key}: usa busca dia a dia`);
        }
      }
      if (!evs) {
        // a cada execução: ontem até daqui a 2 dias; de hora em hora: janela inteira
        const days = fullRun || !(await readOld(`espn/${lg.key}.json`)) ? dayList(-DAYS_BACK, DAYS_FWD) : dayList(-1, 2);
        const fetched = new Map(); let okDays = 0;
        await pool(days, 4, async (dstr) => {
          const d = await get(`${ESPN}/apis/site/v2/sports/${lg.path}/scoreboard?dates=${dstr}&limit=300`, {}, 2).catch(() => null);
          if (d) { okDays++; (d.events || []).forEach((e) => fetched.set(String(e.id), slimEvent(e))); }
        });
        if (!okDays) throw new Error('nenhum dia respondeu');
        // mantém do arquivo antigo os jogos de dias que não foram buscados agora
        const old = (await readOld(`espn/${lg.key}.json`)) || [];
        const inWin = (e) => { const t = new Date(e.date); return t > addDays(now, -DAYS_BACK - 1) && t < addDays(now, DAYS_FWD + 1); };
        old.forEach((e) => { if (!fetched.has(String(e.id)) && inWin(e) && !days.includes(ymd(new Date(new Date(e.date).getTime() - 5 * 3600e3)))) fetched.set(String(e.id), e); });
        evs = [...fetched.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
      }
      await write(`espn/${lg.key}.json`, evs);
      meta.leagues[lg.key] = { ok: true, events: evs.length };
      evs.forEach((e) => allEvents.push({ lg, e }));
      log(`✔ ${lg.key}: ${evs.length} jogos`);
    } catch (e) {
      meta.leagues[lg.key] = { ok: false, error: String(e) };
      log(`✘ ${lg.key}: ${e}`);
    }
  });
  await write('single-day.json', singleState);

  // 1b) reserva: se a ESPN falhou numa liga, busca no football-data.org
  if (FD_TOKEN) {
    for (const lg of espnLeagues.filter((l) => !meta.leagues[l.key]?.ok && FD_CODES[l.key])) {
      try {
        const evs = await fdMatches(FD_CODES[lg.key], addDays(now, -DAYS_BACK), addDays(now, DAYS_FWD));
        await write(`espn/${lg.key}.json`, evs);
        meta.leagues[lg.key] = { ok: true, events: evs.length, source: 'football-data' };
        log(`↺ ${lg.key}: ${evs.length} jogos pela fonte reserva`);
      } catch (e) {
        log(`✘ reserva ${lg.key}: ${e}`);
        // mantém os dados antigos, se existirem
        if (await readOld(`espn/${lg.key}.json`)) meta.leagues[lg.key] = { ok: true, stale: true };
      }
    }
  }

  // 2) detalhes (escalação/lances) dos jogos de ontem→amanhã; ao vivo sempre
  const near = allEvents.filter(({ e }) => {
    const t = new Date(e.date).getTime();
    const st = e.competitions?.[0]?.status?.type?.state;
    return st === 'in' || (t > now - 30 * 3600e3 && t < +now + (fullRun ? 72 : 30) * 3600e3);
  });
  let nSum = 0;
  await pool(near, 6, async ({ lg, e }) => {
    const st = e.competitions?.[0]?.status?.type?.state;
    const rel = `summary/${lg.key}/${e.id}.json`;
    // jogos terminados há tempo e já salvos não precisam baixar de novo
    if (st === 'post' && (await readOld(rel)) && !fullRun) return;
    try { await write(rel, slimSummary(await get(`${ESPN}/apis/site/v2/sports/${lg.path}/summary?event=${e.id}`))); nSum++; } catch (err) { log(`  resumo ${lg.key}/${e.id}: ${err}`); }
  });
  log(`✔ ${nSum} resumos atualizados`);

  // 3) tabelas e lista de times (1x por hora)
  if (fullRun) {
    await pool(espnLeagues, 4, async (lg) => {
      try {
        const d = await get(`${ESPN}/apis/v2/sports/${lg.path}/standings`);
        const groups = [];
        const walk = (n, name) => { if (n.standings?.entries?.length) groups.push({ name: n.name || name || '', entries: n.standings.entries.map((x) => ({ team: { id: x.team?.id, displayName: x.team?.displayName, abbreviation: x.team?.abbreviation, logos: x.team?.logos?.slice(0, 1) }, note: x.note ? { color: x.note.color } : undefined, stats: (x.stats || []).map((s) => ({ name: s.name, abbreviation: s.abbreviation, displayValue: s.displayValue })) })) }); (n.children || []).forEach((c) => walk(c, c.name)); };
        walk(d, d.name);
        if (!groups.length) throw new Error('vazia');
        await write(`standings/${lg.key}.json`, groups);
      } catch (e) {
        log(`  tabela ${lg.key}: ${e}`);
        if (FD_TOKEN && FD_CODES[lg.key]) { try { await write(`standings/${lg.key}.json`, await fdStandings(FD_CODES[lg.key])); log(`  ↺ tabela ${lg.key} pela reserva`); } catch (e2) { log(`  ✘ reserva tabela ${lg.key}: ${e2}`); } }
      }
      try {
        const d = await get(`${ESPN}/apis/site/v2/sports/${lg.path}/teams`);
        const teams = (d.sports?.[0]?.leagues?.[0]?.teams || []).map((x) => ({ id: String(x.team.id), name: x.team.displayName, short: x.team.abbreviation, logo: x.team.logos?.[0]?.href || '' }));
        await write(`teams/${lg.key}.json`, teams);
      } catch (e) { log(`  times ${lg.key}: ${e}`); }
    });
    log('✔ tabelas e times');
  }

  // 4) artilharia / líderes (1x por hora)
  if (fullRun) {
    await pool(espnLeagues, 4, async (lg) => {
      try {
        let cats = [];
        if (lg.sport === 'soccer') {
          const d = await get(`${ESPN}/apis/site/v2/sports/${lg.path}/statistics`);
          cats = (d.stats || []).map((c) => ({
            key: c.name, title: c.displayName,
            rows: (c.leaders || []).slice(0, 25).map((l) => {
              const st = {}; (l.statistics || []).forEach((x) => { st[x.name] = x.value; });
              return { player: l.athlete?.displayName, playerId: l.athlete?.id, team: l.athlete?.team?.displayName, teamId: l.athlete?.team?.id, teamLogo: l.athlete?.team?.logos?.[0]?.href || l.athlete?.team?.logo || '', value: l.value, display: String(l.value ?? ''), apps: st.appearances, goals: st.totalGoals, assists: st.goalAssists };
            }),
          }));
        } else {
          const d = await get(`${ESPN}/apis/site/v3/sports/${lg.path}/leaders`);
          cats = (d.leaders?.categories || []).slice(0, 12).map((c) => ({
            key: c.name, title: c.displayName, abbr: c.abbreviation,
            rows: (c.leaders || []).slice(0, 15).map((l) => ({ player: l.athlete?.displayName, playerId: l.athlete?.id, pos: l.athlete?.position?.abbreviation, team: l.team?.displayName, teamId: l.team?.id, teamLogo: l.team?.logos?.[0]?.href || l.team?.logo || '', value: l.value, display: l.displayValue })),
          }));
        }
        cats = cats.filter((c) => c.rows.length);
        if (!cats.length) throw new Error('vazio');
        await write(`leaders/${lg.key}.json`, cats);
      } catch (e) {
        log(`  líderes ${lg.key}: ${e}`);
        if (FD_TOKEN && FD_CODES[lg.key]) { try { await write(`leaders/${lg.key}.json`, await fdScorers(FD_CODES[lg.key])); log(`  ↺ artilharia ${lg.key} pela reserva`); } catch (e2) { log(`  ✘ reserva artilharia ${lg.key}: ${e2}`); } }
      }
    });
    log('✔ artilharia/líderes');
  }

  // 5) página de cada time (elenco + calendário completo) — rodízio: alguns times por execução
  {
    const state = (await readOld('team-state.json')) || {};
    const all = [];
    for (const lg of espnLeagues.filter((l) => !l.cup)) {
      const teams = (await readOld(`teams/${lg.key}.json`)) || [];
      teams.forEach((t) => all.push({ lg, t, k: `${lg.sport}/${t.id}` }));
    }
    const missing = all.filter((x) => !state[x.k]).length;
    const batch = all.sort((a, b) => (state[a.k] || 0) - (state[b.k] || 0)).slice(0, missing ? 45 : 14);
    let nt = 0;
    await pool(batch, 6, async ({ lg, t, k }) => {
      try {
        const base = `${ESPN}/apis/site/v2/sports/${lg.path}/teams/${t.id}`;
        const [ro, sc, fx] = await Promise.all([
          get(`${base}/roster`).catch(() => ({})),
          get(`${base}/schedule`).catch(() => ({})),
          lg.sport === 'soccer' ? get(`${base}/schedule?fixture=true`).catch(() => ({})) : Promise.resolve({}),
        ]);
        const flat = (ro.athletes || []).flatMap((a) => (a.items ? a.items.map((i) => ({ ...i, _group: a.position })) : [a]));
        const KEEP = ['appearances', 'totalGoals', 'goalAssists', 'yellowCards', 'redCards', 'saves', 'goalsConceded', 'shotsOnTarget', 'gamesPlayed', 'avgPoints', 'avgRebounds', 'avgAssists'];
        const roster = flat.map((a) => {
          const st = {};
          (a.statistics?.splits?.categories || []).forEach((c) => (c.stats || []).forEach((x) => { if (KEEP.includes(x.name) && st[x.name] == null) st[x.name] = x.displayValue ?? x.value; }));
          return { id: a.id, name: a.displayName, jersey: a.jersey, pos: a.position?.abbreviation, posName: a.position?.displayName || a.position?.name, age: a.age, flag: a.citizenshipCountry?.abbreviation || a.citizenship || '', head: a.headshot?.href || '', st };
        });
        const seen = new Set(); const events = [];
        [...(sc.events || []), ...(fx.events || [])].forEach((e) => { if (!seen.has(e.id)) { seen.add(e.id); events.push({ ...slimEvent(e), comp: e.league?.abbreviation || e.league?.name || e.seasonType?.name || '' }); } });
        events.sort((a, b) => new Date(a.date) - new Date(b.date));
        await write(`team/${lg.sport}/${t.id}.json`, { id: t.id, name: t.name, short: t.short, logo: t.logo, leagueKey: lg.key, record: sc.team?.recordSummary || '', standing: sc.team?.standingSummary || '', roster, events });
        state[k] = Date.now(); nt++;
      } catch (e) { log(`  time ${k}: ${e}`); }
    });
    await write('team-state.json', state);
    log(`✔ ${nt} páginas de time atualizadas (${all.length} no total)`);
  }

  // 5b) histórico das últimas temporadas de cada time (busca uma vez e guarda; rodízio de poucos times por execução)
  {
    const hstate = (await readOld('history-state.json')) || {};
    const all = [];
    for (const lg of espnLeagues.filter((l) => !l.cup)) {
      ((await readOld(`teams/${lg.key}.json`)) || []).forEach((t) => all.push({ lg, t, k: `${lg.sport}/${t.id}` }));
    }
    const MONTH = 30 * 86400e3;
    const due = all.filter((x) => !hstate[x.k] || Date.now() - hstate[x.k] > MONTH).sort((a, b) => (hstate[a.k] || 0) - (hstate[b.k] || 0));
    const batch = due.slice(0, process.env.FULL === '1' ? 10 : 6);
    const yearNow = now.getUTCFullYear();
    let nh = 0;
    for (const { lg, t, k } of batch) {
      const comps = lg.sport !== 'soccer' ? [lg.key]
        : lg.key.startsWith('bra.') ? CUPS.br
        : lg.key === 'usa.1' ? ['usa.1']
        : [lg.key, ...CUPS.eu];
      const jobs = [];
      for (let y = yearNow - 1; y >= yearNow - HIST_YEARS; y--) comps.forEach((c) => jobs.push({ c, y }));
      const teamsMap = {}; const games = []; const seen = new Set();
      await pool(jobs, 6, async ({ c, y }) => {
        const path = LEAGUES.find((l) => l.key === c)?.path || `soccer/${c}`;
        const d = await get(`${ESPN}/apis/site/v2/sports/${path}/teams/${t.id}/schedule?season=${y}`, {}, 2).catch(() => null);
        (d?.events || []).forEach((e) => {
          const comp = e.competitions?.[0]; const st = comp?.status?.type;
          if (!comp || seen.has(e.id) || !(st?.completed === true || st?.state === 'post')) return;
          const cs = comp.competitors || [];
          const h = cs.find((x) => x.homeAway === 'home'); const a = cs.find((x) => x.homeAway === 'away');
          if (!h || !a) return;
          const sc = (x) => (typeof x.score === 'object' ? x.score?.displayValue ?? x.score?.value : x.score);
          if (sc(h) == null || sc(a) == null) return;
          seen.add(e.id);
          [h, a].forEach((x) => { const id = String(x.team?.id); if (!teamsMap[id]) teamsMap[id] = [x.team?.displayName || x.team?.name || '?', x.team?.logo || x.team?.logos?.[0]?.href || '']; });
          const win = h.winner ? 'h' : a.winner ? 'a' : '';
          games.push([String(e.id), e.date, String(h.team?.id), String(a.team?.id), String(sc(h)), String(sc(a)), COMP_NAME[c] || c, y, win]);
        });
      });
      games.sort((x, y2) => new Date(y2[1]) - new Date(x[1]));
      await write(`history/${lg.sport}/${t.id}.json`, { teams: teamsMap, games });
      hstate[k] = Date.now(); nh++;
    }
    await write('history-state.json', hstate);
    log(`✔ histórico: ${nh} times atualizados (faltam ${Math.max(0, due.length - nh)})`);
  }

  // 5c) MATA-MATA das copas: fases do calendário da ESPN + jogos de cada fase eliminatória
  {
    const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    // "Aug 11-25" | "Apr 7-May 28" | "Nov 28" -> [inicio, fim] (usa o ano das datas da fase)
    const parseDetail = (det, s0, e0) => {
      const m = String(det || '').match(/^([A-Z][a-z]{2}) (\d{1,2})(?:-(?:([A-Z][a-z]{2}) )?(\d{1,2}))?$/);
      if (!m || MON[m[1]] == null) return null;
      const y0 = new Date(s0).getUTCFullYear();
      const a = new Date(Date.UTC(y0, MON[m[1]], +m[2]));
      if (a < addDays(new Date(s0), -2)) a.setUTCFullYear(y0 + 1);
      const b = m[4] ? new Date(Date.UTC(a.getUTCFullYear(), MON[m[3] || m[1]], +m[4])) : new Date(a);
      if (b < a) b.setUTCFullYear(b.getUTCFullYear() + 1);
      return [addDays(a, -1), addDays(b, 1)];
    };
    const isKO = (label) => !/group|league phase|league stage|regular/i.test(label || '');
    const slimKO = (e) => {
      const c = e.competitions?.[0] || {};
      const sc = (x) => (typeof x.score === 'object' ? x.score?.displayValue ?? x.score?.value : x.score);
      return {
        id: String(e.id), date: e.date, state: c.status?.type?.state || 'pre', clock: c.status?.type?.shortDetail || '',
        leg: c.leg?.value || null, legs: c.series?.totalCompetitions || null, series: c.series?.title || '',
        note: c.notes?.[0]?.text || c.notes?.[0]?.headline || '',
        sWin: (c.series?.competitors || []).find((x) => x.winner)?.id || null, sDone: !!c.series?.completed,
        t: (c.competitors || []).map((x) => ({ id: String(x.team?.id ?? x.id), home: x.homeAway === 'home', name: x.team?.displayName, short: x.team?.abbreviation, logo: x.team?.logo || x.team?.logos?.[0]?.href || '', score: sc(x), pen: x.shootoutScore ?? null, agg: x.aggregateScore ?? null, win: !!x.winner })),
      };
    };
    const cups = espnLeagues.filter((l) => l.cup);
    // cota dividida entre as copas (antes a primeira da lista podia usar tudo)
    const perCup = fullRun ? 45 : 20;
    for (const lg of cups) {
      let budget = perCup;
      try {
        const sb = await get(`${ESPN}/apis/site/v2/sports/${lg.path}/scoreboard`, {}, 2);
        const stages = (sb.leagues?.[0]?.calendar?.[0]?.entries || []).map((x) => ({ label: x.label, detail: x.detail, start: x.startDate, end: x.endDate }));
        if (!stages.length) continue;
        const cache = (await readOld(`bracket-days/${lg.key}.json`)) || {}; // { 'YYYYMMDD': { at, evs: [...] } }
        const today = ymd(now);
        const want = [];
        stages.filter((st) => isKO(st.label)).forEach((st) => {
          const win = parseDetail(st.detail, st.start, st.end) || [new Date(st.start), new Date(st.end)];
          if (win[0] > addDays(now, DAYS_FWD)) return; // fase futura distante: ainda sem jogos
          for (let d = new Date(win[0]); d <= win[1] && d <= addDays(now, DAYS_FWD); d = addDays(d, 1)) {
            const k = ymd(d); const hit = cache[k];
            const settled = k < ymd(addDays(now, -3)); // dias antigos não mudam mais
            if (!hit || (!settled && Date.now() - hit.at > 50 * 60e3)) want.push(k);
          }
        });
        const todo = [...new Set(want)].sort().reverse().slice(0, budget); // recentes primeiro
        await pool(todo, 4, async (k) => {
          const d = await get(`${ESPN}/apis/site/v2/sports/${lg.path}/scoreboard?dates=${k}&limit=100`, {}, 2).catch(() => null);
          if (d) cache[k] = { at: Date.now(), evs: (d.events || []).map(slimKO) };
        });
        // jogos da janela principal (atualizados a cada 5 min) entram por cima
        const fresh = new Map();
        Object.values(cache).forEach((v) => v.evs.forEach((e) => fresh.set(e.id, e)));
        // monta os confrontos por fase
        const out = [];
        for (const st of stages) {
          const s0 = new Date(st.start), e0 = new Date(st.end);
          const evs = [...fresh.values()].filter((e) => { const t = new Date(e.date); return t >= s0 && t < e0; });
          if (!evs.length) { out.push({ label: st.label, detail: st.detail, ko: isKO(st.label), ties: [] }); continue; }
          if (!isKO(st.label)) { out.push({ label: st.label, detail: st.detail, ko: false, ties: [] }); continue; }
          const ties = new Map();
          evs.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((e) => {
            if (e.t.length < 2) return;
            const key = e.t.map((x) => x.id).sort().join('-');
            if (!ties.has(key)) ties.set(key, { a: e.t[0], b: e.t[1], legs: [] });
            ties.get(key).legs.push(e);
          });
          out.push({ label: st.label, detail: st.detail, ko: true, ties: [...ties.values()].map((T) => {
            const ids = [T.a.id, T.b.id]; const team = (id) => { const x = T.legs.flatMap((l) => l.t).find((y) => y.id === id); return { id, name: x?.name, short: x?.short, logo: x?.logo }; };
            const agg = { [ids[0]]: 0, [ids[1]]: 0 }; let played = 0;
            T.legs.forEach((l) => { if (l.state !== 'pre') { played++; l.t.forEach((x) => { agg[x.id] += Number(x.score) || 0; }); } });
            const last = T.legs[T.legs.length - 1];
            const total = last.legs || T.legs.length;
            const done = last.state === 'post' && (last.sDone || T.legs.length >= total);
            let winner = last.sWin ? String(last.sWin) : null;
            if (!winner && done) {
              const lt = last.t; const pen = lt.every((x) => x.pen != null) ? lt : null;
              if (agg[ids[0]] !== agg[ids[1]]) winner = agg[ids[0]] > agg[ids[1]] ? ids[0] : ids[1];
              else if (pen) winner = Number(pen[0].pen) > Number(pen[1].pen) ? pen[0].id : pen[1].id;
              else winner = lt.find((x) => x.win)?.id || null;
            }
            const pens = last.t.every((x) => x.pen != null) ? Object.fromEntries(last.t.map((x) => [x.id, x.pen])) : null;
            return { teams: [team(ids[0]), team(ids[1])], agg: played ? agg : null, pens, winner, done, live: T.legs.some((l) => l.state === 'in'), note: last.note,
              legs: T.legs.map((l) => ({ id: l.id, date: l.date, state: l.state, clock: l.clock, leg: l.leg, home: l.t.find((x) => x.home)?.id || l.t[0].id, score: Object.fromEntries(l.t.map((x) => [x.id, x.score])) })) };
          }) });
        }
        await write(`bracket-days/${lg.key}.json`, cache);
        const pending = [...new Set(want)].length - todo.length;
        await write(`bracket/${lg.key}.json`, { stages: out, updated: now.toISOString(), pending: Math.max(0, pending) });
        log(`✔ mata-mata ${lg.key}: ${out.filter((x) => x.ties.length).map((x) => `${x.label} (${x.ties.length})`).join(', ') || 'sem confrontos ainda'}${todo.length ? ` · ${todo.length} dias buscados` : ''}`);
      } catch (e) { log(`  mata-mata ${lg.key}: ${e}`); }
    }
  }

  // 6) e-sports (PandaScore)
  if (TOKEN) {
    const H = { authorization: `Bearer ${TOKEN}` };
    for (const lg of LEAGUES.filter((l) => l.src === 'ps')) {
      try {
        const from = addDays(now, -DAYS_BACK).toISOString(), to = addDays(now, 14).toISOString();
        let list = [];
        for (let page = 1; page <= 5; page++) {
          const d = await get(`${PS}/${lg.game}/matches?range[begin_at]=${from},${to}&sort=begin_at&per_page=100&page=${page}`, H);
          list.push(...d); if (d.length < 100) break;
        }
        const running = await get(`${PS}/${lg.game}/matches/running?per_page=50`, H).catch(() => []);
        const ids = new Set(list.map((m) => m.id)); running.forEach((m) => !ids.has(m.id) && list.push(m));
        const slim = list.map(slimPs);
        await write(`ps/${lg.key}.json`, slim);
        meta.leagues[lg.key] = { ok: true, events: slim.length };
        log(`✔ ${lg.key}: ${slim.length} partidas`);

        // elencos dos times que aparecem (1x por hora)
        if (fullRun) {
          const teamIds = [...new Set(slim.flatMap((m) => m.opponents.map((o) => o.opponent.id)).filter(Boolean))];
          const teams = [];
          for (let i = 0; i < teamIds.length; i += 50) {
            const d = await get(`${PS}/teams?filter[id]=${teamIds.slice(i, i + 50).join(',')}&per_page=50`, H).catch(() => []);
            teams.push(...d.map((t) => ({ id: t.id, name: t.name, acronym: t.acronym, image_url: t.image_url, players: (t.players || []).map((p) => ({ name: p.name, first_name: p.first_name, last_name: p.last_name, nationality: p.nationality, image_url: p.image_url, active: p.active })) })));
          }
          await write(`ps-teams/${lg.key}.json`, teams);

          // confronto direto + últimos resultados das partidas das próximas 48 h
          const soon = slim.filter((m) => m.opponents.length === 2 && (m.status === 'running' || (m.status === 'not_started' && new Date(m.begin_at || m.scheduled_at) < addDays(now, 2)))).slice(0, 40);
          let nh = 0;
          for (const m of soon) {
            const [a, b] = m.opponents.map((o) => o.opponent.id);
            try {
              const past = (await get(`${PS}/${lg.game}/matches/past?filter[opponent_id]=${a},${b}&sort=-begin_at&per_page=50`, H)).map(slimPs);
              const has = (x, id) => x.opponents.some((o) => o.opponent.id === id);
              await write(`ps-h2h/${lg.key}/${m.id}.json`, {
                form: { [a]: past.filter((x) => has(x, a)).slice(0, 5), [b]: past.filter((x) => has(x, b)).slice(0, 5) },
                h2h: past.filter((x) => has(x, a) && has(x, b)).slice(0, 10),
              });
              nh++;
            } catch (e) { log(`  h2h ${lg.key}/${m.id}: ${e}`); }
          }
          log(`✔ ${lg.key}: ${nh} confrontos`);
        }
      } catch (e) {
        meta.leagues[lg.key] = { ok: false, error: String(e) };
        log(`✘ ${lg.key}: ${e}`);
      }
    }
  }

  // 7) Valorant: estatísticas de jogadores (VLR.gg)
  if (VLR) {
    try {
      if (fullRun || !(await readOld('vlr/stats.json'))) {
        const regions = { americas: 'Américas', emea: 'EMEA', pacific: 'Pacífico', china: 'China' };
        const out = { timespan: 60, regions: {} };
        for (const r of Object.keys(regions)) {
          try {
            const rows = await vlrGet(`/v2/stats?region=${r}&timespan=60&min_rounds=100&min_rating=0`);
            out.regions[r] = { name: regions[r], rows: (Array.isArray(rows) ? rows : []).slice(0, 200).map((x) => ({
              player: x.player, org: x.org, agents: x.agents, rating: x.rating, acs: x.average_combat_score, kd: x.kill_deaths, kast: x.kill_assists_survived_traded,
              adr: x.average_damage_per_round, kpr: x.kills_per_round, fkpr: x.first_kills_per_round, hs: x.headshot_percentage, clutch: x.clutch_success_percentage })) };
          } catch (e) { log(`  vlr stats ${r}: ${e}`); }
        }
        if (Object.keys(out.regions).length) { await write('vlr/stats.json', out); log(`✔ valorant: estatísticas de ${Object.keys(out.regions).length} regiões`); }
      }
      // estatísticas por partida: casa as partidas da PandaScore com as do VLR.gg pelos nomes dos times
      const ps = (await readOld('ps/valorant.json')) || [];
      const finished = ps.filter((m) => (m.status === 'finished' || m.status === 'running') && new Date(m.begin_at || m.scheduled_at) > addDays(now, -4) && m.opponents?.length === 2);
      const todo = [];
      for (const m of finished) { if (m.status === 'running' || !(await readOld(`vlr/match/${m.id}.json`))) todo.push(m); }
      if (todo.length) {
        const pages = [];
        try { pages.push(...((await vlrGet('/v2/match?q=results&num_pages=3')) || [])); } catch (e) { log(`  vlr resultados: ${e}`); }
        try { pages.push(...((await vlrGet('/v2/match?q=live_score')) || [])); } catch {}
        let nm = 0;
        for (const m of todo.slice(0, 8)) {
          const [A, B] = m.opponents.map((o) => o.opponent);
          const hit = pages.find((r) => (sameTeam(r.team1, A.name) && sameTeam(r.team2, B.name)) || (sameTeam(r.team1, B.name) && sameTeam(r.team2, A.name)) || (sameTeam(r.team1, A.acronym) && sameTeam(r.team2, B.acronym)));
          const id = hit && String(hit.match_page || '').match(/\/(\d+)\//)?.[1];
          if (!id) continue;
          try {
            const seg = await vlrGet(`/v2/match/${id}/details?light=true`);
            const d = Array.isArray(seg) ? seg[0] : seg;
            const t1 = d?.teams?.[0]?.name || hit.team1;
            const flip = sameTeam(t1, B.name) && !sameTeam(t1, A.name); // garante a ordem da PandaScore (A = 1º time)
            const pl = (arr) => (arr || []).map((p) => ({ name: p.name, agent: p.agent, rating: p.rating, acs: p.acs, k: p.kills, d: p.deaths, a: p.assists, kast: p.kast, adr: p.adr, hs: p.hs_pct, fk: p.fk, fd: p.fd }));
            const maps = (d?.maps || []).map((mp) => {
              const s1 = mp.score?.team1, s2 = mp.score?.team2; const P1 = pl(mp.players?.team1), P2 = pl(mp.players?.team2);
              return { name: mp.map_name, picked: mp.picked_by, dur: mp.duration, score: flip ? [s2, s1] : [s1, s2], players: flip ? [P2, P1] : [P1, P2] };
            }).filter((mp) => mp.players[0].length || mp.players[1].length);
            if (maps.length) { await write(`vlr/match/${m.id}.json`, { vlrId: id, url: `https://www.vlr.gg/${id}`, teams: [A.name, B.name], maps }); nm++; }
          } catch (e) { log(`  vlr partida ${id}: ${e}`); }
        }
        log(`✔ valorant: estatísticas de ${nm} partidas`);
      }
    } catch (e) { log(`✘ valorant/vlr: ${e}`); }
  }

  await write('meta.json', meta);
  log('pronto', meta.generatedAt);
}

main().catch((e) => { console.error(e); process.exit(1); });
