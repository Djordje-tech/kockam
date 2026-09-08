--!strict
-- Every tunable number in Quarantine Zone lives here. Balancing is a pass over
-- this file and nothing else.

export type GeneratorTier = {
	Name: string,
	Cost: number,          -- supplies to reach this tier from the one below
	Rate: number,          -- supplies per minute
	Color: Color3,
	Height: number,        -- stud height of the pedestal model
}

-- Tier 0 is an empty slot. Buying tier 1 costs Tiers[1].Cost, and so on, so a
-- slot's total investment is the sum of every tier up to its level.
local tiers: { GeneratorTier } = {
	{ Name = "Scrap Pile",   Cost = 0,     Rate = 1,   Color = Color3.fromRGB(122, 118, 108), Height = 1.2 },
	{ Name = "Water Filter", Cost = 120,   Rate = 4,   Color = Color3.fromRGB(86, 132, 148),  Height = 2.0 },
	{ Name = "Ration Crate", Cost = 600,   Rate = 14,  Color = Color3.fromRGB(140, 118, 74),  Height = 2.6 },
	{ Name = "Generator",    Cost = 2800,  Rate = 46,  Color = Color3.fromRGB(168, 122, 52),  Height = 3.2 },
	{ Name = "Greenhouse",   Cost = 12000, Rate = 150, Color = Color3.fromRGB(92, 138, 82),   Height = 3.8 },
}

local Config = {
	--- Shelter ---------------------------------------------------------------
	SlotCount = 6,
	Tiers = tiers,

	--- Offline generation ----------------------------------------------------
	-- The cap is the retention mechanic: supplies stop accruing once the
	-- shelter is full, so the only way not to waste production is to come
	-- back. It is also the natural thing to sell more of later.
	OfflineCapMinutes = 8 * 60,
	-- Anything under this is not worth interrupting the player with.
	OfflineReportThreshold = 5,

	--- World -----------------------------------------------------------------
	PlotSize = Vector3.new(48, 1, 48),
	PlotSpacing = 64,
	PlotCount = 6,
	PlotOrigin = Vector3.new(0, 24, 0),

	--- Loop timing -----------------------------------------------------------
	-- How often live production is credited. Slower than a heartbeat on
	-- purpose: this is bookkeeping, not gameplay.
	TickInterval = 1,

	--- Persistence -----------------------------------------------------------
	DataStoreName = "QuarantineZone_v1",
	DataVersion = 1,
	AutosaveInterval = 120,
}

return Config
