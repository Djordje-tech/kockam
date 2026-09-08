--!strict
-- Transient messages only. Everything persistent lives in its own HUD module.

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local Theme = require(script.Parent:WaitForChild("Theme"))

local HUD = {}

local player = Players.LocalPlayer
local layer: Frame

function HUD.build(): ScreenGui
	local gui = Instance.new("ScreenGui")
	gui.Name = "MessageHUD"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = player:WaitForChild("PlayerGui")

	layer = Instance.new("Frame")
	layer.Name = "Overlay"
	layer.BackgroundTransparency = 1
	layer.Size = UDim2.fromScale(1, 1)
	layer.Parent = gui

	return gui
end

function HUD.toast(message: string, good: boolean)
	local label = Instance.new("TextLabel")
	label.AnchorPoint = Vector2.new(0.5, 0)
	label.Position = UDim2.new(0.5, 0, 0, 24)
	label.Size = UDim2.fromOffset(280, 34)
	label.BackgroundColor3 = Theme.Panel
	label.Font = Theme.Body
	label.Text = message
	label.TextColor3 = if good then Theme.Good else Theme.Bad
	label.TextSize = 14
	label.Parent = layer

	local corner = Instance.new("UICorner")
	corner.CornerRadius = Theme.Corner
	corner.Parent = label

	local stroke = Instance.new("UIStroke")
	stroke.Color = Theme.PanelEdge
	stroke.Parent = label

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

return HUD
