--!strict
-- Client entry point.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Net = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Net"))

local HUD = require(script:WaitForChild("HUD"))

HUD.build()

local profileSync = Net.waitForEvent("ProfileSync")
local offlineReport = Net.waitForEvent("OfflineReport")
local purchaseResult = Net.waitForEvent("PurchaseResult")

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
