--!strict
-- The whole interface, built in code. Nothing about the UI is stored in the
-- place file, so this module is the single source of truth for how the game
-- looks.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Shelter = require(Shared:WaitForChild("Shelter"))

local Theme = require(script.Parent:WaitForChild("Theme"))

local HUD = {}

local player = Players.LocalPlayer

local suppliesLabel: TextLabel
local rateLabel: TextLabel
local layer: Frame

local function corner(parent: Instance)
	local c = Instance.new("UICorner")
	c.CornerRadius = Theme.Corner
	c.Parent = parent
end

local function stroke(parent: Instance, color: Color3?)
	local s = Instance.new("UIStroke")
	s.Color = color or Theme.PanelEdge
	s.Thickness = 1
	s.Parent = parent
end

local function commas(n: number): string
	local text = tostring(math.floor(n))
	while true do
		local replaced: number
		text, replaced = string.gsub(text, "^(-?%d+)(%d%d%d)", "%1,%2")
		if replaced == 0 then
			break
		end
	end
	return text
end

-- "3h 20m" / "12m". Used for the away time, where seconds are noise.
local function duration(seconds: number): string
	local minutes = math.floor(seconds / 60)
	local hours = math.floor(minutes / 60)

	if hours > 0 then
		return string.format("%dh %dm", hours, minutes % 60)
	end
	return string.format("%dm", math.max(minutes, 1))
end

local function buildCounter(gui: ScreenGui)
	local frame = Instance.new("Frame")
	frame.Name = "Supplies"
	frame.AnchorPoint = Vector2.new(0.5, 0)
	frame.Position = UDim2.new(0.5, 0, 0, 14)
	frame.Size = UDim2.fromOffset(228, 62)
	frame.BackgroundColor3 = Theme.Panel
	frame.BackgroundTransparency = 0.08
	frame.Parent = gui
	corner(frame)
	stroke(frame)

	local title = Instance.new("TextLabel")
	title.BackgroundTransparency = 1
	title.Position = UDim2.fromOffset(0, 7)
	title.Size = UDim2.new(1, 0, 0, 13)
	title.Font = Theme.Body
	title.Text = "SUPPLIES"
	title.TextColor3 = Theme.Muted
	title.TextSize = 11
	title.Parent = frame

	suppliesLabel = Instance.new("TextLabel")
	suppliesLabel.Name = "Amount"
	suppliesLabel.BackgroundTransparency = 1
	suppliesLabel.Position = UDim2.fromOffset(0, 19)
	suppliesLabel.Size = UDim2.new(1, 0, 0, 26)
	suppliesLabel.Font = Theme.Font
	suppliesLabel.Text = "0"
	suppliesLabel.TextColor3 = Theme.Text
	suppliesLabel.TextSize = 24
	suppliesLabel.Parent = frame

	rateLabel = Instance.new("TextLabel")
	rateLabel.Name = "Rate"
	rateLabel.BackgroundTransparency = 1
	rateLabel.Position = UDim2.fromOffset(0, 43)
	rateLabel.Size = UDim2.new(1, 0, 0, 14)
	rateLabel.Font = Theme.Body
	rateLabel.Text = "+0 / min"
	rateLabel.TextColor3 = Theme.Amber
	rateLabel.TextSize = 12
	rateLabel.Parent = frame
end

function HUD.build(): ScreenGui
	local gui = Instance.new("ScreenGui")
	gui.Name = "QuarantineHUD"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = player:WaitForChild("PlayerGui")

	layer = Instance.new("Frame")
	layer.Name = "Overlay"
	layer.BackgroundTransparency = 1
	layer.Size = UDim2.fromScale(1, 1)
	layer.Parent = gui

	buildCounter(gui)
	return gui
end

function HUD.setProfile(profile: { Supplies: number, Slots: { number } })
	suppliesLabel.Text = commas(profile.Supplies)

	local rate = Shelter.totalRate(profile.Slots)
	rateLabel.Text = string.format("+%s / min", commas(rate))
	rateLabel.TextColor3 = if rate > 0 then Theme.Amber else Theme.Muted
end

function HUD.toast(message: string, good: boolean)
	local label = Instance.new("TextLabel")
	label.AnchorPoint = Vector2.new(0.5, 0)
	label.Position = UDim2.new(0.5, 0, 0, 84)
	label.Size = UDim2.fromOffset(260, 34)
	label.BackgroundColor3 = Theme.Panel
	label.Font = Theme.Body
	label.Text = message
	label.TextColor3 = if good then Theme.Good else Theme.Bad
	label.TextSize = 14
	label.Parent = layer
	corner(label)
	stroke(label)

	task.delay(1.8, function()
		local tween = TweenService:Create(label, TweenInfo.new(0.35), {
			BackgroundTransparency = 1,
			TextTransparency = 1,
		})
		tween.Completed:Connect(function()
			label:Destroy()
		end)
		tween:Play()
	end)
end

-- The "while you were away" card. This is the moment that makes coming back
-- feel rewarded, so it gets a real panel rather than a toast.
function HUD.offlineReport(amount: number, secondsAway: number)
	local card = Instance.new("Frame")
	card.Name = "OfflineReport"
	card.AnchorPoint = Vector2.new(0.5, 0.5)
	card.Position = UDim2.fromScale(0.5, 0.42)
	card.Size = UDim2.fromOffset(320, 148)
	card.BackgroundColor3 = Theme.Panel
	card.Parent = layer
	corner(card)
	stroke(card, Theme.Amber)

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 18)
	padding.Parent = card

	local title = Instance.new("TextLabel")
	title.BackgroundTransparency = 1
	title.Size = UDim2.new(1, 0, 0, 16)
	title.Font = Theme.Body
	title.Text = "WHILE YOU WERE GONE"
	title.TextColor3 = Theme.Muted
	title.TextSize = 12
	title.Parent = card

	local value = Instance.new("TextLabel")
	value.BackgroundTransparency = 1
	value.Position = UDim2.fromOffset(0, 30)
	value.Size = UDim2.new(1, 0, 0, 46)
	value.Font = Theme.Font
	value.Text = "+" .. commas(amount)
	value.TextColor3 = Theme.Amber
	value.TextSize = 40
	value.Parent = card

	local caption = Instance.new("TextLabel")
	caption.BackgroundTransparency = 1
	caption.Position = UDim2.fromOffset(0, 78)
	caption.Size = UDim2.new(1, 0, 0, 18)
	caption.Font = Theme.Body
	caption.Text = string.format("supplies banked over %s", duration(secondsAway))
	caption.TextColor3 = Theme.Text
	caption.TextSize = 13
	caption.Parent = card

	local dismiss = Instance.new("TextButton")
	dismiss.AnchorPoint = Vector2.new(0.5, 1)
	dismiss.Position = UDim2.new(0.5, 0, 1, -16)
	dismiss.Size = UDim2.fromOffset(140, 32)
	dismiss.BackgroundColor3 = Theme.Sunk
	dismiss.Font = Theme.Font
	dismiss.Text = "COLLECT"
	dismiss.TextColor3 = Theme.Text
	dismiss.TextSize = 13
	dismiss.Parent = card
	corner(dismiss)
	stroke(dismiss)

	dismiss.Activated:Connect(function()
		card:Destroy()
	end)

	-- Auto-clears, so a player who walks away does not come back to a blocked
	-- screen.
	task.delay(12, function()
		if card.Parent then
			card:Destroy()
		end
	end)
end

return HUD
