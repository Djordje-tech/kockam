--!strict
-- The economy. Assigns a shelter, runs live production, and validates every
-- purchase.
--
-- Production is credited on a slow tick rather than a heartbeat: this is
-- bookkeeping, and a player cannot perceive the difference between crediting
-- supplies 1x and 60x a second.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Net = require(Shared:WaitForChild("Net"))
local Shelter = require(Shared:WaitForChild("Shelter"))

local DataService = require(script.Parent:WaitForChild("DataService"))
local PlotService = require(script.Parent:WaitForChild("PlotService"))

local ShelterService = {}

local PURCHASE_COOLDOWN = 0.2

-- Production arrives in fractions of a supply. Whole units are banked to the
-- profile; the remainder rides here between ticks so slow shelters still pay
-- out eventually instead of flooring to zero forever.
local remainders: { [Player]: number } = {}
local lastPurchase: { [Player]: number } = {}

local purchaseResult: RemoteEvent

local function redraw(player: Player)
	local profile = DataService.get(player)
	if profile then
		PlotService.refresh(player, profile.Slots, profile.Supplies)
	end
end

local function onSlotTriggered(player: Player, slotIndex: number)
	if slotIndex < 1 or slotIndex > Config.SlotCount then
		return
	end

	local now = os.clock()
	if now - (lastPurchase[player] or 0) < PURCHASE_COOLDOWN then
		return
	end
	lastPurchase[player] = now

	local profile = DataService.get(player)
	if not profile then
		return
	end

	-- A prompt can only be triggered from the world, but the slot still has to
	-- belong to the player triggering it.
	local plot = PlotService.plotOf(player)
	if not plot then
		return
	end

	local level = profile.Slots[slotIndex] or 0
	local cost = Shelter.upgradeCost(level)
	if not cost then
		purchaseResult:FireClient(player, false, "Already at max tier")
		return
	end

	if not DataService.trySpend(player, cost) then
		purchaseResult:FireClient(player, false, "Not enough supplies")
		return
	end

	profile.Slots[slotIndex] = level + 1
	DataService.push(player)
	redraw(player)

	local tier = Shelter.tierAt(level + 1)
	purchaseResult:FireClient(player, true, if tier then tier.Name else nil)
end

local function onCharacterAdded(player: Player, character: Model)
	local spawnPoint = PlotService.spawnPointFor(player)
	if not spawnPoint then
		return
	end

	-- PivotTo needs the model fully streamed in, and the default spawn wins if
	-- we move too early.
	local root = character:WaitForChild("HumanoidRootPart", 10)
	if root then
		character:PivotTo(CFrame.new(spawnPoint))
	end
end

local function onPlayerAdded(player: Player)
	PlotService.assign(player)

	player.CharacterAdded:Connect(function(character)
		task.spawn(onCharacterAdded, player, character)
	end)

	if player.Character then
		task.spawn(onCharacterAdded, player, player.Character)
	end

	-- The profile loads asynchronously, so wait for it before drawing prices.
	task.spawn(function()
		for _ = 1, 100 do
			if DataService.get(player) then
				redraw(player)
				return
			end
			task.wait(0.2)
		end
	end)
end

local function tick(delta: number)
	for _, player in Players:GetPlayers() do
		local profile = DataService.get(player)
		if not profile then
			continue
		end

		local perMinute = Shelter.totalRate(profile.Slots)
		if perMinute <= 0 then
			continue
		end

		local produced = (remainders[player] or 0) + perMinute * (delta / 60)
		local whole = math.floor(produced)

		remainders[player] = produced - whole

		if whole > 0 then
			DataService.addSupplies(player, whole)
			redraw(player)
		end
	end
end

function ShelterService.start()
	purchaseResult = Net.event("PurchaseResult")

	PlotService.onSlotTriggered = onSlotTriggered

	for _, player in Players:GetPlayers() do
		task.spawn(onPlayerAdded, player)
	end
	Players.PlayerAdded:Connect(function(player)
		task.spawn(onPlayerAdded, player)
	end)

	Players.PlayerRemoving:Connect(function(player)
		remainders[player] = nil
		lastPurchase[player] = nil
	end)

	task.spawn(function()
		while true do
			local delta = task.wait(Config.TickInterval)
			tick(delta)
		end
	end)
end

return ShelterService
