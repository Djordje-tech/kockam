--!strict
-- Server entry point.
--
-- Two rules here, both learned the hard way:
--
-- 1. Remotes come first. The client blocks on them, so anything slow or
--    failable that runs before they exist turns one server-side problem into
--    a client stuck waiting forever with no clue why.
-- 2. Every step is isolated. One failing system should cost you that system,
--    not the whole game, and the output should say exactly which one went.

local function need(name: string): ModuleScript
	local module = script:FindFirstChild(name)
	if not module or not module:IsA("ModuleScript") then
		error(`[QZ] missing module '{name}' - the sync did not deliver it`, 0)
	end
	return module
end

local function step(name: string, fn: () -> ())
	local started = os.clock()
	local ok, err = pcall(fn)
	local elapsed = math.floor((os.clock() - started) * 1000)

	if ok then
		print(`[QZ] {name} ok ({elapsed}ms)`)
	else
		warn(`[QZ] {name} FAILED after {elapsed}ms: {err}`)
	end
end

print("[QZ] booting")

local DataService = require(need("DataService"))
local PlotService = require(need("PlotService"))
local ShelterService = require(need("ShelterService"))
local WorldService = require(need("WorldService"))
local StructureService = require(need("StructureService"))
local SurvivalService = require(need("SurvivalService"))
local BuildingService = require(need("BuildingService"))

print("[QZ] modules loaded")

-- Data first: requiring it publishes the remotes the client is waiting on.
step("DataService", DataService.start)
step("PlotService", PlotService.start)
step("ShelterService", ShelterService.start)
step("SurvivalService", SurvivalService.start)

-- World last. It is the slow one, and nothing else depends on it existing.
step("WorldService", WorldService.start)

-- After the world, because both need terrain to stand on.
step("BuildingService", BuildingService.start)
step("StructureService", StructureService.start)

print("[QZ] server up")
