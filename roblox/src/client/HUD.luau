--!strict
-- Builds the whole interface in code. Nothing about the UI lives in the .rbxl,
-- so the file you sync is the single source of truth for how the game looks.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Upgrades = require(Shared:WaitForChild("Upgrades"))

local Theme = require(script.Parent:WaitForChild("Theme"))

local HUD = {}

local player = Players.LocalPlayer

local coinLabel: TextLabel
local rows: { [string]: { button: TextButton, level: TextLabel } } = {}
local popupLayer: Frame

local state = {
	coins = 0,
	upgrades = {} :: { [string]: number },
}

local onPurchase: ((string) -> ())? = nil

local function corner(parent: Instance)
	local c = Instance.new("UICorner")
	c.CornerRadius = Theme.Corner
	c.Parent = parent
end

local function stroke(parent: Instance)
	local s = Instance.new("UIStroke")
	s.Color = Theme.PanelStroke
	s.Thickness = 1
	s.Parent = parent
end

local function formatNumber(n: number): string
	local text = tostring(math.floor(n))
	local formatted = text
	while true do
		local replaced: number
		formatted, replaced = string.gsub(formatted, "^(-?%d+)(%d%d%d)", "%1,%2")
		if replaced == 0 then
			break
		end
	end
	return formatted
end

local function buildCounter(parent: ScreenGui)
	local frame = Instance.new("Frame")
	frame.Name = "CoinCounter"
	frame.AnchorPoint = Vector2.new(0.5, 0)
	frame.Position = UDim2.new(0.5, 0, 0, 16)
	frame.Size = UDim2.fromOffset(200, 52)
	frame.BackgroundColor3 = Theme.Panel
	frame.BackgroundTransparency = 0.1
	frame.Parent = parent
	corner(frame)
	stroke(frame)

	local icon = Instance.new("TextLabel")
	icon.BackgroundTransparency = 1
	icon.Position = UDim2.fromOffset(14, 0)
	icon.Size = UDim2.new(0, 28, 1, 0)
	icon.Font = Theme.Font
	icon.Text = "●"
	icon.TextColor3 = Theme.Accent
	icon.TextSize = 26
	icon.Parent = frame

	coinLabel = Instance.new("TextLabel")
	coinLabel.Name = "Amount"
	coinLabel.BackgroundTransparency = 1
	coinLabel.Position = UDim2.fromOffset(44, 0)
	coinLabel.Size = UDim2.new(1, -58, 1, 0)
	coinLabel.Font = Theme.Font
	coinLabel.Text = "0"
	coinLabel.TextColor3 = Theme.Text
	coinLabel.TextSize = 24
	coinLabel.TextXAlignment = Enum.TextXAlignment.Left
	coinLabel.Parent = frame
end

local function buildShop(parent: ScreenGui)
	local panel = Instance.new("Frame")
	panel.Name = "Shop"
	panel.AnchorPoint = Vector2.new(0, 1)
	panel.Position = UDim2.new(0, 16, 1, -16)
	panel.Size = UDim2.fromOffset(300, 44 + 66 * 2)
	panel.BackgroundColor3 = Theme.Panel
	panel.BackgroundTransparency = 0.1
	panel.Parent = parent
	corner(panel)
	stroke(panel)

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 12)
	padding.PaddingLeft = UDim.new(0, 12)
	padding.PaddingRight = UDim.new(0, 12)
	padding.PaddingBottom = UDim.new(0, 12)
	padding.Parent = panel

	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 8)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = panel

	local title = Instance.new("TextLabel")
	title.BackgroundTransparency = 1
	title.Size = UDim2.new(1, 0, 0, 20)
	title.Font = Theme.Font
	title.Text = "UPGRADES"
	title.TextColor3 = Theme.Muted
	title.TextSize = 13
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.LayoutOrder = 0
	title.Parent = panel

	local order = 1
	for id, def in Config.Upgrades do
		local button = Instance.new("TextButton")
		button.Name = id
		button.Size = UDim2.new(1, 0, 0, 52)
		button.BackgroundColor3 = Theme.Background
		button.AutoButtonColor = true
		button.Font = Theme.Font
		button.Text = ""
		button.LayoutOrder = order
		button.Parent = panel
		corner(button)
		stroke(button)

		local name = Instance.new("TextLabel")
		name.BackgroundTransparency = 1
		name.Position = UDim2.fromOffset(12, 8)
		name.Size = UDim2.new(1, -24, 0, 18)
		name.Font = Theme.Font
		name.Text = def.DisplayName
		name.TextColor3 = Theme.Text
		name.TextSize = 15
		name.TextXAlignment = Enum.TextXAlignment.Left
		name.Parent = button

		local level = Instance.new("TextLabel")
		level.Name = "Detail"
		level.BackgroundTransparency = 1
		level.Position = UDim2.fromOffset(12, 26)
		level.Size = UDim2.new(1, -24, 0, 16)
		level.Font = Theme.BodyFont
		level.Text = "Lv 0  •  50"
		level.TextColor3 = Theme.Muted
		level.TextSize = 13
		level.TextXAlignment = Enum.TextXAlignment.Left
		level.Parent = button

		button.Activated:Connect(function()
			if onPurchase then
				onPurchase(id)
			end
		end)

		rows[id] = { button = button, level = level }
		order += 1
	end

	panel.Size = UDim2.fromOffset(300, 44 + 60 * (order - 1))
end

local function refreshShop()
	for id, row in rows do
		local level = state.upgrades[id] or 0
		local cost = Upgrades.costOf(id, level)

		if cost then
			row.level.Text = string.format("Lv %d  •  %s coins", level, formatNumber(cost))
			row.level.TextColor3 = if state.coins >= cost then Theme.Positive else Theme.Muted
		else
			row.level.Text = string.format("Lv %d  •  MAX", level)
			row.level.TextColor3 = Theme.Accent
		end
	end
end

function HUD.build(): ScreenGui
	local gui = Instance.new("ScreenGui")
	gui.Name = "MainHUD"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = player:WaitForChild("PlayerGui")

	popupLayer = Instance.new("Frame")
	popupLayer.Name = "Popups"
	popupLayer.BackgroundTransparency = 1
	popupLayer.Size = UDim2.fromScale(1, 1)
	popupLayer.Parent = gui

	buildCounter(gui)
	buildShop(gui)
	refreshShop()

	return gui
end

function HUD.onPurchaseRequested(callback: (string) -> ())
	onPurchase = callback
end

function HUD.setProfile(profile: { Coins: number, Upgrades: { [string]: number } })
	state.coins = profile.Coins
	state.upgrades = profile.Upgrades

	coinLabel.Text = formatNumber(profile.Coins)
	refreshShop()
end

-- A "+N" that floats up and fades, anchored near the middle of the screen.
function HUD.popup(amount: number, positive: boolean)
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.AnchorPoint = Vector2.new(0.5, 0.5)
	label.Position = UDim2.new(0.5, math.random(-60, 60), 0.42, math.random(-20, 20))
	label.Size = UDim2.fromOffset(140, 32)
	label.Font = Theme.Font
	label.Text = (if positive then "+" else "") .. formatNumber(amount)
	label.TextColor3 = if positive then Theme.Accent else Theme.Negative
	label.TextSize = 26
	label.TextStrokeTransparency = 0.5
	label.Parent = popupLayer

	local tween = TweenService:Create(label, TweenInfo.new(0.8, Enum.EasingStyle.Quad), {
		Position = label.Position - UDim2.fromOffset(0, 60),
		TextTransparency = 1,
		TextStrokeTransparency = 1,
	})
	tween.Completed:Connect(function()
		label:Destroy()
	end)
	tween:Play()
end

function HUD.toast(message: string)
	local label = Instance.new("TextLabel")
	label.AnchorPoint = Vector2.new(0.5, 0)
	label.Position = UDim2.new(0.5, 0, 0, 78)
	label.Size = UDim2.fromOffset(240, 32)
	label.BackgroundColor3 = Theme.Panel
	label.Font = Theme.BodyFont
	label.Text = message
	label.TextColor3 = Theme.Negative
	label.TextSize = 14
	label.Parent = popupLayer
	corner(label)

	task.delay(1.6, function()
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

return HUD
