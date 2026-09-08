--!strict
-- Generates the island: mountains, rivers, lakes, forest, and the look that
-- holds it together.
--
-- The terrain is written as voxels from layered noise rather than sculpted by
-- hand. That keeps the whole world in a diff, costs nothing in the place file,
-- and makes re-rolling the landscape a one-seed change.

local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")

local WorldService = {}

local SEED = 1337

--- Shape -----------------------------------------------------------------

local RES = 4                    -- Roblox voxel size, in studs
local HALF = 1536                -- map extends +/- this on X and Z
local CHUNK = 128                -- studs per WriteVoxels call

local FLOOR_Y = -80
local CEILING_Y = 340
local WATER_LEVEL = 0

local SNOW_LINE = 205
local ROCK_LINE = 130
local SHORE_BAND = 6

-- The shelters need somewhere flat to stand, so a plateau is stamped over
-- whatever the noise produced in the middle of the map.
local PLATEAU_Y = 24
local PLATEAU_HALF_X = 265
local PLATEAU_HALF_Z = 120
local PLATEAU_BLEND = 160        -- studs of ramp from plateau down to terrain

local RIVER_WIDTH = 64
local RIVER_DEPTH = 34

--- Height field ----------------------------------------------------------

local function smoothstep(edge0: number, edge1: number, x: number): number
	local t = math.clamp((x - edge0) / (edge1 - edge0), 0, 1)
	return t * t * (3 - 2 * t)
end

-- Where a river's centreline sits at a given depth into the map. Two of them,
-- offset, so the map has more than one piece of water running through it.
local function riverCentre(z: number, channel: number): number
	return math.noise(z / 900, SEED * 0.17 + channel * 40) * 900 + channel * 520
end

local function terrainHeight(x: number, z: number): number
	-- Feature size scales with the map, so a bigger island gets bigger
	-- mountains rather than the same hills spread thinner.
	local sx, sz = x / 3000 + SEED, z / 3000 + SEED

	local height = math.noise(sx * 1.4, sz * 1.4) * 330
		+ math.noise(sx * 4.5, sz * 4.5) * 88
		+ math.noise(sx * 13, sz * 13) * 22
		+ math.noise(sx * 34, sz * 34) * 6

	-- Radial falloff turns the noise field into an island instead of a slab
	-- that gets cut off at the edges.
	local distance = math.sqrt(x * x + z * z) / HALF
	height -= smoothstep(0.58, 1.02, distance) * 320

	-- Carve the rivers. They cut below the waterline, so they fill themselves.
	for channel = -1, 1 do
		local offset = math.abs(x - riverCentre(z, channel))
		local cut = 1 - smoothstep(RIVER_WIDTH * 0.3, RIVER_WIDTH, offset)
		height -= cut * RIVER_DEPTH
	end

	-- Stamp the plateau, ramping out so it does not read as a cut-out box.
	local px = math.abs(x) - PLATEAU_HALF_X
	local pz = math.abs(z) - PLATEAU_HALF_Z
	local flatness = 1 - smoothstep(0, PLATEAU_BLEND, math.max(px, pz))
	height = height * (1 - flatness) + PLATEAU_Y * flatness

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

			-- Central difference gives the gradient, which is what decides
			-- whether a face is cliff or meadow.
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

	-- Only write the band this chunk actually occupies. Most of the map is
	-- nowhere near the full vertical range, and writing empty air above every
	-- meadow is what makes a large map impossible.
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
	local rows = 0

	for x = -HALF, HALF - CHUNK, CHUNK do
		for z = -HALF, HALF - CHUNK, CHUNK do
			if writeChunk(x, z) then
				written += 1
			else
				failed += 1
			end
		end

		rows += 1
		-- Yield a frame per row so the server never looks hung.
		task.wait()

		if rows % 6 == 0 then
			print(`[QZ] terrain {math.floor(rows / (2 * HALF / CHUNK) * 100)}%`)
		end
	end

	print(`[QZ] terrain: {written} chunks written, {failed} failed`)
	print(`[QZ] height at origin = {math.floor(terrainHeight(0, 0))}`)
end

--- Forest ----------------------------------------------------------------

-- Stylised, not realistic: layered rounded canopies in saturated greens, the
-- way a hand-painted game does it. Roblox cannot do photoreal foliage without
-- imported meshes, but it does this look very well.
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

local function ball(parent: Instance, position: Vector3, diameter: number, colour: Color3, squash: number)
	local blob = Instance.new("Part")
	blob.Anchored = true
	blob.CanCollide = false
	blob.CanQuery = false
	blob.CastShadow = true
	blob.Shape = Enum.PartType.Ball
	blob.Size = Vector3.new(diameter, diameter * squash, diameter)
	blob.Position = position
	blob.Color = colour
	blob.Material = Enum.Material.Grass
	blob.Parent = parent
end

local function plantTree(rng: Random, base: Vector3, parent: Instance)
	local autumn = rng:NextNumber() < 0.14
	local palette = if autumn then AUTUMN else CANOPY_GREENS
	local tint = palette[rng:NextInteger(1, #palette)]

	local tall = rng:NextNumber() < 0.3
	local height = if tall then rng:NextNumber(34, 52) else rng:NextNumber(20, 32)
	local trunkWidth = height * 0.09

	local trunk = Instance.new("Part")
	trunk.Name = "Trunk"
	trunk.Anchored = true
	trunk.Shape = Enum.PartType.Cylinder
	trunk.Size = Vector3.new(height, trunkWidth, trunkWidth)
	-- A cylinder's length runs along X, so it has to be stood upright.
	trunk.CFrame = CFrame.new(base + Vector3.new(0, height * 0.45, 0))
		* CFrame.Angles(0, 0, math.pi / 2)
	trunk.Color = Color3.fromRGB(96, 70, 50)
	trunk.Material = Enum.Material.Wood
	trunk.Parent = parent

	-- Four overlapping blobs of decreasing size. The overlap is the whole
	-- trick: separate spheres read as balls on a stick, merged ones read as
	-- a canopy.
	local layers = rng:NextInteger(3, 4)
	local spread = height * (if tall then 0.5 else 0.78)

	for layer = 1, layers do
		local t = (layer - 1) / layers
		local diameter = spread * (1 - t * 0.42)

		ball(
			parent,
			base + Vector3.new(
				rng:NextNumber(-spread, spread) * 0.16,
				height * (0.66 + t * 0.3),
				rng:NextNumber(-spread, spread) * 0.16
			),
			diameter,
			tint:Lerp(Color3.new(1, 1, 1), t * 0.16),
			if tall then 1.15 else 0.82
		)
	end
end

local function plantBush(rng: Random, base: Vector3, parent: Instance)
	local tint = CANOPY_GREENS[rng:NextInteger(1, #CANOPY_GREENS)]
	for index = 1, 2 do
		ball(
			parent,
			base + Vector3.new(rng:NextNumber(-2, 2), 1.6 + index * 0.9, rng:NextNumber(-2, 2)),
			rng:NextNumber(5, 9) - index,
			tint,
			0.8
		)
	end
end

local function plantFlower(rng: Random, base: Vector3, parent: Instance)
	local colours = {
		Color3.fromRGB(240, 208, 84),
		Color3.fromRGB(238, 240, 244),
		Color3.fromRGB(226, 128, 142),
	}

	local bloom = Instance.new("Part")
	bloom.Anchored = true
	bloom.CanCollide = false
	bloom.CanQuery = false
	bloom.CastShadow = false
	bloom.Shape = Enum.PartType.Ball
	bloom.Size = Vector3.new(1.1, 1.1, 1.1)
	bloom.Position = base + Vector3.new(0, 0.9, 0)
	bloom.Color = colours[rng:NextInteger(1, #colours)]
	bloom.Material = Enum.Material.SmoothPlastic
	bloom.Parent = parent
end

local function buildForest()
	local rng = Random.new(SEED)

	local forest = Instance.new("Folder")
	forest.Name = "Forest"
	forest.Parent = Workspace

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { forest }

	local trees, bushes, flowers = 0, 0, 0
	local attempts = 0

	while trees < 2200 and attempts < 26000 do
		attempts += 1

		local x = rng:NextNumber(-HALF + 60, HALF - 60)
		local z = rng:NextNumber(-HALF + 60, HALF - 60)

		-- Keep the plateau clear; that is where the shelters go.
		if math.abs(x) < PLATEAU_HALF_X + 40 and math.abs(z) < PLATEAU_HALF_Z + 40 then
			continue
		end

		local hit = Workspace:Raycast(Vector3.new(x, CEILING_Y, z), Vector3.new(0, -700, 0), params)
		if not hit then
			continue
		end

		-- Things grow on soil between the shoreline and the rock line.
		local material = hit.Material
		if material ~= Enum.Material.Grass and material ~= Enum.Material.Ground then
			continue
		end
		if hit.Position.Y < WATER_LEVEL + 3 or hit.Position.Y > ROCK_LINE - 10 then
			continue
		end

		local roll = rng:NextNumber()
		if roll < 0.72 then
			plantTree(rng, hit.Position, forest)
			trees += 1
		elseif roll < 0.86 then
			plantBush(rng, hit.Position, forest)
			bushes += 1
		else
			plantFlower(rng, hit.Position, forest)
			flowers += 1
		end

		if (trees + bushes + flowers) % 150 == 0 then
			task.wait()
		end
	end

	print(`[QZ] forest: {trees} trees, {bushes} bushes, {flowers} flowers`)
end

--- Look ------------------------------------------------------------------

-- Every group is guarded separately. Engine properties change scriptability
-- between releases, and an entire landscape should never be lost to one
-- rejected assignment — which is exactly what happened once already.
local function guard(label: string, fn: () -> ())
	local ok, err = pcall(fn)
	if not ok then
		warn(`[WorldService] {label}: {err}`)
	end
end

local function applyLighting()
	guard("lighting properties", function()
		-- Technology is deliberately absent: it is not assignable from a
		-- script. It is set in default.project.json instead.
		Lighting.Brightness = 3
		Lighting.ClockTime = 15
		Lighting.GeographicLatitude = 8
		Lighting.ExposureCompensation = 0.25

		Lighting.Ambient = Color3.fromRGB(40, 46, 58)
		Lighting.OutdoorAmbient = Color3.fromRGB(126, 140, 162)

		-- Image-based lighting is what makes materials read as lit by the sky
		-- rather than by a lamp.
		Lighting.EnvironmentDiffuseScale = 1
		Lighting.EnvironmentSpecularScale = 1

		-- Warm on the lit faces, cool in the shade. This split is most of what
		-- separates a scene that looks painted from one that looks flat.
		Lighting.ColorShift_Top = Color3.fromRGB(56, 42, 18)
		Lighting.ColorShift_Bottom = Color3.fromRGB(14, 22, 38)

		Lighting.ShadowSoftness = 0.2
	end)
end

local function applyEffects()
	-- Rebuild from scratch so re-running never accumulates duplicates.
	for _, existing in Lighting:GetChildren() do
		if existing:IsA("PostEffect") or existing:IsA("Atmosphere") or existing:IsA("Sky") then
			existing:Destroy()
		end
	end

	guard("atmosphere", function()
		local atmosphere = Instance.new("Atmosphere")
		atmosphere.Density = 0.3
		atmosphere.Offset = 0.3
		atmosphere.Color = Color3.fromRGB(212, 222, 236)
		atmosphere.Decay = Color3.fromRGB(112, 148, 190)
		atmosphere.Glare = 0.15
		-- Aerial perspective: enough haze that distant ridges sit behind near
		-- ones, not so much that the map turns to soup.
		atmosphere.Haze = 1.2
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
		-- High threshold so only genuinely bright things bleed. A low
		-- threshold is what makes a scene look washed out.
		bloom.Threshold = 1.55
		bloom.Parent = Lighting

		local sunRays = Instance.new("SunRaysEffect")
		sunRays.Intensity = 0.07
		sunRays.Spread = 1
		sunRays.Parent = Lighting

		local colour = Instance.new("ColorCorrectionEffect")
		colour.Brightness = 0.01
		colour.Contrast = 0.16
		-- Pushed up rather than down: the reference look is saturated.
		colour.Saturation = 0.18
		colour.TintColor = Color3.fromRGB(255, 250, 240)
		colour.Parent = Lighting

		-- Near intensity stays at zero so whatever the player is standing next
		-- to is always sharp; only the far ridgelines soften.
		local depth = Instance.new("DepthOfFieldEffect")
		depth.NearIntensity = 0
		depth.FarIntensity = 0.3
		depth.FocusDistance = 260
		depth.InFocusRadius = 640
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
		-- Free grass tufts on every grass voxel. Nothing else in the engine
		-- buys this much perceived detail for this little.
		terrain.Decoration = true
	end)

	guard("material colours", function()
		-- Saturated and warm, to match a hand-painted look rather than the
		-- muted realism the defaults aim for.
		terrain:SetMaterialColor(Enum.Material.Grass, Color3.fromRGB(118, 166, 74))
		terrain:SetMaterialColor(Enum.Material.Ground, Color3.fromRGB(122, 100, 72))
		terrain:SetMaterialColor(Enum.Material.Rock, Color3.fromRGB(118, 116, 112))
		terrain:SetMaterialColor(Enum.Material.Slate, Color3.fromRGB(96, 98, 102))
		terrain:SetMaterialColor(Enum.Material.Sand, Color3.fromRGB(214, 196, 152))
		terrain:SetMaterialColor(Enum.Material.Snow, Color3.fromRGB(240, 244, 250))
	end)

	guard("clouds", function()
		-- Volumetric clouds live under Terrain, not Lighting. They cast real
		-- shadows across the landscape, which is what sells the scale.
		local existing = terrain:FindFirstChildOfClass("Clouds")
		if existing then
			existing:Destroy()
		end

		local clouds = Instance.new("Clouds")
		clouds.Cover = 0.55
		clouds.Density = 0.62
		clouds.Color = Color3.fromRGB(255, 254, 250)
		clouds.Parent = terrain
	end)
end

--- Spawn -----------------------------------------------------------------

-- A real SpawnLocation on the plateau, so a player is never left falling
-- through the void when plot assignment has not happened yet.
local function buildSpawn()
	local pad = Instance.new("SpawnLocation")
	pad.Name = "PlateauSpawn"
	pad.Anchored = true
	pad.Size = Vector3.new(24, 1, 24)
	pad.Position = Vector3.new(0, PLATEAU_Y + 1, PLATEAU_HALF_Z - 40)
	pad.Color = Color3.fromRGB(112, 108, 100)
	pad.Material = Enum.Material.Concrete
	pad.TopSurface = Enum.SurfaceType.Smooth
	pad.Duration = 0
	pad.Parent = Workspace
end

--- Public ----------------------------------------------------------------

function WorldService.start()
	-- The template's baseplate and spawn would float over the terrain.
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
	buildForest()

	print("[QZ] world ready")
end

return WorldService
