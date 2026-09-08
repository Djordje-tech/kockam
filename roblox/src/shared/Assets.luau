--!strict
-- Asset IDs for imported models, by category.
--
-- This file is the entire interface for getting real 3D models into the
-- world. A mesh cannot be uploaded from here — that needs a Roblox account —
-- but once something is on the Creator Store it has an id, and an id is all
-- the code needs.
--
-- To add one: find the model in the Toolbox, right-click it, "Copy Asset ID",
-- and paste the number into the right list. Everything else is automatic;
-- anything left empty falls back to the procedural version.

local Assets = {}

Assets.Categories = {
	-- Trees replace the procedural branch-and-blob ones entirely.
	Trees = {} :: { number },

	-- Rocks, logs and ferns scattered as ground cover.
	Clutter = {} :: { number },

	-- Whole buildings, placed the same way the generated ones are.
	Buildings = {} :: { number },

	-- Car bodies. These get rigged with wheels, a seat and an engine, so any
	-- model roughly the shape of a vehicle becomes drivable.
	Vehicles = {} :: { number },
}

-- How much to scale loaded models, per category. Creator Store assets come in
-- wildly inconsistent sizes, so this is almost always worth tuning once.
Assets.Scale = {
	Trees = 1,
	Clutter = 1,
	Buildings = 1,
	Vehicles = 1,
}

function Assets.has(category: string): boolean
	local list = Assets.Categories[category]
	return list ~= nil and #list > 0
end

return Assets
