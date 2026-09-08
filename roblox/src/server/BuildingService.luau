--!strict
-- Generates the buildings that make up the map's points of interest.
--
-- Built from code rather than imported models on purpose. An imported mesh is
-- an opaque blob: you cannot ask it which opening is a window, which room is
-- the pharmacy, or which door can be reinforced. Everything here is
-- addressable, which is what the loot and fortification systems need.
--
-- Naming and attributes are the interface. Windows are named "Window", doors
-- "Door", and every room carries a LootCategory attribute — later systems find
-- their work by looking for those, not by hard-coded coordinates.

local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Buildings = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Buildings"))

local BuildingService = {}

--- Construction constants ------------------------------------------------

local WALL_THICK = 1.2
local SLAB_THICK = 1.4

local SILL_HEIGHT = 4          -- floor to bottom of window
local WINDOW_HEIGHT = 6
local WINDOW_WIDTH = 7
local WINDOW_SPACING = 15
local WALL_MARGIN = 5          -- solid corner before the first window

local DOOR_WIDTH = 7
local CORRIDOR_WIDTH = 12
local ROOM_DEPTH = 16          -- along the corridor, per room

--- Placement constants ---------------------------------------------------

local HALF = 1536
local WATER_LEVEL = 0
local MAX_SITE_HEIGHT = 115
local MAX_SITE_SLOPE = 5
local PLACEMENT_ATTEMPTS = 300
local BUILDING_COUNT = 14

local PLATEAU_HALF_X = 265
local PLATEAU_HALF_Z = 120
local PLATEAU_MARGIN = 140

local PAD_OVERHANG = 10
local PAD_DEPTH = 24

--- Primitives ------------------------------------------------------------

local function block(
	parent: Instance,
	name: string,
	size: Vector3,
	position: Vector3,
	colour: Color3,
	material: Enum.Material
): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.Size = size
	p.Position = position
	p.Color = colour
	p.Material = material
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

-- Walls run along one axis. Passing that as a flag rather than a rotation
-- keeps every size and offset below readable as plain numbers.
local function axisSize(alongX: boolean, run: number, height: number): Vector3
	return if alongX then Vector3.new(run, height, WALL_THICK) else Vector3.new(WALL_THICK, height, run)
end

local function axisOffset(alongX: boolean, distance: number): Vector3
	return if alongX then Vector3.new(distance, 0, 0) else Vector3.new(0, 0, distance)
end

-- Openings are described as centres along the run; this turns them into the
-- solid spans between them.
local function spansBetween(run: number, openings: { { centre: number, width: number } }): { { from: number, to: number } }
	table.sort(openings, function(a, b)
		return a.centre < b.centre
	end)

	local spans = {}
	local cursor = -run / 2

	for _, opening in openings do
		local from = opening.centre - opening.width / 2
		if from > cursor then
			table.insert(spans, { from = cursor, to = from })
		end
		cursor = math.max(cursor, opening.centre + opening.width / 2)
	end

	if cursor < run / 2 then
		table.insert(spans, { from = cursor, to = run / 2 })
	end

	return spans
end

local function windowCentres(run: number): { number }
	local usable = run - WALL_MARGIN * 2
	if usable < WINDOW_WIDTH then
		return {}
	end

	local count = math.max(1, math.floor(usable / WINDOW_SPACING))
	local step = usable / count
	local centres = {}

	for index = 1, count do
		table.insert(centres, -usable / 2 + step * (index - 0.5))
	end

	return centres
end

--- Walls -----------------------------------------------------------------

-- An exterior wall: a solid band below the windows, another above them, and
-- piers between. The openings are real gaps, so they can be boarded up later.
local function exteriorWall(
	parent: Instance,
	kind: Buildings.BuildingKind,
	base: Vector3,
	run: number,
	alongX: boolean,
	rng: Random
)
	local height = kind.FloorHeight
	local upperHeight = height - SILL_HEIGHT - WINDOW_HEIGHT

	local function maybe(name: string, size: Vector3, position: Vector3)
		-- The ruin pass drops segments rather than damaging them: a missing
		-- wall reads as collapsed far better than a discoloured one.
		if rng:NextNumber() < kind.Ruin then
			return
		end
		block(parent, name, size, position, kind.WallColor, Enum.Material.Concrete)
	end

	maybe("Wall", axisSize(alongX, run, SILL_HEIGHT), base + Vector3.new(0, SILL_HEIGHT / 2, 0))

	if upperHeight > 0.5 then
		maybe(
			"Wall",
			axisSize(alongX, run, upperHeight),
			base + Vector3.new(0, SILL_HEIGHT + WINDOW_HEIGHT + upperHeight / 2, 0)
		)
	end

	local centres = windowCentres(run)
	local openings = {}
	for _, centre in centres do
		table.insert(openings, { centre = centre, width = WINDOW_WIDTH })
	end

	for _, span in spansBetween(run, openings) do
		local width = span.to - span.from
		if width > 0.2 then
			maybe(
				"Wall",
				axisSize(alongX, width, WINDOW_HEIGHT),
				base
					+ axisOffset(alongX, (span.from + span.to) / 2)
					+ Vector3.new(0, SILL_HEIGHT + WINDOW_HEIGHT / 2, 0)
			)
		end
	end

	-- A thin marker in each opening. Nothing collides with it; it exists so
	-- fortification can find the window and board it.
	for _, centre in centres do
		local marker = block(
			parent,
			"Window",
			axisSize(alongX, WINDOW_WIDTH, WINDOW_HEIGHT),
			base + axisOffset(alongX, centre) + Vector3.new(0, SILL_HEIGHT + WINDOW_HEIGHT / 2, 0),
			Color3.fromRGB(120, 150, 160),
			Enum.Material.Glass
		)
		marker.Transparency = 0.72
		marker.CanCollide = false
		CollectionService:AddTag(marker, "Boardable")
	end
end

-- An interior wall: full height, with doorways cut through it.
local function interiorWall(
	parent: Instance,
	kind: Buildings.BuildingKind,
	base: Vector3,
	run: number,
	alongX: boolean,
	doorCentres: { number }
)
	local openings = {}
	for _, centre in doorCentres do
		table.insert(openings, { centre = centre, width = DOOR_WIDTH })
	end

	for _, span in spansBetween(run, openings) do
		local width = span.to - span.from
		if width > 0.2 then
			block(
				parent,
				"Wall",
				axisSize(alongX, width, kind.FloorHeight),
				base + axisOffset(alongX, (span.from + span.to) / 2) + Vector3.new(0, kind.FloorHeight / 2, 0),
				kind.WallColor,
				Enum.Material.Plaster
			)
		end
	end

	for _, centre in doorCentres do
		local frame = block(
			parent,
			"Door",
			axisSize(alongX, DOOR_WIDTH, kind.FloorHeight - 9),
			base + axisOffset(alongX, centre) + Vector3.new(0, kind.FloorHeight - (kind.FloorHeight - 9) / 2, 0),
			kind.WallColor,
			Enum.Material.Plaster
		)
		frame.Name = "DoorHeader"

		local marker = block(
			parent,
			"Door",
			axisSize(alongX, DOOR_WIDTH, 9),
			base + axisOffset(alongX, centre) + Vector3.new(0, 4.5, 0),
			Color3.fromRGB(92, 74, 58),
			Enum.Material.WoodPlanks
		)
		marker.Transparency = 1
		marker.CanCollide = false
		CollectionService:AddTag(marker, "Reinforceable")
	end
end

--- Floors ----------------------------------------------------------------

-- Rooms are laid either side of a corridor running the long axis. Each gets a
-- marker carrying its loot category, which is how the loot system finds it.
local function buildInterior(
	parent: Instance,
	kind: Buildings.BuildingKind,
	origin: Vector3,
	level: number
)
	local width = kind.Footprint.X
	local depth = kind.Footprint.Y
	local corridorHalf = CORRIDOR_WIDTH / 2

	local roomDepth = (depth / 2) - corridorHalf
	if roomDepth < 8 then
		return
	end

	local roomCount = math.max(1, math.floor((width - 4) / ROOM_DEPTH))
	local roomWidth = (width - 4) / roomCount

	local doorCentres = {}
	for index = 1, roomCount do
		table.insert(doorCentres, -(width - 4) / 2 + roomWidth * (index - 0.5))
	end

	-- The two walls that line the corridor, each with a door per room.
	for _, side in { -1, 1 } do
		interiorWall(
			parent,
			kind,
			origin + Vector3.new(0, 0, side * corridorHalf),
			width - 4,
			true,
			doorCentres
		)
	end

	-- Partitions between neighbouring rooms.
	for index = 1, roomCount - 1 do
		local x = -(width - 4) / 2 + roomWidth * index
		for _, side in { -1, 1 } do
			interiorWall(
				parent,
				kind,
				origin + Vector3.new(x, 0, side * (corridorHalf + roomDepth / 2)),
				roomDepth,
				false,
				{}
			)
		end
	end

	-- One marker per room. Invisible, non-colliding, and the only thing the
	-- loot system needs in order to know what belongs here.
	for index = 1, roomCount do
		local x = -(width - 4) / 2 + roomWidth * (index - 0.5)

		for _, side in { -1, 1 } do
			local marker = Instance.new("Part")
			marker.Name = "Room"
			marker.Anchored = true
			marker.CanCollide = false
			marker.CanQuery = false
			marker.Transparency = 1
			marker.Size = Vector3.new(roomWidth - 2, 4, roomDepth - 2)
			marker.Position = origin
				+ Vector3.new(x, 2, side * (corridorHalf + roomDepth / 2))
			marker:SetAttribute("LootCategory", kind.RoomCategory)
			marker:SetAttribute("Level", level)
			marker.Parent = parent

			CollectionService:AddTag(marker, "LootRoom")
		end
	end
end

local function buildStairs(parent: Instance, kind: Buildings.BuildingKind, origin: Vector3)
	local steps = 12
	local rise = kind.FloorHeight / steps
	local run = 1.6

	-- Tucked into a corner of the corridor so it never blocks a doorway.
	local startX = kind.Footprint.X / 2 - 14

	for index = 1, steps do
		block(
			parent,
			"Step",
			Vector3.new(run, rise, CORRIDOR_WIDTH - 3),
			origin + Vector3.new(startX + index * run, rise * (index - 0.5), 0),
			kind.FloorColor,
			Enum.Material.Concrete
		)
	end
end

local function buildFloor(
	parent: Instance,
	kind: Buildings.BuildingKind,
	origin: Vector3,
	level: number,
	rng: Random
)
	local width = kind.Footprint.X
	local depth = kind.Footprint.Y

	block(
		parent,
		"Slab",
		Vector3.new(width, SLAB_THICK, depth),
		origin - Vector3.new(0, SLAB_THICK / 2, 0),
		kind.FloorColor,
		Enum.Material.Concrete
	)

	exteriorWall(parent, kind, origin + Vector3.new(0, 0, -depth / 2), width, true, rng)
	exteriorWall(parent, kind, origin + Vector3.new(0, 0, depth / 2), width, true, rng)
	exteriorWall(parent, kind, origin + Vector3.new(-width / 2, 0, 0), depth, false, rng)
	exteriorWall(parent, kind, origin + Vector3.new(width / 2, 0, 0), depth, false, rng)

	buildInterior(parent, kind, origin, level)

	if level < kind.Floors then
		buildStairs(parent, kind, origin)
	end
end

--- Assembly --------------------------------------------------------------

local function generate(kind: Buildings.BuildingKind, base: Vector3, rng: Random): Model
	local model = Instance.new("Model")
	model.Name = kind.Name

	for level = 1, kind.Floors do
		local origin = base + Vector3.new(0, (level - 1) * kind.FloorHeight, 0)
		buildFloor(model, kind, origin, level, rng)
	end

	local roofY = base.Y + kind.Floors * kind.FloorHeight
	block(
		model,
		"Roof",
		Vector3.new(kind.Footprint.X + 2, SLAB_THICK, kind.Footprint.Y + 2),
		Vector3.new(base.X, roofY, base.Z),
		kind.FloorColor,
		Enum.Material.Concrete
	)

	model:SetAttribute("Kind", kind.Name)
	model:SetAttribute("LootCategory", kind.RoomCategory)
	CollectionService:AddTag(model, "Building")

	return model
end

--- Placement -------------------------------------------------------------

local placed: { { position: Vector3, radius: number } } = {}

local function groundAt(x: number, z: number, ignore: { Instance }): RaycastResult?
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = ignore

	return Workspace:Raycast(Vector3.new(x, 500, z), Vector3.new(0, -900, 0), params)
end

local function levelGround(centre: Vector3, footprint: Vector2, height: number)
	local width = footprint.X + PAD_OVERHANG * 2
	local depth = footprint.Y + PAD_OVERHANG * 2

	Workspace.Terrain:FillBlock(
		CFrame.new(centre + Vector3.new(0, height / 2 + 2, 0)),
		Vector3.new(width, height + 4, depth),
		Enum.Material.Air
	)

	Workspace.Terrain:FillBlock(
		CFrame.new(centre - Vector3.new(0, PAD_DEPTH / 2, 0)),
		Vector3.new(width, PAD_DEPTH, depth),
		Enum.Material.Ground
	)
end

local function findSite(kind: Buildings.BuildingKind, ignore: { Instance }, rng: Random): Vector3?
	local radius = math.max(kind.Footprint.X, kind.Footprint.Y)

	for _ = 1, PLACEMENT_ATTEMPTS do
		local x = rng:NextNumber(-HALF + 260, HALF - 260)
		local z = rng:NextNumber(-HALF + 260, HALF - 260)

		if math.abs(x) < PLATEAU_HALF_X + PLATEAU_MARGIN
			and math.abs(z) < PLATEAU_HALF_Z + PLATEAU_MARGIN
		then
			continue
		end

		local tooClose = false
		for _, other in placed do
			if (other.position - Vector3.new(x, 0, z)).Magnitude < other.radius + radius then
				tooClose = true
				break
			end
		end
		if tooClose then
			continue
		end

		local hit = groundAt(x, z, ignore)
		if not hit then
			continue
		end

		local y = hit.Position.Y
		if y < WATER_LEVEL + 8 or y > MAX_SITE_HEIGHT then
			continue
		end

		-- Sample the corners. A building half-buried in a hillside looks
		-- worse than no building at all.
		local flat = true
		for _, corner in {
			Vector2.new(1, 1),
			Vector2.new(1, -1),
			Vector2.new(-1, 1),
			Vector2.new(-1, -1),
		} do
			local sample = groundAt(
				x + corner.X * kind.Footprint.X / 2,
				z + corner.Y * kind.Footprint.Y / 2,
				ignore
			)
			if not sample or math.abs(sample.Position.Y - y) > MAX_SITE_SLOPE then
				flat = false
				break
			end
		end

		if not flat then
			continue
		end

		table.insert(placed, { position = Vector3.new(x, 0, z), radius = radius })
		return Vector3.new(x, y, z)
	end

	return nil
end

function BuildingService.start()
	local parent = Instance.new("Folder")
	parent.Name = "Buildings"
	parent.Parent = Workspace

	local rng = Random.new(90210)
	local pool = Buildings.weightedList()

	local built = 0

	for _ = 1, BUILDING_COUNT do
		local kind = pool[rng:NextInteger(1, #pool)]

		local site = findSite(kind, { parent }, rng)
		if site then
			levelGround(site, kind.Footprint, kind.Floors * kind.FloorHeight)

			local model = generate(kind, site, rng)
			model.Parent = parent

			built += 1
		end

		task.wait()
	end

	print(`[QZ] buildings: {built} placed, {#CollectionService:GetTagged("LootRoom")} loot rooms`)
end

return BuildingService
