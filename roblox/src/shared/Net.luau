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
--
-- Bounded rather than infinite. If the server never gets far enough to create
-- its remotes, an unbounded wait hides that behind a silent hang; this way the
-- output names the remote that never arrived.
function Net.waitForEvent(name: string, timeout: number?): RemoteEvent
	local seconds = timeout or 20

	local parent = ReplicatedStorage:WaitForChild(FOLDER_NAME, seconds)
	if not parent then
		error(`[Net] '{FOLDER_NAME}' never appeared - the server did not finish starting`, 0)
	end

	local remote = parent:WaitForChild(name, seconds)
	if not remote then
		error(`[Net] remote '{name}' never appeared - the server did not publish it`, 0)
	end

	return remote :: RemoteEvent
end

return Net
