--!strict
-- Server entry point. Order matters: data has to be ready before anything
-- reads a profile, and the world has to exist before players are placed in it.

local DataService = require(script:WaitForChild("DataService"))
local PlotService = require(script:WaitForChild("PlotService"))
local ShelterService = require(script:WaitForChild("ShelterService"))

DataService.start()
PlotService.start()
ShelterService.start()

print("[Quarantine Zone] server up")
