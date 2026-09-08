--!strict
-- Owns every player's saved state. Nothing else touches a DataStore directly.
--
-- In Studio with API access switched off, DataStore calls throw. That is the
-- normal first-run state, so a failed load degrades to a fresh in-memory
-- profile instead of blocking the session.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Net = require(Shared:WaitForChild("Net"))
local Shelter = require(Shared:WaitForChild("Shelter"))

export type Profile = {
	Version: number,
	Supplies: number,
	Slots: { number },
	-- Unix time of the last save, used to work out offline production.
	LastSeen: number,
	-- True once the save round-tripped. A profile that never loaded is never
	-- allowed to overwrite whatever is on the server.
	Loaded: boolean,
}

local DataService = {}

local store: DataStore? = nil
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(Config.DataStoreName)
	end)
	if ok then
		store = result
	else
		warn("[DataService] DataStores unavailable, running in memory only:", result)
	end
end

local profiles: { [Player]: Profile } = {}
local syncRemote: RemoteEvent = Net.event("ProfileSync")
local welcomeRemote: RemoteEvent = Net.event("OfflineReport")

local function emptySlots(): { number }
	local slots = table.create(Config.SlotCount, 0)
	return slots
end

local function defaultProfile(): Profile
	return {
		Version = Config.DataVersion,
		Supplies = 0,
		Slots = emptySlots(),
		LastSeen = os.time(),
		Loaded = false,
	}
end

local function keyFor(player: Player): string
	return string.format("player_%d", player.UserId)
end

-- Fills in anything a newer DataVersion added, so old saves keep working.
local function migrate(saved: any): Profile
	local profile = defaultProfile()

	if type(saved) ~= "table" then
		return profile
	end

	if type(saved.Supplies) == "number" then
		profile.Supplies = math.max(0, math.floor(saved.Supplies))
	end

	if type(saved.LastSeen) == "number" then
		profile.LastSeen = saved.LastSeen
	end

	if type(saved.Slots) == "table" then
		for index = 1, Config.SlotCount do
			local level = saved.Slots[index]
			if type(level) == "number" then
				profile.Slots[index] = math.clamp(math.floor(level), 0, Shelter.MaxTier)
			end
		end
	end

	return profile
end

function DataService.push(player: Player)
	local profile = profiles[player]
	if not profile then
		return
	end

	syncRemote:FireClient(player, {
		Supplies = profile.Supplies,
		Slots = profile.Slots,
	})
end

local function load(player: Player)
	profiles[player] = defaultProfile()

	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local supplies = Instance.new("IntValue")
	supplies.Name = "Supplies"
	supplies.Parent = leaderstats

	leaderstats.Parent = player

	local profile = profiles[player]

	if store then
		-- Three attempts with backoff covers a transient DataStore blip
		-- without making the player wait forever.
		for attempt = 1, 3 do
			local ok, result = pcall(function()
				return (store :: DataStore):GetAsync(keyFor(player))
			end)

			if ok then
				profile = migrate(result)
				profile.Loaded = true
				profiles[player] = profile
				break
			end

			warn(`[DataService] load attempt {attempt} failed for {player.Name}: {result}`)
			task.wait(2 ^ attempt)
		end
	end

	if not player.Parent then
		-- They left mid-load. Drop the profile so it can never be written.
		profiles[player] = nil
		return
	end

	-- Pay out whatever the shelter banked while they were gone, before the
	-- first sync so the client only ever sees the settled number.
	local away = os.time() - profile.LastSeen
	local banked = Shelter.offlineYield(profile.Slots, away)
	if banked > 0 then
		profile.Supplies += banked
	end

	supplies.Value = profile.Supplies
	DataService.push(player)

	if banked >= Config.OfflineReportThreshold then
		welcomeRemote:FireClient(player, banked, away)
	end
end

local function save(player: Player)
	local profile = profiles[player]
	if not profile or not store then
		return
	end

	-- Never overwrite a real save with a default profile we failed to load.
	if not profile.Loaded then
		warn(`[DataService] skipping save for {player.Name}: profile never loaded`)
		return
	end

	profile.LastSeen = os.time()

	local payload = {
		Version = profile.Version,
		Supplies = profile.Supplies,
		Slots = profile.Slots,
		LastSeen = profile.LastSeen,
	}

	local ok, err = pcall(function()
		(store :: DataStore):SetAsync(keyFor(player), payload)
	end)

	if not ok then
		warn(`[DataService] save failed for {player.Name}: {err}`)
	end
end

function DataService.get(player: Player): Profile?
	return profiles[player]
end

function DataService.addSupplies(player: Player, amount: number)
	local profile = profiles[player]
	if not profile then
		return
	end

	profile.Supplies = math.max(0, profile.Supplies + amount)

	local leaderstats = player:FindFirstChild("leaderstats")
	local supplies = leaderstats and leaderstats:FindFirstChild("Supplies")
	if supplies and supplies:IsA("IntValue") then
		supplies.Value = profile.Supplies
	end

	DataService.push(player)
end

-- Returns true only if the player could afford it and the supplies were taken.
function DataService.trySpend(player: Player, amount: number): boolean
	local profile = profiles[player]
	if not profile or profile.Supplies < amount then
		return false
	end

	DataService.addSupplies(player, -amount)
	return true
end

function DataService.start()
	for _, player in Players:GetPlayers() do
		task.spawn(load, player)
	end

	Players.PlayerAdded:Connect(function(player)
		task.spawn(load, player)
	end)

	Players.PlayerRemoving:Connect(function(player)
		save(player)
		profiles[player] = nil
	end)

	-- Autosave, so a crash costs minutes rather than a session.
	task.spawn(function()
		while true do
			task.wait(Config.AutosaveInterval)
			for _, player in Players:GetPlayers() do
				task.spawn(save, player)
			end
		end
	end)

	game:BindToClose(function()
		if RunService:IsStudio() then
			return
		end

		for _, player in Players:GetPlayers() do
			task.spawn(save, player)
		end
		task.wait(3)
	end)
end

return DataService
