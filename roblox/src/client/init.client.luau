--!strict
-- Client entry point.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")

local Net = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Net"))

local HUD = require(script:WaitForChild("HUD"))
local VitalsHUD = require(script:WaitForChild("VitalsHUD"))

HUD.build()
VitalsHUD.build()

local profileSync = Net.waitForEvent("ProfileSync")
local offlineReport = Net.waitForEvent("OfflineReport")
local purchaseResult = Net.waitForEvent("PurchaseResult")
local vitalsSync = Net.waitForEvent("VitalsSync")
local sprintRequest = Net.waitForEvent("SprintRequest")

profileSync.OnClientEvent:Connect(function(profile)
	HUD.setProfile(profile)
end)

offlineReport.OnClientEvent:Connect(function(amount, secondsAway)
	HUD.offlineReport(amount, secondsAway)
end)

purchaseResult.OnClientEvent:Connect(function(success, detail)
	if success then
		HUD.toast(string.format("%s online", detail or "Built"), true)
	elseif detail then
		HUD.toast(detail, false)
	end
end)

vitalsSync.OnClientEvent:Connect(function(vitals)
	VitalsHUD.update(vitals)
end)

-- Sprint is a request, not a command. The server decides whether the body can
-- actually deliver it, so holding shift while exhausted does nothing.
local function setSprint(wants: boolean)
	sprintRequest:FireServer(wants)
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	if input.KeyCode == Enum.KeyCode.LeftShift or input.KeyCode == Enum.KeyCode.RightShift then
		setSprint(true)
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.KeyCode == Enum.KeyCode.LeftShift or input.KeyCode == Enum.KeyCode.RightShift then
		setSprint(false)
	end
end)
