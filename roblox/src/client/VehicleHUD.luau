--!strict
-- Dashboard. Only visible while sitting in a vehicle.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Vehicles = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Vehicles"))
local Theme = require(script.Parent:WaitForChild("Theme"))

local VehicleHUD = {}

local player = Players.LocalPlayer

local panel: Frame
local fuelFill: Frame
local fuelLabel: TextLabel
local tempLabel: TextLabel
local statusLabel: TextLabel

local lastSeen = 0

local function bar(parent: Instance, order: number): Frame
	local track = Instance.new("Frame")
	track.Size = UDim2.fromOffset(196, 10)
	track.BackgroundColor3 = Theme.Sunk
	track.BorderSizePixel = 0
	track.LayoutOrder = order
	track.Parent = parent

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 3)
	corner.Parent = track

	local fill = Instance.new("Frame")
	fill.Size = UDim2.fromScale(1, 1)
	fill.BackgroundColor3 = Theme.Amber
	fill.BorderSizePixel = 0
	fill.Parent = track

	local fillCorner = Instance.new("UICorner")
	fillCorner.CornerRadius = UDim.new(0, 3)
	fillCorner.Parent = fill

	return fill
end

local function label(parent: Instance, order: number, size: number, colour: Color3): TextLabel
	local text = Instance.new("TextLabel")
	text.BackgroundTransparency = 1
	text.Size = UDim2.fromOffset(196, size + 4)
	text.Font = Theme.Body
	text.Text = ""
	text.TextColor3 = colour
	text.TextSize = size
	text.TextXAlignment = Enum.TextXAlignment.Left
	text.TextTruncate = Enum.TextTruncate.AtEnd
	text.LayoutOrder = order
	text.Parent = parent
	return text
end

function VehicleHUD.build()
	local gui = Instance.new("ScreenGui")
	gui.Name = "VehicleHUD"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.Parent = player:WaitForChild("PlayerGui")

	panel = Instance.new("Frame")
	panel.Name = "Dashboard"
	panel.AnchorPoint = Vector2.new(1, 1)
	panel.Position = UDim2.new(1, -16, 1, -16)
	panel.Size = UDim2.fromOffset(224, 122)
	panel.BackgroundColor3 = Theme.Panel
	panel.BackgroundTransparency = 0.15
	panel.Visible = false
	panel.Parent = gui

	local corner = Instance.new("UICorner")
	corner.CornerRadius = Theme.Corner
	corner.Parent = panel

	local stroke = Instance.new("UIStroke")
	stroke.Color = Theme.PanelEdge
	stroke.Parent = panel

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 12)
	padding.PaddingLeft = UDim.new(0, 14)
	padding.Parent = panel

	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 5)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = panel

	fuelLabel = label(panel, 1, 11, Theme.Muted)
	fuelFill = bar(panel, 2)
	tempLabel = label(panel, 3, 12, Theme.Text)
	statusLabel = label(panel, 4, 12, Theme.Bad)
end

function VehicleHUD.update(state: {
	Fuel: number,
	Capacity: number,
	Coolant: number,
	Running: boolean,
	Reason: string?,
	Parts: { [string]: boolean },
})
	lastSeen = os.clock()
	panel.Visible = true

	local fraction = math.clamp(state.Fuel / state.Capacity, 0, 1)
	fuelFill.Size = UDim2.fromScale(fraction, 1)
	fuelFill.BackgroundColor3 = if fraction < 0.12 then Theme.Bad else Theme.Amber
	fuelLabel.Text = string.format("FUEL  %.1f / %d L", state.Fuel, state.Capacity)

	tempLabel.Text = string.format("Coolant  %d C", math.floor(state.Coolant))
	if state.Coolant >= Vehicles.CoolantWarning then
		tempLabel.TextColor3 = Theme.Bad
		tempLabel.Text ..= "  OVERHEATING"
	elseif state.Coolant >= Vehicles.CoolantNormal then
		tempLabel.TextColor3 = Theme.Amber
	else
		tempLabel.TextColor3 = Theme.Text
	end

	if state.Running then
		statusLabel.Text = "engine running"
		statusLabel.TextColor3 = Theme.Good
		return
	end

	-- Name what is actually missing. "Won't start" is not information.
	local missing = {}
	for _, id in Vehicles.RequiredParts do
		if not state.Parts[id] then
			table.insert(missing, Vehicles.PartNames[id])
		end
	end

	if #missing > 0 then
		statusLabel.Text = "needs " .. table.concat(missing, ", ")
	else
		statusLabel.Text = state.Reason or "engine off"
	end
	statusLabel.TextColor3 = Theme.Bad
end

-- The server only sends while someone is seated, so silence means out.
function VehicleHUD.start()
	task.spawn(function()
		while true do
			task.wait(0.5)
			if panel and panel.Visible and os.clock() - lastSeen > 1.5 then
				panel.Visible = false
			end
		end
	end)
end

return VehicleHUD
