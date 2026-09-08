--!strict
-- Upgrade purchases. The client sends an intent; the server decides.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Net = require(Shared:WaitForChild("Net"))
local Upgrades = require(Shared:WaitForChild("Upgrades"))

local DataService = require(script.Parent:WaitForChild("DataService"))

local ShopService = {}

local COOLDOWN = 0.25

local lastRequest: { [Player]: number } = {}

function ShopService.start()
	local purchase: RemoteEvent = Net.event("PurchaseUpgrade")
	local result: RemoteEvent = Net.event("PurchaseResult")

	purchase.OnServerEvent:Connect(function(player, id)
		-- Never trust the payload: it arrives from the client.
		if type(id) ~= "string" or not Config.Upgrades[id] then
			return
		end

		local now = os.clock()
		if now - (lastRequest[player] or 0) < COOLDOWN then
			return
		end
		lastRequest[player] = now

		local profile = DataService.get(player)
		if not profile then
			return
		end

		local level = profile.Upgrades[id] or 0
		local cost = Upgrades.costOf(id, level)
		if not cost then
			result:FireClient(player, id, false, "Maxed out")
			return
		end

		if not DataService.trySpend(player, cost) then
			result:FireClient(player, id, false, "Not enough coins")
			return
		end

		DataService.setUpgradeLevel(player, id, level + 1)
		result:FireClient(player, id, true, nil)
	end)

	game:GetService("Players").PlayerRemoving:Connect(function(player)
		lastRequest[player] = nil
	end)
end

return ShopService
