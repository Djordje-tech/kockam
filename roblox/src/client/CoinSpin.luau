--!strict
-- Spins the orbs locally. Doing this on the client keeps 25 rotating parts
-- off the replication budget entirely — the server only ever sends a coin's
-- position when it respawns.

local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local CoinSpin = {}

local SPIN_SPEED = 2.5

function CoinSpin.start()
	local folder = Workspace:WaitForChild("Coins")
	local angle = 0

	RunService.RenderStepped:Connect(function(dt)
		angle = (angle + dt * SPIN_SPEED) % (math.pi * 2)

		for _, coin in folder:GetChildren() do
			if coin:IsA("BasePart") and coin.Transparency < 1 then
				-- Rebuilding from the current position, never accumulating an
				-- offset, so a server reposition is picked up cleanly.
				coin.CFrame = CFrame.new(coin.Position) * CFrame.Angles(0, angle, 0)
			end
		end
	end)
end

return CoinSpin
