--!strict
-- Builds the quarantined city the shelters sit inside.
--
-- The map is generated from a fixed seed rather than modelled by hand: it is
-- reviewable as code, it costs nothing in the place file, and re-rolling the
-- whole city is a one-number change. Everything is anchored and welded to
-- nothing, so it is static geometry as far as the engine is concerned.

local Workspace = game:GetService("Workspace")

local MapService = {}

local SEED = 20260908

--- Dimensions ------------------------------------------------------------

local GROUND_SIZE = 1200
local WALL_RADIUS = 560          -- half-width of the quarantine perimeter
local WALL_HEIGHT = 44

-- The shelters live here. Nothing else is allowed to spawn inside it.
local SAFE_HALF_X = 240
local SAFE_HALF_Z = 95

local BLOCK = 130                -- city grid pitch, so streets fall between
local BUILDING_MIN = 46
local BUILDING_MAX = 84

--- Palette ---------------------------------------------------------------

local ASPHALT = Color3.fromRGB(48, 48, 50)
local PLAZA = Color3.fromRGB(96, 93, 88)
local CONCRETE = { 
	Color3.fromRGB(122, 118, 110),
	Color3.fromRGB(104, 101, 96),
	Color3.fromRGB(88, 86, 82),
	Color3.fromRGB(134, 126, 114),
}
local RUST = Color3.fromRGB(122, 74, 48)
local WARNING = Color3.fromRGB(196, 158, 54)

local rng = Random.new(SEED)
local folder: Folder

--- Helpers ---------------------------------------------------------------

local function part(name: string, size: Vector3, position: Vector3, color: Color3, material: Enum.Material?): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.Size = size
	p.Position = position
	p.Color = color
	p.Material = material or Enum.Material.Concrete
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = folder
	return p
end

local function insideSafeZone(x: number, z: number, margin: number): boolean
	return math.abs(x) < SAFE_HALF_X + margin and math.abs(z) < SAFE_HALF_Z + margin
end

local function pick<T>(list: { T }): T
	return list[rng:NextInteger(1, #list)]
end

--- Pieces ----------------------------------------------------------------

local function buildGround()
	part("Ground", Vector3.new(GROUND_SIZE, 4, GROUND_SIZE), Vector3.new(0, -2, 0), ASPHALT, Enum.Material.Asphalt)

	-- The safe zone reads as a cleared plaza rather than more road.
	part(
		"Plaza",
		Vector3.new(SAFE_HALF_X * 2 + 40, 1, SAFE_HALF_Z * 2 + 40),
		Vector3.new(0, -0.5, 0),
		PLAZA,
		Enum.Material.Concrete
	)
end

local function buildPerimeter()
	-- Four slabs with a warning stripe along the top. This is the thing that
	-- makes the map read as *quarantined* rather than merely ruined.
	local spans = {
		{ size = Vector3.new(WALL_RADIUS * 2, WALL_HEIGHT, 8), pos = Vector3.new(0, WALL_HEIGHT / 2, -WALL_RADIUS) },
		{ size = Vector3.new(WALL_RADIUS * 2, WALL_HEIGHT, 8), pos = Vector3.new(0, WALL_HEIGHT / 2, WALL_RADIUS) },
		{ size = Vector3.new(8, WALL_HEIGHT, WALL_RADIUS * 2), pos = Vector3.new(-WALL_RADIUS, WALL_HEIGHT / 2, 0) },
		{ size = Vector3.new(8, WALL_HEIGHT, WALL_RADIUS * 2), pos = Vector3.new(WALL_RADIUS, WALL_HEIGHT / 2, 0) },
	}

	for index, span in spans do
		part("Wall" .. index, span.size, span.pos, Color3.fromRGB(78, 76, 72), Enum.Material.Concrete)

		local stripeSize = if span.size.X > span.size.Z
			then Vector3.new(span.size.X, 2, 9)
			else Vector3.new(9, 2, span.size.Z)

		part(
			"WallStripe" .. index,
			stripeSize,
			span.pos + Vector3.new(0, WALL_HEIGHT / 2, 0),
			WARNING,
			Enum.Material.Metal
		)
	end
end

local function buildTower(x: number, z: number)
	local width = rng:NextInteger(BUILDING_MIN, BUILDING_MAX)
	local depth = rng:NextInteger(BUILDING_MIN, BUILDING_MAX)

	-- Height falls off toward the walls, so the skyline reads as a city
	-- centre rather than a uniform field of boxes.
	local distance = math.sqrt(x * x + z * z) / WALL_RADIUS
	local ceiling = math.max(26, 150 * (1 - distance * 0.72))
	local height = rng:NextInteger(24, math.floor(ceiling))

	local tower = part(
		"Building",
		Vector3.new(width, height, depth),
		Vector3.new(x, height / 2, z),
		pick(CONCRETE),
		Enum.Material.Concrete
	)

	-- One in five is a burnt-out shell: same footprint, sheared top.
	if rng:NextNumber() < 0.2 then
		tower.Size = Vector3.new(width, height * 0.55, depth)
		tower.Position = Vector3.new(x, tower.Size.Y / 2, z)
		tower.Color = Color3.fromRGB(58, 54, 52)

		part(
			"Rubble",
			Vector3.new(width * 0.8, 5, depth * 0.8),
			Vector3.new(x, tower.Size.Y + 2, z),
			Color3.fromRGB(70, 66, 62),
			Enum.Material.Slate
		)
		return
	end

	-- A darker cap reads as a roof and breaks up the flat box silhouette.
	part(
		"Roof",
		Vector3.new(width + 2, 2, depth + 2),
		Vector3.new(x, height + 1, z),
		Color3.fromRGB(62, 60, 58),
		Enum.Material.Metal
	)
end

local function buildCity()
	local half = math.floor(WALL_RADIUS / BLOCK)

	for gx = -half, half do
		for gz = -half, half do
			-- Jitter keeps the grid from reading as a spreadsheet while the
			-- gaps between cells still behave like streets.
			local x = gx * BLOCK + rng:NextInteger(-14, 14)
			local z = gz * BLOCK + rng:NextInteger(-14, 14)

			if insideSafeZone(x, z, 60) then
				continue
			end
			if math.abs(x) > WALL_RADIUS - 60 or math.abs(z) > WALL_RADIUS - 60 then
				continue
			end
			-- Leave some lots empty so there are open sightlines to run down.
			if rng:NextNumber() < 0.18 then
				continue
			end

			buildTower(x, z)
		end
	end
end

local function buildProps()
	local CAR_COLORS = {
		Color3.fromRGB(92, 46, 42),
		Color3.fromRGB(52, 62, 74),
		Color3.fromRGB(78, 78, 74),
		Color3.fromRGB(64, 74, 58),
	}

	for index = 1, 90 do
		local x = rng:NextInteger(-WALL_RADIUS + 30, WALL_RADIUS - 30)
		local z = rng:NextInteger(-WALL_RADIUS + 30, WALL_RADIUS - 30)

		if insideSafeZone(x, z, 20) then
			continue
		end

		local roll = rng:NextNumber()

		if roll < 0.4 then
			-- Wrecked car: body plus cabin.
			local color = pick(CAR_COLORS)
			local rotated = rng:NextNumber() < 0.5
			local length, width = 14, 6
			if rotated then
				length, width = width, length
			end

			part("Car", Vector3.new(length, 4, width), Vector3.new(x, 2, z), color, Enum.Material.CorrodedMetal)
			part(
				"Cabin",
				Vector3.new(length * 0.5, 3, width * 0.8),
				Vector3.new(x, 5.5, z),
				Color3.fromRGB(40, 44, 48),
				Enum.Material.Glass
			)
		elseif roll < 0.65 then
			part("Barrel", Vector3.new(4, 6, 4), Vector3.new(x, 3, z), RUST, Enum.Material.CorrodedMetal)
		elseif roll < 0.85 then
			part(
				"Debris",
				Vector3.new(rng:NextInteger(8, 20), rng:NextInteger(2, 5), rng:NextInteger(8, 20)),
				Vector3.new(x, 1.5, z),
				Color3.fromRGB(74, 70, 66),
				Enum.Material.Slate
			)
		else
			-- Barricade: the only prop that is deliberately readable from far
			-- away, so it doubles as a landmark.
			part("Barricade", Vector3.new(18, 5, 3), Vector3.new(x, 2.5, z), WARNING, Enum.Material.Metal)
		end
	end
end

local function buildLights()
	-- Few and deliberate: every PointLight costs, and a handful of sodium
	-- pools does more for the mood than an evenly lit street ever would.
	local positions = {
		Vector3.new(-SAFE_HALF_X - 24, 0, -SAFE_HALF_Z - 24),
		Vector3.new(-SAFE_HALF_X - 24, 0, SAFE_HALF_Z + 24),
		Vector3.new(SAFE_HALF_X + 24, 0, -SAFE_HALF_Z - 24),
		Vector3.new(SAFE_HALF_X + 24, 0, SAFE_HALF_Z + 24),
		Vector3.new(0, 0, -SAFE_HALF_Z - 24),
		Vector3.new(0, 0, SAFE_HALF_Z + 24),
	}

	for index, base in positions do
		part("LampPost" .. index, Vector3.new(1.5, 26, 1.5), base + Vector3.new(0, 13, 0), Color3.fromRGB(52, 50, 48), Enum.Material.Metal)

		local head = part(
			"Lamp" .. index,
			Vector3.new(4, 1.5, 4),
			base + Vector3.new(0, 26, 0),
			Color3.fromRGB(255, 214, 148),
			Enum.Material.Neon
		)

		local light = Instance.new("PointLight")
		light.Color = Color3.fromRGB(255, 198, 122)
		light.Brightness = 3
		light.Range = 52
		light.Parent = head
	end
end

--- Public ----------------------------------------------------------------

function MapService.start()
	-- The default template's baseplate and spawn would z-fight the map and
	-- drop players in the wrong place. The map replaces both.
	for _, name in { "Baseplate", "SpawnLocation" } do
		local existing = Workspace:FindFirstChild(name)
		if existing then
			existing:Destroy()
		end
	end

	folder = Instance.new("Folder")
	folder.Name = "Map"
	folder.Parent = Workspace

	buildGround()
	buildPerimeter()
	buildCity()
	buildProps()
	buildLights()

	print(`[Quarantine Zone] map built: {#folder:GetChildren()} parts`)
end

return MapService
