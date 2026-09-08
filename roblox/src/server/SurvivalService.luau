--!strict
-- Drives every player's body: anaerobic output, load, metabolism and core
-- temperature, and applies the result to their character each tick.
--
-- The server owns all of it. The client may ask to sprint; whether that is
-- physically possible is not its decision.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Lighting = game:GetService("Lighting")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Net = require(Shared:WaitForChild("Net"))
local Survival = require(Shared:WaitForChild("Survival"))

local SurvivalService = {}

local TICK = 0.5

-- Placeholder climate until the weather and seasons system lands. Ambient is
-- derived from time of day and altitude so thermoregulation is already real,
-- and the weather pass only has to replace this one function.
local BASE_AMBIENT_C = 17
local NIGHT_DROP_C = 9
local LAPSE_PER_STUD = 0.022      -- colder with altitude
local WATER_AMBIENT_C = 9

local vitalsOf: { [Player]: Survival.Vitals } = {}
local wantsSprint: { [Player]: boolean } = {}

local syncRemote: RemoteEvent
local sprintRemote: RemoteEvent

--- Environment -----------------------------------------------------------

local function ambientFor(root: BasePart, humanoid: Humanoid): number
	-- Roblox's clock runs 0-24; the coldest part of the cycle sits before
	-- dawn, so the curve is offset rather than centred on midnight.
	local hours = Lighting.ClockTime
	local nightness = math.clamp(math.cos((hours - 14) / 24 * math.pi * 2) * 0.5 + 0.5, 0, 1)

	local ambient = BASE_AMBIENT_C - NIGHT_DROP_C * nightness
	ambient -= math.max(0, root.Position.Y) * LAPSE_PER_STUD

	-- Immersion dominates everything else. Water pulls heat out of a body
	-- roughly twenty-five times faster than air does.
	if humanoid:GetState() == Enum.HumanoidStateType.Swimming then
		return WATER_AMBIENT_C
	end

	return ambient
end

--- Tick ------------------------------------------------------------------

local function applyToCharacter(vitals: Survival.Vitals, humanoid: Humanoid, sprinting: boolean)
	humanoid.WalkSpeed = if sprinting then Survival.sprintSpeed(vitals) else Survival.walkSpeed(vitals)
	humanoid.JumpPower = Survival.jumpPower(vitals)
end

local function stepMetabolism(vitals: Survival.Vitals, minutes: number, effort: number)
	vitals.Carbs = math.max(0, vitals.Carbs - Survival.CarbDrain * effort * minutes)
	vitals.Protein = math.max(0, vitals.Protein - Survival.ProteinDrain * minutes)
	vitals.Hydration = math.max(0, vitals.Hydration - Survival.HydrationDrain * effort * minutes)
end

local function stepThermal(vitals: Survival.Vitals, ambient: number, minutes: number, effort: number)
	-- Working raises the temperature the body is heading toward; that is why
	-- exertion staves off cold and compounds heat.
	local target = ambient + 20 + (effort - 1) * 1.6

	local delta = target - vitals.CoreTemp
	local step = math.clamp(delta, -1, 1) * Survival.ThermalRate * minutes

	-- Shivering costs water and sugar, so cold is expensive even when it is
	-- not yet dangerous.
	if vitals.CoreTemp < Survival.HypothermiaOnset then
		vitals.Carbs = math.max(0, vitals.Carbs - 0.4 * minutes)
	end

	vitals.CoreTemp += step
end

local function stepLactate(vitals: Survival.Vitals, sprinting: boolean, moving: boolean, seconds: number)
	if sprinting then
		vitals.Lactate = math.min(1, vitals.Lactate + Survival.LactateRise * seconds)

		if vitals.Lactate >= 1 then
			-- Muscle failure. Nothing gets them moving fast again until they
			-- have genuinely recovered.
			vitals.Exhausted = true
		end
		return
	end

	local rate = if moving then Survival.LactateClearWalking else Survival.LactateClearResting
	vitals.Lactate = math.max(0, vitals.Lactate - rate * Survival.clearanceMultiplier(vitals) * seconds)

	if vitals.Exhausted and vitals.Lactate <= Survival.RecoveryThreshold then
		vitals.Exhausted = false
	end
end

local function harm(humanoid: Humanoid, vitals: Survival.Vitals, minutes: number)
	local damage = 0

	if vitals.CoreTemp <= Survival.CoreTempCritical then
		damage += 9 * minutes
	elseif vitals.CoreTemp < Survival.HypothermiaOnset then
		damage += 1.6 * minutes
	elseif vitals.CoreTemp > Survival.HyperthermiaOnset + 1.5 then
		damage += 3 * minutes
	end

	-- Dehydration kills long before starvation does, and the model should
	-- reflect that rather than treating them as two identical bars.
	if vitals.Hydration <= 0 then
		damage += 6 * minutes
	end
	if vitals.Carbs <= 0 then
		damage += 1.4 * minutes
	end

	if damage > 0 then
		humanoid:TakeDamage(damage)
	end
end

local function tick(seconds: number)
	local minutes = seconds / 60

	for _, player in Players:GetPlayers() do
		local vitals = vitalsOf[player]
		if not vitals then
			continue
		end

		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		local root = character and character:FindFirstChild("HumanoidRootPart")

		if not humanoid or humanoid.Health <= 0 or not root or not root:IsA("BasePart") then
			-- Still clear lactate while dead or loading, so respawning does
			-- not hand the player a body that is already broken.
			stepLactate(vitals, false, false, seconds)
			continue
		end

		local moving = humanoid.MoveDirection.Magnitude > 0.1
		local sprinting = moving and wantsSprint[player] == true and Survival.canSprint(vitals)

		stepLactate(vitals, sprinting, moving, seconds)

		local effort = if sprinting
			then Survival.SprintMetabolicMultiplier
			elseif moving then Survival.WalkMetabolicMultiplier
			else 1

		stepMetabolism(vitals, minutes, effort)
		stepThermal(vitals, ambientFor(root, humanoid), minutes, effort)
		harm(humanoid, vitals, minutes)

		applyToCharacter(vitals, humanoid, sprinting)
		syncRemote:FireClient(player, vitals)
	end
end

--- Public ----------------------------------------------------------------

function SurvivalService.get(player: Player): Survival.Vitals?
	return vitalsOf[player]
end

-- Called by the inventory system once it exists. Mass arrives in grams
-- because that is how items are defined; the body thinks in kilograms.
function SurvivalService.setCarriedMass(player: Player, grams: number)
	local vitals = vitalsOf[player]
	if vitals then
		vitals.LoadKg = grams / 1000
	end
end

-- Food, water and medical items all land here.
function SurvivalService.feed(player: Player, carbs: number, protein: number, hydration: number)
	local vitals = vitalsOf[player]
	if not vitals then
		return
	end

	vitals.Carbs = math.clamp(vitals.Carbs + carbs, 0, 100)
	vitals.Protein = math.clamp(vitals.Protein + protein, 0, 100)
	vitals.Hydration = math.clamp(vitals.Hydration + hydration, 0, 100)

	syncRemote:FireClient(player, vitals)
end

function SurvivalService.start()
	syncRemote = Net.event("VitalsSync")
	sprintRemote = Net.event("SprintRequest")

	sprintRemote.OnServerEvent:Connect(function(player, wants)
		-- The client states intent. Whether the body can deliver it is
		-- decided in the tick, never here.
		wantsSprint[player] = wants == true
	end)

	local function onPlayerAdded(player: Player)
		vitalsOf[player] = Survival.newVitals()
		wantsSprint[player] = false
	end

	for _, player in Players:GetPlayers() do
		onPlayerAdded(player)
	end
	Players.PlayerAdded:Connect(onPlayerAdded)

	Players.PlayerRemoving:Connect(function(player)
		vitalsOf[player] = nil
		wantsSprint[player] = nil
	end)

	task.spawn(function()
		while true do
			local delta = task.wait(TICK)
			tick(delta)
		end
	end)
end

return SurvivalService
