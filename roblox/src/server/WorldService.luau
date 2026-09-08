--!strict
-- Generates the island: mountains, a river, lakes, forest, and the lighting
-- that holds it together.
--
-- The terrain is written as voxels from layered noise rather than sculpted by
-- hand. That keeps the whole world in a diff, costs nothing in the place file,
-- and makes re-rolling the landscape a one-seed change.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local WorldService = {}

local SEED = 1337

--- Shape -----------------------------------------------------------------

local RES = 4                    -- Roblox voxel size, in studs
local HALF = 512                 -- map extends +/- this on X and Z
local CHUNK = 128                -- studs generated per WriteVoxels call

local FLOOR_Y = -60
local CEILING_Y = 220
local WATER_LEVEL = 0

local SNOW_LINE = 132
local ROCK_LINE = 88
local SHORE_BAND = 5

-- The shelters need somewhere flat to stand, so a plateau is stamped over
-- whatever the noise produced in the middle of the map.
local PLATEAU_Y = 24
local PLATEAU_HALF_X = 265
local PLATEAU_HALF_Z = 120
local PLATEAU_BLEND = 90         -- studs of ramp from plateau down to terrain

local RIVER_WIDTH = 44
local RIVER_DEPTH = 26

--- Height field ----------------------------------------------------------

local function smoothstep(edge0: number, edge1: number, x: number): number
	local t = math.clamp((x - edge0) / (edge1 - edge0), 0, 1)
	return t * t * (3 - 2 * t)
end

-- Where the river's centreline sits at a given depth into the map.
local function riverCentre(z: number): number
	return math.noise(z / 420, SEED * 0.17) * 260
end

local function terrainHeight(x: number, z: number): number
	local sx, sz = x / 1000 + SEED, z / 1000 + SEED

	-- Three octaves: ranges, then hills, then surface detail.
	local height = math.noise(sx * 1.4, sz * 1.4) * 210
		+ math.noise(sx * 4.5, sz * 4.5) * 52
		+ math.noise(sx * 14, sz * 14) * 11

	-- Radial falloff turns the noise field into an island instead of a slab
	-- that gets cut off at the edges.
	local distance = math.sqrt(x * x + z * z) / HALF
	height -= smoothstep(0.62, 1.05, distance) * 210

	-- Carve the river. It cuts below the waterline, so it fills itself.
	local offset = math.abs(x - riverCentre(z))
	local cut = 1 - smoothstep(RIVER_WIDTH * 0.35, RIVER_WIDTH, offset)
	height -= cut * RIVER_DEPTH

	-- Stamp the plateau, ramping out so it does not read as a cut-out box.
	local px = math.abs(x) - PLATEAU_HALF_X
	local pz = math.abs(z) - PLATEAU_HALF_Z
	local outside = math.max(px, pz)
	local flatness = 1 - smoothstep(0, PLATEAU_BLEND, outside)
	height = height * (1 - flatness) + PLATEAU_Y * flatness

	return height
end

local function surfaceMaterial(height: number, slope: number): Enum.Material
	if height > SNOW_LINE then
		return Enum.Material.Snow
	end
	if height > ROCK_LINE or slope > 0.85 then
		return Enum.Material.Rock
	end
	if height < WATER_LEVEL + SHORE_BAND then
		return Enum.Material.Sand
	end
	if slope > 0.55 then
		return Enum.Material.Ground
	end
	return Enum.Material.Grass
end

--- Voxel writing ---------------------------------------------------------

local function writeChunk(originX: number, originZ: number)
	local region = Region3.new(
		Vector3.new(originX, FLOOR_Y, originZ),
		Vector3.new(originX + CHUNK, CEILING_Y, originZ + CHUNK)
	):ExpandToGrid(RES)

	local size = region.Size
	local corner = region.CFrame.Position - size / 2

	local nx = math.floor(size.X / RES)
	local ny = math.floor(size.Y / RES)
	local nz = math.floor(size.Z / RES)

	-- Height is per column, so it is sampled once per (x, z) instead of once
	-- per voxel. That is the difference between seconds and minutes.
	local heights = table.create(nx)
	local slopes = table.create(nx)

	for ix = 1, nx do
		local wx = corner.X + (ix - 0.5) * RES
		local columnHeights = table.create(nz)
		local columnSlopes = table.create(nz)

		for iz = 1, nz do
			local wz = corner.Z + (iz - 0.5) * RES
			local here = terrainHeight(wx, wz)

			-- Central difference gives the gradient, which is what decides
			-- whether a face is cliff or meadow.
			local dx = terrainHeight(wx + RES, wz) - terrainHeight(wx - RES, wz)
			local dz = terrainHeight(wx, wz + RES) - terrainHeight(wx, wz - RES)

			columnHeights[iz] = here
			columnSlopes[iz] = math.sqrt(dx * dx + dz * dz) / (2 * RES)
		end

		heights[ix] = columnHeights
		slopes[ix] = columnSlopes
	end

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

	Workspace.Terrain:WriteVoxels(region, RES, materials, occupancies)
end

local function buildTerrain()
	Workspace.Terrain:Clear()

	local chunks = 0
	for x = -HALF, HALF - CHUNK, CHUNK do
		for z = -HALF, HALF - CHUNK, CHUNK do
			writeChunk(x, z)
			chunks += 1
		end
		-- Yield a frame per row so the server never looks hung.
		task.wait()
	end

	print(`[Quarantine Zone] terrain written in {chunks} chunks`)
end

--- Forest ----------------------------------------------------------------

local function plantTree(rng: Random, position: Vector3, parent: Folder)
	local height = rng:NextNumber(16, 30)
	local lean = CFrame.Angles(
		math.rad(rng:NextNumber(-4, 4)),
		rng:NextNumber(0, math.pi * 2),
		math.rad(rng:NextNumber(-4, 4))
	)

	local trunk = Instance.new("Part")
	trunk.Name = "Trunk"
	trunk.Anchored = true
	trunk.Shape = Enum.PartType.Cylinder
	trunk.Size = Vector3.new(height, 2.6, 2.6)
	-- A cylinder's length runs along X, so it has to be stood upright.
	trunk.CFrame = CFrame.new(position + Vector3.new(0, height / 2, 0))
		* lean
		* CFrame.Angles(0, 0, math.pi / 2)
	trunk.Color = Color3.fromRGB(74, 56, 42)
	trunk.Material = Enum.Material.Wood
	trunk.Parent = parent

	-- Two offset canopies read as a fuller crown than one sphere ever does.
	local greens = {
		Color3.fromRGB(58, 84, 48),
		Color3.fromRGB(48, 72, 44),
		Color3.fromRGB(68, 92, 52),
	}

	for index = 1, 2 do
		local spread = rng:NextNumber(11, 16) - index * 2.5

		local canopy = Instance.new("Part")
		canopy.Name = "Canopy" .. index
		canopy.Anchored = true
		canopy.CanCollide = false
		canopy.Shape = Enum.PartType.Ball
		canopy.Size = Vector3.new(spread, spread * 0.85, spread)
		canopy.CFrame = CFrame.new(
			position
				+ Vector3.new(
					rng:NextNumber(-2, 2),
					height * (0.72 + index * 0.16),
					rng:NextNumber(-2, 2)
				)
		)
		canopy.Color = greens[rng:NextInteger(1, #greens)]
		canopy.Material = Enum.Material.Grass
		canopy.Parent = parent
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

	local planted = 0
	local attempts = 0

	while planted < 420 and attempts < 4000 do
		attempts += 1

		local x = rng:NextNumber(-HALF + 40, HALF - 40)
		local z = rng:NextNumber(-HALF + 40, HALF - 40)

		-- Keep the plateau clear; that is where the shelters go.
		if math.abs(x) < PLATEAU_HALF_X + 30 and math.abs(z) < PLATEAU_HALF_Z + 30 then
			continue
		end

		local hit = Workspace:Raycast(Vector3.new(x, CEILING_Y, z), Vector3.new(0, -400, 0), params)
		if not hit then
			continue
		end

		-- Trees belong on soil between the shoreline and the rock line.
		local material = hit.Material
		if material ~= Enum.Material.Grass and material ~= Enum.Material.Ground then
			continue
		end
		if hit.Position.Y < WATER_LEVEL + 3 or hit.Position.Y > ROCK_LINE then
			continue
		end

		plantTree(rng, hit.Position, forest)
		planted += 1

		if planted % 60 == 0 then
			task.wait()
		end
	end

	print(`[Quarantine Zone] planted {planted} trees`)
end

--- Look ------------------------------------------------------------------

local function applyLighting()
	Lighting.Technology = Enum.Technology.Future
	Lighting.Brightness = 2.2
	Lighting.ClockTime = 15.4
	Lighting.GeographicLatitude = 12
	Lighting.Ambient = Color3.fromRGB(28, 30, 34)
	Lighting.OutdoorAmbient = Color3.fromRGB(96, 102, 112)
	Lighting.EnvironmentDiffuseScale = 0.9
	Lighting.EnvironmentSpecularScale = 0.8
	Lighting.ExposureCompensation = 0.15

	-- Terrain water only looks like water once it is told to move and reflect.
	Workspace.Terrain.WaterColor = Color3.fromRGB(28, 84, 96)
	Workspace.Terrain.WaterTransparency = 0.82
	Workspace.Terrain.WaterReflectance = 0.55
	Workspace.Terrain.WaterWaveSize = 0.12
	Workspace.Terrain.WaterWaveSpeed = 8

	-- Rebuild the effect stack from scratch so re-running is idempotent.
	for _, existing in Lighting:GetChildren() do
		if existing:IsA("PostEffect") or existing:IsA("Atmosphere") or existing:IsA("Sky") then
			existing:Destroy()
		end
	end

	local atmosphere = Instance.new("Atmosphere")
	atmosphere.Density = 0.34
	atmosphere.Offset = 0.15
	atmosphere.Color = Color3.fromRGB(199, 201, 206)
	atmosphere.Decay = Color3.fromRGB(106, 112, 125)
	atmosphere.Glare = 0.28
	atmosphere.Haze = 1.9
	atmosphere.Parent = Lighting

	local bloom = Instance.new("BloomEffect")
	bloom.Intensity = 0.55
	bloom.Size = 26
	bloom.Threshold = 1.15
	bloom.Parent = Lighting

	local sunRays = Instance.new("SunRaysEffect")
	sunRays.Intensity = 0.06
	sunRays.Spread = 0.42
	sunRays.Parent = Lighting

	local colour = Instance.new("ColorCorrectionEffect")
	colour.Brightness = 0.01
	colour.Contrast = 0.14
	colour.Saturation = -0.06
	colour.TintColor = Color3.fromRGB(250, 248, 242)
	colour.Parent = Lighting

	-- Shallow, far-focused blur: it separates the mountains from the valley
	-- without smearing anything the player is actually looking at.
	local depth = Instance.new("DepthOfFieldEffect")
	depth.FarIntensity = 0.28
	depth.NearIntensity = 0
	depth.FocusDistance = 90
	depth.InFocusRadius = 320
	depth.Parent = Lighting
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
	buildTerrain()
	buildForest()

	print("[Quarantine Zone] world ready")
end

return WorldService
