--!strict
-- Generates the landmass: mountain ranges, forest biomes, lakes, rivers, and
-- the road, track and rail network cut across them.
--
-- Written as voxels from layered noise rather than sculpted by hand, so the
-- entire world stays in a diff, costs nothing in the place file, and re-rolls
-- from a single seed.
--
-- Order matters and is load-bearing: terrain, then roads, then forest. Trees
-- are planted by raycast and only take on soil, so carving roads first means
-- nothing has to remember to keep the carriageway clear — it is clear because
-- asphalt is not soil.

local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")

local WorldService = {}

local SEED = 1337

--- Extent ----------------------------------------------------------------

local RES = 4                    -- Roblox voxel size, in studs
local HALF = 2560                -- map extends +/- this: 5120 studs across
local CHUNK = 128                -- studs per WriteVoxels call

local FLOOR_Y = -90
local CEILING_Y = 380
local WATER_LEVEL = 0

-- Land sits well above the waterline by default. This is a continent with
-- lakes in it, not an island in an ocean — you should never have to swim to
-- reach the rest of the map.
local BASE_ELEVATION = 52

local SNOW_LINE = 235
local ROCK_LINE = 150
local SHORE_BAND = 5

--- Water -----------------------------------------------------------------

local RIVER_WIDTH = 70
local RIVER_DEPTH = 46
local LAKE_DEPTH = 40

--- Spawn clearing --------------------------------------------------------

local CLEARING_Y = 58
local CLEARING_RADIUS = 130
local CLEARING_BLEND = 220

--- Noise helpers ---------------------------------------------------------

local function smoothstep(edge0: number, edge1: number, x: number): number
	local t = math.clamp((x - edge0) / (edge1 - edge0), 0, 1)
	return t * t * (3 - 2 * t)
end

local function noise2(x: number, z: number, scale: number, offset: number): number
	return math.noise(x / scale + offset, z / scale + offset)
end

-- Ridged noise reads as mountain ranges rather than rolling dunes: the
-- absolute value puts a crease along every zero crossing.
local function ridge(x: number, z: number, scale: number, offset: number): number
	return 1 - math.abs(noise2(x, z, scale, offset)) * 2
end

--- Height field ----------------------------------------------------------

local function riverCentre(z: number, channel: number): number
	return noise2(0, z, 1400, SEED + channel * 37) * 1700 + channel * 1500
end

-- Where mountains are allowed to exist at all, so ranges are localised
-- instead of the whole map being lumpy.
local function mountainMask(x: number, z: number): number
	return smoothstep(0.02, 0.34, noise2(x, z, 2600, SEED + 11))
end

-- Where the ground dips below the waterline into a lake basin.
local function lakeMask(x: number, z: number): number
	return smoothstep(0.16, 0.4, noise2(x, z, 1100, SEED + 91))
end

local function terrainHeight(x: number, z: number): number
	local height = BASE_ELEVATION

	-- Rolling ground everywhere.
	height += noise2(x, z, 900, SEED) * 70
	height += noise2(x, z, 300, SEED + 3) * 24
	height += noise2(x, z, 90, SEED + 7) * 7

	-- Ranges, only where the mask allows them.
	height += ridge(x, z, 1500, SEED + 21) * 250 * mountainMask(x, z)

	-- Lake basins.
	height -= lakeMask(x, z) * LAKE_DEPTH

	-- Rivers cut below the waterline, so they fill themselves.
	for channel = -1, 1 do
		local offset = math.abs(x - riverCentre(z, channel))
		height -= (1 - smoothstep(RIVER_WIDTH * 0.3, RIVER_WIDTH, offset)) * RIVER_DEPTH
	end

	-- Only the extreme edge falls away, purely so the map does not end in a
	-- vertical wall. Everything inside it is walkable land.
	local distance = math.max(math.abs(x), math.abs(z)) / HALF
	height -= smoothstep(0.93, 1.0, distance) * 220

	-- A flat clearing to spawn into, ramped out so it is not a cut-out box.
	local fromCentre = math.sqrt(x * x + z * z)
	local flatness = 1 - smoothstep(CLEARING_RADIUS, CLEARING_BLEND, fromCentre)
	height = height * (1 - flatness) + CLEARING_Y * flatness

	return height
end

local function surfaceMaterial(height: number, slope: number): Enum.Material
	if height > SNOW_LINE then
		return Enum.Material.Snow
	end
	if height > ROCK_LINE or slope > 0.95 then
		return Enum.Material.Rock
	end
	if height < WATER_LEVEL + SHORE_BAND then
		return Enum.Material.Sand
	end
	if slope > 0.6 then
		return Enum.Material.Ground
	end
	return Enum.Material.Grass
end

--- Voxel writing ---------------------------------------------------------

local function snapDown(value: number): number
	return math.floor(value / RES) * RES
end

local function snapUp(value: number): number
	return math.ceil(value / RES) * RES
end

local function writeChunk(originX: number, originZ: number): boolean
	local columns = CHUNK // RES

	-- Height is per column, so it is sampled once per (x, z) instead of once
	-- per voxel. That is the difference between seconds and minutes.
	local heights = table.create(columns)
	local slopes = table.create(columns)

	local minHeight, maxHeight = math.huge, -math.huge

	for ix = 1, columns do
		local wx = originX + (ix - 0.5) * RES
		local columnHeights = table.create(columns)
		local columnSlopes = table.create(columns)

		for iz = 1, columns do
			local wz = originZ + (iz - 0.5) * RES
			local here = terrainHeight(wx, wz)

			local dx = terrainHeight(wx + RES, wz) - terrainHeight(wx - RES, wz)
			local dz = terrainHeight(wx, wz + RES) - terrainHeight(wx, wz - RES)

			columnHeights[iz] = here
			columnSlopes[iz] = math.sqrt(dx * dx + dz * dz) / (2 * RES)

			minHeight = math.min(minHeight, here)
			maxHeight = math.max(maxHeight, here)
		end

		heights[ix] = columnHeights
		slopes[ix] = columnSlopes
	end

	-- Only write the band this chunk occupies. Most of the map is nowhere
	-- near the mountains, and writing empty air above every meadow is what
	-- makes a map this size impossible.
	local lowY = math.max(FLOOR_Y, snapDown(math.min(minHeight, WATER_LEVEL) - 12))
	local highY = math.min(CEILING_Y, snapUp(math.max(maxHeight, WATER_LEVEL) + 8))

	if highY <= lowY then
		return true
	end

	local region = Region3.new(
		Vector3.new(originX, lowY, originZ),
		Vector3.new(originX + CHUNK, highY, originZ + CHUNK)
	):ExpandToGrid(RES)

	local size = region.Size
	local corner = region.CFrame.Position - size / 2

	-- round, not floor: a size landing a hair under a multiple of RES would
	-- truncate and hand WriteVoxels arrays one column short, which it rejects.
	local nx = math.round(size.X / RES)
	local ny = math.round(size.Y / RES)
	local nz = math.round(size.Z / RES)

	local materials = table.create(nx)
	local occupancies = table.create(nx)

	for ix = 1, nx do
		local matColumn = table.create(ny)
		local occColumn = table.create(ny)

		for iy = 1, ny do
			local wy = corner.Y + (iy - 0.5) * RES
			local matRow = table.create(nz)
			local occRow = table.create(nz)

			for iz = 1, nz do
				local height = heights[ix][iz]
				local fill = math.clamp((height - wy) / RES + 0.5, 0, 1)

				if fill > 0 then
					matRow[iz] = surfaceMaterial(height, slopes[ix][iz])
					occRow[iz] = fill
				elseif wy < WATER_LEVEL then
					matRow[iz] = Enum.Material.Water
					occRow[iz] = 1
				else
					matRow[iz] = Enum.Material.Air
					occRow[iz] = 0
				end
			end

			matColumn[iy] = matRow
			occColumn[iy] = occRow
		end

		materials[ix] = matColumn
		occupancies[ix] = occColumn
	end

	local ok, err = pcall(function()
		Workspace.Terrain:WriteVoxels(region, RES, materials, occupancies)
	end)

	if not ok then
		warn(`[WorldService] WriteVoxels failed at ({originX}, {originZ}): {err}`)
		return false
	end

	return true
end

local function buildTerrain()
	Workspace.Terrain:Clear()

	local written, failed = 0, 0
	local rows, totalRows = 0, (2 * HALF) // CHUNK

	for x = -HALF, HALF - CHUNK, CHUNK do
		for z = -HALF, HALF - CHUNK, CHUNK do
			if writeChunk(x, z) then
				written += 1
			else
				failed += 1
			end
		end

		rows += 1
		task.wait()

		if rows % 8 == 0 then
			print(`[QZ] terrain {math.floor(rows / totalRows * 100)}%`)
		end
	end

	print(`[QZ] terrain: {written} chunks written, {failed} failed`)
end

--- Routes ----------------------------------------------------------------

-- A route is stamped by walking it in short steps and cutting a flat ribbon
-- of the given material. Heights are smoothed along the way first, so a road
-- climbs a hill on a gradient instead of tracing every bump in it.
local function smoothedHeights(points: { Vector3 }, window: number): { number }
	local raw = table.create(#points)
	for index, point in points do
		raw[index] = terrainHeight(point.X, point.Z)
	end

	local out = table.create(#points)
	for index = 1, #points do
		local total, count = 0, 0
		for offset = -window, window do
			local sample = raw[index + offset]
			if sample then
				total += sample
				count += 1
			end
		end
		out[index] = total / count
	end

	return out
end

local function stampRoute(points: { Vector3 }, width: number, material: Enum.Material, cutHeight: number)
	local heights = smoothedHeights(points, 6)

	for index = 1, #points - 1 do
		local from = Vector3.new(points[index].X, heights[index], points[index].Z)
		local to = Vector3.new(points[index + 1].X, heights[index + 1], points[index + 1].Z)

		local delta = to - from
		local length = delta.Magnitude
		if length < 0.1 then
			continue
		end

		local centre = (from + to) / 2
		local frame = CFrame.lookAt(centre, centre + delta.Unit)

		-- Clear whatever is standing in the way, then lay the surface.
		Workspace.Terrain:FillBlock(
			frame + Vector3.new(0, cutHeight / 2, 0),
			Vector3.new(width, cutHeight, length + 2),
			Enum.Material.Air
		)
		Workspace.Terrain:FillBlock(
			frame - Vector3.new(0, 2, 0),
			Vector3.new(width, 8, length + 2),
			material
		)
	end
end

-- A wandering line between two edges of the map. Waypoints are pushed around
-- by noise so routes curve like they were surveyed, not drawn with a ruler.
local function route(startPoint: Vector2, endPoint: Vector2, wander: number, seed: number): { Vector3 }
	local points = {}
	local steps = math.floor((endPoint - startPoint).Magnitude / 24)

	for index = 0, steps do
		local t = index / steps
		local base = startPoint:Lerp(endPoint, t)

		-- Perpendicular offset, tapering to zero at both ends so the route
		-- still meets the points it was asked to connect.
		local direction = (endPoint - startPoint).Unit
		local normal = Vector2.new(-direction.Y, direction.X)
		local swing = math.noise(t * 3 + seed, seed * 0.7) * wander * math.sin(t * math.pi)

		local offset = base + normal * swing
		table.insert(points, Vector3.new(offset.X, 0, offset.Y))
	end

	return points
end

local function buildRoads()
	local edge = HALF - 60

	-- Two highways crossing the map, then dirt tracks branching off them.
	stampRoute(route(Vector2.new(-edge, -900), Vector2.new(edge, 700), 620, SEED + 1), 34, Enum.Material.Asphalt, 40)
	stampRoute(route(Vector2.new(500, -edge), Vector2.new(-300, edge), 700, SEED + 2), 34, Enum.Material.Asphalt, 40)

	local tracks = {
		{ Vector2.new(-edge, 1400), Vector2.new(900, edge) },
		{ Vector2.new(edge, -1500), Vector2.new(-1200, -edge) },
		{ Vector2.new(-1800, -edge), Vector2.new(1900, edge) },
		{ Vector2.new(edge, 1900), Vector2.new(-edge, -400) },
	}

	for index, pair in tracks do
		stampRoute(route(pair[1], pair[2], 480, SEED + 10 + index), 16, Enum.Material.Ground, 30)
		task.wait()
	end

	print("[QZ] roads: 2 highways, 4 dirt tracks")
end

local function buildRailway()
	local edge = HALF - 60
	local points = route(Vector2.new(-edge, 2100), Vector2.new(edge, -2100), 400, SEED + 50)

	stampRoute(points, 26, Enum.Material.Slate, 34)

	local folder = Instance.new("Folder")
	folder.Name = "Railway"
	folder.Parent = Workspace

	local heights = smoothedHeights(points, 6)

	-- Sleepers and a pair of rails. Placed sparsely: this is scenery and a
	-- navigation landmark, not track that needs to carry a train.
	for index = 1, #points - 1, 2 do
		local at = Vector3.new(points[index].X, heights[index] + 0.6, points[index].Z)
		local next = Vector3.new(points[index + 1].X, heights[index + 1], points[index + 1].Z)
		local frame = CFrame.lookAt(at, next)

		local sleeper = Instance.new("Part")
		sleeper.Name = "Sleeper"
		sleeper.Anchored = true
		sleeper.Size = Vector3.new(14, 1, 3)
		sleeper.CFrame = frame
		sleeper.Color = Color3.fromRGB(74, 58, 46)
		sleeper.Material = Enum.Material.WoodPlanks
		sleeper.Parent = folder

		for _, side in { -5, 5 } do
			local rail = Instance.new("Part")
			rail.Name = "Rail"
			rail.Anchored = true
			rail.Size = Vector3.new(0.9, 1.1, 48)
			rail.CFrame = frame * CFrame.new(side, 0.9, 0)
			rail.Color = Color3.fromRGB(96, 84, 74)
			rail.Material = Enum.Material.CorrodedMetal
			rail.Parent = folder
		end
	end

	print(`[QZ] railway: {#points} segments`)
end

--- Forest ----------------------------------------------------------------

local CANOPY_GREENS = {
	Color3.fromRGB(104, 158, 68),
	Color3.fromRGB(126, 176, 76),
	Color3.fromRGB(86, 140, 62),
	Color3.fromRGB(142, 186, 88),
	Color3.fromRGB(74, 124, 58),
}

local AUTUMN = {
	Color3.fromRGB(214, 168, 62),
	Color3.fromRGB(198, 134, 54),
	Color3.fromRGB(224, 190, 84),
}

-- Forest is a biome, not a scatter. Where this is high the woods are dense
-- enough to lose someone in; where it is low you get meadow and sightlines.
local function forestDensity(x: number, z: number): number
	return smoothstep(-0.12, 0.26, noise2(x, z, 1300, SEED + 60))
end

local function ball(parent: Instance, position: Vector3, diameter: number, colour: Color3, squash: number)
	local blob = Instance.new("Part")
	blob.Anchored = true
	blob.CanCollide = false
	blob.CanQuery = false
	blob.Shape = Enum.PartType.Ball
	blob.Size = Vector3.new(diameter, diameter * squash, diameter)
	blob.Position = position
	blob.Color = colour
	blob.Material = Enum.Material.Grass
	blob.Parent = parent
end

local function plantTree(rng: Random, base: Vector3, parent: Instance)
	local autumn = rng:NextNumber() < 0.12
	local palette = if autumn then AUTUMN else CANOPY_GREENS
	local tint = palette[rng:NextInteger(1, #palette)]

	local tall = rng:NextNumber() < 0.34
	local height = if tall then rng:NextNumber(38, 60) else rng:NextNumber(22, 36)
	local trunkWidth = height * 0.085

	local trunk = Instance.new("Part")
	trunk.Name = "Trunk"
	trunk.Anchored = true
	trunk.Shape = Enum.PartType.Cylinder
	trunk.Size = Vector3.new(height, trunkWidth, trunkWidth)
	-- A cylinder's length runs along X, so it has to be stood upright.
	trunk.CFrame = CFrame.new(base + Vector3.new(0, height * 0.45, 0)) * CFrame.Angles(0, 0, math.pi / 2)
	trunk.Color = Color3.fromRGB(92, 68, 48)
	trunk.Material = Enum.Material.Wood
	trunk.Parent = parent

	-- Overlapping blobs. The overlap is the whole trick: separate spheres read
	-- as balls on a stick, merged ones read as a canopy.
	local layers = rng:NextInteger(3, 4)
	local spread = height * (if tall then 0.46 else 0.76)

	for layer = 1, layers do
		local t = (layer - 1) / layers
		ball(
			parent,
			base + Vector3.new(
				rng:NextNumber(-spread, spread) * 0.15,
				height * (0.64 + t * 0.32),
				rng:NextNumber(-spread, spread) * 0.15
			),
			spread * (1 - t * 0.4),
			tint:Lerp(Color3.new(1, 1, 1), t * 0.15),
			if tall then 1.2 else 0.82
		)
	end
end

local function buildForest()
	local rng = Random.new(SEED)

	local forest = Instance.new("Folder")
	forest.Name = "Forest"
	forest.Parent = Workspace

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { forest }

	local trees = 0
	local attempts = 0

	while trees < 3200 and attempts < 42000 do
		attempts += 1

		local x = rng:NextNumber(-HALF + 80, HALF - 80)
		local z = rng:NextNumber(-HALF + 80, HALF - 80)

		-- Biome first: it is the cheapest test, and it rejects most of the
		-- map before any raycast is spent on it.
		if rng:NextNumber() > forestDensity(x, z) then
			continue
		end

		if math.sqrt(x * x + z * z) < CLEARING_RADIUS + 40 then
			continue
		end

		local hit = Workspace:Raycast(Vector3.new(x, CEILING_Y, z), Vector3.new(0, -700, 0), params)
		if not hit then
			continue
		end

		-- Only on soil. Asphalt, slate, rock, sand and snow all reject, which
		-- is why roads stay clear without anything having to know about them.
		local material = hit.Material
		if material ~= Enum.Material.Grass and material ~= Enum.Material.Ground then
			continue
		end
		if hit.Position.Y < WATER_LEVEL + 4 or hit.Position.Y > ROCK_LINE - 14 then
			continue
		end

		plantTree(rng, hit.Position, forest)
		trees += 1

		if trees % 200 == 0 then
			task.wait()
		end
	end

	print(`[QZ] forest: {trees} trees from {attempts} attempts`)
end

--- Look ------------------------------------------------------------------

local function guard(label: string, fn: () -> ())
	local ok, err = pcall(fn)
	if not ok then
		warn(`[WorldService] {label}: {err}`)
	end
end

local function applyLighting()
	guard("lighting properties", function()
		-- Technology is not assignable from a script; it is set in
		-- default.project.json instead.
		Lighting.Brightness = 3
		Lighting.ClockTime = 15
		Lighting.GeographicLatitude = 8
		Lighting.ExposureCompensation = 0.25

		Lighting.Ambient = Color3.fromRGB(40, 46, 58)
		Lighting.OutdoorAmbient = Color3.fromRGB(126, 140, 162)
		Lighting.EnvironmentDiffuseScale = 1
		Lighting.EnvironmentSpecularScale = 1

		-- Warm on the lit faces, cool in the shade: most of what separates a
		-- scene that looks lit from one that looks flat.
		Lighting.ColorShift_Top = Color3.fromRGB(56, 42, 18)
		Lighting.ColorShift_Bottom = Color3.fromRGB(14, 22, 38)
		Lighting.ShadowSoftness = 0.2
	end)
end

local function applyEffects()
	for _, existing in Lighting:GetChildren() do
		if existing:IsA("PostEffect") or existing:IsA("Atmosphere") or existing:IsA("Sky") then
			existing:Destroy()
		end
	end

	guard("atmosphere", function()
		local atmosphere = Instance.new("Atmosphere")
		atmosphere.Density = 0.32
		atmosphere.Offset = 0.3
		atmosphere.Color = Color3.fromRGB(212, 222, 236)
		atmosphere.Decay = Color3.fromRGB(112, 148, 190)
		atmosphere.Glare = 0.15
		-- Aerial perspective across a map this wide: distant ranges need to
		-- sit behind near ones without the whole view turning to soup.
		atmosphere.Haze = 1.6
		atmosphere.Parent = Lighting
	end)

	guard("sky", function()
		local sky = Instance.new("Sky")
		sky.SunAngularSize = 14
		sky.MoonAngularSize = 9
		sky.StarCount = 3000
		sky.Parent = Lighting
	end)

	guard("post stack", function()
		local bloom = Instance.new("BloomEffect")
		bloom.Intensity = 0.5
		bloom.Size = 26
		bloom.Threshold = 1.55
		bloom.Parent = Lighting

		local sunRays = Instance.new("SunRaysEffect")
		sunRays.Intensity = 0.07
		sunRays.Spread = 1
		sunRays.Parent = Lighting

		local colour = Instance.new("ColorCorrectionEffect")
		colour.Contrast = 0.16
		colour.Saturation = 0.16
		colour.TintColor = Color3.fromRGB(255, 250, 240)
		colour.Parent = Lighting

		local depth = Instance.new("DepthOfFieldEffect")
		depth.NearIntensity = 0
		depth.FarIntensity = 0.3
		depth.FocusDistance = 320
		depth.InFocusRadius = 800
		depth.Parent = Lighting
	end)
end

local function applyTerrainLook()
	local terrain = Workspace.Terrain

	guard("water", function()
		terrain.WaterColor = Color3.fromRGB(42, 122, 148)
		terrain.WaterTransparency = 0.78
		terrain.WaterReflectance = 0.55
		terrain.WaterWaveSize = 0.09
		terrain.WaterWaveSpeed = 12
	end)

	guard("terrain decoration", function()
		terrain.Decoration = true
	end)

	guard("material colours", function()
		terrain:SetMaterialColor(Enum.Material.Grass, Color3.fromRGB(112, 158, 72))
		terrain:SetMaterialColor(Enum.Material.Ground, Color3.fromRGB(122, 100, 72))
		terrain:SetMaterialColor(Enum.Material.Rock, Color3.fromRGB(118, 116, 112))
		terrain:SetMaterialColor(Enum.Material.Slate, Color3.fromRGB(92, 92, 96))
		terrain:SetMaterialColor(Enum.Material.Asphalt, Color3.fromRGB(72, 72, 74))
		terrain:SetMaterialColor(Enum.Material.Sand, Color3.fromRGB(210, 194, 154))
		terrain:SetMaterialColor(Enum.Material.Snow, Color3.fromRGB(240, 244, 250))
	end)

	guard("clouds", function()
		local existing = terrain:FindFirstChildOfClass("Clouds")
		if existing then
			existing:Destroy()
		end

		local clouds = Instance.new("Clouds")
		clouds.Cover = 0.55
		clouds.Density = 0.6
		clouds.Color = Color3.fromRGB(255, 254, 250)
		clouds.Parent = terrain
	end)
end

local function buildSpawn()
	local pad = Instance.new("SpawnLocation")
	pad.Name = "Clearing"
	pad.Anchored = true
	pad.Size = Vector3.new(28, 1, 28)
	pad.Position = Vector3.new(0, CLEARING_Y + 1, 0)
	pad.Color = Color3.fromRGB(112, 108, 100)
	pad.Material = Enum.Material.Concrete
	pad.TopSurface = Enum.SurfaceType.Smooth
	pad.Duration = 0
	pad.Parent = Workspace
end

--- Public ----------------------------------------------------------------

function WorldService.start()
	for _, name in { "Baseplate", "SpawnLocation" } do
		local existing = Workspace:FindFirstChild(name)
		if existing then
			existing:Destroy()
		end
	end

	applyLighting()
	applyEffects()
	applyTerrainLook()
	buildSpawn()

	buildTerrain()
	buildRoads()
	buildRailway()
	buildForest()

	print("[QZ] world ready")
end

return WorldService
