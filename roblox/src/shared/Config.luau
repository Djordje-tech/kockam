--!strict
-- Every tunable number in the game lives here. Balancing happens in this file
-- and nowhere else, so a tuning pass never means touching gameplay code.

export type UpgradeDef = {
	DisplayName: string,
	BaseCost: number,
	CostGrowth: number,
	MaxLevel: number,
	EffectPerLevel: number,
}

-- Cost grows geometrically so the curve keeps its shape no matter how many
-- levels we add later.
local upgrades: { [string]: UpgradeDef } = {
	Multiplier = {
		DisplayName = "Coin Multiplier",
		BaseCost = 50,
		CostGrowth = 1.6,
		MaxLevel = 25,
		-- Level 0 pays 1x; each level adds 25%.
		EffectPerLevel = 0.25,
	},
	Magnet = {
		DisplayName = "Coin Magnet",
		BaseCost = 120,
		CostGrowth = 1.8,
		MaxLevel = 10,
		-- Studs of pickup range added per level.
		EffectPerLevel = 4,
	},
}

-- Passes are wired up but left at 0 until real asset ids exist. A 0 id means
-- "not configured" everywhere, so the game runs fine before any pass exists.
local gamePasses: { [string]: number } = {
	DoubleCoins = 0,
}

local Config = {
	-- How many coin orbs are alive at once, and how far they scatter.
	CoinCount = 25,
	CoinSpawnRadius = 120,
	CoinValue = 1,
	CoinRespawnDelay = 1.5,

	Upgrades = upgrades,

	GamePasses = gamePasses,
	DoubleCoinsMultiplier = 2,

	-- DataStore. Bump DataVersion whenever the saved shape changes.
	DataStoreName = "PlayerData",
	DataVersion = 1,
	AutosaveInterval = 120,
}

return Config
