--!strict
-- Spawns the collectable orbs and pays players who reach them.
--
-- Pickup is a throttled distance check rather than Touched events: it is one
-- code path for both the base pickup radius and the Magnet upgrade, and it
-- cannot be spoofed by a client faking a touch.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Net = require(Shared:WaitForChild("Net"))
local Upgrades = require(Shared:WaitForChild("Upgrades"))

local DataService = require(script.Parent:WaitForChild("DataService"))
local PassService = require(script.Parent:WaitForChild("PassService"))

local CoinService = {}

local BASE_PICKUP_RADIUS = 5
local CHECK_INTERVAL = 0.1

local collectedRemote: RemoteEvent = Net.event("CoinCollected")

local folder: Folder
local coins: { BasePart } = {}
local active: { [BasePart]: boolean } = {}

-- Drops a point onto whatever ground is under a random spot in the ring.
local function randomSpawnCFrame(): CFrame
	local angle = math.random() * math.pi * 2
	local distance = math.sqrt(math.random()) * Config.CoinSpawnRadius
	local x = math.cos(angle) * distance
	local z = math.sin(angle) * distance

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { folder }

	local result = Workspace:Raycast(Vector3.new(x, 500, z), Vector3.new(0, -1000, 0), params)
	local y = if result then result.Position.Y + 3 else 5

	return CFrame.new(x, y, z)
end

local function makeCoin(): BasePart
	local coin = Instance.new("Part")
	coin.Name = "Coin"
	coin.Shape = Enum.PartType.Cylinder
	coin.Size = Vector3.new(0.4, 2.4, 2.4)
	coin.Color = Color3.fromRGB(255, 200, 60)
	coin.Material = Enum.Material.Neon
	coin.Anchored = true
	coin.CanCollide = false
	coin.CanTouch = false
	coin.CanQuery = false
	coin.CastShadow = false

	local light = Instance.new("PointLight")
	light.Color = coin.Color
	light.Range = 8
	light.Brightness = 1.5
	light.Parent = coin

	return coin
end

local function respawn(coin: BasePart)
	active[coin] = false
	coin.Transparency = 1

	task.delay(Config.CoinRespawnDelay, function()
		if not coin.Parent then
			return
		end
		coin.CFrame = randomSpawnCFrame()
		coin.Transparency = 0
		active[coin] = true
	end)
end

local function payoutFor(player: Player): number
	local profile = DataService.get(player)
	local level = if profile then profile.Upgrades.Multiplier or 0 else 0

	local amount = Config.CoinValue
		* Upgrades.multiplierFor(level)
		* PassService.coinMultiplier(player)

	return math.max(1, math.floor(amount))
end

local function pickupRadiusFor(player: Player): number
	local profile = DataService.get(player)
	local level = if profile then profile.Upgrades.Magnet or 0 else 0
	return BASE_PICKUP_RADIUS + Upgrades.magnetRangeFor(level)
end

local function collect(player: Player, coin: BasePart)
	active[coin] = false

	local amount = payoutFor(player)
	DataService.addCoins(player, amount)
	collectedRemote:FireClient(player, amount, coin.Position)

	respawn(coin)
end

function CoinService.start()
	folder = Instance.new("Folder")
	folder.Name = "Coins"
	folder.Parent = Workspace

	for _ = 1, Config.CoinCount do
		local coin = makeCoin()
		coin.CFrame = randomSpawnCFrame()
		coin.Parent = folder

		table.insert(coins, coin)
		active[coin] = true
	end

	local accumulator = 0
	RunService.Heartbeat:Connect(function(dt)
		accumulator += dt
		if accumulator < CHECK_INTERVAL then
			return
		end
		accumulator = 0

		for _, player in Players:GetPlayers() do
			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart")
			if not root or not root:IsA("BasePart") then
				continue
			end

			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			if not humanoid or humanoid.Health <= 0 then
				continue
			end

			local radius = pickupRadiusFor(player)
			local radiusSquared = radius * radius

			for _, coin in coins do
				if not active[coin] then
					continue
				end

				local offset = coin.Position - root.Position
				if offset:Dot(offset) <= radiusSquared then
					collect(player, coin)
				end
			end
		end
	end)
end

return CoinService
