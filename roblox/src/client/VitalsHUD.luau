--!strict
-- The body readout. Four bars and a temperature, bottom-left.
--
-- Deliberately quiet: these are things a player checks, not things that should
-- shout. Colour only changes when a value is actually worth acting on.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Survival = require(Shared:WaitForChild("Survival"))

local Theme = require(script.Parent:WaitForChild("Theme"))

local VitalsHUD = {}

local player = Players.LocalPlayer

type Row = {
	fill: Frame,
	label: TextLabel,
}

local rows: { [string]: Row } = {}
local tempLabel: TextLabel
local loadLabel: TextLabel

local BAR_WIDTH = 176
local BAR_HEIGHT = 9

local function makeRow(parent: Instance, name: string, order: number, colour: Color3): Row
	local holder = Instance.new("Frame")
	holder.Name = name
	holder.BackgroundTransparency = 1
	holder.Size = UDim2.fromOffset(BAR_WIDTH, 26)
	holder.LayoutOrder = order
	holder.Parent = parent

	local label = Instance.new("TextLabel")
	label.Name = "Label"
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, 0, 0, 13)
	label.Font = Theme.Body
	label.Text = name
	label.TextColor3 = Theme.Muted
	label.TextSize = 11
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Parent = holder

	local track = Instance.new("Frame")
	track.Name = "Track"
	track.Position = UDim2.fromOffset(0, 15)
	track.Size = UDim2.fromOffset(BAR_WIDTH, BAR_HEIGHT)
	track.BackgroundColor3 = Theme.Sunk
	track.BorderSizePixel = 0
	track.Parent = holder

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 3)
	corner.Parent = track

	local fill = Instance.new("Frame")
	fill.Name = "Fill"
	fill.Size = UDim2.fromScale(1, 1)
	fill.BackgroundColor3 = colour
	fill.BorderSizePixel = 0
	fill.Parent = track

	local fillCorner = Instance.new("UICorner")
	fillCorner.CornerRadius = UDim.new(0, 3)
	fillCorner.Parent = fill

	local row = { fill = fill, label = label }
	rows[name] = row
	return row
end

function VitalsHUD.build()
	local gui = Instance.new("ScreenGui")
	gui.Name = "VitalsHUD"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = player:WaitForChild("PlayerGui")

	local panel = Instance.new("Frame")
	panel.Name = "Vitals"
	panel.AnchorPoint = Vector2.new(0, 1)
	panel.Position = UDim2.new(0, 16, 1, -16)
	panel.Size = UDim2.fromOffset(BAR_WIDTH + 28, 190)
	panel.BackgroundColor3 = Theme.Panel
	panel.BackgroundTransparency = 0.15
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
	padding.PaddingBottom = UDim.new(0, 12)
	padding.Parent = panel

	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 6)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = panel

	makeRow(panel, "STAMINA", 1, Theme.Good)
	makeRow(panel, "HYDRATION", 2, Color3.fromRGB(96, 170, 214))
	makeRow(panel, "CARBS", 3, Theme.Amber)
	makeRow(panel, "PROTEIN", 4, Color3.fromRGB(198, 122, 96))

	local footer = Instance.new("Frame")
	footer.BackgroundTransparency = 1
	footer.Size = UDim2.fromOffset(BAR_WIDTH, 16)
	footer.LayoutOrder = 5
	footer.Parent = panel

	tempLabel = Instance.new("TextLabel")
	tempLabel.BackgroundTransparency = 1
	tempLabel.Size = UDim2.fromScale(0.55, 1)
	tempLabel.Font = Theme.Font
	tempLabel.Text = "37.0 C"
	tempLabel.TextColor3 = Theme.Text
	tempLabel.TextSize = 12
	tempLabel.TextXAlignment = Enum.TextXAlignment.Left
	tempLabel.Parent = footer

	loadLabel = Instance.new("TextLabel")
	loadLabel.BackgroundTransparency = 1
	loadLabel.Position = UDim2.fromScale(0.55, 0)
	loadLabel.Size = UDim2.fromScale(0.45, 1)
	loadLabel.Font = Theme.Body
	loadLabel.Text = "0.0 kg"
	loadLabel.TextColor3 = Theme.Muted
	loadLabel.TextSize = 12
	loadLabel.TextXAlignment = Enum.TextXAlignment.Right
	loadLabel.Parent = footer
end

local function setRow(name: string, fraction: number, warnBelow: number, colour: Color3)
	local row = rows[name]
	if not row then
		return
	end

	local value = math.clamp(fraction, 0, 1)
	row.fill.Size = UDim2.fromScale(value, 1)
	row.fill.BackgroundColor3 = if value <= warnBelow then Theme.Bad else colour
	row.label.TextColor3 = if value <= warnBelow then Theme.Bad else Theme.Muted
end

function VitalsHUD.update(vitals: Survival.Vitals)
	-- Stamina is shown as what is left, not as lactate accumulated. Players
	-- read a bar that empties, not one that fills toward a punishment.
	setRow("STAMINA", 1 - vitals.Lactate, 0.2, Theme.Good)
	setRow("HYDRATION", vitals.Hydration / 100, 0.2, Color3.fromRGB(96, 170, 214))
	setRow("CARBS", vitals.Carbs / 100, 0.15, Theme.Amber)
	setRow("PROTEIN", vitals.Protein / 100, 0.15, Color3.fromRGB(198, 122, 96))

	local staminaRow = rows.STAMINA
	if staminaRow then
		staminaRow.label.Text = if vitals.Exhausted then "STAMINA - MUSCLE FAILURE" else "STAMINA"
	end

	tempLabel.Text = string.format("%.1f C", vitals.CoreTemp)
	if vitals.CoreTemp < Survival.HypothermiaOnset then
		tempLabel.TextColor3 = Color3.fromRGB(120, 178, 226)
	elseif vitals.CoreTemp > Survival.HyperthermiaOnset then
		tempLabel.TextColor3 = Theme.Bad
	else
		tempLabel.TextColor3 = Theme.Text
	end

	loadLabel.Text = string.format("%.1f kg", vitals.LoadKg)
	loadLabel.TextColor3 = if Survival.encumbrance(vitals.LoadKg) > 0.7 then Theme.Bad else Theme.Muted
end

return VitalsHUD
