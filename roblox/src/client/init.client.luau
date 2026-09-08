--!strict
-- Client entry point.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Net = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Net"))

local HUD = require(script:WaitForChild("HUD"))
local CoinSpin = require(script:WaitForChild("CoinSpin"))

HUD.build()
CoinSpin.start()

local profileSync = Net.waitForEvent("ProfileSync")
local coinCollected = Net.waitForEvent("CoinCollected")
local purchaseUpgrade = Net.waitForEvent("PurchaseUpgrade")
local purchaseResult = Net.waitForEvent("PurchaseResult")

profileSync.OnClientEvent:Connect(function(profile)
	HUD.setProfile(profile)
end)

coinCollected.OnClientEvent:Connect(function(amount)
	HUD.popup(amount, true)
end)

purchaseResult.OnClientEvent:Connect(function(_id, success, reason)
	if not success and reason then
		HUD.toast(reason)
	end
end)

HUD.onPurchaseRequested(function(id)
	purchaseUpgrade:FireServer(id)
end)
