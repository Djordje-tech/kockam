--!strict
-- Owns every player's saved state. Nothing else in the game touches a
-- DataStore directly.
--
-- In Studio with API access switched off, DataStore calls throw. That is the
-- normal first-run state, so a failed load degrades to a fresh in-memory
-- profile instead of blocking the session — you still get to play, you just
-- don't keep progress until you tick the setting.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Net = require(Shared:WaitForChild("Net"))

export type Profile = {
	Version: number,
	Coins: number,
	Upgrades: { [string]: number },
	-- True when the save round-tripped. A profile that never loaded is not
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

local function defaultProfile(): Profile
	local upgrades = {}
	for id in Config.Upgrades do
		upgrades[id] = 0
	end

	return {
		Version = Config.DataVersion,
		Coins = 0,
		Upgrades = upgrades,
		Loaded = false,
	}
end

local function keyFor(player: Player): string
	return string.format("player_%d", player.UserId)
end

-- Fills in anything a newer DataVersion added, so old saves keep working.
local function migrate(saved: any): Profile
	local profile = defaultProfile()

	if type(saved) == "table" then
		if type(saved.Coins) == "number" then
			profile.Coins = saved.Coins
		end
		if type(saved.Upgrades) == "table" then
			for id in Config.Upgrades do
				local level = saved.Upgrades[id]
				if type(level) == "number" then
					profile.Upgrades[id] = level
				end
			end
		end
	end

	return profile
end

local function push(player: Player)
	local profile = profiles[player]
	if not profile then
		return
	end

	syncRemote:FireClient(player, {
		Coins = profile.Coins,
		Upgrades = profile.Upgrades,
	})
end

local function load(player: Player)
	local profile = defaultProfile()
	profiles[player] = profile

	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = leaderstats

	leaderstats.Parent = player

	if store then
		-- Three attempts with backoff covers a transient DataStore blip
		-- without making a disconnected player wait forever.
		local saved: any = nil
		for attempt = 1, 3 do
			local ok, result = pcall(function()
				return (store :: DataStore):GetAsync(keyFor(player))
			end)

			if ok then
				saved = result
				profile = migrate(saved)
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

	coins.Value = profile.Coins
	push(player)
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

	local payload = {
		Version = profile.Version,
		Coins = profile.Coins,
		Upgrades = profile.Upgrades,
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

function DataService.addCoins(player: Player, amount: number)
	local profile = profiles[player]
	if not profile then
		return
	end

	profile.Coins += amount

	local leaderstats = player:FindFirstChild("leaderstats")
	local coins = leaderstats and leaderstats:FindFirstChild("Coins")
	if coins and coins:IsA("IntValue") then
		coins.Value = profile.Coins
	end

	push(player)
end

-- Returns true only if the player could afford it and the coins were taken.
function DataService.trySpend(player: Player, amount: number): boolean
	local profile = profiles[player]
	if not profile or profile.Coins < amount then
		return false
	end

	DataService.addCoins(player, -amount)
	return true
end

function DataService.setUpgradeLevel(player: Player, id: string, level: number)
	local profile = profiles[player]
	if not profile then
		return
	end

	profile.Upgrades[id] = level
	push(player)
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

	-- Autosave, so a server crash costs minutes rather than a whole session.
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
