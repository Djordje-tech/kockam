--!strict
-- Places building models onto the generated terrain.
--
-- Models are the one thing that cannot live in this repository: they are
-- binary assets. So the pipeline is split — you drop a model into
-- ServerStorage.Structures, and this decides where it stands, flattens ground
-- under it, and makes it safe to run.
--
-- Nothing here fails loudly if the folder is empty. A world with no models is
-- a valid world.

local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local StructureService = {}

local FOLDER_NAME = "Structures"

local COPIES_PER_MODEL = 3
local PLACEMENT_ATTEMPTS = 400

-- Keep clear of the shelters.
local PLATEAU_HALF_X = 265
local PLATEAU_HALF_Z = 120
local PLATEAU_MARGIN = 120

local HALF = 1536
local WATER_LEVEL = 0
local MAX_HEIGHT = 120
local MAX_SLOPE = 6              -- studs of height difference across the pad

local PAD_OVERHANG = 8           -- studs of flat ground beyond the footprint
local PAD_DEPTH = 20

local placed: { Vector3 } = {}

-- A Toolbox model is code from a stranger. Nothing in this project needs a
-- script that arrived inside a building, so every one of them is removed
-- before the model is ever parented into the world.
local function sanitise(model: Model): number
	local removed = 0

	for _, descendant in model:GetDescendants() do
		if descendant:IsA("LuaSourceContainer") then
			descendant:Destroy()
			removed += 1
		elseif descendant:IsA("BasePart") then
			-- Free models are routinely shipped unanchored and fall apart the
			-- moment physics touches them.
			descendant.Anchored = true
		end
	end

	return removed
end

local function groundAt(x: number, z: number, ignore: { Instance }): RaycastResult?
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = ignore

	return Workspace:Raycast(Vector3.new(x, 400, z), Vector3.new(0, -800, 0), params)
end

-- Buildings need level ground. Rather than move the building to fit the hill,
-- the hill is cut to fit the building.
local function levelGround(centre: Vector3, footprint: Vector3, height: number)
	local width = footprint.X + PAD_OVERHANG * 2
	local depth = footprint.Z + PAD_OVERHANG * 2

	-- Carve out anything occupying the space the building will stand in.
	Workspace.Terrain:FillBlock(
		CFrame.new(centre + Vector3.new(0, height / 2 + 2, 0)),
		Vector3.new(width, height + 4, depth),
		Enum.Material.Air
	)

	-- Then lay a solid pad under it.
	Workspace.Terrain:FillBlock(
		CFrame.new(centre - Vector3.new(0, PAD_DEPTH / 2, 0)),
		Vector3.new(width, PAD_DEPTH, depth),
		Enum.Material.Ground
	)
end

local function farFromOthers(position: Vector3, clearance: number): boolean
	for _, other in placed do
		if (other - position).Magnitude < clearance then
			return false
		end
	end
	return true
end

local function place(template: Model, parent: Folder, rng: Random): boolean
	local footprint = template:GetExtentsSize()
	local clearance = math.max(footprint.X, footprint.Z) * 1.8

	for _ = 1, PLACEMENT_ATTEMPTS do
		local x = rng:NextNumber(-HALF + 200, HALF - 200)
		local z = rng:NextNumber(-HALF + 200, HALF - 200)

		if math.abs(x) < PLATEAU_HALF_X + PLATEAU_MARGIN
			and math.abs(z) < PLATEAU_HALF_Z + PLATEAU_MARGIN
		then
			continue
		end

		if not farFromOthers(Vector3.new(x, 0, z), clearance) then
			continue
		end

		local hit = groundAt(x, z, { parent })
		if not hit then
			continue
		end

		local y = hit.Position.Y
		if y < WATER_LEVEL + 6 or y > MAX_HEIGHT then
			continue
		end

		-- Reject slopes by sampling the corners of the footprint. A building
		-- half-buried in a hillside looks worse than no building.
		local flat = true
		for _, corner in {
			Vector2.new(1, 1),
			Vector2.new(1, -1),
			Vector2.new(-1, 1),
			Vector2.new(-1, -1),
		} do
			local sample = groundAt(
				x + corner.X * footprint.X / 2,
				z + corner.Y * footprint.Z / 2,
				{ parent }
			)
			if not sample or math.abs(sample.Position.Y - y) > MAX_SLOPE then
				flat = false
				break
			end
		end

		if not flat then
			continue
		end

		local centre = Vector3.new(x, y, z)
		levelGround(centre, footprint, footprint.Y)

		local copy = template:Clone()
		sanitise(copy)

		-- Pivot sits at the model's centre, so it is raised by half its height
		-- to stand the building on the ground rather than in it.
		copy:PivotTo(
			CFrame.new(centre + Vector3.new(0, footprint.Y / 2, 0))
				* CFrame.Angles(0, rng:NextNumber(0, math.pi * 2), 0)
		)
		copy.Parent = parent

		table.insert(placed, centre)
		return true
	end

	return false
end

-- Matched loosely on purpose. This folder is created by hand in Studio, and
-- an exact-name lookup turns a typo or a lowercase S into a silent no-op with
-- nothing to debug.
local function findSourceFolder(): Instance?
	local exact = ServerStorage:FindFirstChild(FOLDER_NAME)
	if exact then
		return exact
	end

	for _, child in ServerStorage:GetChildren() do
		if string.lower(child.Name):find("struct", 1, true) then
			warn(`[QZ] using '{child.Name}' as the structures folder - rename it to '{FOLDER_NAME}'`)
			return child
		end
	end

	return nil
end

function StructureService.start()
	local source = findSourceFolder()
	if not source then
		print(`[QZ] no ServerStorage.{FOLDER_NAME} folder - skipping structures`)
		return
	end

	-- Toolbox items arrive as Models, but also as bare MeshParts, single
	-- Parts, and Folders. Anything with geometry is usable, so anything that
	-- is not already a Model gets wrapped in one rather than ignored.
	local templates: { Model } = {}

	for _, child in source:GetChildren() do
		if child:IsA("Model") then
			table.insert(templates, child)
		elseif child:IsA("BasePart") or child:IsA("Folder") then
			local wrapper = Instance.new("Model")
			wrapper.Name = child.Name

			local copy = child:Clone()
			copy.Parent = wrapper

			table.insert(templates, wrapper)
			print(`[QZ] wrapped '{child.Name}' ({child.ClassName}) as a model`)
		end
	end

	if #templates == 0 then
		local found = #source:GetChildren()
		if found == 0 then
			print(`[QZ] ServerStorage.{FOLDER_NAME} is empty - drop a model into it`)
		else
			warn(`[QZ] ServerStorage.{FOLDER_NAME} holds {found} item(s), none usable as geometry`)
		end
		return
	end

	local parent = Instance.new("Folder")
	parent.Name = "Structures"
	parent.Parent = Workspace

	local rng = Random.new(4242)
	local built = 0

	for _, template in templates do
		local stripped = sanitise(template)
		if stripped > 0 then
			warn(`[QZ] removed {stripped} script(s) from '{template.Name}'`)
		end

		for _ = 1, COPIES_PER_MODEL do
			if place(template, parent, rng) then
				built += 1
			end
			task.wait()
		end
	end

	print(`[QZ] placed {built} structures from {#templates} model(s)`)
end

return StructureService
