--!strict
-- Game pass ownership, cached per session. MarketplaceService is a network
-- call, so we never ask it on a gameplay hot path.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local PassService = {}

local owned: { [Player]: { [number]: boolean } } = {}

function PassService.owns(player: Player, passId: number): boolean
	-- Id 0 means "not configured yet". Treat it as unowned so the game runs
	-- perfectly well before any pass exists on the Creator Dashboard.
	if passId == 0 then
		return false
	end

	local cache = owned[player]
	if not cache then
		cache = {}
		owned[player] = cache
	end

	local cached = cache[passId]
	if cached ~= nil then
		return cached
	end

	local ok, result = pcall(function()
		return MarketplaceService:UserOwnsGamePassAsync(player.UserId, passId)
	end)

	local value = ok and result == true
	cache[passId] = value
	return value
end

-- Total earnings multiplier from passes alone.
function PassService.coinMultiplier(player: Player): number
	if PassService.owns(player, Config.GamePasses.DoubleCoins) then
		return Config.DoubleCoinsMultiplier
	end
	return 1
end

function PassService.start()
	Players.PlayerRemoving:Connect(function(player)
		owned[player] = nil
	end)

	-- A player who buys mid-session should feel it immediately.
	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
		if not purchased then
			return
		end

		local cache = owned[player]
		if not cache then
			cache = {}
			owned[player] = cache
		end
		cache[passId] = true
	end)
end

return PassService
