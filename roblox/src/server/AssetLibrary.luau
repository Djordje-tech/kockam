--!strict
-- Loads the models named in Shared.Assets and hands out copies.
--
-- Loading happens once at startup and is cached, because InsertService is a
-- network call and nothing that runs per-tree can afford one. Any id that
-- fails to load is reported and skipped rather than taking the world with it —
-- a wrong number in a list should cost you that model, not the map.

local InsertService = game:GetService("InsertService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Assets = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Assets"))

local AssetLibrary = {}

local templates: { [string]: { Model } } = {}
local cache: Folder

local function normalise(model: Model, scale: number): Model
	-- Free models arrive unanchored and full of other people's scripts. Both
	-- are fixed here, once, rather than at every placement.
	for _, descendant in model:GetDescendants() do
		if descendant:IsA("LuaSourceContainer") then
			descendant:Destroy()
		elseif descendant:IsA("BasePart") then
			descendant.Anchored = true
			descendant.CanCollide = descendant.CanCollide and descendant.Size.Magnitude > 3
		end
	end

	if scale ~= 1 then
		model:ScaleTo(scale)
	end

	return model
end

-- InsertService returns a wrapper Model containing the real asset, so the
-- useful thing is usually one level down.
local function unwrap(loaded: Model): Model?
	local children = loaded:GetChildren()
	if #children == 1 and children[1]:IsA("Model") then
		return children[1] :: Model
	end

	if #children == 0 then
		return nil
	end

	return loaded
end

local function loadOne(assetId: number, scale: number): Model?
	local ok, result = pcall(function()
		return InsertService:LoadAsset(assetId)
	end)

	if not ok then
		warn(`[QZ] asset {assetId} failed to load: {result} (is it public?)`)
		return nil
	end

	local model = unwrap(result)
	if not model then
		warn(`[QZ] asset {assetId} loaded but held no model`)
		result:Destroy()
		return nil
	end

	return normalise(model, scale)
end

-- Models dropped straight into ServerStorage are the lowest-friction way to
-- get real geometry in: an imported model has no asset id until it is
-- published, so requiring one would mean an extra publish step for nothing.
-- A folder named after the category is enough.
local function adoptFromStorage(category: string, scale: number): { Model }
	local list = {}

	local folder = ServerStorage:FindFirstChild(category)
	if not folder then
		return list
	end

	for _, child in folder:GetChildren() do
		local model: Model? = nil

		if child:IsA("Model") then
			model = child:Clone()
		elseif child:IsA("BasePart") then
			-- A single imported MeshPart is common and perfectly usable; it
			-- just needs wrapping so everything downstream sees a Model.
			local wrapper = Instance.new("Model")
			wrapper.Name = child.Name
			local copy = child:Clone()
			copy.Parent = wrapper
			wrapper.PrimaryPart = copy
			model = wrapper
		end

		if model then
			table.insert(list, normalise(model, scale))
		end
	end

	if #list > 0 then
		print(`[QZ] {category}: adopted {#list} model(s) from ServerStorage.{category}`)
	end

	return list
end

function AssetLibrary.start()
	cache = Instance.new("Folder")
	cache.Name = "AssetCache"
	cache.Parent = ServerStorage

	local loaded, failed = 0, 0

	for category, ids in Assets.Categories do
		local scale = Assets.Scale[category] or 1

		-- Hand-placed models first, then anything named by asset id.
		local list = adoptFromStorage(category, scale)
		for _, model in list do
			model.Parent = cache
			loaded += 1
		end

		for _, assetId in ids do
			local model = loadOne(assetId, scale)
			if model then
				model.Parent = cache
				table.insert(list, model)
				loaded += 1
			else
				failed += 1
			end
		end

		templates[category] = list
	end

	if loaded == 0 and failed == 0 then
		print("[QZ] no models supplied - using procedural ones")
		print("[QZ] drop models into ServerStorage.Trees / Clutter / Buildings / Vehicles to replace them")
	else
		print(`[QZ] assets: {loaded} loaded, {failed} failed`)
	end
end

function AssetLibrary.has(category: string): boolean
	local list = templates[category]
	return list ~= nil and #list > 0
end

-- Returns a fresh copy standing on `base`, or nil when the category is empty
-- so callers can fall through to their procedural version.
function AssetLibrary.place(category: string, base: Vector3, rng: Random, parent: Instance): Model?
	local list = templates[category]
	if not list or #list == 0 then
		return nil
	end

	local copy = list[rng:NextInteger(1, #list)]:Clone()

	-- Models pivot around their centre, so they have to be lifted by half
	-- their height to stand on the ground rather than sink into it.
	local size = copy:GetExtentsSize()
	copy:PivotTo(
		CFrame.new(base + Vector3.new(0, size.Y / 2, 0))
			* CFrame.Angles(0, rng:NextNumber(0, math.pi * 2), 0)
	)
	copy.Parent = parent

	return copy
end

return AssetLibrary
