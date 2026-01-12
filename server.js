const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.use(express.static("public"));

const APISPORTS_KEY = process.env.APISPORTS_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

const TEAM_ALIASES = {
  "la clippers": "los angeles clippers",
  "los angeles clippers": "los angeles clippers",
  "la lakers": "los angeles lakers",
  "los angeles lakers": "los angeles lakers",
  "new york knicks": "new york knicks",
  "ny knicks": "new york knicks",
  "oklahoma city thunder": "oklahoma city thunder",
  "okc thunder": "oklahoma city thunder",
  "phoenix suns": "phoenix suns",
  "brooklyn nets": "brooklyn nets",
  "new orleans pelicans": "new orleans pelicans",
  "n.o. pelicans": "new orleans pelicans",
  "san antonio spurs": "san antonio spurs",
  "golden state warriors": "golden state warriors",
  "gs warriors": "golden state warriors",
  "utah jazz": "utah jazz",
  "washington wizards": "washington wizards",
  "portland trail blazers": "portland trail blazers",
  "portland blazers": "portland trail blazers",
  "minnesota timberwolves": "minnesota timberwolves",
  "minnesota wolves": "minnesota timberwolves",
  "philadelphia 76ers": "philadelphia 76ers",
  "phoenix suns": "phoenix suns",
  "sacramento kings": "sacramento kings",
  "dallas mavericks": "dallas mavericks",
  "houston rockets": "houston rockets",
  "indiana pacers": "indiana pacers",
  "orlando magic": "orlando magic",
  "chicago bulls": "chicago bulls",
  "cleveland cavaliers": "cleveland cavaliers",
  "detroit pistons": "detroit pistons",
  "milwaukee bucks": "milwaukee bucks",
  "boston celtics": "boston celtics",
  "miami heat": "miami heat",
  "memphis grizzlies": "memphis grizzlies",
  "toronto raptors": "toronto raptors",
  "denver nuggets": "denver nuggets",
  "charlotte hornets": "charlotte hornets",
  "atlanta hawks": "atlanta hawks"
};

function normalizeTeamName(name) {
  if (!name) return "";
  const cleaned = name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  return TEAM_ALIASES[cleaned] || cleaned;
}

function sumPeriodScores(scoreObj) {
  if (!scoreObj || typeof scoreObj !== "object") return null;
  const periodKeys = [
    "quarter_1",
    "quarter_2",
    "quarter_3",
    "quarter_4",
    "overtime",
    "ot",
    "period_1",
    "period_2",
    "period_3",
    "period_4"
  ];
  let total = 0;
  let found = false;
  for (const key of periodKeys) {
    const value = scoreObj[key];
    if (typeof value === "number") {
      total += value;
      found = true;
    }
  }
  if (!found) return null;
  return total;
}

function extractScoreTotals(game) {
  const home = game?.scores?.home || {};
  const away = game?.scores?.away || {};
  const homeTotal = typeof home.total === "number" ? home.total : null;
  const awayTotal = typeof away.total === "number" ? away.total : null;

  if (homeTotal !== null && awayTotal !== null) {
    return { home: homeTotal, away: awayTotal, isEstimated: false };
  }

  const homeFallback = sumPeriodScores(home);
  const awayFallback = sumPeriodScores(away);

  if (homeFallback !== null && awayFallback !== null) {
    return { home: homeFallback, away: awayFallback, isEstimated: true };
  }

  return { home: null, away: null, isEstimated: false };
}

async function fetchApiSportsGames() {
  if (!APISPORTS_KEY) {
    return [];
  }
  const response = await fetch("https://v1.basketball.api-sports.io/games?live=all", {
    headers: {
      "x-apisports-key": APISPORTS_KEY
    }
  });
  if (!response.ok) {
    throw new Error(`API-Sports error: ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data.response) ? data.response : [];
}

async function fetchOdds() {
  if (!ODDS_API_KEY) {
    return [];
  }
  const url = new URL("https://api.the-odds-api.com/v4/sports/basketball_nba/odds");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("regions", "us");
  url.searchParams.set("apiKey", ODDS_API_KEY);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Odds API error: ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function buildOddsIndex(oddsGames) {
  const index = new Map();
  for (const game of oddsGames) {
    if (!Array.isArray(game?.teams) || game.teams.length !== 2) continue;
    const [teamA, teamB] = game.teams;
    const homeTeam = game.home_team;
    const awayTeam = teamA === homeTeam ? teamB : teamA;

    const key = `${normalizeTeamName(awayTeam)}@${normalizeTeamName(homeTeam)}`;
    index.set(key, game);
  }
  return index;
}

function extractMoneyline(game) {
  const market = game?.bookmakers?.[0]?.markets?.find((item) => item.key === "h2h");
  if (!market) return { away: null, home: null };
  const outcomes = market.outcomes || [];
  const awayTeam = game.teams.find((team) => team !== game.home_team);
  const homeTeam = game.home_team;
  const awayOutcome = outcomes.find((outcome) => outcome.name === awayTeam);
  const homeOutcome = outcomes.find((outcome) => outcome.name === homeTeam);
  return {
    away: awayOutcome ? awayOutcome.price : null,
    home: homeOutcome ? homeOutcome.price : null
  };
}

app.get("/api/board", async (req, res) => {
  try {
    const [apiSportsGames, oddsGames] = await Promise.all([
      fetchApiSportsGames(),
      fetchOdds()
    ]);

    const oddsIndex = buildOddsIndex(oddsGames);

    const merged = apiSportsGames.map((game) => {
      const awayName = game?.teams?.away?.name || "";
      const homeName = game?.teams?.home?.name || "";
      const key = `${normalizeTeamName(awayName)}@${normalizeTeamName(homeName)}`;
      const oddsGame = oddsIndex.get(key);
      const moneyline = oddsGame ? extractMoneyline(oddsGame) : { away: null, home: null };
      const scoreTotals = extractScoreTotals(game);

      const status = game?.status?.long || "";
      const scoreLabel = scoreTotals.home === null || scoreTotals.away === null
        ? "Score unavailable"
        : scoreTotals.isEstimated
          ? "Estimated"
          : "Live";

      return {
        id: game?.id,
        awayTeam: awayName,
        homeTeam: homeName,
        score: {
          away: scoreTotals.away,
          home: scoreTotals.home,
          label: scoreLabel
        },
        status,
        moneyline
      };
    });

    res.json({
      generatedAt: new Date().toISOString(),
      games: merged
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to load board",
      message: error.message
    });
  }
});

app.get("/", (req, res) => {
  res.render("index");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
