const https = require('https');

// League codes για football-data.co.uk
const LEAGUE_CODES = {
  'ΑΓΓ1': 'E0', 'ΑΓΓ2': 'E1', 'ΑΓΓ3': 'E2',
  'ΙΣΠ1': 'SP1', 'ΙΣΠ2': 'SP2',
  'ΓΕΡ1': 'D1', 'ΓΕΡ2': 'D2',
  'ΙΤΑ1': 'I1', 'ΙΤΑ2': 'I2',
  'ΓΑΛ1': 'F1', 'ΓΑΛ2': 'F2',
  'ΕΛΛΣ': 'G1',
  'ΠΟΡ1': 'P1',
  'ΟΛΛ1': 'N1',
  'ΒΕΛ1': 'B1',
  'ΤΟΥ1': 'T1',
  'ΣΚΩ1': 'SC0',
};

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim().replace(/"/g, ''); });
    return obj;
  }).filter(r => r.HomeTeam && r.AwayTeam);
}

function computeStandings(rows) {
  const teams = {};
  
  for (const row of rows) {
    if (!row.FTR || !row.FTHG || !row.FTAG) continue;
    const h = row.HomeTeam, a = row.AwayTeam;
    const hg = parseInt(row.FTHG), ag = parseInt(row.FTAG);
    const r = row.FTR;
    
    if (!teams[h]) teams[h] = { p:0, w:0, d:0, l:0, gf:0, ga:0, pts:0, form:[], home:{w:0,d:0,l:0,gf:0,ga:0,p:0} };
    if (!teams[a]) teams[a] = { p:0, w:0, d:0, l:0, gf:0, ga:0, pts:0, form:[], away:{w:0,d:0,l:0,gf:0,ga:0,p:0} };
    
    teams[h].p++; teams[h].gf+=hg; teams[h].ga+=ag;
    teams[h].home.p++;  teams[h].home.gf+=hg; teams[h].home.ga+=ag;
    teams[a].p++; teams[a].gf+=ag; teams[a].ga+=hg;
    teams[a].away = teams[a].away || {w:0,d:0,l:0,gf:0,ga:0,p:0};
    teams[a].away.p++; teams[a].away.gf+=ag; teams[a].away.ga+=hg;
    
    if (r === 'H') {
      teams[h].w++; teams[h].pts+=3; teams[h].form.push('W');
      teams[h].home.w++;
      teams[a].l++; teams[a].form.push('L');
      teams[a].away.l++;
    } else if (r === 'D') {
      teams[h].d++; teams[h].pts+=1; teams[h].form.push('D');
      teams[h].home.d++;
      teams[a].d++; teams[a].pts+=1; teams[a].form.push('D');
      teams[a].away.d++;
    } else {
      teams[a].w++; teams[a].pts+=3; teams[a].form.push('W');
      teams[a].away.w++;
      teams[h].l++; teams[h].form.push('L');
      teams[h].home.l++;
    }
  }
  
  // Ταξινόμηση
  const sorted = Object.entries(teams)
    .map(([name, s]) => ({
      name,
      pos: 0,
      pts: s.pts,
      p: s.p,
      w: s.w,
      d: s.d,
      l: s.l,
      gf: s.gf,
      ga: s.ga,
      gd: s.gf - s.ga,
      form: s.form.slice(-5),
      home: s.home || {w:0,d:0,l:0,gf:0,ga:0,p:0},
      away: s.away || {w:0,d:0,l:0,gf:0,ga:0,p:0},
      avgGf: +(s.gf / (s.p||1)).toFixed(2),
      avgGa: +(s.ga / (s.p||1)).toFixed(2),
    }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  
  sorted.forEach((t, i) => t.pos = i + 1);
  
  return sorted;
}

function computeH2H(rows, team1, team2) {
  const h2h = rows.filter(r =>
    (r.HomeTeam === team1 && r.AwayTeam === team2) ||
    (r.HomeTeam === team2 && r.AwayTeam === team1)
  ).slice(-10);
  
  return h2h.map(r => ({
    date: r.Date,
    home: r.HomeTeam,
    away: r.AwayTeam,
    score: `${r.FTHG}-${r.FTAG}`,
    result: r.FTR,
  })).reverse();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const params = event.queryStringParameters || {};
    const leagueGr = params.league || 'ΑΓΓ1';
    const homeTeam = params.home || '';
    const awayTeam = params.away || '';
    const currentSeason = '2425';
    const prevSeason    = '2324';

    const leagueCode = LEAGUE_CODES[leagueGr];
    if (!leagueCode) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Άγνωστη λίγκα: ${leagueGr}` }) };
    }

    // Τρέχουσα σεζόν — για βαθμολογία + φόρμα
    const urlCurrent = `https://www.football-data.co.uk/mmz4281/${currentSeason}/${leagueCode}.csv`;
    const csvCurrent = await fetchCSV(urlCurrent);
    const rowsCurrent = parseCSV(csvCurrent);

    if (!rowsCurrent.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Δεν βρέθηκαν δεδομένα' }) };
    }

    // Προηγούμενη σεζόν — μόνο για H2H
    let rowsPrev = [];
    try {
      const urlPrev = `https://www.football-data.co.uk/mmz4281/${prevSeason}/${leagueCode}.csv`;
      const csvPrev = await fetchCSV(urlPrev);
      rowsPrev = parseCSV(csvPrev);
    } catch(e) { /* συνεχίζουμε χωρίς */ }

    // Βαθμολογία από τρέχουσα σεζόν
    const standings = computeStandings(rowsCurrent);

    // Βρίσκουμε ομάδες
    const homeData = standings.find(t =>
      t.name.toLowerCase().includes(homeTeam.toLowerCase()) ||
      homeTeam.toLowerCase().includes(t.name.toLowerCase().split(' ')[0])
    );
    const awayData = standings.find(t =>
      t.name.toLowerCase().includes(awayTeam.toLowerCase()) ||
      awayTeam.toLowerCase().includes(t.name.toLowerCase().split(' ')[0])
    );

    // H2H από 2 σεζόν — τελευταίοι 5
    const allRows = [...rowsPrev, ...rowsCurrent];
    const h2h = (homeData && awayData)
      ? computeH2H(allRows, homeData.name, awayData.name)
      : [];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        league: leagueGr,
        season: currentSeason,
        totalTeams: standings.length,
        standings: standings.slice(0, 20),
        homeTeam: homeData || null,
        awayTeam: awayData || null,
        h2h,
        lastUpdated: new Date().toISOString(),
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
