--!strict
-- Client entry point.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")

local Net = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Net"))

local HUD = require(script:WaitForChild("HUD"))
local VitalsHUD = require(script:WaitForChild("VitalsHUD"))

HUD.build()
VitalsHUD.build()

local vitalsSync = Net.waitForEvent("VitalsSync")
local sprintRequest = Net.waitForEvent("SprintRequest")

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
