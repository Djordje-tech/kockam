--!strict
-- What each kind of building is. Dimensions, materials and the loot category
-- its rooms carry.
--
-- Loot categories are declared here rather than in the loot system so a
-- building and the things found inside it can never drift apart.

export type BuildingKind = {
	Name: string,
	Footprint: Vector2,       -- studs, X by Z
	Floors: number,
	FloorHeight: number,
	WallColor: Color3,
	FloorColor: Color3,
	RoomCategory: string,     -- what the POI loot system spawns in here
	Ruin: number,             -- 0-1, share of wall segments left missing
	Weight: number,           -- relative frequency across the map
}

local Buildings = {}

Buildings.Kinds = {
	Hospital = {
		Name = "Hospital",
		Footprint = Vector2.new(96, 64),
		Floors = 3,
		FloorHeight = 16,
		WallColor = Color3.fromRGB(198, 200, 196),
		FloorColor = Color3.fromRGB(150, 152, 150),
		RoomCategory = "Medical",
		Ruin = 0.16,
		Weight = 1,
	},
	Supermarket = {
		Name = "Supermarket",
		Footprint = Vector2.new(88, 56),
		Floors = 1,
		FloorHeight = 20,
		WallColor = Color3.fromRGB(186, 176, 158),
		FloorColor = Color3.fromRGB(140, 136, 130),
		RoomCategory = "Food",
		Ruin = 0.2,
		Weight = 2,
	},
	MilitaryOutpost = {
		Name = "Military Outpost",
		Footprint = Vector2.new(64, 48),
		Floors = 2,
		FloorHeight = 14,
		WallColor = Color3.fromRGB(104, 110, 92),
		FloorColor = Color3.fromRGB(84, 88, 78),
		RoomCategory = "Military",
		Ruin = 0.24,
		Weight = 1,
	},
	Farmhouse = {
		Name = "Farmhouse",
		Footprint = Vector2.new(48, 40),
		Floors = 2,
		FloorHeight = 13,
		WallColor = Color3.fromRGB(168, 142, 116),
		FloorColor = Color3.fromRGB(122, 100, 78),
		RoomCategory = "Rural",
		Ruin = 0.28,
		Weight = 2,
	},
	House = {
		Name = "House",
		Footprint = Vector2.new(38, 32),
		Floors = 2,
		FloorHeight = 12,
		WallColor = Color3.fromRGB(176, 168, 152),
		FloorColor = Color3.fromRGB(120, 114, 104),
		RoomCategory = "Residential",
		Ruin = 0.32,
		Weight = 4,
	},
} :: { [string]: BuildingKind }

-- Flattened into a weighted list once, so placement can pick without walking
-- the table every time.
function Buildings.weightedList(): { BuildingKind }
	local list = {}
	for _, kind in Buildings.Kinds do
		for _ = 1, kind.Weight do
			table.insert(list, kind)
		end
	end
	return list
end

return Buildings
