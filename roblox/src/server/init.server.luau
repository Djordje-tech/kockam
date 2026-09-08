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

local SurvivalService = require(need("SurvivalService"))
local AssetLibrary = require(need("AssetLibrary"))
local WorldService = require(need("WorldService"))
local BuildingService = require(need("BuildingService"))
local StructureService = require(need("StructureService"))
local VehicleService = require(need("VehicleService"))

print("[QZ] modules loaded")

-- Survival first: requiring it publishes the remotes the client waits on.
step("SurvivalService", SurvivalService.start)

-- Assets before the world, so the forest can use real models if any
-- ids are configured.
step("AssetLibrary", AssetLibrary.start)

step("WorldService", WorldService.start)
step("BuildingService", BuildingService.start)
step("StructureService", StructureService.start)

-- Last: vehicles look for asphalt, so the roads have to exist first.
step("VehicleService", VehicleService.start)

print("[QZ] server up")
