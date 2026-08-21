import { LOCATIONS } from "./locations.js";

// Purely cosmetic simulated activity so the live feed feels like a busy
// casino floor even with few real players connected. Never touches real
// balances or the database.
const BOT_NAMES = [
  "ShadowFox", "LuckyDraga", "PixelNomad", "BalkanWolf", "NeonRider",
  "MapMaverick", "SkyHunter77", "GoldenCompass", "MidnightAtlas", "RapidRaven",
  "VelvetViper", "TurboTraveler", "CrimsonCartographer", "SilentSultan", "AceOfMaps",
  "BlazeRunner", "IronNomad", "StormChaser99", "GlobeTrotterX", "EchoWanderer",
];

function randomBotName() {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + Math.floor(Math.random() * 900 + 100);
}

function randomBotEvent() {
  const location = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
  const bet = [50, 100, 250, 500, 1000, 2500][Math.floor(Math.random() * 6)];
  const roll = Math.random();
  let result, multiplier;
  if (roll < 0.12) { result = "JACKPOT"; multiplier = 5; }
  else if (roll < 0.35) { result = "WIN"; multiplier = 2.5; }
  else if (roll < 0.55) { result = "WIN"; multiplier = 1.2; }
  else if (roll < 0.72) { result = "PUSH"; multiplier = 0.5; }
  else { result = "BUST"; multiplier = 0; }

  return {
    id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    username: randomBotName(),
    bot: true,
    locationName: location.name,
    country: location.country,
    betAmount: bet,
    payout: Math.round(bet * multiplier),
    result,
    multiplier,
    at: new Date().toISOString(),
  };
}

export function startLiveFeed(io) {
  const timer = setInterval(() => {
    io.emit("live-feed", randomBotEvent());
  }, 2600 + Math.random() * 2000);
  return () => clearInterval(timer);
}
