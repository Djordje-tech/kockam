--!strict
-- Shared upgrade maths. The server is the authority on purchases, but the
-- client needs the same cost curve to draw honest prices in the shop, so the
-- formulas live in one place both sides require.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local Upgrades = {}

-- Cost of moving from `level` to `level + 1`. Returns nil when maxed out.
function Upgrades.costOf(id: string, level: number): number?
	local def = Config.Upgrades[id]
	if not def then
		return nil
	end
	if level >= def.MaxLevel then
		return nil
	end

	return math.floor(def.BaseCost * def.CostGrowth ^ level)
end

function Upgrades.multiplierFor(level: number): number
	return 1 + level * Config.Upgrades.Multiplier.EffectPerLevel
end

function Upgrades.magnetRangeFor(level: number): number
	return level * Config.Upgrades.Magnet.EffectPerLevel
end

return Upgrades
