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
local ServerScriptService = game:GetService("ServerScriptService")
local Workspace = game:GetService("Workspace")

local AssetLibrary = require(ServerScriptService:WaitForChild("Server"):WaitForChild("AssetLibrary"))

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

-- Low-chroma greens with real spread between them. A canopy made of one
-- bright green is the tell that gives a Roblox forest away instantly.
local CANOPY_GREENS = {
	Color3.fromRGB(72, 88, 54),
	Color3.fromRGB(88, 100, 62),
	Color3.fromRGB(60, 76, 48),
	Color3.fromRGB(96, 106, 70),
	Color3.fromRGB(52, 66, 44),
	Color3.fromRGB(80, 92, 58),
}

local AUTUMN = {
	Color3.fromRGB(148, 118, 58),
	Color3.fromRGB(132, 96, 48),
	Color3.fromRGB(160, 134, 72),
}

local BARK = {
	Color3.fromRGB(72, 62, 52),
	Color3.fromRGB(60, 52, 44),
	Color3.fromRGB(84, 72, 60),
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
	blob.Material = Enum.Material.LeafyGrass
	blob.Parent = parent
end

-- Cylinders lie along X in Roblox, so every limb needs standing up before it
-- can be pointed anywhere. This wraps that once.
local function limb(parent: Instance, from: Vector3, to: Vector3, thickness: number, colour: Color3)
	local delta = to - from
	local length = delta.Magnitude
	if length < 0.05 then
		return
	end

	local part = Instance.new("Part")
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.Shape = Enum.PartType.Cylinder
	part.Size = Vector3.new(length, thickness, thickness)
	part.CFrame = CFrame.lookAt((from + to) / 2, to) * CFrame.Angles(0, math.pi / 2, 0)
	part.Color = colour
	part.Material = Enum.Material.Wood
	part.Parent = parent
end

local function plantTree(rng: Random, base: Vector3, parent: Instance)
	local autumn = rng:NextNumber() < 0.1
	local palette = if autumn then AUTUMN else CANOPY_GREENS
	local bark = BARK[rng:NextInteger(1, #BARK)]

	local conifer = rng:NextNumber() < 0.42
	local height = if conifer then rng:NextNumber(46, 78) else rng:NextNumber(28, 46)
	local trunkWidth = height * 0.058

	-- A tapered trunk in two sections. Constant-width trunks are one of the
	-- things that reads as "made of primitives" from a hundred studs away.
	local midHeight = height * 0.55
	limb(parent, base, base + Vector3.new(0, midHeight, 0), trunkWidth, bark)
	limb(
		parent,
		base + Vector3.new(0, midHeight, 0),
		base + Vector3.new(rng:NextNumber(-1.5, 1.5), height, rng:NextNumber(-1.5, 1.5)),
		trunkWidth * 0.6,
		bark
	)

	if conifer then
		-- Stacked, narrowing tiers: a spruce silhouette rather than a ball.
		local tiers = rng:NextInteger(5, 7)
		for tier = 1, tiers do
			local t = (tier - 1) / (tiers - 1)
			local y = height * (0.34 + t * 0.62)
			local spread = height * 0.34 * (1 - t * 0.82)

			ball(
				parent,
				base + Vector3.new(rng:NextNumber(-1, 1), y, rng:NextNumber(-1, 1)),
				spread * 2,
				palette[rng:NextInteger(1, #palette)],
				0.5
			)
		end
		return
	end

	-- Broadleaf: real branches reaching out of the upper trunk, each ending
	-- in its own clump. The clumps read as a canopy; the branches are what
	-- stop it reading as a lollipop.
	local branches = rng:NextInteger(4, 6)
	for index = 1, branches do
		local angle = (index / branches) * math.pi * 2 + rng:NextNumber(-0.4, 0.4)
		local reach = height * rng:NextNumber(0.22, 0.36)
		local from = base + Vector3.new(0, height * rng:NextNumber(0.5, 0.72), 0)
		local to = from
			+ Vector3.new(math.cos(angle) * reach, reach * rng:NextNumber(0.4, 0.8), math.sin(angle) * reach)

		limb(parent, from, to, trunkWidth * 0.4, bark)
		ball(parent, to, reach * rng:NextNumber(1.1, 1.5), palette[rng:NextInteger(1, #palette)], 0.78)
	end

	ball(
		parent,
		base + Vector3.new(0, height * 0.86, 0),
		height * 0.44,
		palette[rng:NextInteger(1, #palette)],
		0.72
	)
end

--- Ground cover ----------------------------------------------------------

local ROCK_GREYS = {
	Color3.fromRGB(96, 96, 92),
	Color3.fromRGB(82, 84, 82),
	Color3.fromRGB(110, 108, 102),
}

-- Undergrowth is what separates a forest from trees on a lawn: rocks, fallen
-- timber, ferns and dead branches at ankle height, where the eye actually
-- looks when it judges whether ground is real.
local function scatterClutter(rng: Random, base: Vector3, parent: Instance)
	local roll = rng:NextNumber()

	if roll < 0.3 then
		local size = rng:NextNumber(2.5, 7)
		local rock = Instance.new("Part")
		rock.Name = "Rock"
		rock.Anchored = true
		rock.Size = Vector3.new(size * rng:NextNumber(0.8, 1.6), size * 0.7, size * rng:NextNumber(0.8, 1.4))
		rock.CFrame = CFrame.new(base + Vector3.new(0, size * 0.2, 0))
			* CFrame.Angles(rng:NextNumber(-0.3, 0.3), rng:NextNumber(0, 6.28), rng:NextNumber(-0.3, 0.3))
		rock.Color = ROCK_GREYS[rng:NextInteger(1, #ROCK_GREYS)]
		rock.Material = Enum.Material.Rock
		rock.Parent = parent
	elseif roll < 0.46 then
		-- Fallen trunk, lying where it dropped.
		local length = rng:NextNumber(12, 26)
		local angle = rng:NextNumber(0, 6.28)
		limb(
			parent,
			base + Vector3.new(0, 1.2, 0),
			base + Vector3.new(math.cos(angle) * length, rng:NextNumber(0.6, 2.2), math.sin(angle) * length),
			rng:NextNumber(1.8, 3.2),
			BARK[rng:NextInteger(1, #BARK)]
		)
	elseif roll < 0.84 then
		-- Fern clumps, two or three low blobs together.
		local tint = CANOPY_GREENS[rng:NextInteger(1, #CANOPY_GREENS)]
		for _ = 1, rng:NextInteger(2, 3) do
			ball(
				parent,
				base + Vector3.new(rng:NextNumber(-2.5, 2.5), rng:NextNumber(0.6, 1.4), rng:NextNumber(-2.5, 2.5)),
				rng:NextNumber(2.6, 5),
				tint,
				0.42
			)
		end
	else
		local angle = rng:NextNumber(0, 6.28)
		limb(
			parent,
			base + Vector3.new(0, 0.5, 0),
			base + Vector3.new(math.cos(angle) * rng:NextNumber(3, 7), rng:NextNumber(0.4, 1.4), math.sin(angle) * rng:NextNumber(3, 7)),
			rng:NextNumber(0.4, 0.8),
			BARK[rng:NextInteger(1, #BARK)]
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

	local trees, clutter = 0, 0
	local attempts = 0

	while (trees < 1500 or clutter < 2400) and attempts < 60000 do
		attempts += 1

		local x = rng:NextNumber(-HALF + 80, HALF - 80)
		local z = rng:NextNumber(-HALF + 80, HALF - 80)

		local density = forestDensity(x, z)

		-- Biome first: it is the cheapest test, and it rejects most of the
		-- map before a raycast is spent on it. Clutter tolerates thinner
		-- woodland than trees do, so it gets a softer threshold.
		local wantTree = trees < 1500 and rng:NextNumber() < density
		local wantClutter = clutter < 2400 and rng:NextNumber() < density * 0.8 + 0.12

		if not wantTree and not wantClutter then
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
		-- is why roads stay clear without anything knowing they exist.
		local material = hit.Material
		if material ~= Enum.Material.Grass and material ~= Enum.Material.Ground then
			continue
		end
		if hit.Position.Y < WATER_LEVEL + 4 or hit.Position.Y > ROCK_LINE - 14 then
			continue
		end

		if wantTree then
			-- A configured model always wins; the procedural tree is the
			-- fallback for when no asset id has been supplied.
			if not AssetLibrary.place("Trees", hit.Position, rng, forest) then
				plantTree(rng, hit.Position, forest)
			end
			trees += 1
		else
			if not AssetLibrary.place("Clutter", hit.Position, rng, forest) then
				scatterClutter(rng, hit.Position, forest)
			end
			clutter += 1
		end

		if (trees + clutter) % 250 == 0 then
			task.wait()
		end
	end

	print(`[QZ] forest: {trees} trees, {clutter} ground cover, {attempts} attempts`)
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
		Lighting.Brightness = 2.4
		-- Overcast-hour sun. Harsh midday light flattens everything and is
		-- the single most Roblox-looking thing a scene can do.
		Lighting.ClockTime = 16.4
		Lighting.GeographicLatitude = 8
		Lighting.ExposureCompensation = 0.25

		Lighting.Ambient = Color3.fromRGB(44, 48, 50)
		Lighting.OutdoorAmbient = Color3.fromRGB(118, 126, 126)
		Lighting.EnvironmentDiffuseScale = 1
		Lighting.EnvironmentSpecularScale = 1

		-- Warm on the lit faces, cool in the shade: most of what separates a
		-- scene that looks lit from one that looks flat.
		Lighting.ColorShift_Top = Color3.fromRGB(42, 36, 22)
		Lighting.ColorShift_Bottom = Color3.fromRGB(18, 24, 26)
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
		atmosphere.Density = 0.42
		atmosphere.Offset = 0.4
		atmosphere.Color = Color3.fromRGB(196, 202, 200)
		atmosphere.Decay = Color3.fromRGB(104, 118, 116)
		atmosphere.Glare = 0.1
		-- Aerial perspective across a map this wide: distant ranges need to
		-- sit behind near ones without the whole view turning to soup.
		atmosphere.Haze = 2.4
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
		bloom.Intensity = 0.28
		bloom.Size = 26
		bloom.Threshold = 1.55
		bloom.Parent = Lighting

		local sunRays = Instance.new("SunRaysEffect")
		sunRays.Intensity = 0.07
		sunRays.Spread = 1
		sunRays.Parent = Lighting

		local colour = Instance.new("ColorCorrectionEffect")
		-- Desaturated and cool. Photoreal post-apocalyptic grading pulls
		-- colour *out* of a frame; the saturated version this replaced was
		-- reading as a cartoon no matter what the geometry did.
		colour.Contrast = 0.22
		colour.Saturation = -0.28
		colour.TintColor = Color3.fromRGB(232, 238, 234)
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
		terrain.WaterColor = Color3.fromRGB(48, 74, 74)
		terrain.WaterTransparency = 0.7
		terrain.WaterReflectance = 0.55
		terrain.WaterWaveSize = 0.09
		terrain.WaterWaveSpeed = 12
	end)

	guard("terrain decoration", function()
		terrain.Decoration = true
	end)

	guard("material colours", function()
		-- Real ground is grey-green and low-chroma. Roblox's defaults are
		-- vivid because they have to read on a phone at 20 metres.
		terrain:SetMaterialColor(Enum.Material.Grass, Color3.fromRGB(94, 108, 68))
		terrain:SetMaterialColor(Enum.Material.Ground, Color3.fromRGB(98, 90, 74))
		terrain:SetMaterialColor(Enum.Material.Rock, Color3.fromRGB(108, 108, 104))
		terrain:SetMaterialColor(Enum.Material.Slate, Color3.fromRGB(88, 90, 90))
		terrain:SetMaterialColor(Enum.Material.Asphalt, Color3.fromRGB(64, 64, 64))
		terrain:SetMaterialColor(Enum.Material.Sand, Color3.fromRGB(168, 158, 132))
		terrain:SetMaterialColor(Enum.Material.Snow, Color3.fromRGB(226, 230, 232))
	end)

	guard("clouds", function()
		local existing = terrain:FindFirstChildOfClass("Clouds")
		if existing then
			existing:Destroy()
		end

		local clouds = Instance.new("Clouds")
		clouds.Cover = 0.74
		clouds.Density = 0.75
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
