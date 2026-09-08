--!strict
-- Thin wrapper over RemoteEvents so neither side hand-rolls WaitForChild
-- chains. The server creates remotes on demand; the client waits for them.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Net = {}

local FOLDER_NAME = "Remotes"

local function folder(): Instance
	if RunService:IsServer() then
		local existing = ReplicatedStorage:FindFirstChild(FOLDER_NAME)
		if existing then
			return existing
		end

		local created = Instance.new("Folder")
		created.Name = FOLDER_NAME
		created.Parent = ReplicatedStorage
		return created
	end

	return ReplicatedStorage:WaitForChild(FOLDER_NAME)
end

-- Server side: returns the remote, creating it the first time it is asked for.
function Net.event(name: string): RemoteEvent
	assert(RunService:IsServer(), "Net.event is server-only; clients use Net.waitForEvent")

	local parent = folder()
	local existing = parent:FindFirstChild(name)
	if existing then
		return existing :: RemoteEvent
	end

	local remote = Instance.new("RemoteEvent")
	remote.Name = name
	remote.Parent = parent
	return remote
end

-- Client side: blocks until the server has published the remote.
function Net.waitForEvent(name: string): RemoteEvent
	return folder():WaitForChild(name) :: RemoteEvent
end

return Net
