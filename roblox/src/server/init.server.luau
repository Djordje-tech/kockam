--!strict
-- Server entry point. Order matters: data has to be ready before anything
-- reads a profile, and remotes must exist before the client asks for them.

local DataService = require(script:WaitForChild("DataService"))
local PassService = require(script:WaitForChild("PassService"))
local ShopService = require(script:WaitForChild("ShopService"))
local CoinService = require(script:WaitForChild("CoinService"))

DataService.start()
PassService.start()
ShopService.start()
CoinService.start()

print("[kockam] server up")
