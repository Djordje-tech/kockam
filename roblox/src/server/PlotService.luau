--!strict
-- Builds the physical shelters and keeps each one looking like the profile
-- behind it.
--
-- This module owns geometry and nothing else. It never decides whether a
-- purchase is allowed — it raises the intent and redraws whatever the
-- economy tells it the shelter now looks like.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Shelter = require(Shared:WaitForChild("Shelter"))

local PlotService = {}

-- Set by the economy layer. Receives the player and the slot index they tried
-- to buy or upgrade.
PlotService.onSlotTriggered = nil :: ((Player, number) -> ())?

local SLOTS_PER_ROW = 3
local SLOT_SPACING = 12

local plotsFolder: Folder
local plots: { { model: Folder, owner: Player? } } = {}
local ownerOf: { [Player]: number } = {}

local function plotPosition(index: number): Vector3
	-- Laid out in a line, centred on the origin, so the first players to join
	-- end up near each other rather than scattered across the map.
	local offset = (index - 1 - (Config.PlotCount - 1) / 2) * Config.PlotSpacing
	return Config.PlotOrigin + Vector3.new(offset, 0, 0)
end

local function slotOffset(slotIndex: number): Vector3
	local zeroBased = slotIndex - 1
	local column = zeroBased % SLOTS_PER_ROW
	local row = math.floor(zeroBased / SLOTS_PER_ROW)

	local rows = math.ceil(Config.SlotCount / SLOTS_PER_ROW)

	return Vector3.new(
		(column - (SLOTS_PER_ROW - 1) / 2) * SLOT_SPACING,
		0,
		(row - (rows - 1) / 2) * SLOT_SPACING
	)
end

local function buildPedestal(plot: Folder, slotIndex: number, origin: Vector3)
	local base = Instance.new("Part")
	base.Name = "Slot" .. slotIndex
	base.Anchored = true
	base.Size = Vector3.new(7, 1, 7)
	base.Position = origin + slotOffset(slotIndex) + Vector3.new(0, 1, 0)
	base.Color = Color3.fromRGB(58, 58, 62)
	base.Material = Enum.Material.Concrete
	base.TopSurface = Enum.SurfaceType.Smooth
	base.Parent = plot

	-- The thing that grows as the slot is upgraded.
	local unit = Instance.new("Part")
	unit.Name = "Unit"
	unit.Anchored = true
	unit.CanCollide = false
	unit.Size = Vector3.new(4, 1, 4)
	unit.Position = base.Position + Vector3.new(0, 1, 0)
	unit.Material = Enum.Material.Metal
	unit.Transparency = 1
	unit.Parent = base

	local label = Instance.new("BillboardGui")
	label.Name = "Label"
	label.Size = UDim2.fromOffset(190, 46)
	label.StudsOffsetWorldSpace = Vector3.new(0, 5.5, 0)
	label.AlwaysOnTop = true
	label.Parent = base

	local text = Instance.new("TextLabel")
	text.Name = "Text"
	text.BackgroundTransparency = 1
	text.Size = UDim2.fromScale(1, 1)
	text.Font = Enum.Font.GothamBold
	text.TextScaled = true
	text.TextColor3 = Color3.fromRGB(235, 235, 235)
	text.TextStrokeTransparency = 0.4
	text.Text = ""
	text.Parent = label

	local prompt = Instance.new("ProximityPrompt")
	prompt.Name = "Prompt"
	prompt.ActionText = "Build"
	prompt.ObjectText = "Slot"
	prompt.HoldDuration = 0
	prompt.MaxActivationDistance = 12
	prompt.RequiresLineOfSight = false
	prompt.Parent = base

	prompt.Triggered:Connect(function(player)
		local handler = PlotService.onSlotTriggered
		if handler then
			handler(player, slotIndex)
		end
	end)
end

local function buildPlot(index: number): Folder
	local plot = Instance.new("Folder")
	plot.Name = "Plot" .. index

	local origin = plotPosition(index)

	local pad = Instance.new("Part")
	pad.Name = "Pad"
	pad.Anchored = true
	pad.Size = Config.PlotSize
	pad.Position = origin + Vector3.new(0, Config.PlotSize.Y / 2, 0)
	pad.Color = Color3.fromRGB(74, 72, 68)
	pad.Material = Enum.Material.Concrete
	pad.TopSurface = Enum.SurfaceType.Smooth
	pad.Parent = plot

	local sign = Instance.new("Part")
	sign.Name = "Sign"
	sign.Anchored = true
	sign.CanCollide = false
	sign.Size = Vector3.new(10, 0.4, 0.4)
	sign.Position = origin + Vector3.new(0, 8, -Config.PlotSize.Z / 2 + 2)
	sign.Color = Color3.fromRGB(40, 40, 44)
	sign.Material = Enum.Material.Metal
	sign.Parent = plot

	local nameplate = Instance.new("BillboardGui")
	nameplate.Name = "Nameplate"
	nameplate.Size = UDim2.fromOffset(260, 52)
	nameplate.StudsOffsetWorldSpace = Vector3.new(0, 2, 0)
	nameplate.AlwaysOnTop = true
	nameplate.Parent = sign

	local owner = Instance.new("TextLabel")
	owner.Name = "Owner"
	owner.BackgroundTransparency = 1
	owner.Size = UDim2.fromScale(1, 1)
	owner.Font = Enum.Font.GothamBold
	owner.TextScaled = true
	owner.TextColor3 = Color3.fromRGB(215, 215, 215)
	owner.TextStrokeTransparency = 0.4
	owner.Text = "UNCLAIMED"
	owner.Parent = nameplate

	for slotIndex = 1, Config.SlotCount do
		buildPedestal(plot, slotIndex, origin)
	end

	plot.Parent = plotsFolder
	return plot
end

--- Public ---------------------------------------------------------------

function PlotService.plotOf(player: Player): Folder?
	local index = ownerOf[player]
	return if index then plots[index].model else nil
end

function PlotService.spawnPointFor(player: Player): Vector3?
	local index = ownerOf[player]
	if not index then
		return nil
	end
	return plotPosition(index) + Vector3.new(0, 6, Config.PlotSize.Z / 2 - 6)
end

function PlotService.assign(player: Player): boolean
	for index, plot in plots do
		if plot.owner == nil then
			plot.owner = player
			ownerOf[player] = index

			local sign = plot.model:FindFirstChild("Sign")
			local nameplate = sign and sign:FindFirstChild("Nameplate")
			local owner = nameplate and nameplate:FindFirstChild("Owner")
			if owner and owner:IsA("TextLabel") then
				owner.Text = string.upper(player.DisplayName) .. "'S SHELTER"
			end

			return true
		end
	end

	warn(`[PlotService] no free plot for {player.Name}`)
	return false
end

function PlotService.release(player: Player)
	local index = ownerOf[player]
	if not index then
		return
	end

	ownerOf[player] = nil
	plots[index].owner = nil

	local model = plots[index].model
	local sign = model:FindFirstChild("Sign")
	local nameplate = sign and sign:FindFirstChild("Nameplate")
	local owner = nameplate and nameplate:FindFirstChild("Owner")
	if owner and owner:IsA("TextLabel") then
		owner.Text = "UNCLAIMED"
	end

	for slotIndex = 1, Config.SlotCount do
		PlotService.drawSlot(model, slotIndex, 0, nil)
	end
end

-- Redraws one pedestal to match a slot level. `supplies` is only used to
-- colour the price, so nil means "do not know, show it neutral".
function PlotService.drawSlot(plot: Folder, slotIndex: number, level: number, supplies: number?)
	local base = plot:FindFirstChild("Slot" .. slotIndex)
	if not base or not base:IsA("BasePart") then
		return
	end

	local unit = base:FindFirstChild("Unit") :: BasePart?
	local label = base:FindFirstChild("Label")
	local text = label and label:FindFirstChild("Text") :: TextLabel?
	local prompt = base:FindFirstChild("Prompt") :: ProximityPrompt?

	if not unit or not text or not prompt then
		return
	end

	local tier = Shelter.tierAt(level)
	if tier then
		unit.Transparency = 0
		unit.Color = tier.Color
		unit.Size = Vector3.new(4, tier.Height, 4)
		unit.Position = base.Position + Vector3.new(0, 0.5 + tier.Height / 2, 0)
	else
		unit.Transparency = 1
	end

	local cost = Shelter.upgradeCost(level)
	if not cost then
		text.Text = string.format("%s\nMAX", tier and tier.Name or "Slot")
		text.TextColor3 = Color3.fromRGB(240, 200, 120)
		prompt.Enabled = false
		return
	end

	local nextTier = Shelter.tierAt(level + 1)
	local nextName = if nextTier then nextTier.Name else "Slot"

	text.Text = string.format("%s\n%d supplies", nextName, cost)
	prompt.Enabled = true
	prompt.ActionText = if level == 0 then "Build" else "Upgrade"
	prompt.ObjectText = nextName

	if supplies == nil then
		text.TextColor3 = Color3.fromRGB(220, 220, 220)
	elseif supplies >= cost then
		text.TextColor3 = Color3.fromRGB(130, 226, 150)
	else
		text.TextColor3 = Color3.fromRGB(226, 130, 130)
	end
end

function PlotService.refresh(player: Player, slots: { number }, supplies: number)
	local plot = PlotService.plotOf(player)
	if not plot then
		return
	end

	for slotIndex = 1, Config.SlotCount do
		PlotService.drawSlot(plot, slotIndex, slots[slotIndex] or 0, supplies)
	end
end

function PlotService.start()
	plotsFolder = Instance.new("Folder")
	plotsFolder.Name = "Plots"
	plotsFolder.Parent = Workspace

	for index = 1, Config.PlotCount do
		plots[index] = { model = buildPlot(index), owner = nil }
	end

	Players.PlayerRemoving:Connect(PlotService.release)
end

return PlotService
