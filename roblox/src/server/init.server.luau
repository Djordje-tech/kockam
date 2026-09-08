--!strict
-- Server entry point. Order matters: the map has to exist before plots are
-- placed on it, and data has to be ready before anything reads a profile.

local MapService = require(script:WaitForChild("MapService"))
local DataService = require(script:WaitForChild("DataService"))
local PlotService = require(script:WaitForChild("PlotService"))
local ShelterService = require(script:WaitForChild("ShelterService"))

MapService.start()
DataService.start()
PlotService.start()
ShelterService.start()

print("[Quarantine Zone] server up")
