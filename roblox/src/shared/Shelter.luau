--!strict
-- Shared shelter maths. The server is the authority on every purchase, but the
-- client needs the same formulas to draw honest prices and rates, so they live
-- in one module both sides require.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local Shelter = {}

Shelter.MaxTier = #Config.Tiers

-- Cost of taking a slot from `level` to `level + 1`. Nil when already maxed.
function Shelter.upgradeCost(level: number): number?
	local nextLevel = level + 1
	if nextLevel > Shelter.MaxTier then
		return nil
	end

	return Config.Tiers[nextLevel].Cost
end

function Shelter.tierAt(level: number): Config.GeneratorTier?
	if level < 1 or level > Shelter.MaxTier then
		return nil
	end
	return Config.Tiers[level]
end

-- Supplies per minute produced by one slot at this level.
function Shelter.slotRate(level: number): number
	local tier = Shelter.tierAt(level)
	return if tier then tier.Rate else 0
end

-- Supplies per minute across a whole shelter.
function Shelter.totalRate(slots: { number }): number
	local total = 0
	for _, level in slots do
		total += Shelter.slotRate(level)
	end
	return total
end

-- What a shelter banked while the player was away. Capped, so production stops
-- once storage is full rather than paying out an unbounded amount.
function Shelter.offlineYield(slots: { number }, secondsAway: number): number
	local minutes = math.min(secondsAway / 60, Config.OfflineCapMinutes)
	if minutes <= 0 then
		return 0
	end

	return math.floor(Shelter.totalRate(slots) * minutes)
end

return Shelter
