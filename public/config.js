// Competições disponíveis. "on" = ativada por padrão (dá para mudar em Ajustes).
// src "espn" usa a API aberta da ESPN; src "ps" usa a PandaScore (e-sports).
export const LEAGUES = [
  // Futebol — Brasil / América do Sul
  { key: 'bra.1', name: 'Brasileirão Série A', short: 'Brasileirão', sport: 'soccer', src: 'espn', path: 'soccer/bra.1', flag: '🇧🇷', on: true },
  { key: 'bra.2', name: 'Brasileirão Série B', short: 'Série B', sport: 'soccer', src: 'espn', path: 'soccer/bra.2', flag: '🇧🇷', on: false },
  { key: 'bra.copa_do_brazil', name: 'Copa do Brasil', short: 'Copa do Brasil', sport: 'soccer', src: 'espn', path: 'soccer/bra.copa_do_brazil', flag: '🇧🇷', cup: true, on: true },
  { key: 'conmebol.libertadores', name: 'Copa Libertadores', short: 'Libertadores', sport: 'soccer', src: 'espn', path: 'soccer/conmebol.libertadores', flag: '🌎', cup: true, on: true },
  { key: 'conmebol.sudamericana', name: 'Copa Sul-Americana', short: 'Sul-Americana', sport: 'soccer', src: 'espn', path: 'soccer/conmebol.sudamericana', flag: '🌎', cup: true, on: true },
  // Futebol — EUA
  { key: 'usa.1', name: 'MLS', short: 'MLS', sport: 'soccer', src: 'espn', path: 'soccer/usa.1', flag: '🇺🇸', on: true },
  // Futebol — Europa
  { key: 'eng.1', name: 'Premier League', short: 'Premier League', sport: 'soccer', src: 'espn', path: 'soccer/eng.1', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', on: true },
  { key: 'esp.1', name: 'La Liga', short: 'La Liga', sport: 'soccer', src: 'espn', path: 'soccer/esp.1', flag: '🇪🇸', on: true },
  { key: 'ita.1', name: 'Serie A (Itália)', short: 'Serie A', sport: 'soccer', src: 'espn', path: 'soccer/ita.1', flag: '🇮🇹', on: true },
  { key: 'ger.1', name: 'Bundesliga', short: 'Bundesliga', sport: 'soccer', src: 'espn', path: 'soccer/ger.1', flag: '🇩🇪', on: true },
  { key: 'fra.1', name: 'Ligue 1', short: 'Ligue 1', sport: 'soccer', src: 'espn', path: 'soccer/fra.1', flag: '🇫🇷', on: true },
  { key: 'por.1', name: 'Liga Portugal', short: 'Liga Portugal', sport: 'soccer', src: 'espn', path: 'soccer/por.1', flag: '🇵🇹', on: true },
  { key: 'uefa.champions', name: 'Champions League', short: 'Champions', sport: 'soccer', src: 'espn', path: 'soccer/uefa.champions', flag: '🇪🇺', cup: true, on: false },
  // EUA
  { key: 'nba', name: 'NBA', short: 'NBA', sport: 'basketball', src: 'espn', path: 'basketball/nba', flag: '🏀', on: true },
  { key: 'nfl', name: 'NFL', short: 'NFL', sport: 'football', src: 'espn', path: 'football/nfl', flag: '🏈', on: true },
  // E-sports
  { key: 'cs2', name: 'Counter-Strike 2', short: 'CS2', sport: 'esports', src: 'ps', game: 'csgo', flag: '🎯', on: true },
  { key: 'valorant', name: 'Valorant', short: 'Valorant', sport: 'esports', src: 'ps', game: 'valorant', flag: '🔺', on: true },
];

export const SPORTS = [
  { key: 'all', label: 'Todos' },
  { key: 'fav', label: '★ Favoritos' },
  { key: 'soccer', label: 'Futebol' },
  { key: 'nba', label: 'NBA' },
  { key: 'nfl', label: 'NFL' },
  { key: 'cs2', label: 'CS2' },
  { key: 'valorant', label: 'Valorant' },
];

// Tiers de torneio da PandaScore (s = maiores eventos).
export const TIERS = ['s', 'a', 'b', 'c', 'd'];
